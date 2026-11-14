/**
 * A small fake of the parts of Google the app uses: OAuth (authorization code + PKCE, refresh, revoke, userinfo) and the Drive v3
 * appDataFolder API (list with name filters and paging, multipart create/update, media download, delete).
 * Used by scripts/gsync-test.js so the complete sign-in and sync flows are exercised without a real Google account.
 */
const http = require('http');
const crypto = require('crypto');

module.exports = function startFakeGoogle(opts = {}) {
  const state = {
    codes: new Map(),        // code -> { challenge, redirect, email }
    refresh: new Map(),      // refresh token -> email
    access: new Map(),       // access token -> email
    files: new Map(),        // id -> { id, name, bytes, props, created, modified }
    accounts: { 'asif@example.com': { name: 'Asif Iqbal', picture: 'https://example.com/a.png' }, 'other@example.com': { name: 'Someone Else', picture: '' } },
    nextEmail: 'asif@example.com',
    maxPage: 1000, quotaFull: false, grantDrive: true, requests: 0, tokenCalls: 0,
  };
  const filesOf = email => [...state.files.values()].filter(f => f.owner === email);
  const id = () => crypto.randomBytes(8).toString('hex');
  const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const meta = f => ({ id: f.id, name: f.name, size: String(f.bytes.length), createdTime: f.created, modifiedTime: f.modified, appProperties: f.props });

  function parseMultipart(buf, contentType) {
    const boundary = /boundary=(.+)$/.exec(contentType)[1];
    const sep = Buffer.from(`--${boundary}`);
    const parts = []; let pos = buf.indexOf(sep);
    while (pos >= 0) {
      const next = buf.indexOf(sep, pos + sep.length);
      if (next < 0) break;
      let part = buf.subarray(pos + sep.length, next);
      if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
      if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);
      const hdrEnd = part.indexOf('\r\n\r\n');
      parts.push(part.subarray(hdrEnd + 4));
      pos = next;
    }
    return { meta: JSON.parse(parts[0].toString('utf8') || '{}'), media: parts[1] || Buffer.alloc(0) };
  }

  const server = http.createServer(async (req, res) => {
    state.requests++;
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    try {
      // ---- OAuth ----
      if (p === '/auth') {
        const redirect = u.searchParams.get('redirect_uri');
        if (opts.denyConsent || state.deny) { res.writeHead(302, { Location: `${redirect}?error=access_denied&state=${u.searchParams.get('state')}` }); return res.end(); }
        const code = id();
        state.codes.set(code, { challenge: u.searchParams.get('code_challenge'), method: u.searchParams.get('code_challenge_method'), redirect, email: state.nextEmail, scope: u.searchParams.get('scope'), clientId: u.searchParams.get('client_id') });
        res.writeHead(302, { Location: `${redirect}?code=${code}&state=${u.searchParams.get('state')}` }); return res.end();
      }
      if (p === '/token') {
        state.tokenCalls++;
        const f = new URLSearchParams((await readBody(req)).toString());
        if (f.get('client_id') !== 'test-client-id' || f.get('client_secret') !== 'test-secret') return send(res, 401, { error: 'invalid_client' });
        if (f.get('grant_type') === 'authorization_code') {
          const c = state.codes.get(f.get('code'));
          if (!c || c.redirect !== f.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
          const ver = f.get('code_verifier') || '';
          const chal = crypto.createHash('sha256').update(ver).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          if (c.method !== 'S256' || chal !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
          state.codes.delete(f.get('code'));
          const refresh = 'r-' + id(), access = 'a-' + id();
          state.refresh.set(refresh, c.email); state.access.set(access, c.email);
          return send(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: state.grantDrive ? 'openid email profile https://www.googleapis.com/auth/drive.appdata' : 'openid email profile' });
        }
        if (f.get('grant_type') === 'refresh_token') {
          const email = state.refresh.get(f.get('refresh_token'));
          if (!email) return send(res, 400, { error: 'invalid_grant' });
          const access = 'a-' + id(); state.access.set(access, email);
          return send(res, 200, { access_token: access, expires_in: 3600, token_type: 'Bearer' });
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }
      if (p === '/revoke') { state.refresh.delete(u.searchParams.get('token')); return send(res, 200, {}); }
      // ---- everything below needs a bearer token ----
      const email = state.access.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!email) return send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
      if (p === '/userinfo') return send(res, 200, { sub: '1', email, name: state.accounts[email]?.name, picture: state.accounts[email]?.picture });
      // ---- Drive ----
      if (p === '/drive/files' && req.method === 'GET') {
        let list = filesOf(email);
        const q = u.searchParams.get('q') || '';
        let m;
        if ((m = /^name = '(.*)'$/.exec(q))) list = list.filter(f => f.name === m[1].replace(/\\'/g, "'"));
        else if ((m = /^name contains '(.*)'$/.exec(q))) list = list.filter(f => f.name.includes(m[1]));
        list.sort((a, b) => a.name.localeCompare(b.name));
        const size = Math.min(Number(u.searchParams.get('pageSize')) || 100, state.maxPage);
        const start = Number(u.searchParams.get('pageToken')) || 0;
        const slice = list.slice(start, start + size);
        return send(res, 200, { files: slice.map(meta), ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}) });
      }
      const fm = /^\/drive\/files\/([^/]+)$/.exec(p);
      if (fm && req.method === 'GET') {
        const f = state.files.get(fm[1]);
        if (!f || f.owner !== email) return send(res, 404, { error: { code: 404, message: 'File not found' } });
        if (state.failDownload) return send(res, 500, { error: { code: 500, message: 'backend error' } });
        return send(res, 200, f.bytes, 'application/octet-stream');
      }
      if (fm && req.method === 'DELETE') {
        const f = state.files.get(fm[1]);
        if (!f || f.owner !== email) return send(res, 404, { error: { code: 404 } });
        state.files.delete(fm[1]); res.writeHead(204); return res.end();
      }
      if (p === '/upload/files' && req.method === 'POST') {
        if (state.quotaFull) return send(res, 403, { error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }], message: 'The user\'s Drive storage quota has been exceeded.' } });
        const { meta: m, media } = parseMultipart(await readBody(req), req.headers['content-type']);
        if (!(m.parents || []).includes('appDataFolder')) return send(res, 400, { error: { message: 'only appDataFolder is allowed' } });
        const f = { id: id(), owner: email, name: m.name, bytes: media, props: m.appProperties || {}, created: new Date().toISOString(), modified: new Date().toISOString() };
        state.files.set(f.id, f); return send(res, 200, meta(f));
      }
      const um = /^\/upload\/files\/([^/]+)$/.exec(p);
      if (um && req.method === 'PATCH') {
        const f = state.files.get(um[1]);
        if (!f || f.owner !== email) return send(res, 404, { error: { code: 404 } });
        const { meta: m, media } = parseMultipart(await readBody(req), req.headers['content-type']);
        f.bytes = media; if (m.appProperties) f.props = { ...f.props, ...m.appProperties }; f.modified = new Date().toISOString();
        return send(res, 200, meta(f));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 500, { error: String(e && e.stack) }); }
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      base, state, server,
      endpoints: { auth: `${base}/auth`, token: `${base}/token`, userinfo: `${base}/userinfo`, drive: `${base}/drive`, upload: `${base}/upload`, revoke: `${base}/revoke` },
      expireAccessTokens: () => state.access.clear(),
      revokeEverything: () => { state.refresh.clear(); state.access.clear(); },
      corrupt: (name) => { for (const f of state.files.values()) if (f.name === name || f.name.startsWith(name)) f.bytes = Buffer.concat([f.bytes, Buffer.from('X')]); },
      fileNames: () => [...state.files.values()].map(f => f.name).sort(),
      close: () => new Promise(r => server.close(r)),
    });
  }));
};
