/**
 * Electron glue for Google sync and Drive backup: where the account, the client credentials and the sync state are stored,
 * the single IPC entry point (with the module permission each operation needs), and the quiet background sync.
 * The logic itself lives in google.ts (sign-in, Drive) and gsync.ts (what to upload or download).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { IpcMain, App, Shell, SafeStorage, Net } from 'electron';
import * as store from './database';
import type { ModuleKey } from './database';
import { GoogleAuth, GoogleDrive, type AccountStore, type GoogleClient } from './google';
import { SyncEngine, markDirtyIn, type StateStore, type SyncState, type SecretVault, type CryptoPort } from './gsync';
import { encryptBackup, decryptBackup, isEncryptedBackup, validatePin, hasMasterRecovery } from './backup-crypto';

// Build-time credentials (from config/google.json, git-ignored). The same values can also be entered by the Super User inside the app.
const BUILT_ID = process.env.BF_GOOGLE_CLIENT_ID_BUILT || '';
const BUILT_SECRET = process.env.BF_GOOGLE_CLIENT_SECRET_BUILT || '';

export interface GoogleCtx {
  app: App; shell: Shell; net: Net; safeStorage: SafeStorage; ipcMain: IpcMain;
  wrap: <T>(fn: () => T | Promise<T>) => Promise<{ ok: true; data: T } | { ok: false; error: string }>;
  /** a copy of the current data on this computer (kept before anything is replaced) */
  snapshot: (label: string) => string;
  /** the folder holding signed consent papers */
  docsDir: () => string;
  /** the normal restore path (safety snapshot, replace, re-check the session) */
  restoreBytes: (bytes: Buffer, name: string, origin: string) => unknown;
  /** park an encrypted backup until its PIN is entered (the same flow as restoring a local file) */
  setPendingRestore: (bytes: Buffer, name: string) => void;
}

