/**
 * Software licence: an activation PIN, a paid-until date and a remote lock, kept in the vendor's Supabase project.
 *
 * Two parts, both free of Electron so they can be tested against a fake server:
 *   LicenseClient  what every installed copy does: activate with a PIN, check in regularly, decide "may this user sign in".
 *   LicenseAdmin   what only the iqbal_labs panel does: sign in to Supabase and manage customers, PINs and payments.
 *
 * A PIN can be tagged to one username ("user" licence: only that person needs and gets it) or left untagged
 * ("computer" licence: it covers everybody who signs in on that computer). A user may sign in when their own licence
 * or the computer licence is active. The owner account (iqbal_labs) is never subject to any of this.
 *
 * Locking never deletes or changes any data. It only stops the affected accounts from signing in or continuing, and it
 * ends the moment the licence is active again. An offline computer keeps working until the paid-until date, for at most
 * OFFLINE_GRACE_DAYS since the last successful check.
 */
import * as crypto from 'crypto';

export const CHECK_EVERY_MS = 10 * 60_000;
export const OFFLINE_GRACE_DAYS = 14;
const DAY = 86_400_000;
/** the slot of an untagged (whole-computer) licence */
export const COMPUTER = '*';

export interface LicenseConfig { url: string; key: string }
export type LicenseStatus = 'active' | 'suspended' | 'revoked';
export type LockReason = 'none' | 'not_activated' | 'suspended' | 'revoked' | 'expired' | 'needs_check' | 'invalid' | 'not_registered' | 'not_allowed';

export interface LicenseSnapshot {
  customer: string; username: string | null; status: LicenseStatus; paidUntil: string | null; message: string; serverTime: string; okAt: number;
  /** limits of this licence, and the users already counted against max users (whole-customer licences) */
  maxDevices: number; maxUsers: number | null; users: string[];
  /** true: only the listed users may sign in (the list is kept by the vendor) */
  restrict: boolean;
}
/** one activated PIN on this computer: the computer's own, or one user's */
export interface Slot { activated: boolean; snapshot: LicenseSnapshot | null; invalid: boolean; lastError: string | null; lastTryAt: number | null }
export interface LicenseState {
  installId: string;
  /** the latest time seen since the last check: while offline, setting the clock back cannot buy more days */
  maxSeen: number;
  /** server time minus this computer's clock at the last successful check: online, the server decides what time it is */
  skew: number;
  slots: Record<string, Slot>;
}
export interface StateStore { load(): LicenseState; save(s: LicenseState): void }
export interface TokenVault { get(slot: string): string | null; set(slot: string, t: string): void; clear(slot: string): void }

export interface LicenseView {
  /** false: this build does not enforce a licence (nothing is ever locked) */
  enforced: boolean; configured: boolean; locked: boolean; reason: LockReason; message: string;
  /** which licence decided this: the user's own, the computer's, or none */
  scope: 'user' | 'computer' | null; username: string;
  customer: string; paidUntil: string | null; daysLeft: number | null; status: LicenseStatus | null;
  installId: string; lastCheckAt: number | null; lastError: string | null;
}

export const freshState = (): LicenseState => ({ installId: crypto.randomUUID(), maxSeen: 0, skew: 0, slots: {} });
const emptySlot = (): Slot => ({ activated: false, snapshot: null, invalid: false, lastError: null, lastTryAt: null });
export const slotKey = (username?: string | null) => (username ? String(username).trim().toLowerCase() : COMPUTER);

export class LicenseFailure extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'LicenseFailure'; }
}
const TEXT: Record<string, string> = {
  invalid_pin: 'That activation PIN is not correct. Check it and try again.',
  pin_used: 'This PIN has already been used on another computer. Ask for a new PIN.',
  wrong_user: 'This PIN was issued for a different user.',
  device_limit: 'This licence is already in use on the maximum number of computers. Ask the software provider to remove an old computer or raise the limit.',
  user_limit: 'This licence allows only a limited number of users and all of them are already taken. Ask the software provider.',
  user_not_allowed: 'This username is not on the licence. Ask the software provider to add it.',
  revoked: 'This licence has been withdrawn. Contact the software provider.',
  invalid_token: 'This computer is no longer registered. Enter a new activation PIN.',
};
/** the sign-in gate talks to the login screen in these codes: LICENSE_PIN_REQUIRED:<reason>|<message> or LICENSE_LOCKED:<reason>|<message> */
export const GATE_PIN = 'LICENSE_PIN_REQUIRED', GATE_LOCKED = 'LICENSE_LOCKED', GATE_REGISTER = 'LICENSE_REGISTER';

