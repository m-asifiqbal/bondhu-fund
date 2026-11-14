/**
 * Google account sign-in and the hidden Drive "app data" folder (main process).
 *
 * Same Google Cloud project and same approach as the FocusFlow app: the only Drive permission asked for is
 * `drive.appdata` — a private folder that does not show up in the user's Drive and that other apps cannot read.
 * A desktop app signs in through the system browser (OAuth "loopback" redirect with PKCE); the long-lived refresh
 * token is stored encrypted by the operating system (Electron safeStorage), never in the database or in a backup.
 *
 * Everything here talks to Google through injected functions (fetch, open-browser, secret storage), so the whole
 * flow is tested against a local fake Google server (scripts/gsync-test.js).
 */
import * as http from 'http';
import * as crypto from 'crypto';

export const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'];

export interface GoogleEndpoints { auth: string; token: string; userinfo: string; drive: string; upload: string; revoke: string }
export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  drive: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
  revoke: 'https://oauth2.googleapis.com/revoke',
};

/** The OAuth client of this app: a "Desktop app" client created in the same Google Cloud project as FocusFlow. */
export interface GoogleClient { clientId: string; clientSecret: string }

export interface GoogleAccount { email: string; name: string; picture: string }
/** Where the signed-in account and its refresh token are kept (encrypted on disk by the caller). */
export interface AccountStore {
  load(): (GoogleAccount & { refreshToken: string }) | null;
  save(a: GoogleAccount & { refreshToken: string }): void;
  clear(): void;
}

export type DriveFailureKind = 'offline' | 'authExpired' | 'quota' | 'notSignedIn' | 'notConfigured' | 'cancelled' | 'unknown';
export class DriveFailure extends Error {
  constructor(public kind: DriveFailureKind, message: string, public detail?: string) { super(message); }
}
const MESSAGES: Record<DriveFailureKind, string> = {
  offline: 'You are offline. Check the internet connection and try again.',
  authExpired: 'Your Google sign-in has expired. Connect your Google account again.',
  quota: 'Your Google Drive storage is full. Free up space and try again.',
  notSignedIn: 'Connect a Google account first.',
  notConfigured: 'Google sync is not set up in this copy of the app yet.',
  cancelled: 'Google sign-in was cancelled.',
  unknown: 'Google did not accept the request. Try again in a moment.',
};
export const failure = (kind: DriveFailureKind, detail?: string, message?: string) => new DriveFailure(kind, message || MESSAGES[kind], detail);

