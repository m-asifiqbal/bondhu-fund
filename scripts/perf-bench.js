/**
 * Performance benchmark: timing of the heavy operations on a large fund, through the real code.
 * 500 members, about 33,000 payments, 400 expenses, 12 investments and 60 loans are created in a throw-away database, then each
 * operation a user waits for is timed and compared with its target. Nothing of your real data is touched.
 *   npm run bench
 * Exit code 1 when an operation is slower than its target (a regression guard).
 */
const fs = require('fs'), path = require('path'), os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
const pad = n => String(n).padStart(2, '0');
const rows = [];
const t = (label, fn, n = 1, limitMs = 800) => { const s = process.hrtime.bigint(); let r; for (let i = 0; i < n; i++) r = fn(); const ms = Number(process.hrtime.bigint() - s) / 1e6 / n; rows.push({ label, ms, limitMs }); return r; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-bench-'));
  const t0 = Date.now();
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);
  A.saveAppSettings({ late_fee_amount: 100, monthly_due_day: 10, loan_consent_required: false, loan_max_active: 0, loan_block_overdue: false, loan_block_written_off: false, loan_guarantor_max: 0 });
  let nid = 1990000000000; const ids = [];
  for (let i = 0; i < 500; i++) ids.push(A.addMember({ name: `Member ${i + 1}`, nid: String(++nid), opening_balance: 1000, join_date: '2021-01-01', monthly_due: 500 }));
  let pays = 0; const tp = Date.now();
  for (const id of ids) for (let y = 2021; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const mk = `${y}-${pad(m)}`; if (mk > '2026-11') break; if ((id + y + m) % 17 === 0) continue; A.recordPayment({ member_id: id, payment_month: mk, payment_date: `${mk}-05`, contribution_amount: 500, late_fee: 0, payment_method: 'Cash' }); pays++; }
  const payRate = pays / ((Date.now() - tp) / 1000);
  for (let i = 0; i < 400; i++) A.addExpense({ allow_overdraft: true, title: 'Exp ' + i, category: 'Meetup & Events', amount: 100 + (i % 50), expense_date: `2025-${pad(1 + (i % 12))}-10`, payee: 'Shop', receipt_ref: 'R' });
  for (let i = 0; i < 12; i++) A.addInvestment({ allow_overdraft: true, name: 'Inv ' + i, sector: 'Land', invested_amount: 20000, purchase_date: '2024-03-01' });
  // 60 loans with repayments so the loan engine is exercised too
  let loans = 0;
  for (let i = 0; i < 60; i++) { try { const l = A.addLoan({ member_id: ids[i], principal: 20000, method: 'reducing', annual_rate: 12, term_months: 12, disbursed_date: '2026-01-05', first_due_date: '2026-02-05', payment_method: 'Cash', purpose: 'Shop', guarantor_type: 'member', guarantor_member_id: ids[i + 100] }); loans++; if (i % 2 === 0) A.recordLoanRepayment({ loan_id: l, paid_date: '2026-02-05', amount: 1800, payment_method: 'Cash' }); } catch (e) { /* policy or cash: skip */ } }
  console.log(`built: ${ids.length} members, ${pays} payments (${payRate.toFixed(0)} payments/s), 400 expenses, 12 investments, ${loans} loans in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  store.flush();
  console.log('database size:', (fs.statSync(path.join(dir, 't.db')).size / 1048576).toFixed(1), 'MB\n');
  t('Overview screen (getOverviewData)', () => A.getOverviewData('2026-11'), 3, 500);
  t('Members page (10 rows)', () => A.getMembers('', 'All', 1, 10), 3, 200);
  t('Members search "Member 25"', () => A.getMembers('Member 25', 'All', 1, 10), 3, 200);
  t('Collections for one month', () => A.getCollections('2026-10', 'All'), 3, 200);
  t('Fines screen (getFineRegister)', () => A.getFineRegister({}), 2, 800);
  t('Fund books (getFundBooks)', () => A.getFundBooks(), 3, 400);
  t('Loans list + summary', () => { A.getLoans(); return A.getLoanSummary(); }, 2, 500);
  t('Accounting health check', () => A.checkAccountingHealth(), 2, 800);
  t('Cash-book source (getTransactions)', () => A.getTransactions(), 2, 800);
  t('Notifications', () => A.getDynamicNotifications(), 3, 300);
  t('Add one payment (write path)', () => A.recordPayment({ member_id: ids[0], payment_month: '2026-11', payment_date: '2026-11-05', contribution_amount: 500, late_fee: 0, payment_method: 'Cash', replace: true }), 1, 100);
  t('Backup export (whole database)', () => store.exportBytes(), 3, 200);
  let bad = 0;
  for (const r of rows) { const ok = r.ms <= r.limitMs; if (!ok) bad++; console.log(`${ok ? 'OK  ' : 'SLOW'} ${r.label.padEnd(40)} ${r.ms.toFixed(0).padStart(6)} ms   (target ≤ ${r.limitMs})`); }
  console.log(`\n${rows.length - bad} of ${rows.length} operations within target`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