export function setupGoogle(ctx: GoogleCtx) {
  const { app, safeStorage } = ctx;
  const dir = () => { const d = path.join(app.getPath('userData'), 'google'); fs.mkdirSync(d, { recursive: true }); return d; };
  const readJson = <T>(f: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as T; } catch { return fallback; } };
  const writeJson = (f: string, v: unknown) => { const p = path.join(dir(), f); fs.writeFileSync(`${p}.tmp`, JSON.stringify(v)); fs.renameSync(`${p}.tmp`, p); };
  const seal = (s: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the Google sign-in cannot be saved safely.');
    return safeStorage.encryptString(s).toString('base64');
  };
  const unseal = (b: string) => safeStorage.decryptString(Buffer.from(b, 'base64'));

  // ---- the stores ---------------------------------------------------------------------------------------------
  const accountStore: AccountStore = {
    load() { const j = readJson<any>('account.json', null); if (!j?.token) return null; try { return { email: j.email, name: j.name, picture: j.picture, refreshToken: unseal(j.token) }; } catch { return null; } },
    save(a) { writeJson('account.json', { email: a.email, name: a.name, picture: a.picture, token: seal(a.refreshToken) }); },
    clear() { try { fs.unlinkSync(path.join(dir(), 'account.json')); } catch { /* none */ } },
  };
  const defaultState = (): SyncState => ({ deviceId: crypto.randomUUID(), deviceName: os.hostname() || 'This computer', account: null, lastRev: 0, lastHash: '', lastSyncAt: null, dirty: false, dirtyAt: null, auto: true, encrypt: false, lastResult: null });
  const stateStore: StateStore = {
    load() { const s = readJson<SyncState | null>('sync-state.json', null); if (s && s.deviceId) return { ...defaultState(), ...s }; const d = defaultState(); writeJson('sync-state.json', d); return d; },
    save(s) { writeJson('sync-state.json', s); },
  };
  const vault: SecretVault = {
    get(k) { const j = readJson<Record<string, string>>('vault.json', {}); try { return j[k] ? unseal(j[k]) : null; } catch { return null; } },
    set(k, v) { const j = readJson<Record<string, string>>('vault.json', {}); j[k] = seal(v); writeJson('vault.json', j); },
    delete(k) { const j = readJson<Record<string, string>>('vault.json', {}); delete j[k]; writeJson('vault.json', j); },
  };
  const clientSource = (): 'app' | 'build' | null => {
    const j = readJson<any>('config.json', null);
    if (j?.clientId && j?.secret) return 'app';
    return BUILT_ID && BUILT_SECRET ? 'build' : null;
  };
  const client = (): GoogleClient | null => {
    const j = readJson<any>('config.json', null);
    if (j?.clientId && j?.secret) { try { return { clientId: j.clientId, clientSecret: unseal(j.secret) }; } catch { /* fall through */ } }
    return BUILT_ID && BUILT_SECRET ? { clientId: BUILT_ID, clientSecret: BUILT_SECRET } : null;
  };

  // every change to real data marks this computer as "has unsynced changes", connected or not
  store.setChangeHook(() => markDirtyIn(stateStore));

  const auth = new GoogleAuth({ client, store: accountStore, fetch: ((u: any, i: any) => ctx.net.fetch(u, i)) as typeof fetch, openUrl: url => ctx.shell.openExternal(url) });
  const drive = new GoogleDrive(auth, ((u: any, i: any) => ctx.net.fetch(u, i)) as typeof fetch);
  const cx: CryptoPort = { isEncrypted: isEncryptedBackup, encrypt: (b, pin) => encryptBackup(b, pin, null), decrypt: decryptBackup, validatePin };
  const engine = new SyncEngine(drive, {
    exportBytes: () => store.exportBytes(),
    replaceWith: b => store.replaceWith(b),
    hasData: () => store.syncHasData(),
    counts: () => store.syncCounts(),
    safetySnapshot: label => { ctx.snapshot(label); },
    docs: () => store.consentFiles().filter(f => f.sha256 && fs.existsSync(f.file)).map(f => ({ name: path.basename(f.file), sha256: f.sha256, size: f.size, read: () => fs.readFileSync(f.file) })),
    hasDoc: n => fs.existsSync(path.join(ctx.docsDir(), path.basename(n))),
    saveDoc: (n, b) => fs.writeFileSync(path.join(ctx.docsDir(), path.basename(n)), b),
    afterPull: () => { store.rebaseConsentFiles(ctx.docsDir()); store.revalidateSession(); },
  }, stateStore, vault, cx, () => auth.account()?.email || null);

  // ---- operations, with the module that guards each ---------------------------------------------------------------
  const deviceName = () => os.hostname() || 'This computer';
  const ops: Record<string, { need: ModuleKey[]; level: 'view' | 'edit'; system?: boolean; fn: (...a: any[]) => any }> = {
    status: { need: ['google_sync', 'drive_backup'], level: 'view', fn: () => {
      const st = engine.state();
      return {
        configured: auth.isConfigured(), clientSource: clientSource(), canConfigure: !!store.api.getSession()?.canUpload, secureStorage: safeStorage.isEncryptionAvailable(),
        account: auth.account(), device: deviceName(), hasPin: engine.hasPin(),
        sync: { lastSyncAt: st.lastSyncAt, lastRev: st.lastRev, dirty: st.dirty, dirtyAt: st.dirtyAt, auto: st.auto, encrypt: st.encrypt, lastResult: st.lastResult },
      };
    } },
    saveConfig: { need: ['google_sync'], level: 'edit', system: true, fn: (cfg: { clientId: string; clientSecret: string }) => {
      const id = String(cfg?.clientId || '').trim(), secret = String(cfg?.clientSecret || '').trim();
      if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id)) throw new Error('The client ID should look like 123456789012-abcdef….apps.googleusercontent.com');
      if (secret.length < 10) throw new Error('Paste the client secret that Google shows next to the client ID.');
      writeJson('config.json', { clientId: id, secret: seal(secret) });
      return true;
    } },
    clearConfig: { need: ['google_sync'], level: 'edit', system: true, fn: () => { try { fs.unlinkSync(path.join(dir(), 'config.json')); } catch { /* none */ } return true; } },
    connect: { need: ['google_sync'], level: 'edit', fn: async () => { const a = await auth.signIn(); engine.state(); return a; } },
    disconnect: { need: ['google_sync'], level: 'edit', fn: async () => { await auth.signOut(); return true; } },
    check: { need: ['google_sync'], level: 'view', fn: () => engine.checkRemote() },
    sync: { need: ['google_sync'], level: 'edit', fn: (opts?: { resolve?: 'local' | 'remote'; pin?: string }) => engine.syncNow({ resolve: opts?.resolve, pin: opts?.pin }) },
    setAuto: { need: ['google_sync'], level: 'edit', fn: (on: boolean) => { engine.setAuto(!!on); return true; } },
    setEncryption: { need: ['google_sync'], level: 'edit', fn: (enabled: boolean, pin?: string) => { engine.setEncryption(!!enabled, pin); return true; } },

    driveList: { need: ['drive_backup'], level: 'view', fn: () => engine.listBackups() },
    driveBackup: { need: ['drive_backup'], level: 'edit', fn: async (pin: string) => {
      validatePin(pin);                                                    // refuse before reading or uploading anything
      const pub = store.getMasterRecoveryPub();
      const bytes = encryptBackup(store.exportBytes(), pin, pub ? Buffer.from(pub, 'base64') : null);
      const f = await engine.uploadBackup(bytes, { device: deviceName(), encrypted: true });
      store.logBackup(f.name, 'Google Drive', bytes.length, 'Manual');
      return { name: f.name, size: bytes.length };
    } },
    driveRestore: { need: ['drive_backup'], level: 'edit', fn: async (id: string) => {
      store.requireAdmin();
      const found = (await engine.listBackups()).find(b => b.id === id);
      if (!found) throw new Error('That backup is no longer in Google Drive.');
      const bytes = await engine.downloadBackup(id);
      if (isEncryptedBackup(bytes)) {
        ctx.setPendingRestore(bytes, found.name);
        return { canceled: false, needsPin: true, fileName: found.name, masterRecovery: hasMasterRecovery(bytes) && !!store.api.getSession()?.canUpload };
      }
      return ctx.restoreBytes(bytes, found.name, 'Google Drive');
    } },
    driveDelete: { need: ['drive_backup'], level: 'edit', fn: async (id: string) => { await engine.deleteBackup(id); return true; } },
  };

  ctx.ipcMain.handle('google:call', (_e, method: string, args: any[]) => ctx.wrap(async () => {
    const op = ops[method];
    if (!op) throw new Error(`Unknown Google operation: ${method}`);
    store.requireModule(op.need, op.level);
    if (op.system) store.requireUpload();
    return await op.fn(...(Array.isArray(args) ? args : []));
  }));

  // ---- quiet background sync ----------------------------------------------------------------------------------------
  const autoOn = () => { try { return !!auth.account() && engine.state().auto; } catch { return false; } };
  return {
    /** at start-up (nobody is signed in yet) a full safe sync; afterwards only uploads of changes, every 10 minutes */
    startAuto() {
      setTimeout(() => { if (autoOn()) engine.syncNow({ auto: true }).catch(() => undefined); }, 20_000);
      setInterval(() => { if (autoOn() && engine.state().dirty) engine.syncNow({ auto: true, pushOnly: true }).catch(() => undefined); }, 10 * 60_000).unref?.();
    },
  };
}