export interface GoogleDeps {
  client: () => GoogleClient | null;
  store: AccountStore;
  fetch: typeof fetch;
  /** opens the Google sign-in page in the user's browser */
  openUrl: (url: string) => Promise<void> | void;
  endpoints?: GoogleEndpoints;
  now?: () => number;
  /** how long to wait for the user to finish signing in */
  signInTimeoutMs?: number;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class GoogleAuth {
  private accessToken: { value: string; expires: number } | null = null;
  private ep: GoogleEndpoints;
  constructor(private d: GoogleDeps) { this.ep = d.endpoints || GOOGLE_ENDPOINTS; }
  private now() { return (this.d.now || Date.now)(); }

  isConfigured() { const c = this.d.client(); return !!(c && c.clientId && c.clientSecret); }
  account(): GoogleAccount | null { const a = this.d.store.load(); return a ? { email: a.email, name: a.name, picture: a.picture } : null; }

  private requireClient(): GoogleClient {
    const c = this.d.client();
    if (!c || !c.clientId || !c.clientSecret) throw failure('notConfigured');
    return c;
  }

  private async tokenCall(body: Record<string, string>) {
    let res: Response;
    try {
      res = await this.d.fetch(this.ep.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    } catch (e: any) { throw failure('offline', String(e?.message || e)); }
    const text = await res.text();
    let j: any = {};
    try { j = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok) {
      if (j?.error === 'invalid_grant') throw failure('authExpired', 'invalid_grant');
      throw failure('unknown', `token endpoint ${res.status}: ${j?.error || ''} ${j?.error_description || ''}`.trim());
    }
    return j;
  }

  /**
   * Opens Google's sign-in page in the browser and waits for the redirect to a temporary local address.
   * Resolves with the signed-in account once Drive access (appdata) has been granted.
   */
  async signIn(): Promise<GoogleAccount> {
    const c = this.requireClient();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = crypto.randomBytes(16).toString('hex');
    const server = http.createServer();
    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      let done = false;
      let port = 0;
      const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); try { server.close(); } catch { /* ignore */ } fn(); };
      const timer = setTimeout(() => finish(() => reject(failure('cancelled', 'timeout', 'Google sign-in took too long and was stopped. Try again.'))), this.d.signInTimeoutMs ?? 180_000);
      server.on('request', (req, res) => {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        if (u.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
        const page = (title: string, body: string) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:60px"><h2>${title}</h2><p>${body}</p></body>`); };
        if (u.searchParams.get('state') !== state) { page('Sign-in failed', 'This sign-in link is not valid. Please close this tab and try again from the app.'); return; }
        const err = u.searchParams.get('error');
        const cd = u.searchParams.get('code');
        if (err || !cd) { page('Sign-in was not completed', 'You can close this tab and return to Bondhu Fund.'); finish(() => reject(failure('cancelled', err || 'no code'))); return; }
        page('Connected to Google', 'You can close this tab and return to Bondhu Fund.');
        finish(() => resolve({ code: cd, redirect: `http://127.0.0.1:${port}/oauth/callback` }));
      });
      server.on('error', (e: any) => finish(() => reject(failure('unknown', String(e?.message || e)))));
      server.listen(0, '127.0.0.1', async () => {
        port = (server.address() as any).port;
        const url = `${this.ep.auth}?${new URLSearchParams({
          client_id: c.clientId, redirect_uri: `http://127.0.0.1:${port}/oauth/callback`, response_type: 'code', scope: SCOPES.join(' '),
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        }).toString()}`;
        try { await this.d.openUrl(url); } catch (e: any) { finish(() => reject(failure('unknown', String(e?.message || e), 'Could not open the browser for Google sign-in.'))); }
      });
    });

    const tok = await this.tokenCall({ code: code.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: code.redirect, grant_type: 'authorization_code', code_verifier: verifier });
    if (!String(tok.scope || '').includes('drive.appdata')) throw failure('unknown', 'drive.appdata not granted', 'Google Drive access was not allowed. Press Connect again and tick the Drive permission.');
    if (!tok.refresh_token) throw failure('unknown', 'no refresh token', 'Google did not return a long-lived sign-in. Remove Bondhu Fund from your Google account\'s connected apps and try again.');
    this.accessToken = { value: tok.access_token, expires: this.now() + (Number(tok.expires_in) || 3600) * 1000 };
    let info: any = {};
    try {
      const r = await this.d.fetch(this.ep.userinfo, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      info = await r.json();
    } catch (e: any) { throw failure('offline', String(e?.message || e)); }
    if (!info?.email) throw failure('unknown', 'no email', 'Google did not tell us which account this is.');
    const acct = { email: String(info.email), name: String(info.name || info.email), picture: String(info.picture || '') };
    this.d.store.save({ ...acct, refreshToken: String(tok.refresh_token) });
    return acct;
  }

  /** A valid access token (refreshed silently when it is about to expire). */
  async getAccessToken(force = false): Promise<string> {
    const c = this.requireClient();
    const a = this.d.store.load();
    if (!a) throw failure('notSignedIn');
    if (!force && this.accessToken && this.accessToken.expires - 60_000 > this.now()) return this.accessToken.value;
    try {
      const j = await this.tokenCall({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
      this.accessToken = { value: j.access_token, expires: this.now() + (Number(j.expires_in) || 3600) * 1000 };
      return this.accessToken.value;
    } catch (e) {
      if (e instanceof DriveFailure && e.kind === 'authExpired') { this.d.store.clear(); this.accessToken = null; }
      throw e;
    }
  }

  /** Forget the account on this computer and ask Google to revoke the token. */
  async signOut() {
    const a = this.d.store.load();
    this.d.store.clear();
    this.accessToken = null;
    if (a) { try { await this.d.fetch(`${this.ep.revoke}?token=${encodeURIComponent(a.refreshToken)}`, { method: 'POST' }); } catch { /* offline: the token is already forgotten here */ } }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Drive (appDataFolder only)
// ---------------------------------------------------------------------------------------------------------------
export interface DriveFile { id: string; name: string; size: number; createdTime: string; modifiedTime: string; props: Record<string, string> }

/** What the sync engine needs from Drive. The real implementation is below; tests use an in-memory one. */
export interface DriveApi {
  list(nameQuery?: { name?: string; prefix?: string }): Promise<DriveFile[]>;
  create(name: string, bytes: Buffer, props?: Record<string, string>): Promise<DriveFile>;
  update(id: string, bytes: Buffer, props?: Record<string, string>): Promise<DriveFile>;
  download(id: string): Promise<Buffer>;
  remove(id: string): Promise<void>;
}

export class GoogleDrive implements DriveApi {
  private ep: GoogleEndpoints;
  constructor(private auth: GoogleAuth, private f: typeof fetch, endpoints?: GoogleEndpoints) { this.ep = endpoints || GOOGLE_ENDPOINTS; }

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.auth.getAccessToken();
    let res: Response;
    try { res = await this.f(url, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${token}` } }); }
    catch (e: any) { throw failure('offline', String(e?.message || e)); }
    if (res.status === 401 && retry) { await this.auth.getAccessToken(true); return this.call(url, init, false); }
    if (res.ok) return res;
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    if (res.status === 401) throw failure('authExpired', body.slice(0, 200));
    if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/i.test(body)) throw failure('quota', body.slice(0, 200));
    throw failure('unknown', `Drive ${res.status}: ${body.slice(0, 300)}`);
  }

  private toFile(j: any): DriveFile {
    return { id: String(j.id), name: String(j.name), size: Number(j.size) || 0, createdTime: String(j.createdTime || ''), modifiedTime: String(j.modifiedTime || ''), props: j.appProperties || {} };
  }

  async list(q: { name?: string; prefix?: string } = {}): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page = '';
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = q.name ? `name = '${esc(q.name)}'` : q.prefix ? `name contains '${esc(q.prefix)}'` : '';
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,size,createdTime,modifiedTime,appProperties)' });
      if (query) params.set('q', query);
      if (page) params.set('pageToken', page);
      const j: any = await (await this.call(`${this.ep.drive}/files?${params}`)).json();
      for (const f of j.files || []) out.push(this.toFile(f));
      page = j.nextPageToken || '';
    } while (page);
    return q.prefix ? out.filter(f => f.name.startsWith(q.prefix!)) : out;
  }

  private multipart(meta: object, bytes: Buffer) {
    const boundary = `bf${crypto.randomBytes(12).toString('hex')}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    return { body: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--`)]), type: `multipart/related; boundary=${boundary}` };
  }

  async create(name: string, bytes: Buffer, props: Record<string, string> = {}): Promise<DriveFile> {
    const m = this.multipart({ name, parents: ['appDataFolder'], appProperties: props }, bytes);
    const res = await this.call(`${this.ep.upload}/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,appProperties`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body });
    return this.toFile(await res.json());
  }

  async update(id: string, bytes: Buffer, props?: Record<string, string>): Promise<DriveFile> {
    const m = this.multipart(props ? { appProperties: props } : {}, bytes);
    const res = await this.call(`${this.ep.upload}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,appProperties`, { method: 'PATCH', headers: { 'Content-Type': m.type }, body: m.body });
    return this.toFile(await res.json());
  }

  async download(id: string): Promise<Buffer> {
    const res = await this.call(`${this.ep.drive}/files/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(id: string): Promise<void> {
    await this.call(`${this.ep.drive}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
