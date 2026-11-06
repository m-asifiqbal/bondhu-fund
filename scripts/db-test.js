/**
 * Database test suite for electron/database.ts (runs the compiled dist-electron/database.js in plain Node).
 *
 *   npm run test:db                       # fresh database, demo data, CRUD, backup/restore
 *   npm run test:db -- path\to\old.db     # additionally test migrating a real older database (a COPY is used)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const legacyCopy = process.argv[2] || null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-dbtest-'));
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const throws = (fn, re, msg) => { try { fn(); ok(false, `${msg} (no error)`); } catch (e) { ok(re.test(e.message), `${msg} -> "${e.message}"`); } };

(async () => {
  // 1) Optional: migration of an older database (a COPY is used)
  if (legacyCopy) {
  const legacyDb = path.join(work, 'legacy.db');
  fs.copyFileSync(legacyCopy, legacyDb);
  await store.openDatabase(legacyDb, wasm);
  const st = A.getDatabaseStats();
  ok(st.schemaVersion === 2, `legacy migrated to schema v${st.schemaVersion}`);
  console.log('      legacy counts', JSON.stringify(st));
  const m = A.getMembers('', 'All', 1, 5, '2024-06');
  ok(m.total === st.members, `getMembers total ${m.total} == members ${st.members}`);
  console.log('      June 2024 stats', JSON.stringify(m.stats));
  const c = A.getCollections('June 2024');
  console.log('      June 2024 collections', JSON.stringify(c.stats));
  const ov = A.getOverviewData('2024-06');
  console.log('      legacy overview netWorth', Math.round(ov.kpis.netWorth), 'cash', Math.round(ov.kpis.cashInHand), 'portfolio', ov.kpis.portfolioValue);
  ok(Array.isArray(ov.trend) && ov.trend.length === 12, 'overview trend has 12 months');
  const exp = A.getExpenses();
  ok(exp.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.expense_date)), 'all expense dates are ISO after migration');
  const inv = A.getInvestments();
  ok(inv.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.purchase_date)), 'all investment dates are ISO after migration');
  store.flush();
  }

  // 2) Fresh database + demo + CRUD
  const freshDb = path.join(work, 'fresh.db');
  if (fs.existsSync(freshDb)) fs.unlinkSync(freshDb);
  await store.openDatabase(freshDb, wasm);
  ok(A.getDatabaseStats().members === 0, 'fresh database starts empty');
  ok(A.getDatabaseStats().users === 2, 'fresh database has the two built-in accounts (admin, iqbal_labs)');
  ok(A.getUsers().length === 1 && A.getUsers()[0].username === 'admin', 'the protected iqbal_labs account is hidden from everyone but itself');
  ok(A.getMasterData('payment_method').length >= 5, 'default payment methods present');

  const id = A.addMember({ name: 'Test Member', nid: '1990123456001', monthly_due: 2500, join_date: '2026-01-15' });
  ok(id > 0, `addMember -> id ${id}`);
  const id2 = A.addMember({ name: 'Second Person', nid: '1990123456002', member_code: 'BF-0001' }); // duplicate code -> auto
  ok(A.getMembers().members.find(x => x.id === id2).member_code !== 'BF-0001', 'duplicate member code auto-replaced');
  throws(() => A.addMember({ name: '  ' }), /required/i, 'empty name rejected');

  const cur = store.currentMonthKey();
  A.recordPayment({ member_id: id, payment_month: cur, payment_date: store.todayISO(), contribution_amount: 2500, late_fee: 0, payment_method: 'Cash' });
  A.recordPayment({ member_id: id, payment_month: cur, payment_date: store.todayISO(), contribution_amount: 2500, late_fee: 300, payment_method: 'bKash' });
  const hist = A.getMemberHistory(id);
  ok(hist.length === 1 && hist[0].total_amount === 2800, 'second payment for same month replaces (no double count)');
  const mem = A.getMembers('Test').members[0];
  ok(mem.total_contributed === 2500, `total_contributed = ${mem.total_contributed}`);
  throws(() => A.recordPayment({ member_id: id, payment_month: cur, payment_date: '2999-01-01', contribution_amount: 1, payment_method: 'Cash' }), /future/i, 'future payment date rejected');
  throws(() => A.deleteMember(id), /Inactive/, 'delete member with payments blocked');
  A.deletePayment(hist[0].id);
  A.deleteMember(id);
  ok(!A.getMembers().members.find(x => x.id === id), 'member deleted after voiding payment');

  const stm = A.getMemberStatement(id2);
  ok(stm.rows.length >= 1, `statement rows ${stm.rows.length}`);

  throws(() => A.addUser({ username: 'admin', full_name: 'X' }), /taken/, 'duplicate username rejected');
  throws(() => A.deleteUser(A.getUsers().find(u => u.username === 'admin').id + 1), /protected|not found/i, 'iqbal_labs cannot be deleted');
  const cat = A.getMasterData('expense_category')[0];
  A.addExpense({ title: 'Tea', category: cat.name, amount: 120, expense_date: store.todayISO() });
  throws(() => A.deleteMasterItem(cat.id), /in use|used by/, 'in-use category cannot be deleted');
  A.updateMasterItem(cat.id, { name: cat.name + ' X' });
  ok(A.getExpenses()[0].category === cat.name + ' X', 'category rename cascades to expenses');
  ok(A.getExpenses()[0].status === 'Needs receipt', 'expense without receipt flagged');

  const ivId = A.addInvestment({ name: 'FDR', sector: 'Fixed Deposit', invested_amount: 10000, purchase_date: store.todayISO() });
  A.updateInvestment(ivId, { status: 'Sold', sold_amount: 11000 });
  ok(A.getInvestments()[0].gain_loss === 1000, 'sold investment realized gain 1000');

  // 3) Demo data + analytics + performance
  let t = Date.now();
  A.loadDemoData();
  console.log(`      loadDemoData ${Date.now() - t} ms`, JSON.stringify(A.getDatabaseStats()));
  t = Date.now();
  const o = A.getOverviewData(cur);
  const ms = Date.now() - t;
  ok(ms < 1500, `getOverviewData ${ms} ms`);
  ok(o.kpis.netWorth > 0 && o.kpis.dueMembers > 0, `overview netWorth ${Math.round(o.kpis.netWorth)}, due ${o.kpis.dueMembers}, rate ${o.kpis.collectionRate}%`);
  t = Date.now(); A.getMembers('', 'Overdue', 1, 10, cur); A.getCollections(cur); A.getTransactions('2000-01-01', '2999-12-31');
  ok(Date.now() - t < 500, `members+collections+ledger ${Date.now() - t} ms`);
  const ledger = A.getTransactions();
  const credit = ledger.reduce((a, r) => a + r.credit, 0), debit = ledger.reduce((a, r) => a + r.debit, 0);
  const opening = A.getMembers('', 'All', 1, 1000).members.reduce((a, x) => a + x.opening_balance, 0);
  ok(Math.abs(opening + credit - debit - o.kpis.cashInHand) < 1, `ledger reconciles with cash in hand (${Math.round(opening + credit - debit)} vs ${Math.round(o.kpis.cashInHand)})`);
  ok(A.getAuditLog(5).length > 0, 'audit log populated');
  ok(A.getDynamicNotifications().length >= 1, 'notifications generated');

  // 4) Backup -> restore round trip, plus invalid restore leaves data intact
  store.flush();
  const backup = store.exportBytes();
  const before = A.getDatabaseStats();
  A.resetDatabase(true);
  ok(A.getDatabaseStats().members === 0, 'reset clears business data');
  store.replaceWith(backup);
  ok(A.getDatabaseStats().members === before.members, `restore round trip (${before.members} members)`);
  throws(() => store.replaceWith(Buffer.from('not a database at all, definitely not SQLite')), /not a SQLite/, 'invalid file rejected');
  ok(A.getDatabaseStats().members === before.members, 'data intact after rejected restore');
  if (legacyCopy) {
    store.replaceWith(fs.readFileSync(legacyCopy));
    ok(A.getDatabaseStats().schemaVersion === 2, 'older backup restores and migrates');
  }


  // 5) Sign-in, permissions, health check
  A.logout();
  const sysId = 2;   // the hidden built-in iqbal_labs account (getUsers() never lists it for other users)
  throws(() => store.authorize('getMembers'), /sign in/i, 'no session → API calls refused');
  throws(() => A.login('admin', 'wrong'), /Incorrect/, 'wrong password rejected');
  // The owner-set admin password is never stored in the repo: pass it via env to run the admin checks.
  const adminPw = process.env.BONDHU_ADMIN_PASSWORD;
  throws(() => A.login('admin', 'admin'), /Incorrect/, 'the old public default password (admin) no longer works');
  if (!adminPw) { console.log('SKIP  admin sign-in / permission checks (set BONDHU_ADMIN_PASSWORD to run them)'); }
  else {
  const s1 = A.login('admin', adminPw);
  ok(s1 && s1.isAdmin && !s1.canUpload && !s1.mustChangePassword, 'admin signs in with the owner password (Admin, no upload, no forced change)');
  throws(() => store.authorize('bulkAddMembers'), /iqbal_labs/, 'admin cannot upload data');
  throws(() => store.authorize('deleteMember', [1]), /iqbal_labs/, 'admin cannot delete a member (Super User only)');
  throws(() => store.requireUpload(), /iqbal_labs/, 'admin blocked from Excel import');
  throws(() => store.authorize('updateUser', [sysId, { full_name: 'x' }]), /protected/, 'admin cannot edit iqbal_labs');
  throws(() => A.setUserPassword(sysId, 'newpass1'), /fixed/, 'iqbal_labs password cannot be set by admin');
  throws(() => A.changeOwnPassword(adminPw, 'abc'), /at least 6/, 'short password rejected');
  A.changeOwnPassword(adminPw, 'Secur3pass');
  A.logout();
  throws(() => A.login('admin', adminPw), /Incorrect/, 'previous admin password no longer works after a change');
  ok(!!A.login('admin', 'Secur3pass'), 'admin signs in with the new password');
  A.logout();
  }
  throws(() => A.login('iqbal_labs', 'not-the-password'), /Incorrect/, 'iqbal_labs rejects a wrong password');
  // The real system password is never stored in the repo: pass it via env to run these checks.
  const sysPw = process.env.BONDHU_SYSTEM_PASSWORD;
  if (sysPw) {
    const s2 = A.login('IQBAL_LABS', sysPw);
    ok(s2 && s2.canUpload && s2.isAdmin, 'iqbal_labs signs in (case-insensitive username) with upload rights');
    store.authorize('bulkAddMembers'); store.requireUpload();
    store.authorize('deleteMember', [1]);
    ok(true, 'iqbal_labs may upload');
    throws(() => A.changeOwnPassword(sysPw, 'another1'), /fixed/, 'iqbal_labs password is fixed');
    A.logout();
  } else {
    console.log('SKIP  iqbal_labs sign-in checks (set BONDHU_SYSTEM_PASSWORD to run them)');
  }
  for (let i = 0; i < 5; i++) { try { A.login('admin', 'nope'); } catch { /* expected */ } }
  throws(() => A.login('admin', adminPw || 'x'), /Too many/, 'account locks after 5 wrong attempts');
  // reopening restores the fixed account even if it was tampered with in the file
  const health = A.checkAccountingHealth();
  ok(health.fails === 0, `health check on demo data: ${health.passes} pass, ${health.warns} warn, ${health.fails} fail`);
  store.flush();
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });

