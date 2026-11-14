/**
 * Module access permissions: every database operation is mapped to a module, role defaults keep the old behaviour,
 * the Super User's custom grants are enforced, and nobody else can change them.   npm run test:access
 * Needs the owner's admin password in BONDHU_ADMIN_PASSWORD (it is never stored in the repo).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, process.env.BF_DIST || 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };
const allowed = (method, args, m) => { try { store.authorize(method, args || []); ok(true, m); } catch (e) { ok(false, `${m} -> refused: ${e.message}`); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-access-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);

  // ---- every operation is classified ----
  const missing = Object.keys(A).filter(m => !store.accessCoverage(m));
  ok(missing.length === 0, `every database operation is mapped to a module or deliberately shared${missing.length ? ' — unmapped: ' + missing.join(', ') : ''}`);
  ok(store.MODULES.includes('google_sync') && store.MODULES.includes('drive_backup') && store.MODULES.length === 15, 'the module list includes Google sync and Drive backup (15 modules)');
  const defA = store.defaultPermissions('Admin'), defT = store.defaultPermissions('Treasurer'), defU = store.defaultPermissions('Auditor');
  ok(store.MODULES.every(m => defA[m] === 'edit'), 'Admin default: edit everywhere');
  ok(defT.members === 'edit' && defT.loans === 'edit' && defT.master === 'none' && defT.users === 'none' && defT.settings === 'none' && defT.google_sync === 'none' && defT.drive_backup === 'none', 'Treasurer default: all working modules, no Master Data / Users / Settings / Google');
  ok(defU.members === 'view' && !store.MODULES.some(m => defU[m] === 'edit') && defU.master === 'none', 'Auditor default: view only');

  const adminPw = process.env.BONDHU_ADMIN_PASSWORD;
  if (!adminPw) { console.log('SKIP  sign-in based checks (set BONDHU_ADMIN_PASSWORD to run them)'); console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL ACCESS TESTS PASSED'); process.exit(fails ? 1 : 0); }

  // ---- users ----
  const s0 = A.login('admin', adminPw);
  ok(store.MODULES.every(m => s0.permissions[m] === 'edit'), 'the session carries the effective permissions (Admin: edit everywhere)');
  const mkUser = (username, role, pw) => { const id = A.addUser({ username, full_name: username, role, email: '' }); A.setUserPassword(id, pw); return id; };
  const tre = mkUser('acc_tre', 'Treasurer', 'Tr3asurerpass'), aud = mkUser('acc_aud', 'Auditor', 'Audit0rpass'), adm2 = mkUser('acc_adm', 'Admin', 'Adm1npass12');
  throws(() => store.authorize('addUser', [{ username: 'x1y2z3', full_name: 'X', role: 'Treasurer', permissions: { loans: 'none' } }]), /Super User/, 'an Admin (not the Super User) cannot create a user with custom module access');
  allowed('addUser', [{ username: 'x1y2z3', full_name: 'X', role: 'Treasurer' }], 'an Admin can still create a user with the role default');
  throws(() => store.authorize('setUserPermissions', [tre, { loans: 'none' }]), /iqbal_labs/, 'only iqbal_labs may change module access (Admin refused)');
  A.logout();

  // ---- Treasurer: same as before this feature ----
  A.login('acc_tre', 'Tr3asurerpass');
  const st = store.api.getSession();
  ok(st.permissions.members === 'edit' && st.permissions.settings === 'none' && st.permissions.google_sync === 'none', 'Treasurer session shows the role default');
  for (const [m, a] of [['getMembers'], ['addMember'], ['recordPayment'], ['getCollections'], ['addExpense'], ['addInvestment'], ['addLoan'], ['getLoans'], ['createLoanApplication'], ['getOverviewData'], ['getTransactions'], ['getAllMembersLite'], ['getMasterData'], ['getBackupLogs'], ['getUsers']])
    allowed(m, a, `Treasurer may use ${m}`);
  throws(() => store.authorize('saveAppSettings', [{ late_fee_amount: 1 }]), /edit access to Settings/, 'Treasurer cannot change Settings');
  throws(() => store.authorize('saveAppSettings', [{ loan_default_rate: 10 }]), /Only an Admin/, 'Treasurer cannot change the loan policy');
  throws(() => store.authorize('addMasterItem', [{}]), /edit access to Master Data/, 'Treasurer cannot edit Master Data');
  throws(() => store.authorize('addUser', [{}]), /edit access to Users/, 'Treasurer cannot create users');
  throws(() => store.authorize('writeOffLoan', [{}]), /Only an Admin/, 'Treasurer cannot write off a loan (Admin action)');
  throws(() => store.authorize('resetDatabase', []), /Only an Admin/, 'Treasurer cannot reset the database');
  throws(() => store.authorize('getAuditLog', []), /view access/, 'Treasurer cannot read the audit log (Users / Settings only)');
  throws(() => store.authorize('updateUser', [aud, { full_name: 'Hacked' }]), /only edit your own profile/, 'Treasurer cannot edit another user');
  allowed('updateUser', [tre, { full_name: 'My Name' }], 'Treasurer may edit their own profile');
  throws(() => store.requireModule('google_sync', 'view'), /view access to Google account sync/, 'Treasurer has no Google sync access by default');
  ok(!store.can('drive_backup') && store.can('backup', 'edit') && store.can(['collections', 'loans'], 'edit'), 'can() reflects the defaults');
  A.logout();

  // ---- the Super User narrows and widens access ----
  A.setUserPermissions(tre, { loans: 'none', members: 'view', reports: 'view', collections: 'none', master: 'edit', google_sync: 'edit', drive_backup: 'view' });
  A.login('acc_tre', 'Tr3asurerpass');
  const sc = store.api.getSession();
  ok(sc.permissions.loans === 'none' && sc.permissions.members === 'view' && sc.permissions.master === 'edit' && sc.permissions.expenses === 'edit', 'custom grants override the role default; modules not mentioned keep the default');
  throws(() => store.authorize('previewLoan', [{}]), /view access to Personal Loans/, 'loans: none → cannot use the loan screens');
  allowed('getLoans', [], 'loans: none, but Reports: view → loans can still be read for reports');
  throws(() => store.authorize('addLoan', [{}]), /edit access to Personal Loans/, 'loans: none → cannot give a loan');
  allowed('getMembers', [], 'members: view → can read members');
  throws(() => store.authorize('addMember', [{}]), /edit access to Members/, 'members: view → cannot add a member');
  allowed('getCollections', [], 'collections: none, but Reports: view → can read collections for reports');
  throws(() => store.authorize('deletePayment', [1]), /edit access to Collections/, 'collections: none → cannot change collections');
  allowed('getTransactions', [], 'Reports: view → can read the ledger');
  allowed('addMasterItem', [{}], 'master: edit granted → may edit Master Data');
  allowed('addExpense', [{}], 'expenses untouched: still edit');
  ok(store.can('google_sync', 'edit') && store.can('drive_backup', 'view') && !store.can('drive_backup', 'edit'), 'Google sync: edit, Drive backup: view only');
  throws(() => store.requireModule('drive_backup', 'edit'), /edit access to Google Drive backup/, 'Drive backup: view → no edit');
  // entry center: forms work through the Entry Center module even without the page modules
  A.logout();
  A.setUserPermissions(tre, { collections: 'none', expenses: 'none', reports: 'none', entry: 'edit' });
  A.login('acc_tre', 'Tr3asurerpass');
  allowed('recordPayment', [{}], 'Entry Center: edit → can record a payment through the entry forms');
  allowed('addExpense', [{}], 'Entry Center: edit → can add an expense through the entry forms');
  throws(() => store.authorize('getExpenses', []), /view access to Operating Expenses/, 'but cannot open the Expenses page data');
  A.logout();

  // ---- an Auditor can never edit, whatever is granted ----
  A.setUserPermissions(aud, { members: 'edit', loans: 'edit', master: 'view' });
  A.login('acc_aud', 'Audit0rpass');
  const sa = store.api.getSession();
  ok(sa.permissions.members === 'view' && sa.permissions.loans === 'view' && sa.permissions.master === 'view', 'Auditor: "edit" grants are capped at view');
  throws(() => store.authorize('addMember', [{}]), /read-only|edit access/, 'Auditor cannot add a member even if edit was granted');
  allowed('getMasterData', [], 'Auditor with Master Data: view can read it');
  A.logout();

  // ---- an Admin can also be restricted ----
  A.setUserPermissions(adm2, { master: 'none', settings: 'view', users: 'view', google_sync: 'none' });
  A.login('acc_adm', 'Adm1npass12');
  throws(() => store.authorize('addMasterItem', [{}]), /edit access to Master Data/, 'a restricted Admin cannot edit Master Data');
  throws(() => store.authorize('saveAppSettings', [{ late_fee_amount: 2 }]), /edit access to Settings/, 'a restricted Admin cannot save Settings');
  throws(() => store.authorize('addUser', [{}]), /edit access to Users/, 'a restricted Admin cannot create users');
  allowed('getAuditLog', [], 'a restricted Admin can still view the audit log (Users: view)');
  allowed('addMember', [{}], 'a restricted Admin keeps the other modules');
  A.logout();

  // ---- validation and reset ----
  A.login('admin', adminPw);
  throws(() => A.setUserPermissions(tre, { nonsense: 'edit' }), /Unknown module/, 'unknown module refused');
  throws(() => A.setUserPermissions(tre, { loans: 'admin' }), /none, view or edit/, 'unknown level refused');
  throws(() => A.setUserPermissions(2, { loans: 'none' }), /always has full access|not found/, 'the iqbal_labs account cannot be restricted');
  const up = A.getUserPermissions(tre);
  ok(up.role === 'Treasurer' && up.custom && up.effective.expenses === 'none' && up.defaults.expenses === 'edit', 'getUserPermissions returns the default, the custom grant and the result');
  A.setUserPermissions(tre, null);
  ok(A.getUserPermissions(tre).custom === null && A.getUserPermissions(tre).effective.loans === 'edit', 'passing null returns the user to the role default');
  ok(A.getAuditLog(50).some(r => r.action === 'permissions'), 'permission changes are written to the audit log');
  // super-user-only creation with access (the API itself, as iqbal_labs would call it)
  const withPerms = A.addUser({ username: 'acc_new', full_name: 'New Person', role: 'Treasurer', email: '', permissions: { loans: 'view', google_sync: 'edit' } });
  const np = A.getUserPermissions(withPerms);
  ok(np.effective.loans === 'view' && np.effective.google_sync === 'edit' && np.effective.members === 'edit', 'a user can be created together with their module access');
  A.logout();

  // ---- a backup made before this feature opens: the new column appears ----
  const bytes = store.exportBytes();
  store.replaceWith(bytes);
  A.login('admin', adminPw);
  ok(store.api.getSession().permissions.master === 'edit', 'after a restore the session still carries permissions');
  A.logout();

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL ACCESS TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
