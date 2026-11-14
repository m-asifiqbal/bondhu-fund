/**
 * A small in-memory stand-in for the Supabase project, used only by the tests. It mirrors what docs/supabase/license.sql sets up:
 * bf_activate / bf_check / bf_register_user callable with the public key; bf_extend and the four tables only for a signed-in admin (row-level security).
 * It cannot prove the SQL itself is right: that is checked against the real project with scripts/license-live-check.js.
 */
const http = require('http');
const crypto = require('crypto');

function start(opts = {}) {
  const KEY = opts.key || 'sb_publishable_test';
  const db = { licenses: [], devices: [], licUsers: [], payments: [], admins: new Set(), users: new Map(), sessions: new Map(), refresh: new Map() };
  const ctl = { down: false, calls: [], skewMs: 0, expiresIn: opts.expiresIn || 3600 };
  const now = () => new Date(Date.now() + ctl.skewMs);
  const clean = p => String(p || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const uuid = () => crypto.randomUUID();
  const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
  const tagOf = l => (l.username && String(l.username).trim() ? String(l.username).trim().toLowerCase() : null);
  const usersOf = l => db.licUsers.filter(u => u.license_id === l.id);
  const payload = l => ({
    customer: l.customer, username: l.username || null, status: l.status, paid_until: l.paid_until, message: l.message || '', server_time: now().toISOString(),
    max_devices: l.max_devices ?? 1, max_users: l.max_users ?? null, restrict_users: !!l.restrict_users, users: usersOf(l).map(u => u.username).sort(),
  });
  const addUser = (email, password, admin) => { const id = uuid(); db.users.set(email, { id, email, password }); if (admin) db.admins.add(id); return id; };
  const row = x => ({ max_devices: 1, max_users: null, restrict_users: false, status: 'active', monthly_fee: 0, username: null, ...x });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      ctl.calls.push(`${req.method} ${url.pathname}${url.search}`);
      if (ctl.down) { req.socket.destroy(); return; }
      if (req.headers.apikey !== KEY) return send(401, { message: 'No API key found in request' });
      let j = {}; try { j = body ? JSON.parse(body) : {}; } catch { /* none */ }
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const sess = db.sessions.get(bearer);
      const isAdmin = !!sess && db.admins.has(sess.userId) && sess.expires > Date.now();

      // ---- auth
      function issue(u) {
        const access = 'at_' + uuid(), refresh = 'rt_' + uuid();
        db.sessions.set(access, { userId: u.id, expires: Date.now() + ctl.expiresIn * 1000 });
        db.refresh.set(refresh, u.id);
        return { access_token: access, refresh_token: refresh, expires_in: ctl.expiresIn, user: { id: u.id, email: u.email } };
      }
      if (url.pathname === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const u = db.users.get(j.email);
          if (!u || u.password !== j.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          return send(200, issue(u));
        }
        if (grant === 'refresh_token') {
          const uid = db.refresh.get(j.refresh_token);
          const u = uid && [...db.users.values()].find(x => x.id === uid);
          if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          db.refresh.delete(j.refresh_token);
          return send(200, issue(u));
        }
      }

      // ---- rpc
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (m) {
        if (m[1] === 'bf_activate') {
          const pin = clean(j.p_pin), uname = String(j.p_username || '').trim().toLowerCase();
          if (pin.length < 8 || String(j.p_install || '').length < 8) return send(200, { ok: false, error: 'invalid_pin' });
          const l = db.licenses.find(x => x.pin === pin);
          if (!l) return send(200, { ok: false, error: 'invalid_pin' });
          if (l.status === 'revoked') return send(200, { ok: false, error: 'revoked' });
          if (tagOf(l) && tagOf(l) !== uname) return send(200, { ok: false, error: 'wrong_user' });
          const d = db.devices.find(x => x.license_id === l.id && x.install_id === j.p_install);
          if (!d && db.devices.filter(x => x.license_id === l.id).length >= (l.max_devices ?? 1)) return send(200, { ok: false, error: 'device_limit' });
          if (uname && !db.licUsers.some(u => u.license_id === l.id && u.username === uname)) {
            if (!tagOf(l) && l.restrict_users) return send(200, { ok: false, error: 'user_not_allowed' });
            if (!tagOf(l) && l.max_users != null && usersOf(l).length >= l.max_users) return send(200, { ok: false, error: 'user_limit' });
            db.licUsers.push({ id: uuid(), license_id: l.id, username: uname, first_seen: now().toISOString(), last_seen: now().toISOString() });
          } else if (uname) db.licUsers.find(u => u.license_id === l.id && u.username === uname).last_seen = now().toISOString();
          const tok = (uuid() + uuid()).replace(/-/g, '');
          if (d) Object.assign(d, { token: tok, device_name: j.p_device, app_version: j.p_version, last_user: uname || d.last_user, last_seen: now().toISOString() });
          else db.devices.push({ id: uuid(), license_id: l.id, install_id: j.p_install, token: tok, device_name: j.p_device, app_version: j.p_version, last_user: uname || null, first_seen: now().toISOString(), last_seen: now().toISOString() });
          return send(200, { ok: true, token: tok, ...payload(l) });
        }
        if (m[1] === 'bf_check') {
          const d = String(j.p_token || '').length >= 40 && db.devices.find(x => x.token === j.p_token);
          if (!d) return send(200, { ok: false, error: 'invalid_token' });
          const l = db.licenses.find(x => x.id === d.license_id);
          let lastU = null;
          for (let u of j.p_users || []) {
            u = String(u || '').trim().toLowerCase(); if (!u) continue; lastU = u;
            const have = db.licUsers.find(x => x.license_id === l.id && x.username === u);
            if (have) have.last_seen = now().toISOString();
            else if (!l.restrict_users && (tagOf(l) || l.max_users == null || usersOf(l).length < l.max_users)) db.licUsers.push({ id: uuid(), license_id: l.id, username: u, first_seen: now().toISOString(), last_seen: now().toISOString() });
          }
          Object.assign(d, { last_seen: now().toISOString(), device_name: j.p_device || d.device_name, app_version: j.p_version || d.app_version, last_user: lastU || d.last_user });
          return send(200, { ok: true, ...payload(l) });
        }
        if (m[1] === 'bf_register_user') {
          const d = String(j.p_token || '').length >= 40 && db.devices.find(x => x.token === j.p_token);
          if (!d) return send(200, { ok: false, error: 'invalid_token' });
          const l = db.licenses.find(x => x.id === d.license_id);
          const uname = String(j.p_username || '').trim().toLowerCase();
          if (!uname || (tagOf(l) && tagOf(l) !== uname)) return send(200, { ok: false, error: 'wrong_user' });
          if (!db.licUsers.some(u => u.license_id === l.id && u.username === uname)) {
            if (!tagOf(l) && l.restrict_users) return send(200, { ok: false, error: 'user_not_allowed' });
            if (!tagOf(l) && l.max_users != null && usersOf(l).length >= l.max_users) return send(200, { ok: false, error: 'user_limit' });
            db.licUsers.push({ id: uuid(), license_id: l.id, username: uname, first_seen: now().toISOString(), last_seen: now().toISOString() });
          } else db.licUsers.find(u => u.license_id === l.id && u.username === uname).last_seen = now().toISOString();
          d.last_seen = now().toISOString(); d.last_user = uname;
          return send(200, { ok: true, ...payload(l) });
        }
        if (m[1] === 'bf_extend') {
          if (!isAdmin) return send(400, { message: 'not allowed' });
          const l = db.licenses.find(x => x.id === j.p_license);
          if (!l) return send(400, { message: 'licence not found' });
          if (j.p_months < 0 || j.p_months > 120) return send(400, { message: 'months must be between 0 and 120' });
          const from = new Date(Math.max(l.paid_until ? Date.parse(l.paid_until) : Date.now(), Date.now()));
          const days = Number(j.p_days) || 0;
          if (days < 0 || days > 3650) return send(400, { message: 'days must be between 0 and 3650' });
          const to = j.p_months === 0 && days === 0 ? l.paid_until : new Date(addMonths(from, j.p_months).getTime() + days * 86400000).toISOString();
          l.paid_until = to;
          db.payments.push({ id: uuid(), license_id: l.id, amount: j.p_amount || 0, months: j.p_months, days, paid_on: j.p_paid_on || now().toISOString().slice(0, 10), method: j.p_method, note: j.p_note, period_from: from.toISOString(), period_to: to, created_at: now().toISOString() });
          return send(200, l);
        }
        return send(404, { message: 'Could not find the function' });
      }

      // ---- tables (row-level security: admin only)
      const t = url.pathname.match(/^\/rest\/v1\/(bf_licenses|bf_devices|bf_license_users|bf_license_payments)$/);
      if (t) {
        if (!sess || sess.expires <= Date.now()) return send(401, { message: 'JWT expired or missing', code: 'PGRST301' });
        const rows = { bf_licenses: db.licenses, bf_devices: db.devices, bf_license_users: db.licUsers, bf_license_payments: db.payments }[t[1]];
        const filter = r => { for (const [k, v] of url.searchParams) { const mm = String(v).match(/^eq\.(.*)$/); if (mm && k !== 'select' && String(r[k]) !== mm[1]) return false; } return true; };
        const wantRep = /return=representation/.test(req.headers.prefer || '');
        if (req.method === 'GET') {
          if (!isAdmin) return send(200, []);
          let out = rows.filter(filter);
          const sel = url.searchParams.get('select') || '';
          if (t[1] === 'bf_licenses') out = out.map(l => ({ ...l, ...(/bf_devices\(/.test(sel) ? { bf_devices: db.devices.filter(d => d.license_id === l.id) } : {}), ...(/bf_license_users\(/.test(sel) ? { bf_license_users: usersOf(l) } : {}) }));
          return send(200, out);
        }
        if (!isAdmin) return send(req.method === 'POST' ? 403 : 200, req.method === 'POST' ? { message: 'new row violates row-level security policy' } : []);
        if (req.method === 'POST') {
          const r = { id: uuid(), created_at: now().toISOString(), ...(t[1] === 'bf_licenses' ? row(j) : j) };
          if (t[1] === 'bf_licenses' && db.licenses.some(x => x.pin === r.pin)) return send(409, { message: 'duplicate key value violates unique constraint' });
          rows.push(r); return send(201, wantRep ? [r] : undefined);
        }
        if (req.method === 'PATCH') { const hit = rows.filter(filter); hit.forEach(r => Object.assign(r, j)); return send(200, wantRep ? hit : undefined); }
        if (req.method === 'DELETE') {
          const hit = rows.filter(filter); hit.forEach(r => rows.splice(rows.indexOf(r), 1));
          if (t[1] === 'bf_licenses') for (const k of ['devices', 'licUsers', 'payments']) db[k] = db[k].filter(p => !hit.some(h => h.id === p.license_id));
          return send(200, wantRep ? hit : undefined);
        }
      }
      send(404, { message: 'Not found', code: '42P01' });
    });
  });
  return new Promise(resolve => server.listen(opts.port || 0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, key: KEY, db, ctl, addUser, close: () => new Promise(r => server.close(r)) })));
}
module.exports = { start };
