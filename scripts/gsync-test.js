/**
 * Google sign-in + Drive sync, end to end against a local fake Google server (scripts/fake-google.js).
 *   Part 1  the OAuth client and the Drive client (PKCE, refresh, 401 retry, paging, errors)
 *   Part 2  two simulated PCs, each with its own database, syncing through the fake Drive
 * npm run test:gsync   (needs BONDHU_ADMIN_PASSWORD for the signed-paper part)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const proj = path.resolve(__dirname, '..');
const DIST = path.join(proj, process.env.BF_DIST || 'dist-electron');
const startFake = require('./fake-google');
const G = require(path.join(DIST, 'google.js'));
const S = require(path.join(DIST, 'gsync.js'));
const BC = require(path.join(DIST, 'backup-crypto.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const rejects = async (fn, re, m) => { try { await fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message + ' ' + (e.kind || '')), `${m} -> "${e.message}"`); } };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const adminPw = process.env.BONDHU_ADMIN_PASSWORD;

const memAccount = () => { let a = null; return { load: () => a, save: x => { a = x; }, clear: () => { a = null; } }; };
const browser = async (url) => { await fetch(url); };            // "opens the browser": follows Google's redirect back to the app's local address

function newAuth(fake, over = {}) {
  const acct = memAccount();
  const auth = new G.GoogleAuth({ client: () => ({ clientId: 'test-client-id', clientSecret: 'test-secret' }), store: acct, fetch, openUrl: browser, endpoints: fake.endpoints, signInTimeoutMs: 4000, ...over });
  return { auth, acct };
}

(async () => {
  const fake = await startFake();

  // ================================================================ Part 1: the Google client ================================================
  {
    const { auth, acct } = newAuth(fake);
    ok(auth.isConfigured() && auth.account() === null, 'configured, nobody signed in yet');
    const a = await auth.signIn();
    ok(a.email === 'asif@example.com' && a.name === 'Asif Iqbal', 'sign-in through the (simulated) browser returns the Google account');
    ok(acct.load() && acct.load().refreshToken.startsWith('r-'), 'the long-lived refresh token was handed to the account store');
    const t1 = await auth.getAccessToken();
    const calls = fake.state.tokenCalls;
    ok((await auth.getAccessToken()) === t1 && fake.state.tokenCalls === calls, 'a valid access token is reused (no extra token request)');
    const t2 = await auth.getAccessToken(true);
    ok(t2 !== t1, 'a refresh gives a new access token');

    const drive = new G.GoogleDrive(auth, fetch, fake.endpoints);
    const f1 = await drive.create('hello.txt', Buffer.from('hi there'), { kind: 'test' });
    ok(f1.id && f1.name === 'hello.txt' && f1.size === 8 && f1.props.kind === 'test', 'Drive: create (multipart) stores name, bytes and properties in the app folder');
    ok((await drive.download(f1.id)).toString() === 'hi there', 'Drive: download returns the same bytes');
    const f2 = await drive.update(f1.id, Buffer.from('changed!!'), { kind: 'test2' });
    ok(f2.id === f1.id && (await drive.download(f1.id)).toString() === 'changed!!' && f2.props.kind === 'test2', 'Drive: update replaces the content and keeps the id');
    await drive.create("it's-a-name.txt", Buffer.from('q'));
    ok((await drive.list({ name: "it's-a-name.txt" })).length === 1, 'Drive: names with a quote are searched safely');
    fake.state.maxPage = 2;
    for (let i = 0; i < 5; i++) await drive.create(`page-${i}.bin`, Buffer.from([i]));
    ok((await drive.list({ prefix: 'page-' })).length === 5 && (await drive.list()).length === 7, 'Drive: listing follows every page (5 + 2 files across pages of 2)');
    fake.state.maxPage = 1000;
    for (const f of await drive.list()) await drive.remove(f.id);
    ok((await drive.list()).length === 0, 'Drive: delete');
    // 401 -> silent refresh -> retry
    fake.expireAccessTokens();
    const before = fake.state.tokenCalls;
    const f3 = await drive.create('after-expiry.txt', Buffer.from('z'));
    ok(f3.id && fake.state.tokenCalls > before, 'an expired access token is refreshed silently and the call is retried');
    fake.state.quotaFull = true;
    await rejects(() => drive.create('x', Buffer.from('x')), /storage is full|quota/i, 'a full Drive is reported as such');
    fake.state.quotaFull = false;
    await rejects(() => new G.GoogleDrive(auth, () => Promise.reject(new TypeError('fetch failed')), fake.endpoints).list(), /offline/i, 'no connection is reported as offline');
    // revoked
    fake.revokeEverything();
    await rejects(() => drive.list(), /expired|authExpired/i, 'a revoked sign-in is reported as expired');
    ok(acct.load() === null && auth.account() === null, 'an expired sign-in is forgotten on this computer');
    await rejects(() => drive.list(), /Connect a Google account/, 'without an account Drive calls ask the user to connect');
    // sign out revokes
    const s2 = newAuth(fake); await s2.auth.signIn(); const rt = s2.acct.load().refreshToken;
    await s2.auth.signOut();
    ok(s2.acct.load() === null && !fake.state.refresh.has(rt), 'sign-out forgets the account here and revokes the token at Google');
    // user cancels / wrong PKCE / no Drive consent / not configured / other account
    fake.state.deny = true;
    await rejects(() => newAuth(fake).auth.signIn(), /cancelled|not completed|stopped/i, 'closing or refusing the Google page cancels sign-in');
    fake.state.deny = false;
    fake.state.grantDrive = false;
    await rejects(() => newAuth(fake).auth.signIn(), /Drive access was not allowed/, 'sign-in without the Drive permission is refused with a clear message');
    fake.state.grantDrive = true;
    await rejects(() => newAuth(fake, { client: () => null }).auth.signIn(), /not set up|notConfigured/i, 'without client credentials sign-in says the app is not set up');
    await rejects(() => newAuth(fake, { client: () => ({ clientId: 'wrong', clientSecret: 'nope' }) }).auth.signIn(), /./, 'wrong client credentials are rejected by Google');
    await rejects(() => newAuth(fake, { openUrl: async () => { /* the user never signs in */ }, signInTimeoutMs: 300 }).auth.signIn(), /too long|stopped|cancelled/i, 'a sign-in nobody completes times out');
  }

  // ================================================================ Part 2: two PCs ===================================================================
  const cx = { isEncrypted: BC.isEncryptedBackup, encrypt: (b, pin) => BC.encryptBackup(b, pin, null), decrypt: BC.decryptBackup, validatePin: BC.validatePin };
  function freshStore() {
    for (const k of Object.keys(require.cache)) if (k.startsWith(DIST) && /database\.js$|loans\.js$/.test(k)) delete require.cache[k];
    return require(path.join(DIST, 'database.js'));
  }
  async function makePc(name, email = 'asif@example.com') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bondhu-gs-${name}-`));
    const store = freshStore();
    await store.openDatabase(path.join(dir, 't.db'), wasm);
    const docsDir = path.join(dir, 'docs'); fs.mkdirSync(docsDir);
    let st = { deviceId: crypto.randomUUID(), deviceName: name, account: null, lastRev: 0, lastHash: '', lastSyncAt: null, dirty: false, dirtyAt: null, auto: true, encrypt: false, lastResult: null };
    const stateStore = { load: () => ({ ...st }), save: s => { st = { ...s }; } };
    const vault = (() => { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v), delete: k => m.delete(k) }; })();
    const local = {
      exportBytes: () => store.exportBytes(), replaceWith: b => store.replaceWith(b), hasData: () => store.syncHasData(), counts: () => store.syncCounts(),
      safetySnapshot: label => fs.writeFileSync(path.join(dir, `safety-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.db`), store.exportBytes()),
      docs: () => store.consentFiles().filter(f => fs.existsSync(f.file)).map(f => ({ name: path.basename(f.file), sha256: f.sha256, size: f.size, read: () => fs.readFileSync(f.file) })),
      hasDoc: n => fs.existsSync(path.join(docsDir, n)), saveDoc: (n, b) => fs.writeFileSync(path.join(docsDir, n), b),
      afterPull: () => store.rebaseConsentFiles(docsDir),
    };
    fake.state.nextEmail = email;
    const { auth } = newAuth(fake); await auth.signIn();
    const drive = new G.GoogleDrive(auth, fetch, fake.endpoints);
    const engine = new S.SyncEngine(drive, local, stateStore, vault, cx, () => auth.account()?.email || null);
    store.setChangeHook(() => engine.markDirty());
    return { name, dir, store, A: store.api, engine, auth, drive, docsDir, vault, getState: () => st, snapshots: () => fs.readdirSync(dir).filter(f => f.startsWith('safety-')), stateStore };
  }
  let nid = 1990777700000;
  const addMember = (pc, name, bal = 10000) => pc.A.addMember({ name, nid: String(++nid), opening_balance: bal, join_date: '2025-01-01', monthly_due: 500 });
  const memberNames = pc => pc.A.getMembers('', 'All', 1, 200).members.map(m => m.name).sort().join(',');

  const A = await makePc('PC-A'), B = await makePc('PC-B');
  // before any data
  let r = await A.engine.syncNow();
  ok(r.status === 'nothing', 'both sides empty: nothing to sync');

  // ---- PC A has data (and a signed paper) -----------------------------------------------------------------
  const m1 = addMember(A, 'Alpha One', 50000), m2 = addMember(A, 'Beta Two', 30000);
  A.A.recordPayment({ member_id: m1, payment_month: '2025-02', payment_date: '2025-02-05', contribution_amount: 500, late_fee: 0, payment_method: 'Cash' });
  let paperName = null, paperBytes = null;
  if (adminPw) {
    A.A.login('admin', adminPw);
    A.A.saveAppSettings({ loan_consent_required: true });
    const dr = A.A.createLoanApplication({ member_id: m1, principal: 5000, method: 'free', term_months: 5, disbursed_date: new Date().toISOString().slice(0, 10), payment_method: 'Cash', guarantor_type: 'member', guarantor_member_id: m2 });
    paperBytes = Buffer.concat([Buffer.from('%PDF-1.4 signed '), crypto.randomBytes(3000)]);
    paperName = 'LA-0001_consent_1.pdf';
    fs.writeFileSync(path.join(A.docsDir, paperName), paperBytes);
    A.store.attachConsentDocument('application', dr, { file: path.join(A.docsDir, paperName), name: 'scan.pdf', size: paperBytes.length, sha256: sha256(paperBytes) });
    A.A.activateLoanApplication({ id: dr, disbursed_date: new Date().toISOString().slice(0, 10) });
  } else console.log('SKIP  signed-paper checks (set BONDHU_ADMIN_PASSWORD)');
  ok(A.getState().dirty, 'real data changes mark this computer as having unsynced changes');
  const calm = A.getState().dirty; A.A.logout?.();
  r = await A.engine.syncNow();
  ok(r.status === 'pushed' && r.revision === 1, `PC A: first sync uploads its data (revision ${r.revision})`);
  ok(!A.getState().dirty && A.getState().lastRev === 1, 'PC A: no unsynced changes after the upload');
  const names1 = fake.fileNames();
  ok(names1.includes('bondhu-sync-head.json') && names1.some(n => n.startsWith('bondhu-snap-000001-')), 'Drive holds the head index and the snapshot');
  if (adminPw) ok(names1.some(n => n === `bondhu-doc-${sha256(paperBytes)}`), 'the signed paper was uploaded too');
  ok((await A.engine.syncNow()).status === 'up-to-date', 'PC A: syncing again with nothing new changes nothing');
  A.A.login?.call(null, 'admin', adminPw || 'x') ;

  // ---- a brand new PC logs in with the same Google account: everything comes back ------------------------------
  ok(!B.store.syncHasData(), 'PC B is a fresh install (no data)');
  const chk = await B.engine.checkRemote();
  ok(chk.remoteNewer && chk.remote.revision === 1 && chk.remote.deviceName === 'PC-A', 'PC B can see that newer data exists in Google Drive');
  r = await B.engine.syncNow();
  ok(r.status === 'pulled' && r.replaced && r.revision === 1, 'PC B: first sync brings all data from Google Drive (fresh PC / lost-PC restore)');
  ok(memberNames(B) === 'Alpha One,Beta Two' && B.store.syncCounts().collections === 1, 'PC B has the same members and payments');
  if (adminPw) {
    const lo = B.A.getLoans();
    ok(lo.length === 1 && lo[0].consent_status === 'Signed' && lo[0].principal === 5000, 'PC B has the loan with its signed-paper record');
    const pf = B.store.consentFiles()[0].file;
    ok(path.dirname(pf) === B.docsDir && fs.existsSync(pf) && sha256(fs.readFileSync(pf)) === sha256(paperBytes), 'PC B: the signed paper file came across and its path points to this computer');
  }
  ok(B.snapshots().length === 1, 'PC B kept a local safety copy of what it replaced');
  ok(!B.getState().dirty && B.getState().lastRev === 1, 'PC B is in sync');
  ok(B.A.checkAccountingHealth().checks.filter(c => c.status === 'fail').length === 0, 'PC B: accounting health check passes on the restored data');

  // ---- B changes data and syncs; A picks it up ---------------------------------------------------------------
  const m3 = addMember(B, 'Gamma Three', 20000);
  ok(B.getState().dirty, 'PC B: a new member counts as an unsynced change');
  r = await B.engine.syncNow();
  ok(r.status === 'pushed' && r.revision === 2, 'PC B: its changes are uploaded (revision 2)');
  ok((await A.engine.checkRemote()).remoteNewer, 'PC A is told there is newer data');
  r = await A.engine.syncNow();
  ok(r.status === 'pulled' && memberNames(A) === 'Alpha One,Beta Two,Gamma Three', 'PC A: sync brings PC B\'s latest data (two-way sync)');
  ok(!A.getState().dirty, 'PC A: not marked as changed after receiving data');

  // ---- both PCs change data separately: no silent overwrite ------------------------------------------------------
  addMember(A, 'From A Only', 1000); addMember(B, 'From B Only', 2000);
  r = await B.engine.syncNow();
  ok(r.status === 'pushed' && r.revision === 3, 'PC B syncs first (revision 3)');
  r = await A.engine.syncNow();
  ok(r.status === 'conflict' && r.conflict.remote.deviceName === 'PC-B' && r.conflict.local.counts.members === 4, 'PC A: both sides changed → CONFLICT, nothing overwritten');
  ok(memberNames(A).includes('From A Only') && !memberNames(A).includes('From B Only'), 'PC A\'s own data is untouched while the conflict is open');
  ok((await A.engine.syncNow({ auto: true })).status === 'conflict', 'repeating the sync still reports the conflict (it never resolves itself)');
  const snapsBefore = A.snapshots().length;
  r = await A.engine.syncNow({ resolve: 'remote' });
  ok(r.status === 'pulled' && memberNames(A).includes('From B Only') && !memberNames(A).includes('From A Only'), 'choosing the cloud data replaces PC A\'s data with it');
  ok(A.snapshots().length === snapsBefore + 1, 'PC A first saved a safety copy (its own changes can still be recovered)');
  // second conflict, this time keep local
  addMember(A, 'A Wins', 111); addMember(B, 'B Loses', 222);
  await B.engine.syncNow();
  r = await A.engine.syncNow({ resolve: 'local' });
  ok(r.status === 'pushed' && r.revision === 5, 'choosing this computer\'s data uploads it as the new revision');
  r = await B.engine.syncNow();
  ok(r.status === 'conflict' || r.status === 'pulled', 'PC B then sees the newer cloud data');
  if (r.status === 'conflict') r = await B.engine.syncNow({ resolve: 'remote' });
  ok(memberNames(B).includes('A Wins') && !memberNames(B).includes('B Loses'), 'PC B ends with PC A\'s data after choosing the cloud copy');
  ok(fake.fileNames().filter(n => n.startsWith('bondhu-snap-')).length <= S.KEEP_SNAPSHOTS, `old cloud snapshots are pruned (at most ${S.KEEP_SNAPSHOTS} kept)`);

  // ---- two histories that never met -----------------------------------------------------------------------------------
  const C = await makePc('PC-C');
  addMember(C, 'Lonely Member');
  r = await C.engine.syncNow();
  ok(r.status === 'conflict', 'a PC that already has its own data (never synced) meets existing cloud data: conflict, not overwrite');
  ok(memberNames(C) === 'Lonely Member', 'its data is untouched');

  // ---- a different Google account has its own, separate cloud ---------------------------------------------------------
  const D = await makePc('PC-D', 'other@example.com');
  addMember(D, 'Other Account Member');
  r = await D.engine.syncNow();
  ok(r.status === 'pushed' && r.revision === 1, 'a different Google account starts its own cloud copy (revision 1)');
  ok((await A.engine.checkRemote()).remote.revision >= 5, 'and the first account\'s cloud copy is untouched');

  // ---- sync PIN (optional encryption) --------------------------------------------------------------------------------
  A.engine.setEncryption(true, 'sync-pin-1234');
  r = await A.engine.syncNow();
  ok(r.status === 'pushed', 'PC A: switching on the sync PIN re-uploads the data encrypted');
  const head = await A.engine.readHead();
  ok(head.encrypted === true, 'the cloud index says the copy is encrypted');
  const snapFile = (await A.drive.list({ prefix: 'bondhu-snap-' })).sort((a, b) => b.name.localeCompare(a.name))[0];
  const raw = await A.drive.download(snapFile.id);
  ok(BC.isEncryptedBackup(raw) && !raw.includes(Buffer.from('Alpha One')), 'what is stored in Drive is encrypted (no readable names)');
  const E = await makePc('PC-E');
  r = await E.engine.syncNow();
  ok(r.status === 'needs-pin', 'a new PC is asked for the sync PIN');
  r = await E.engine.syncNow({ pin: 'not-the-pin-xx' });
  ok(r.status === 'wrong-pin' && !E.store.syncHasData(), 'a wrong PIN is refused and nothing is replaced');
  r = await E.engine.syncNow({ pin: 'sync-pin-1234' });
  ok(r.status === 'pulled' && memberNames(E).includes('A Wins') && E.engine.hasPin(), 'the right PIN restores the data (and is remembered on that PC)');
  addMember(E, 'Added On E');
  r = await E.engine.syncNow();
  ok(r.status === 'pushed' && (await E.engine.readHead()).encrypted, 'later syncs from that PC stay encrypted without asking again');
  E.engine.setEncryption(false);
  r = await E.engine.syncNow();
  ok(r.status === 'pushed' && !(await E.engine.readHead()).encrypted, 'the PIN can be switched off: the next sync stores the data unencrypted again');

  // ---- failures leave everything as it was ---------------------------------------------------------------------------
  const F = await makePc('PC-F');
  fake.state.failDownload = true;
  const beforeState = JSON.stringify(F.getState());
  await rejects(() => F.engine.syncNow(), /./, 'a download that fails halfway raises an error');
  ok(!F.store.syncHasData() && F.getState().lastRev === 0, 'and the PC is left exactly as it was');
  fake.state.failDownload = false;
  const head2 = await F.engine.readHead();
  fake.corrupt(head2.snapshotName);
  await rejects(() => F.engine.syncNow(), /damaged/, 'a damaged snapshot is detected by its checksum and not applied');
  ok(!F.store.syncHasData(), 'nothing was replaced');
  addMember(E, 'Repair Upload'); r = await E.engine.syncNow();
  ok(r.status === 'pushed', 'a healthy PC uploading again repairs the cloud copy');

  // ---- another PC pushes while this one uploads: never overwrite an unseen revision ---------------------------------------
  const H = await makePc('PC-H'); await H.engine.syncNow();
  addMember(H, 'H Local Change');
  const G2 = await makePc('PC-G'); await G2.engine.syncNow(); addMember(G2, 'G Change');
  const realCreate = H.drive.create.bind(H.drive);
  let raced = false;
  H.drive.create = async (name, bytes, props) => { if (!raced && name.startsWith('bondhu-snap-')) { raced = true; await G2.engine.syncNow(); } return realCreate(name, bytes, props); };
  r = await H.engine.syncNow();
  ok(r.status === 'conflict' && /another computer/i.test(r.message), 'if another PC synced during the upload, the upload is abandoned (no overwrite)');
  ok(!fake.fileNames().some(n => n.endsWith('-' + H.getState().deviceId.slice(0, 6) + '.bfsnap')), 'and the abandoned snapshot was cleaned up from Drive');
  r = await H.engine.syncNow({ resolve: 'remote' });
  ok(r.status === 'pulled' && memberNames(H).includes('G Change'), 'after choosing the cloud copy PC H has what the other PC uploaded');
  H.drive.create = realCreate;

  // ---- manual Drive backups ---------------------------------------------------------------------------------------------
  const bk = await A.engine.uploadBackup(BC.encryptBackup(A.store.exportBytes(), 'backup-pin-99', null), { device: 'PC-A', encrypted: true });
  let list = await A.engine.listBackups();
  ok(list.length === 1 && list[0].id === bk.id && list[0].device === 'PC-A' && list[0].encrypted, 'a manual backup is listed with its device and encryption flag');
  const back = await A.engine.downloadBackup(bk.id);
  ok(BC.isEncryptedBackup(back) && BC.decryptBackup(back, 'backup-pin-99').subarray(0, 15).toString() === 'SQLite format 3', 'the downloaded backup opens with its PIN');
  for (let i = 0; i < S.KEEP_BACKUPS + 2; i++) await A.engine.uploadBackup(Buffer.from('x' + i), { device: 'PC-A', encrypted: false });
  list = await A.engine.listBackups();
  ok(list.length === S.KEEP_BACKUPS, `only the newest ${S.KEEP_BACKUPS} Drive backups are kept`);
  await A.engine.deleteBackup(list[0].id);
  ok((await A.engine.listBackups()).length === S.KEEP_BACKUPS - 1, 'a Drive backup can be deleted');
  ok(fake.fileNames().includes('bondhu-sync-head.json'), 'backups never touch the sync files');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL GOOGLE SYNC TESTS PASSED');
  await fake.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