async function rpc(cfg: LicenseConfig, fetchFn: typeof fetch, name: string, body: unknown, bearer?: string): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetchFn(`${cfg.url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', apikey: cfg.key, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) throw new LicenseFailure('http', json?.message || json?.error_description || `The licence server answered ${res.status}.`);
    return json;
  } catch (e: any) {
    if (e instanceof LicenseFailure) throw e;
    throw new LicenseFailure('network', e?.name === 'AbortError' ? 'The licence server did not answer in time.' : 'Cannot reach the licence server. Check the internet connection.');
  } finally { clearTimeout(timer); }
}

export class LicenseClient {
  private st: LicenseState;
  private persistedMax = 0;
  /** users who signed in since the last check; reported to the server so you can see who uses which computer */
  private recent = new Set<string>();
  constructor(
    private cfg: LicenseConfig | null,
    private enforce: boolean,
    private fetchFn: typeof fetch,
    private store: StateStore,
    private vault: TokenVault,
    private device: () => string,
    private version: () => string,
    private clock: () => number = Date.now,
  ) { this.st = store.load(); if (!this.st.slots) this.st.slots = {}; this.persistedMax = this.st.maxSeen; }

  private now(): number {
    const t = Math.max(this.clock() + (this.st.skew || 0), this.st.maxSeen);
    if (t > this.st.maxSeen) { this.st.maxSeen = t; if (t - this.persistedMax > 60_000) this.save(); }
    return t;
  }
  private save() { this.persistedMax = this.st.maxSeen; this.store.save(this.st); }

  private slotReason(slot: Slot, now: number): LockReason {
    const snap = slot.snapshot;
    if (!slot.activated || !snap) return slot.invalid ? 'invalid' : 'not_activated';
    if (snap.status === 'revoked') return 'revoked';
    if (snap.status === 'suspended') return 'suspended';
    if (snap.paidUntil && Date.parse(snap.paidUntil) < now) return 'expired';
    if (now - snap.okAt > OFFLINE_GRACE_DAYS * DAY) return 'needs_check';
    return 'none';
  }

  /**
   * The decision for one user: the user's own licence or the computer's, whichever lets them in (the one running longest wins).
   * If neither does, the reason comes from the user's own licence when they have one. Cheap and synchronous; never uses the network.
   */
  view(username?: string | null): LicenseView {
    const s = this.st, now = this.now(), user = slotKey(username);
    const keys = user === COMPUTER ? [COMPUTER] : [user, COMPUTER];
    const reasonFor = (k: string): LockReason => {
      const slot = s.slots[k];
      if (!slot) return 'not_activated';
      const r = this.slotReason(slot, now);
      // a whole-customer licence with a user limit only lets in users it has counted (a new one is counted online, once)
      if (r === 'none' && k === COMPUTER && user !== COMPUTER && !(slot.snapshot!.users || []).includes(user)) {
        if (slot.snapshot!.restrict) return 'not_allowed';                       // an allowlist: only the names the vendor added
        if (slot.snapshot!.maxUsers != null) return 'not_registered';           // a user limit: a new user is counted online, once
      }
      return r;
    };
    const cand = keys.map(k => ({ k, slot: s.slots[k], reason: reasonFor(k) }));
    const open = cand.filter(c => c.slot && c.reason === 'none').sort((a, b) => (b.slot!.snapshot!.paidUntil ? Date.parse(b.slot!.snapshot!.paidUntil!) : Infinity) - (a.slot!.snapshot!.paidUntil ? Date.parse(a.slot!.snapshot!.paidUntil!) : Infinity));
    const pick = open[0] || cand.find(c => c.slot) || cand[0];
    const snap = pick.slot?.snapshot ?? null;
    const reason: LockReason = !this.enforce ? 'none' : !this.cfg ? 'not_activated' : pick.reason;
    return {
      enforced: this.enforce, configured: !!this.cfg, locked: reason !== 'none', reason, message: snap?.message ?? '',
      scope: pick.slot ? (pick.k === COMPUTER ? 'computer' : 'user') : null, username: username || '',
      customer: snap?.customer ?? '', paidUntil: snap?.paidUntil ?? null, status: snap?.status ?? null, installId: s.installId,
      daysLeft: snap?.paidUntil ? Math.ceil((Date.parse(snap.paidUntil) - now) / DAY) : null,
      lastCheckAt: snap?.okAt ?? null, lastError: pick.slot?.lastError ?? null,
    };
  }

  /** What the sign-in gate throws for this user, or null when they may sign in. */
  gate(username: string): string | null {
    const v = this.view(username);
    if (!v.locked) { if (this.cfg && this.enforce && username) this.recent.add(slotKey(username)); return null; }
    const code = v.reason === 'not_activated' || v.reason === 'invalid' ? GATE_PIN : v.reason === 'not_registered' ? GATE_REGISTER : GATE_LOCKED;
    return `${code}:${v.reason}|${v.message}`;
  }

  private apply(key: string, r: any) {
    if (!r || r.ok !== true) throw new LicenseFailure(String(r?.error || 'failed'), TEXT[String(r?.error)] || 'The licence server refused the request.');
    const serverMs = Date.parse(r.server_time);
    const snap: LicenseSnapshot = { customer: String(r.customer || ''), username: r.username ? String(r.username) : null,
      status: (['active', 'suspended', 'revoked'].includes(r.status) ? r.status : 'suspended') as LicenseStatus,
      paidUntil: r.paid_until || null, message: String(r.message || ''), serverTime: String(r.server_time || ''), okAt: 0,
      maxDevices: Number(r.max_devices) || 1, maxUsers: r.max_users == null ? null : Number(r.max_users), users: Array.isArray(r.users) ? r.users.map((u: any) => String(u).toLowerCase()) : [], restrict: !!r.restrict_users };
    if (Number.isFinite(serverMs)) { this.st.skew = serverMs - this.clock(); this.st.maxSeen = serverMs; }   // online, the server's clock is the truth (it corrects a PC clock that is wrong either way)
    snap.okAt = this.now();
    this.st.slots[key] = { activated: true, snapshot: snap, invalid: false, lastError: null, lastTryAt: snap.okAt };
    this.save();
  }

  /**
   * Activate a PIN for the user who is signing in. A PIN tagged to a username only works for that user; an untagged PIN
   * activates the whole computer. The licence it activates is stored under the tag, not under the name typed.
   */
  async activate(pin: string, username?: string): Promise<LicenseView> {
    if (!this.cfg) throw new LicenseFailure('not_configured', 'Licensing is not set up in this build.');
    const clean = String(pin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (clean.length < 8) throw new LicenseFailure('invalid_pin', TEXT.invalid_pin);
    const r = await rpc(this.cfg, this.fetchFn, 'bf_activate', { p_pin: clean, p_install: this.st.installId, p_device: this.device(), p_version: this.version(), p_username: username || null });
    const key = slotKey(r?.ok === true ? r.username : null);
    this.apply(key, r);
    this.vault.set(key, String(r.token));
    return this.view(username);
  }

  /** Ask the server about every licence on this computer. A failed attempt (no internet) keeps what is known and is reported in lastError. */
  async check(): Promise<void> {
    if (!this.cfg) return;
    const seen = [...this.recent];
    let allOk = true;
    for (const key of Object.keys(this.st.slots)) {
      const slot = this.st.slots[key];
      const token = this.vault.get(key);
      if (!slot.activated || !token) continue;
      slot.lastTryAt = this.now();
      // a user's own licence hears about that user only; the customer licence hears about everybody who has no licence of their own
      const mine = key === COMPUTER ? seen.filter(u => !this.st.slots[u]) : seen.filter(u => u === key);
      try {
        const r = await rpc(this.cfg, this.fetchFn, 'bf_check', { p_token: token, p_device: this.device(), p_version: this.version(), p_users: mine });
        if (r?.ok === false && r.error === 'invalid_token') {
          this.vault.clear(key); this.st.slots[key] = { ...emptySlot(), invalid: true }; this.save();
        } else this.apply(key, r);
      } catch (e: any) {
        allOk = false;
        slot.lastError = e?.message || 'The licence check failed.'; this.save();
      }
    }
    if (allOk) for (const u of seen) this.recent.delete(u);
  }

  /** A user signing in for the first time on a computer that already has the customer licence is counted against max users (online, no PIN). */
  async register(username: string): Promise<LicenseView> {
    if (!this.cfg) throw new LicenseFailure('not_configured', 'Licensing is not set up in this build.');
    const token = this.vault.get(COMPUTER);
    if (!token || !this.st.slots[COMPUTER]?.activated) throw new LicenseFailure('not_activated', 'This computer is not activated.');
    const r = await rpc(this.cfg, this.fetchFn, 'bf_register_user', { p_token: token, p_username: username });
    if (r?.ok === false && r.error === 'invalid_token') { this.vault.clear(COMPUTER); this.st.slots[COMPUTER] = { ...emptySlot(), invalid: true }; this.save(); throw new LicenseFailure('invalid_token', TEXT.invalid_token); }
    this.apply(COMPUTER, r);
    return this.view(username);
  }
}

// ---------------------------------------------------------------------------------------------- vendor panel
export interface AdminSession { email: string; access: string; refresh: string; expiresAt: number }
export interface SessionStore { load(): AdminSession | null; save(s: AdminSession): void; clear(): void }
export interface DeviceRow { id: string; license_id: string; install_id: string; device_name: string | null; app_version: string | null; last_user: string | null; first_seen: string; last_seen: string }
export interface UserRow { id: string; license_id: string; username: string; note: string | null; first_seen: string; last_seen: string | null }
export interface LicenseRow {
  id: string; customer: string; username: string | null; contact: string | null; notes: string | null; pin: string; status: LicenseStatus; paid_until: string | null; monthly_fee: number;
  message: string | null; max_devices: number; max_users: number | null; restrict_users: boolean; created_at: string;
  devices: DeviceRow[]; users: UserRow[];
}
export interface PaymentRow { id: string; license_id: string; amount: number; months: number; days: number; paid_on: string; method: string | null; note: string | null; period_from: string | null; period_to: string | null; created_at: string }

const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           // no 0/O/1/I, so a PIN read out loud is not misheard
export function newPin(): string { let p = ''; for (let i = 0; i < 12; i++) p += PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)]; return p; }
const cleanName = (u: string) => String(u || '').trim().toLowerCase();
/** a limit typed by the vendor: a whole number from 1 to 1000, or none */
function limit(v: unknown, empty: number | null): number | null {
  if (v === null || v === undefined || v === '') return empty;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 1000) throw new LicenseFailure('input', 'A limit must be a whole number from 1 to 1000 (leave users empty for any number).');
  return n;
}
export const groupPin = (p: string) => (p || '').replace(/(.{4})(?=.)/g, '$1-');

export class LicenseAdmin {
  constructor(private cfg: LicenseConfig | null, private fetchFn: typeof fetch, private sessions: SessionStore, private clock: () => number = Date.now) {}
  private base() { if (!this.cfg) throw new LicenseFailure('not_configured', 'This build has no Supabase project configured (config/supabase.json).'); return this.cfg.url.replace(/\/+$/, ''); }

  account(): string | null { return this.sessions.load()?.email ?? null; }
  signOut() { this.sessions.clear(); }

  private async raw(url: string, init: RequestInit, bearer?: string): Promise<any> {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const res = await this.fetchFn(url, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', apikey: this.cfg!.key, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(init.headers as any) } });
      const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
      if (!res.ok) { const e = new LicenseFailure(res.status === 401 ? 'unauthorized' : 'http', json?.message || json?.msg || json?.error_description || json?.hint || `The server answered ${res.status}.`); (e as any).status = res.status; throw e; }
      return json;
    } catch (e: any) {
      if (e instanceof LicenseFailure) throw e;
      throw new LicenseFailure('network', e?.name === 'AbortError' ? 'The server did not answer in time.' : 'Cannot reach Supabase. Check the internet connection.');
    } finally { clearTimeout(timer); }
  }

  async signIn(email: string, password: string): Promise<string> {
    const base = this.base();
    const e = String(email || '').trim();
    if (!e || !password) throw new LicenseFailure('input', 'Enter the email and password of your Supabase admin user.');
    let r: any;
    try { r = await this.raw(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: e, password }) }); }
    catch (err: any) { throw err.code === 'http' ? new LicenseFailure('auth', 'Sign-in refused: check the email and password of the Supabase admin user.') : err; }
    this.sessions.save({ email: r.user?.email || e, access: r.access_token, refresh: r.refresh_token, expiresAt: this.clock() + (Number(r.expires_in) || 3600) * 1000 });
    return r.user?.email || e;
  }

  private async token(): Promise<string> {
    const s = this.sessions.load();
    if (!s) throw new LicenseFailure('not_signed_in', 'Sign in to Supabase first.');
    if (s.expiresAt - 60_000 > this.clock()) return s.access;
    try {
      const r = await this.raw(`${this.base()}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh }) });
      this.sessions.save({ email: s.email, access: r.access_token, refresh: r.refresh_token, expiresAt: this.clock() + (Number(r.expires_in) || 3600) * 1000 });
      return r.access_token;
    } catch (e: any) {
      if (e.code === 'network') throw e;
      this.sessions.clear(); throw new LicenseFailure('not_signed_in', 'The Supabase sign-in has expired. Sign in again.');
    }
  }
  private async api(path: string, init: RequestInit = {}): Promise<any> {
    const url = `${this.base()}${path}`;
    try { return await this.raw(url, init, await this.token()); }
    catch (e: any) {
      if (e.code === 'unauthorized') { this.sessions.clear(); throw new LicenseFailure('not_signed_in', 'The Supabase sign-in has expired. Sign in again.'); }
      if (e.status === 404 || /schema cache|does not exist/i.test(String(e.message))) throw new LicenseFailure('not_installed', 'The licence tables are not in this Supabase project yet. Run docs/supabase/license.sql in the SQL editor.');
      throw e;
    }
  }
  private one(r: any) { const row = Array.isArray(r) ? r[0] : r; if (!row) throw new LicenseFailure('denied', 'Nothing was changed. This Supabase user is probably not listed in bf_admins (see the last lines of docs/supabase/license.sql).'); return row; }

  async list(): Promise<LicenseRow[]> {
    const rows: any[] = await this.api('/rest/v1/bf_licenses?select=*,bf_devices(id,license_id,install_id,device_name,app_version,last_user,first_seen,last_seen),bf_license_users(*)&order=created_at.desc');
    return rows.map(({ bf_devices, bf_license_users, ...l }) => ({ ...l, devices: bf_devices || [], users: bf_license_users || [] })) as LicenseRow[];
  }
  /** a computer is released: it is locked at its next check and its place is free again */
  async removeDevice(id: string): Promise<boolean> { this.one(await this.api(`/rest/v1/bf_devices?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=representation' } })); return true; }
  /** Put a username on the licence's allowlist (or just count it). Refused when the user limit is already full. */
  async addUser(licenseId: string, username: string, note?: string): Promise<UserRow> {
    const name = cleanName(username);
    if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new LicenseFailure('input', 'A username has 3–32 letters, digits, dot, dash or underscore (the same rule as in the app).');
    const lic: any[] = await this.api(`/rest/v1/bf_licenses?id=eq.${encodeURIComponent(licenseId)}&select=id,username,max_users,bf_license_users(id,username)`);
    if (!lic[0]) throw new LicenseFailure('denied', 'Licence not found.');
    const have: any[] = lic[0].bf_license_users || [];
    if (have.some(u => u.username === name)) throw new LicenseFailure('input', `"${name}" is already on this licence.`);
    if (lic[0].username) throw new LicenseFailure('input', 'A PIN tagged to one user cannot have a list of users.');
    if (lic[0].max_users != null && have.length >= lic[0].max_users) throw new LicenseFailure('input', `This licence allows ${lic[0].max_users} users and the list is full. Raise the limit or remove a user first.`);
    const r = await this.api('/rest/v1/bf_license_users', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ license_id: licenseId, username: name, note: note?.trim() || null }) });
    return this.one(r);
  }
  /** a user is released: their place under max users is free again */
  async removeUser(id: string): Promise<boolean> { this.one(await this.api(`/rest/v1/bf_license_users?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=representation' } })); return true; }
  async payments(licenseId?: string): Promise<PaymentRow[]> {
    const q = licenseId ? `&license_id=eq.${encodeURIComponent(licenseId)}` : '';
    return (await this.api(`/rest/v1/bf_license_payments?select=*&order=paid_on.desc,created_at.desc${q}`)) as PaymentRow[];
  }
  async create(input: { customer: string; username?: string; contact?: string; notes?: string; monthly_fee?: number; message?: string; months?: number; days?: number; max_devices?: number; max_users?: number | null; restrict_users?: boolean; users?: string[] }): Promise<LicenseRow> {
    const customer = String(input.customer || '').trim();
    if (!customer) throw new LicenseFailure('input', 'Enter the customer name.');
    const months = Math.max(0, Math.min(120, Math.floor(Number(input.months ?? 1)) || 0));
    const days = Math.max(0, Math.min(3650, Math.floor(Number(input.days ?? 0)) || 0));
    const paid = months > 0 || days > 0 ? new Date(this.clock()) : null;      // both 0 = no expiry
    if (paid) { paid.setMonth(paid.getMonth() + months); paid.setDate(paid.getDate() + days); }
    const r = await this.api('/rest/v1/bf_licenses', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({
      customer, username: input.username?.trim() || null, contact: input.contact?.trim() || null, notes: input.notes?.trim() || null, pin: newPin(), monthly_fee: Math.max(0, Number(input.monthly_fee) || 0),
      message: input.message?.trim() || null, paid_until: paid ? paid.toISOString() : null,
      max_devices: limit(input.max_devices, 1) ?? 1, max_users: limit(input.max_users, null), restrict_users: !!input.restrict_users && !input.username?.trim() }) });
    const row = this.one(r);
    const names = input.username?.trim() ? [] : [...new Set((input.users || []).map(cleanName).filter(Boolean))];
    for (const u of names) await this.addUser(row.id, u);
    return { devices: [], users: [], ...row };
  }
  async update(id: string, patch: Partial<Pick<LicenseRow, 'customer' | 'username' | 'contact' | 'notes' | 'monthly_fee' | 'message' | 'status' | 'paid_until' | 'max_devices' | 'max_users' | 'restrict_users'>>): Promise<LicenseRow> {
    const allowed: any = {};
    for (const k of ['customer', 'username', 'contact', 'notes', 'monthly_fee', 'message', 'status', 'paid_until', 'max_devices', 'max_users', 'restrict_users'] as const) if (k in patch) allowed[k] = (patch as any)[k];
    if ('max_devices' in allowed) allowed.max_devices = limit(allowed.max_devices, 1) ?? 1;
    if ('max_users' in allowed) allowed.max_users = limit(allowed.max_users, null);
    if ('restrict_users' in allowed) allowed.restrict_users = !!allowed.restrict_users;
    if ('status' in allowed && !['active', 'suspended', 'revoked'].includes(allowed.status)) throw new LicenseFailure('input', 'Unknown status.');
    if ('username' in allowed) allowed.username = String(allowed.username || '').trim() || null;
    if ('customer' in allowed && !String(allowed.customer || '').trim()) throw new LicenseFailure('input', 'The customer name cannot be empty.');
    return this.one(await this.api(`/rest/v1/bf_licenses?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(allowed) }));
  }
  /** A new PIN, and every computer using the old one is released (locked at its next check): use when a PIN got into the wrong hands. */
  async resetDevice(id: string): Promise<LicenseRow> {
    const row = this.one(await this.api(`/rest/v1/bf_licenses?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ pin: newPin() }) }));
    await this.api(`/rest/v1/bf_devices?license_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { devices: [], users: [], ...row };
  }
  async extend(id: string, o: { months: number; days?: number; amount: number; method?: string; note?: string; paidOn?: string }): Promise<LicenseRow> {
    const months = Math.floor(Number(o.months));
    if (!Number.isFinite(months) || months < 0 || months > 120) throw new LicenseFailure('input', 'Months must be between 0 and 120.');
    const days = Math.floor(Number(o.days ?? 0));
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw new LicenseFailure('input', 'Days must be between 0 and 3650.');
    return this.one(await this.api('/rest/v1/rpc/bf_extend', { method: 'POST', body: JSON.stringify({ p_license: id, p_months: months, ...(days > 0 ? { p_days: days } : {}), p_amount: Math.max(0, Number(o.amount) || 0), p_method: o.method || null, p_note: o.note || null, p_paid_on: o.paidOn || null }) }));
  }
  async remove(id: string): Promise<boolean> { this.one(await this.api(`/rest/v1/bf_licenses?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=representation' } })); return true; }
}
