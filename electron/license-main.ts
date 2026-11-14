/**
 * Electron glue for the software licence: where the state and the secrets are kept, the IPC entry point, the regular
 * check-in, and the gate that keeps non-owner accounts out while a copy is locked (see license.ts for the rules).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IpcMain, App, SafeStorage, Net } from 'electron';
import * as store from './database';
import { LicenseClient, LicenseAdmin, CHECK_EVERY_MS, freshState, groupPin, type LicenseState, type LicenseConfig, type AdminSession } from './license';

// Build-time settings (config/supabase.json, git-ignored). The publishable key is designed to be public: it can only call bf_activate and bf_check.
const BUILT_URL = process.env.BF_SUPABASE_URL_BUILT || '';
const BUILT_KEY = process.env.BF_SUPABASE_KEY_BUILT || '';
const BUILT_ENFORCE = process.env.BF_LICENSE_ENFORCE_BUILT === '1';

export interface LicenseCtx {
  app: App; net: Net; safeStorage: SafeStorage; ipcMain: IpcMain;
  wrap: <T>(fn: () => T | Promise<T>) => Promise<{ ok: true; data: T } | { ok: false; error: string }>;
  /** tell every open window that the licence state changed */
  broadcast: (channel: string) => void;
}

export function setupLicense(ctx: LicenseCtx) {
  const { app, safeStorage } = ctx;
  const dir = () => { const d = path.join(app.getPath('userData'), 'license'); fs.mkdirSync(d, { recursive: true }); return d; };
  const readJson = <T>(f: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as T; } catch { return fallback; } };
  const writeJson = (f: string, v: unknown) => { const p = path.join(dir(), f); fs.writeFileSync(`${p}.tmp`, JSON.stringify(v)); fs.renameSync(`${p}.tmp`, p); };
  const seal = (s: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the licence cannot be saved safely.');
    return safeStorage.encryptString(s).toString('base64');
  };
  const unseal = (b: string) => safeStorage.decryptString(Buffer.from(b, 'base64'));
  const secret = {
    get: (k: string): string | null => { const j = readJson<Record<string, string>>('vault.json', {}); try { return j[k] ? unseal(j[k]) : null; } catch { return null; } },
    set: (k: string, v: string) => { const j = readJson<Record<string, string>>('vault.json', {}); j[k] = seal(v); writeJson('vault.json', j); },
    del: (k: string) => { const j = readJson<Record<string, string>>('vault.json', {}); delete j[k]; writeJson('vault.json', j); },
  };

  const cfg: LicenseConfig | null = BUILT_URL && BUILT_KEY ? { url: BUILT_URL, key: BUILT_KEY } : null;
  const netFetch = ((u: any, i: any) => ctx.net.fetch(u, i)) as typeof fetch;
  const device = () => os.hostname() || 'This computer';

  const client = new LicenseClient(cfg, BUILT_ENFORCE && !!cfg, netFetch,
    { load: () => { const s = readJson<LicenseState | null>('state.json', null); if (s?.installId) return { ...freshState(), ...s, slots: s.slots || {} }; const f = freshState(); writeJson('state.json', f); return f; }, save: s => writeJson('state.json', s) },
    { get: slot => secret.get(`device-token:${slot}`), set: (slot, t) => secret.set(`device-token:${slot}`, t), clear: slot => secret.del(`device-token:${slot}`) },
    device, () => app.getVersion());
  const admin = new LicenseAdmin(cfg, netFetch, {
    load: () => { const j = secret.get('admin-session'); try { return j ? JSON.parse(j) as AdminSession : null; } catch { return null; } },
    save: s => secret.set('admin-session', JSON.stringify(s)),
    clear: () => secret.del('admin-session'),
  });

  // Everyone but iqbal_labs needs a licence of their own or the computer's; the sign-in screen asks for the PIN when there is none.
  store.setAccessGate(username => client.gate(username));
  const sessionUser = (): string | null => { try { return store.api.getSession()?.user?.username ?? null; } catch { return null; } };

  // After every check: the signed-in user, if their licence just ended, is signed out at once (reading the session applies the gate), and the windows are told.
  let lastKey = '';
  const announce = () => {
    const u = sessionUser();
    const v = client.view(u);
    const key = `${u}|${v.locked}|${v.reason}|${v.status}|${v.paidUntil}|${v.message}`;
    if (key !== lastKey) { lastKey = key; ctx.broadcast('license:changed'); }
  };
  lastKey = (() => { const u = sessionUser(); const v = client.view(u); return `${u}|${v.locked}|${v.reason}|${v.status}|${v.paidUntil}|${v.message}`; })();

  const publicView = () => client.view(sessionUser());
  const sysOnly = () => store.requireUpload();

  const ops: Record<string, { system?: boolean; fn: (...a: any[]) => any }> = {
    // any window, signed in or not: the lock screen needs these
    status: { fn: () => publicView() },
    activate: { fn: async (pin: string, username?: string) => { const v = await client.activate(pin, username); announce(); return v; } },
    register: { fn: async (username: string) => { const v = await client.register(username); announce(); return v; } },
    check: { fn: async () => { await client.check(); announce(); return publicView(); } },

    // iqbal_labs only
    adminState: { system: true, fn: () => ({ configured: !!cfg, enforced: BUILT_ENFORCE && !!cfg, url: cfg?.url || '', account: admin.account() }) },
    adminSignIn: { system: true, fn: (email: string, password: string) => admin.signIn(email, password) },
    adminSignOut: { system: true, fn: () => { admin.signOut(); return true; } },
    adminList: { system: true, fn: async () => (await admin.list()).map(r => ({ ...r, pin_display: groupPin(r.pin) })) },
    adminPayments: { system: true, fn: (id?: string) => admin.payments(id) },
    adminCreate: { system: true, fn: async (input: any) => { const r = await admin.create(input); return { ...r, pin_display: groupPin(r.pin) }; } },
    adminUpdate: { system: true, fn: async (id: string, patch: any) => { const r = await admin.update(id, patch); return { ...r, pin_display: groupPin(r.pin) }; } },
    adminResetDevice: { system: true, fn: async (id: string) => { const r = await admin.resetDevice(id); return { ...r, pin_display: groupPin(r.pin) }; } },
    adminExtend: { system: true, fn: async (id: string, o: any) => { const r = await admin.extend(id, o); return { ...r, pin_display: groupPin(r.pin) }; } },
    adminRemove: { system: true, fn: (id: string) => admin.remove(id) },
    adminRemoveDevice: { system: true, fn: (id: string) => admin.removeDevice(id) },
    adminAddUser: { system: true, fn: (licenseId: string, username: string, note?: string) => admin.addUser(licenseId, username, note) },
    adminRemoveUser: { system: true, fn: (id: string) => admin.removeUser(id) },
  };

  ctx.ipcMain.handle('license:call', (_e, method: string, args: any[]) => ctx.wrap(async () => {
    const op = Object.prototype.hasOwnProperty.call(ops, method) ? ops[method] : null;
    if (!op) throw new Error(`Unknown licence operation: ${method}`);
    if (op.system) sysOnly();
    return await op.fn(...(Array.isArray(args) ? args : []));
  }));

  return {
    /** a check shortly after start, then every few minutes while the app is open */
    start() {
      if (!cfg) return;
      const tick = () => { client.check().then(announce).catch(() => undefined); };
      setTimeout(tick, 3000);
      setInterval(tick, CHECK_EVERY_MS).unref?.();
    },
    client,
  };
}
