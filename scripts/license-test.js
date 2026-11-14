/**
 * Licence: activation PIN, monthly payments, remote lock, offline rules and the vendor panel, against scripts/fake-supabase.js.
 *   Part 1  LicenseClient (activate, check, lock reasons, offline grace, clock set back, server clock)
 *   Part 2  LicenseAdmin  (sign-in, refresh, customers, PINs, payments, row-level security)
 *   Part 3  the sign-in gate in the database (needs BONDHU_ADMIN_PASSWORD; BONDHU_SYSTEM_PASSWORD for the owner part)
 * npm run test:license
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const DIST = path.join(proj, process.env.BF_DIST || 'dist-electron');
const fake = require('./fake-supabase');
const L = require(path.join(DIST, 'license.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const rejects = async (fn, re, m) => { try { await fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message + ' ' + (e.code || '')), `${m} -> "${e.message}"`); } };
const DAY = 86400000;
const adminPw = process.env.BONDHU_ADMIN_PASSWORD, sysPw = process.env.BONDHU_SYSTEM_PASSWORD;

(async () => {
  const srv = await fake.start();
  const cfg = { url: srv.url, key: srv.key };
  const memVault = () => { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, x) => { m.set(k, x); }, clear: k => { m.delete(k); } }; };
  const memState = () => { let s = null; return { load: () => (s ? JSON.parse(JSON.stringify(s)) : (s = L.freshState())), save: x => { s = JSON.parse(JSON.stringify(x)); }, raw: () => s }; };
  let clockOff = 0;
  const clock = () => Date.now() + clockOff;
  const mkClient = (over = {}) => {
    const state = over.state || memState(), vault = over.vault || memVault();
    const c = new L.LicenseClient(over.cfg === undefined ? cfg : over.cfg, over.enforce ?? true, fetch, state, vault, () => 'PC-1', () => '9.9.9', clock);
    const rawCheck = c.check.bind(c); c.check = async () => { await rawCheck(); return c.view(over.user); };   // the tests below look at the view right after a check
    return { c, state, vault };
  };
  const sessions = () => { let s = null; return { load: () => s, save: x => { s = x; }, clear: () => { s = null; } }; };
  const mkAdmin = (store = sessions()) => ({ a: new L.LicenseAdmin(cfg, fetch, store, clock), store });
  srv.addUser('vendor@example.com', 'Vend0r-pass', true);
  srv.addUser('stranger@example.com', 'Stranger-pass', false);

  // ================================================================ Part 2 first: the vendor creates customers ============================
  const { a: admin, store: adminStore } = mkAdmin();
  await rejects(() => admin.list(), /not_signed_in|Sign in/, 'the panel refuses to work before signing in');
  await rejects(() => admin.signIn('vendor@example.com', 'wrong'), /Sign-in refused|auth/, 'a wrong Supabase password is refused');
  ok((await admin.signIn('vendor@example.com', 'Vend0r-pass')) === 'vendor@example.com' && admin.account() === 'vendor@example.com', 'the vendor signs in');

  const lic = await admin.create({ customer: 'Green Valley Fund', contact: '0171', monthly_fee: 1500, months: 1, message: 'Call 01700000000 to renew' });
  ok(/^[A-HJ-NP-Z2-9]{12}$/.test(lic.pin), `a PIN of 12 unambiguous characters is generated (${lic.pin.replace(/./g, '*')})`);
  ok(Math.abs(Date.parse(lic.paid_until) - (Date.now() + 30 * DAY)) < 3 * DAY, 'the first month is paid until about 30 days from now');
  const lic2 = await admin.create({ customer: 'No-expiry Trial', months: 0 });
  ok(lic2.paid_until === null && lic2.pin !== lic.pin, 'a licence with 0 months has no expiry and its own PIN');
  await rejects(() => admin.create({ customer: '  ' }), /customer name/, 'a customer needs a name');
  ok(L.groupPin(lic.pin) === lic.pin.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3'), 'PINs are shown in groups of four');
  ok(new Set(Array.from({ length: 200 }, () => L.newPin())).size === 200, '200 generated PINs are all different');

  // ================================================================ Part 1: a customer's copy ==============================================
  {
    const noCfg = mkClient({ cfg: null, enforce: true });
    ok(noCfg.c.view().locked && noCfg.c.view().reason === 'not_activated', 'enforcing without a configured server locks (nothing can be activated)');
    const off = mkClient({ enforce: false });
    ok(!off.c.view().locked && !off.c.view().enforced && off.c.gate('alice') === null, 'a build that does not enforce is never locked');

    const { c, state, vault } = mkClient();
    let v = c.view();
    ok(v.enforced && v.locked && v.reason === 'not_activated' && v.configured, 'a new copy is locked until a PIN is entered');
    ok(/^LICENSE_PIN_REQUIRED:not_activated\|/.test(c.gate('alice')), 'the sign-in gate asks the login screen for a PIN');
    await rejects(() => c.activate('1234'), /not correct/, 'a short PIN is refused before any request');
    const before = srv.ctl.calls.length;
    await rejects(() => c.activate('ABCD-EFGH-JKLM'), /not correct/, 'an unknown PIN is refused by the server');
    ok(srv.ctl.calls.length === before + 1 && c.view().locked, 'still locked after a wrong PIN');

    v = await c.activate(` ${lic.pin.slice(0, 4).toLowerCase()}-${lic.pin.slice(4, 8)} ${lic.pin.slice(8)} `);
    ok(!v.locked && v.customer === 'Green Valley Fund' && v.status === 'active' && v.message === 'Call 01700000000 to renew', 'the PIN activates (any case, with dashes or spaces)');
    ok(v.daysLeft >= 29 && v.daysLeft <= 31, `days left shown (${v.daysLeft})`);
    ok(typeof vault.get('*') === 'string' && vault.get('*').length >= 40 && !JSON.stringify(state.raw()).includes(vault.get('*')), 'the device token is in the vault, never in the state file');
    const row = (await admin.list()).find(r => r.id === lic.id);
    ok(row.devices.length === 1 && row.devices[0].install_id === state.raw().installId && row.devices[0].device_name === 'PC-1' && row.devices[0].app_version === '9.9.9' && row.devices[0].last_seen, 'the vendor sees the computer, version and last seen');

    // the same PIN on another computer
    const other = mkClient();
    await rejects(() => other.c.activate(lic.pin), /maximum number of computers/, 'a one-computer PIN cannot be used on a second computer');
    // the same computer again (reinstall of the program, same state) keeps working
    v = await c.activate(lic.pin);
    ok(!v.locked, 'the same computer can enter its PIN again');

    // regular check
    v = await c.check();
    ok(!v.locked && v.lastError === null, 'a normal check keeps it open');

    // ---- remote shutdown
    await admin.update(lic.id, { status: 'suspended' });
    v = await c.check();
    ok(v.locked && v.reason === 'suspended' && /^LICENSE_LOCKED:suspended\|/.test(c.gate('alice')), 'REMOTE LOCK: suspended from the panel, locked at the next check');
    ok(v.message === 'Call 01700000000 to renew', "the vendor's message is available for the lock screen");
    await admin.update(lic.id, { status: 'active' });
    v = await c.check();
    ok(!v.locked, 'resumed from the panel, open again at the next check');
    await admin.update(lic.id, { status: 'revoked' });
    v = await c.check();
    ok(v.locked && v.reason === 'revoked', 'a revoked licence locks');
    await rejects(() => mkClient().c.activate(lic.pin), /withdrawn|maximum number of computers|revoked/, 'a revoked PIN cannot activate');
    await admin.update(lic.id, { status: 'active' });
    ok(!(await c.check()).locked, 'and it can be restored');

    // ---- the monthly payment
    await admin.update(lic.id, { paid_until: new Date(Date.now() - DAY).toISOString() });
    v = await c.check();
    ok(v.locked && v.reason === 'expired' && v.daysLeft <= 0, 'EXPIRED: a licence past its paid-until date locks');
    const ext = await admin.extend(lic.id, { months: 2, amount: 3000, method: 'bKash', note: 'Jan+Feb' });
    ok(Math.abs(Date.parse(ext.paid_until) - (Date.now() + 61 * DAY)) < 3 * DAY, 'a payment of 2 months from a lapsed date extends from today');
    v = await c.check();
    ok(!v.locked && v.daysLeft >= 59, `paying unlocks at the next check (${v.daysLeft} days left)`);
    const ext2 = await admin.extend(lic.id, { months: 1, amount: 1500 });
    ok(Date.parse(ext2.paid_until) > Date.parse(ext.paid_until) + 29 * DAY, 'paying early adds the month after the current end date');
    const pays = await admin.payments(lic.id);
    ok(pays.length === 2 && pays.reduce((s, p) => s + p.amount, 0) === 4500 && pays[0].period_to, 'both payments are recorded with amounts and periods');
    await rejects(() => admin.extend(lic.id, { months: 500, amount: 1 }), /between 0 and 120/, 'a silly number of months is refused');

    // ---- offline
    srv.ctl.down = true;
    v = await c.check();
    ok(!v.locked && /Cannot reach|did not answer/.test(v.lastError || ''), 'OFFLINE: the server cannot be reached, the copy stays open and says why');
    clockOff = 10 * DAY;
    ok(!c.view().locked, 'offline for 10 days: still open (grace is 14 days)');
    clockOff = 15 * DAY;
    v = c.view();
    ok(v.locked && v.reason === 'needs_check' && /^LICENSE_LOCKED:needs_check\|/.test(c.gate('alice')), 'offline for 15 days: locked until it can check in');
    srv.ctl.down = false;
    v = await c.check();
    ok(!v.locked && v.lastError === null, 'back online: one check and it is open again');
    clockOff = 0;

    // ---- clock tricks
    await admin.update(lic.id, { paid_until: new Date(Date.now() + 2 * DAY).toISOString() });
    await c.check();
    ok(!c.view().locked, 'two days left: open');
    clockOff = 5 * DAY;
    ok(c.view().locked && c.view().reason === 'expired', 'five days later: expired');
    clockOff = -30 * DAY;
    ok(c.view().locked, 'setting the clock back a month does not bring the days back');
    clockOff = 0;
    ok(c.view().locked, 'even after the clock is "fixed" (the latest time seen is remembered)');
    const fresh = mkClient({ state, vault });
    ok(fresh.c.view().locked, 'and a restart of the program remembers it too');
    await admin.extend(lic.id, { months: 1, amount: 1500 });
    const ahead = mkClient({ state, vault });
    ok(!(await ahead.c.check()).locked, 'a renewal still unlocks it after all that');

    // ---- the vendor releases the computer (lost PC): new PIN, old computer locks
    const reset = await admin.resetDevice(lic.id);
    ok(reset.pin !== lic.pin && reset.devices.length === 0 && (await admin.list()).find(r => r.id === lic.id).devices.length === 0, 'RESET: every computer is released and the licence gets a new PIN');
    v = await c.check();
    ok(v.locked && v.reason === 'invalid' && vault.get('*') === null, 'the old computer is locked at its next check and forgets its token');
    await rejects(() => c.activate(lic.pin), /not correct/, 'the old PIN no longer works');
    const replacement = mkClient();
    v = await replacement.c.activate(reset.pin);
    ok(!v.locked && v.customer === 'Green Valley Fund', 'a replacement computer activates with the new PIN');

    // a lock cannot be undone from the customer's side
    state.raw().slots['*'].snapshot = null;
    ok(mkClient({ state }).c.view().locked, 'editing the saved state cannot unlock a copy');
  }

  // ================================================================ Part 2 (rest): sessions and security ================================
  {
    const one = await admin.update(lic2.id, { customer: 'Renamed Trial', notes: 'n', monthly_fee: 99, message: 'hi' });
    ok(one.customer === 'Renamed Trial' && one.monthly_fee === 99 && one.message === 'hi', 'customer details can be edited');
    await rejects(() => admin.update(lic2.id, { status: 'banana' }), /Unknown status/, 'unknown statuses are refused');
    ok((await admin.update(lic2.id, { pin: 'HACKHACKHACK', id: 'x' })).pin !== 'HACKHACKHACK', 'only the allowed fields can be changed through update');

    // token refresh
    srv.ctl.expiresIn = 1;
    const { a: shortLived } = mkAdmin();
    await shortLived.signIn('vendor@example.com', 'Vend0r-pass');
    await new Promise(r => setTimeout(r, 1200));
    clockOff = 120000;
    const callsBefore = srv.ctl.calls.filter(c => /grant_type=refresh_token/.test(c)).length;
    ok((await shortLived.list()).length >= 2, 'an expired session is refreshed automatically');
    ok(srv.ctl.calls.filter(c => /grant_type=refresh_token/.test(c)).length === callsBefore + 1, 'with exactly one refresh call');
    clockOff = 0; srv.ctl.expiresIn = 3600;

    // a signed-in user who is not a vendor sees and changes nothing
    const { a: stranger } = mkAdmin();
    await stranger.signIn('stranger@example.com', 'Stranger-pass');
    ok((await stranger.list()).length === 0, 'SECURITY: a signed-in stranger sees no customers');
    await rejects(() => stranger.create({ customer: 'Evil' }), /bf_admins|row-level|Nothing was changed|violates/, 'a stranger cannot create licences');
    await rejects(() => stranger.update(lic2.id, { status: 'revoked' }), /Nothing was changed|bf_admins/, 'a stranger cannot change licences');
    await rejects(() => stranger.extend(lic2.id, { months: 12, amount: 0 }), /not allowed/, 'a stranger cannot extend a licence');
    // the public key alone reaches the tables
    const res = await fetch(`${srv.url}/rest/v1/bf_licenses?select=*`, { headers: { apikey: srv.key } });
    ok(res.status === 401, 'SECURITY: the public key alone cannot read the licence table');
    const bad = await fetch(`${srv.url}/rest/v1/bf_licenses?select=*`, { headers: { apikey: 'wrong' } });
    ok(bad.status === 401, 'a wrong API key is refused');

    admin.signOut();
    ok(admin.account() === null, 'signing out forgets the session');
    await admin.signIn('vendor@example.com', 'Vend0r-pass');
    ok(await admin.remove(lic2.id) === true && !(await admin.list()).some(r => r.id === lic2.id), 'a customer can be deleted');
    ok((await admin.payments(lic2.id)).length === 0, 'with their payments');
    const noConfig = new L.LicenseAdmin(null, fetch, sessions());
    await rejects(() => noConfig.signIn('a@b.c', 'x'), /config\/supabase\.json/, 'without a configured project the panel explains what is missing');
  }

  // ================================================================ Part 4: PINs tagged to a user ==========================================
  {
    const tagged = await admin.create({ customer: 'Shop Fund', username: 'Test_User', months: 1 });
    ok(tagged.username === 'Test_User', 'a PIN can be tagged to a username');
    const comp = await admin.create({ customer: 'Whole PC Fund', months: 1 });
    const { c, state, vault } = mkClient({ user: 'test_user' });
    ok(/^LICENSE_PIN_REQUIRED:not_activated/.test(c.gate('test_user')) && /^LICENSE_PIN_REQUIRED:not_activated/.test(c.gate('admin')), 'with no licence at all every user is asked for a PIN');
    await rejects(() => c.activate(tagged.pin, 'someone_else'), /different user/, 'a tagged PIN refuses another user');
    await rejects(() => c.activate(tagged.pin), /different user/, 'and refuses an activation without a user name');
    ok(/^LICENSE_PIN_REQUIRED/.test(c.gate('test_user')) && Object.keys(state.raw().slots).length === 0, 'refused attempts activate nothing');
    let v = await c.activate(tagged.pin, 'TEST_user');
    ok(!v.locked && v.scope === 'user', 'the tagged user activates (any letter case)');
    ok(c.gate('test_user') === null && c.gate('Test_User') === null, 'and may sign in');
    ok(/^LICENSE_PIN_REQUIRED:not_activated/.test(c.gate('other_user')) && /^LICENSE_PIN_REQUIRED:not_activated/.test(c.gate('admin')), 'another user on the same computer still needs their own PIN');
    ok(Object.keys(state.raw().slots).join() === 'test_user' && vault.get('test_user') && !vault.get('*'), 'the licence is stored under the user, not the computer');
    const t2 = await admin.create({ customer: 'Shop Fund', username: 'admin', months: 1 });
    await c.activate(t2.pin, 'admin');
    ok(c.gate('admin') === null && c.gate('test_user') === null, 'two users, two licences');
    await admin.update(tagged.id, { status: 'suspended' }); await c.check();
    ok(/^LICENSE_LOCKED:suspended/.test(c.gate('test_user')) && c.gate('admin') === null, 'SUSPEND one user: the other keeps working');
    await admin.update(tagged.id, { status: 'active', paid_until: new Date(Date.now() - DAY).toISOString() }); await c.check();
    ok(/^LICENSE_LOCKED:expired/.test(c.gate('test_user')) && c.gate('admin') === null, 'EXPIRY of one user licence locks only that user');
    await admin.extend(tagged.id, { months: 1, amount: 500 }); await c.check();
    ok(c.gate('test_user') === null, 'a renewal unlocks that user');
    await c.activate(comp.pin, 'whoever');
    ok(c.gate('random_person') === null && c.view('random_person').scope === 'computer', 'an untagged PIN covers every user on the computer');
    await admin.update(tagged.id, { status: 'suspended' }); await c.check();
    ok(c.gate('test_user') === null, 'a user whose own licence is locked is still let in by an active computer licence');
    await admin.update(comp.id, { status: 'suspended' }); await c.check();
    ok(/suspended/.test(c.gate('test_user')) && /suspended/.test(c.gate('random_person')) && c.gate('admin') === null, 'with the computer licence suspended too, only users with their own active licence get in');
    await admin.resetDevice(tagged.id); await c.check();
    ok(/^LICENSE_PIN_REQUIRED:invalid/.test(c.gate('test_user')), 'a released user is asked for a new PIN');
    const spare = await admin.create({ customer: 'X', username: 'old_name', months: 1 });
    await admin.update(spare.id, { username: 'new_name' });
    await rejects(() => mkClient().c.activate(spare.pin, 'old_name'), /different user/, 'a tag can be changed before the PIN is used');
    ok((await mkClient().c.activate(spare.pin, 'NEW_NAME')).scope === 'user', 'and the new tag works');
    ok(mkClient({ state, vault }).c.gate('admin') === null, 'a restart of the program remembers per-user licences');
    const blank = await admin.update(spare.id, { username: '  ' });
    ok(blank.username === null, 'an empty tag means "everyone on the computer"');
  }

  // ================================================================ Part 5: computers and users per licence ================================
  {
    const multi = await admin.create({ customer: 'Big Fund', months: 1, max_devices: 2, max_users: 3 });
    ok(multi.max_devices === 2 && multi.max_users === 3 && multi.devices.length === 0, 'a licence can allow several computers and a number of users');
    const solo = await admin.create({ customer: 'Solo', months: 1 });
    ok(solo.max_devices === 1 && solo.max_users === null, 'by default: one computer, any number of users');
    await rejects(() => admin.update(solo.id, { max_devices: 0 }), /whole number/, 'zero computers is refused');
    await rejects(() => admin.update(solo.id, { max_users: 5000 }), /whole number/, 'and so is an absurd number');

    const pcA = mkClient(), pcB = mkClient(), pcC = mkClient();
    await pcA.c.activate(multi.pin, 'u1');
    await pcB.c.activate(multi.pin, 'u2');
    await rejects(() => pcC.c.activate(multi.pin, 'u3'), /maximum number of computers/, 'a third computer is refused when two are allowed');
    ok(pcC.c.gate('u3')?.startsWith('LICENSE_PIN_REQUIRED'), 'and stays locked');
    let row = (await admin.list()).find(r => r.id === multi.id);
    ok(row.devices.length === 2 && row.users.map(u => u.username).sort().join() === 'u1,u2', 'the panel lists both computers and both users');
    ok(row.devices.every(d => d.device_name === 'PC-1' && d.last_seen && d.last_user), 'with computer name, version, last user and last seen');

    // user limit: a new user on an activated computer is counted online, once
    ok(pcA.c.gate('u1') === null, 'a counted user signs in without asking anything');
    ok(/^LICENSE_REGISTER:not_registered/.test(pcA.c.gate('u2')), 'a user this computer has not heard of yet must be counted first (u2 was counted from the other computer)');
    await pcA.c.register('u2');
    ok(pcA.c.gate('u2') === null, 'after being counted: in');
    await pcA.c.register('u3');
    ok(pcA.c.gate('u3') === null, 'the third user fills the limit');
    await rejects(() => pcA.c.register('u4'), /limited number of users/, 'a fourth user is refused');
    ok(/^LICENSE_REGISTER:not_registered/.test(pcA.c.gate('u4')), 'and cannot sign in');
    row = (await admin.list()).find(r => r.id === multi.id);
    await admin.removeUser(row.users.find(u => u.username === 'u2').id);
    await pcA.c.register('u4');
    ok(pcA.c.gate('u4') === null, 'removing a user frees a place for another');
    await pcA.c.check();
    ok(/^LICENSE_REGISTER/.test(pcA.c.gate('u2')), 'the removed user must be counted again');

    // removing a computer locks it and frees its place
    row = (await admin.list()).find(r => r.id === multi.id);
    const bId = row.devices.find(d => d.install_id === pcB.state.raw().installId).id;
    await admin.removeDevice(bId);
    await pcB.c.check();
    ok(/^LICENSE_PIN_REQUIRED:invalid/.test(pcB.c.gate('u2')), 'a removed computer is locked at its next check');
    await pcC.c.activate(multi.pin, 'u1');
    ok(pcC.c.gate('u1') === null, 'and its place can be taken by another computer');
    ok(pcA.c.gate('u1') === null, 'the other computers are not affected');

    // suspend the licence: every computer and user at once
    await admin.update(multi.id, { status: 'suspended' });
    await pcA.c.check(); await pcC.c.check();
    ok(/^LICENSE_LOCKED:suspended/.test(pcA.c.gate('u1')) && /^LICENSE_LOCKED:suspended/.test(pcC.c.gate('u1')), 'suspending the customer locks all of its computers');
    await admin.update(multi.id, { status: 'active', max_users: null });
    await pcA.c.check();
    ok(pcA.c.gate('anyone_new') === null, 'with no user limit nobody needs to be counted');
    await pcA.c.check();
    row = (await admin.list()).find(r => r.id === multi.id);
    ok(row.users.some(u => u.username === 'anyone_new'), 'but the users who sign in are still reported, so you can see them');

    // a tagged licence reports only its own user
    const tg = await admin.create({ customer: 'Tagged', username: 'cashier', months: 1 });
    const pcD = mkClient();
    await pcD.c.activate(tg.pin, 'cashier');
    pcD.c.gate('cashier'); pcD.c.gate('someone_else');
    await pcD.c.check();
    row = (await admin.list()).find(r => r.id === tg.id);
    ok(row.users.map(u => u.username).join() === 'cashier' && row.devices[0].last_user === 'cashier', 'a user licence is never shown other users');

    // the whole-customer licence hears about users without a licence of their own
    const both = mkClient();
    const comp2 = await admin.create({ customer: 'Mixed', months: 1, max_devices: 1 });
    await both.c.activate(tg.pin, 'cashier').catch(() => undefined);   // (already bound to PC D: refused)
    await both.c.activate(comp2.pin, 'boss');
    both.c.gate('boss'); await both.c.check();
    row = (await admin.list()).find(r => r.id === comp2.id);
    ok(row.users.map(u => u.username).join() === 'boss', 'the customer licence records the users who signed in under it');
  }

  // ================================================================ Part 6: the user allowlist ==========================================
  {
    const al = await admin.create({ customer: 'Listed Fund', months: 1, max_devices: 2, restrict_users: true, users: ['Cashier1', ' manager ', 'cashier1'] });
    ok(al.restrict_users === true, 'a licence can be restricted to a list of users');
    let row = (await admin.list()).find(r => r.id === al.id);
    ok(row.users.map(u => u.username).sort().join() === 'cashier1,manager' && row.users.every(u => u.last_seen == null), 'the names are stored in lower case, once each, before anybody has signed in');
    const tagged1 = await admin.create({ customer: 'Not a list', username: 'solo', months: 1, restrict_users: true, users: ['x_user'] });
    ok(tagged1.restrict_users === false && (await admin.list()).find(r => r.id === tagged1.id).users.length === 0, 'a PIN tagged to one user cannot be given a list');

    const pc1 = mkClient(), pc2 = mkClient();
    await rejects(() => pc1.c.activate(al.pin, 'stranger'), /not on the licence/, 'a user who is not on the list cannot activate');
    ok(/^LICENSE_PIN_REQUIRED/.test(pc1.c.gate('stranger')), 'and nothing was activated');
    await pc1.c.activate(al.pin, 'CASHIER1');
    ok(pc1.c.gate('cashier1') === null && pc1.c.gate('manager') === null, 'listed users sign in (the list is carried to the computer, no extra call)');
    ok(/^LICENSE_LOCKED:not_allowed\|/.test(pc1.c.gate('stranger')), 'an unlisted user is refused, as a plain refusal (no PIN, no counting)');
    await rejects(() => pc1.c.register('stranger'), /not on the licence/, 'and cannot count themselves in');
    await pc2.c.activate(al.pin, 'manager');
    ok(pc2.c.gate('manager') === null && /not_allowed/.test(pc2.c.gate('cashier1')) === false, 'a second computer works the same');

    // the vendor adds the user: the refused user is let in at the next check (the login screen re-checks on a refusal)
    const added = await admin.addUser(al.id, 'Stranger', 'the new cashier');
    ok(added.username === 'stranger' && added.note === 'the new cashier', 'the vendor adds a user with a note');
    await pc1.c.check();
    ok(pc1.c.gate('stranger') === null, 'ADD: the user is let in after the next check');
    await admin.removeUser(added.id);
    await pc1.c.check();
    ok(/^LICENSE_LOCKED:not_allowed/.test(pc1.c.gate('stranger')), 'REMOVE: the user is refused again after the next check');

    // checks never put unlisted users on the list
    pc1.c.gate('ghost'); await pc1.c.check();
    row = (await admin.list()).find(r => r.id === al.id);
    ok(!row.users.some(u => u.username === 'ghost'), 'an unlisted user who tried to sign in is not added by the check-in');
    ok(row.users.find(u => u.username === 'cashier1').last_seen, 'a listed user who signs in gets a last-seen time');

    // admin guards
    await rejects(() => admin.addUser(al.id, 'bad name'), /3.32/, 'a username must follow the same rule as in the app');
    await rejects(() => admin.addUser(al.id, 'manager'), /already on this licence/, 'a name cannot be added twice');
    const lim = await admin.create({ customer: 'Small', months: 1, restrict_users: true, max_users: 1, users: ['only_one'] });
    await rejects(() => admin.addUser(lim.id, 'second_one'), /list is full/, 'the list cannot grow past the user limit');
    await rejects(() => admin.addUser(tagged1.id, 'someone'), /tagged to one user/, 'a tagged PIN has no list');

    // switching it off: any user, counted as before
    await admin.update(al.id, { restrict_users: false, max_users: null });
    await pc1.c.check();
    ok(pc1.c.gate('stranger') === null, 'switching the list off lets any user in again');
  }

  // ================================================================ Part 7: days as well as months ==================================================
  {
    const near = (iso, days, tol = 1.5) => Math.abs(Date.parse(iso) - (Date.now() + days * DAY)) < tol * DAY;
    const dOnly = await admin.create({ customer: 'Ten days', months: 0, days: 10 });
    ok(dOnly.paid_until && near(dOnly.paid_until, 10), 'a licence can be created for a number of days (no months)');
    const both = await admin.create({ customer: 'Month and days', months: 1, days: 5 });
    ok(both.paid_until && near(both.paid_until, 35, 4), 'or for months plus days');
    const none = await admin.create({ customer: 'No expiry', months: 0, days: 0 });
    ok(none.paid_until === null, 'months 0 and days 0 means no expiry');
    const week = await admin.extend(dOnly.id, { months: 0, days: 7, amount: 350, note: 'one week' });
    ok(near(week.paid_until, 17), 'a payment can extend by days only (10 + 7 days)');
    const pays = await admin.payments(dOnly.id);
    ok(pays.length === 1 && pays[0].months === 0 && pays[0].days === 7 && pays[0].amount === 350, 'the payment records the days');
    const mixed = await admin.extend(dOnly.id, { months: 1, days: 3, amount: 1000 });
    ok(Date.parse(mixed.paid_until) > Date.parse(week.paid_until) + 30 * DAY, 'months and days together extend after the current end date');
    await rejects(() => admin.extend(dOnly.id, { months: 0, days: 4000, amount: 1 }), /Days must be/, 'an absurd number of days is refused');
    await rejects(() => admin.extend(dOnly.id, { months: 0, days: -1, amount: 1 }), /Days must be/, 'and so is a negative number');
    const before = (await admin.list()).find(r => r.id === dOnly.id).paid_until;
    await admin.extend(dOnly.id, { months: 0, days: 0, amount: 50, note: 'deposit only' });
    ok((await admin.list()).find(r => r.id === dOnly.id).paid_until === before, 'a payment of 0 months and 0 days records the money but leaves the date alone');
    // a client whose licence has days left is open, and locks when they are used up
    const c = mkClient();
    await c.c.activate(dOnly.pin, 'u');
    ok(!c.c.view('u').locked, 'a days-based licence opens a copy');
    await admin.update(dOnly.id, { paid_until: new Date(Date.now() + 2 * DAY).toISOString() });
    await c.c.check();
    clockOff = 3 * DAY;
    ok(c.c.view('u').locked && c.c.view('u').reason === 'expired', 'and it expires when the days run out');
    clockOff = 0;
  }

  // ================================================================ Part 3: the gate in the database =======================================
  if (!adminPw) console.log('SKIP  database gate checks (set BONDHU_ADMIN_PASSWORD, and BONDHU_SYSTEM_PASSWORD for the owner part)');
  else {
    for (const k of Object.keys(require.cache)) if (k.includes('dist-electron') && k.endsWith('database.js')) delete require.cache[k];
    const store = require(path.join(DIST, 'database.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-lic-'));
    await store.openDatabase(path.join(dir, 't.db'), wasm);
    const A = store.api;
    let lock = null;
    store.setAccessGate(u => lock);
    ok(A.login('admin', adminPw)?.isAdmin, 'with no lock, an account signs in');
    lock = 'LICENSE_LOCKED:expired|';
    let err = ''; try { A.getMembers('', 'All', 1, 10); store.authorize('getMembers', []); } catch (e) { err = e.message; }
    ok(/sign in/i.test(err), 'LOCK: a session that was open is ended at once');
    ok(A.getSession() === null, 'and stays ended');
    err = ''; try { A.login('admin', adminPw); } catch (e) { err = e.message; }
    ok(/^LICENSE_LOCKED:expired\|/.test(err), 'LOCK: signing in is refused with the reason');
    err = ''; try { A.login('admin', 'wrong-password'); } catch (e) { err = e.message; }
    ok(/Incorrect/.test(err), 'a wrong password gets the normal answer: the lock is only revealed to someone who knows the password');
    ok(!/data|delete|erase/i.test(err), 'the message promises nothing about the data being touched');
    lock = null;
    ok(A.login('admin', adminPw)?.isAdmin, 'unlocked: the same account signs in again, data intact');
    if (!sysPw) console.log('SKIP  owner-account exemption (set BONDHU_SYSTEM_PASSWORD)');
    else {
      A.logout(); lock = 'locked';
      const s = A.login('iqbal_labs', sysPw);
      ok(s?.canUpload, 'OWNER: iqbal_labs can still sign in while the copy is locked');
      ok(A.getMembers('', 'All', 1, 10) !== undefined && A.getSession()?.canUpload, 'and keeps working');
    }
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL LICENSE TESTS PASSED');
  await srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
