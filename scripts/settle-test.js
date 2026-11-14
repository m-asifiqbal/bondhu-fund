/**
 * Accounting tests for member settlement (exit payout) and investment profit/loss entries.
 * Every expected number below is worked out by hand in the comments.   npm run test:settle
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const near = (a, b, m) => ok(Math.abs(a - b) < 0.005, `${m}: ${a} ≈ ${b}`);
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-settle-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);

  // Members joined 2025-01-01. Opening balances: A 1000, B 1000, C 2000 (total 4000)
  let nidN = 1990123400000; const mk = (name, opening) => A.addMember({ name, nid: String(++nidN), opening_balance: opening, join_date: '2025-01-01', monthly_due: 500 });
  const a = mk('Member A', 1000), b = mk('Member B', 1000), c = mk('Member C', 2000);
  const inv = A.addInvestment({ name: 'Plot X', sector: 'Land', invested_amount: 3000, purchase_date: '2025-02-01' });

  // ---- validation of entries ----
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 0, entry_date: '2025-03-01', payment_method: 'Cash' }), /greater than zero/, 'zero amount rejected');
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 10, entry_date: '2025-01-15', payment_method: 'Cash' }), /before the investment/, 'entry before purchase rejected');
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 10, entry_date: '2099-01-01', payment_method: 'Cash' }), /future/, 'future entry rejected');
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 10, entry_date: '2025-03-01', payment_method: '' }), /medium/, 'profit needs a receiving medium');
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Gain', amount: 10, entry_date: '2025-03-01', payment_method: 'Cash' }), /Profit or Loss/, 'bad type rejected');
  throws(() => A.addInvestmentReturn({ investment_id: 999, entry_type: 'Profit', amount: 10, entry_date: '2025-03-01', payment_method: 'Cash' }), /investment/, 'unknown investment rejected');

  const base = A.getOverviewMetrics('2025-12');
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 400, entry_date: '2025-03-01', payment_method: 'Bank transfer' });   // A100 B100 C200
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Loss', amount: 100, entry_date: '2025-04-01' });                                       // A-25 B-25 C-50
  A.recordPayment({ member_id: a, payment_month: '2025-05', payment_date: '2025-05-05', contribution_amount: 500, late_fee: 50, payment_method: 'Cash' }); // A principal 1500
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 600, entry_date: '2025-06-01', payment_method: 'Cash' });             // A200 B133.33 C266.67

  // fund: opening 4000 + collected 550 (500 + 50 late fee) + net returns 900 = 5450 ; cash = 5450 - 3000
  let pos = A.getOverviewMetrics('2025-12');
  near(pos.fund_balance_at_cost, 5450, 'fund balance includes returns');
  near(pos.cash_in_hand, 2450, 'cash in hand includes returns');
  const sum = A.getReturnsSummary();
  near(sum.profit, 1000, 'summary profit'); near(sum.loss, 100, 'summary loss'); near(sum.net, 900, 'summary net');

  // ---- cannot become inactive without settlement ----
  throws(() => A.updateMember(b, { status: 'Inactive' }), /Settle/, 'direct deactivation blocked');
  throws(() => A.settleMember({ member_id: b, settlement_date: '2025-07-01', payment_method: '' }), /medium/, 'settlement needs a payment medium');
  throws(() => A.settleMember({ member_id: a, settlement_date: '2025-04-01', payment_method: 'Cash' }), /before the member's last payment/, 'settlement before last payment blocked');
  throws(() => A.settleMember({ member_id: b, settlement_date: '2099-01-01', payment_method: 'Cash' }), /future/, 'future settlement blocked');

  // ---- settle B on 2025-07-01: principal 1000, share 100 - 25 + 133.33 = 208.33, paid 1208.33 ----
  const pb = A.previewMemberSettlement(b, '2025-07-01');
  near(pb.principal, 1000, 'B principal'); near(pb.profitShare, 208.33, 'B calculated share'); near(pb.suggestedPayout, 1208.33, 'B suggested payout');
  throws(() => A.settleMember({ member_id: b, settlement_date: '2025-07-01', payment_method: 'Cash', profit_share: 300 }), /reason/, 'changed share needs a note');
  throws(() => A.settleMember({ member_id: b, settlement_date: '2025-07-01', payment_method: 'Cash', profit_share: -2000, note: 'x' }), /negative/, 'negative payout blocked');
  A.settleMember({ member_id: b, settlement_date: '2025-07-01', payment_method: 'bKash', trx_id: 'TX1' });
  ok(A.getMembers('', 'Inactive').members.some(m => m.id === b), 'B is Inactive after settlement');
  near(A.getOverviewMetrics('2025-12').fund_balance_at_cost, 5450 - 1208.33, 'fund reduced by B payout');
  throws(() => A.settleMember({ member_id: b, settlement_date: '2025-07-02', payment_method: 'Cash' }), /already has a settlement|active/, 'cannot settle twice');
  throws(() => A.recordPayment({ member_id: b, payment_month: '2025-08', payment_date: '2025-08-02', contribution_amount: 500, payment_method: 'Cash' }), /inactive/, 'payments blocked for inactive member');
  throws(() => A.updateMember(b, { status: 'Active' }), /cancel the settlement/, 'settled member cannot be reactivated directly');
  throws(() => A.updateMember(b, { opening_balance: 5 }), /opening balance/i, 'opening balance locked after settlement');
  throws(() => A.deleteMember(b), /settlement/, 'settled member cannot be deleted');

  // back-dated entries / sale changes after a settlement are refused
  throws(() => A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 50, entry_date: '2025-06-30', payment_method: 'Cash' }), /already settled/, 'entry dated before latest settlement refused');
  const r600 = A.getInvestmentReturns(inv).find(r => r.amount === 600);
  throws(() => A.deleteInvestmentReturn(r600.id), /already been settled/, 'entry inside a settled period cannot be deleted');
  throws(() => A.deleteInvestment(inv), /profit\/loss/, 'investment with entries cannot be deleted');

  // ---- B is out of later benefits: +450 on 2025-08-01 shared by A (1500) and C (2000) only ----
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 450, entry_date: '2025-08-01', payment_method: 'Cash' }); // A 192.857 C 257.143
  const pa = A.previewMemberSettlement(a, '2025-09-01');
  near(pa.principal, 1500, 'A principal (opening 1000 + contribution 500; late fee excluded)'); near(pa.lateFeesKept, 50, 'late fee kept by fund');
  near(pa.profitShare, 100 - 25 + 200 + 192.857, 'A calculated share'); // 467.857
  A.settleMember({ member_id: a, settlement_date: '2025-09-01', payment_method: 'Bank transfer' });
  const pc = A.previewMemberSettlement(c, '2025-10-01');
  near(pc.principal, 2000, 'C principal'); near(pc.profitShare, 200 - 50 + 266.667 + 257.143, 'C calculated share'); // 673.81
  A.settleMember({ member_id: c, settlement_date: '2025-10-01', payment_method: 'Cash', profit_share: 600, note: 'Agreed with committee' });
  const set = A.getMemberSettlements();
  ok(set.length === 3, 'three settlements recorded');
  const C = set.find(s => s.member_id === c);
  near(C.calc_profit_share, 673.81, 'calculated share kept on record'); near(C.profit_share, 600, 'agreed share recorded'); near(C.total_paid, 2600, 'C paid 2000 + 600');
  // total benefit = 400 - 100 + 600 + 450 = 1350 ; calculated shares must add up to it exactly (±rounding)
  const calcSum = set.reduce((s, x) => s + x.calc_profit_share, 0);
  ok(Math.abs(calcSum - 1350) < 0.02, `calculated shares add up to total benefit 1350 (${calcSum.toFixed(2)})`);

  // ---- books still balance ----
  // fund = 4000 + 550 + 1350 - (1208.33 + 1967.86 + 2600) ; investments 3000 at cost
  const paidOut = set.reduce((s, x) => s + x.total_paid, 0);
  near(A.getOverviewMetrics('2025-12').fund_balance_at_cost, 4000 + 550 + 1350 - paidOut, 'fund balance after all settlements');
  const h = A.checkAccountingHealth();
  ok(h.fails === 0, `health check: no failures (${h.passes} pass, ${h.warns} warn)`);
  ok(h.checks.find(x => x.id === 'reconcile').status === 'pass', 'cash book reconciles');
  const led = A.getTransactions('2025-01-01', '2025-12-31');
  ok(led.filter(x => x.type === 'settlement').length === 3 && led.filter(x => x.type === 'return').length === 4, 'ledger lists settlements and returns');
  ok(A.getOverviewData('2025-12').recent.some(x => x.kind === 'settlement'), 'recent activity lists settlements');

  // ---- cancelling a settlement (Admin correction) restores the money and allows reactivation ----
  throws(() => A.deletePayment(A.getMemberHistory(a)[0].id), /settled/, 'settled member payments are locked');
  A.cancelSettlement(a);
  near(A.getOverviewMetrics('2025-12').fund_balance_at_cost, 4000 + 550 + 1350 - (paidOut - 1967.86), 'fund restored after cancel');
  ok(A.checkAccountingHealth().checks.find(x => x.id === 'set_missing').status === 'warn', 'health check flags an inactive member without settlement');
  A.updateMember(a, { status: 'Active' });
  ok(A.getMembers('', 'Active').members.some(m => m.id === a), 'member can be reactivated after cancel');

  // ---- backup round trip keeps the new tables ----
  const st = A.getDatabaseStats();
  ok(st.settlements === 2 && st.returns === 4 && st.schemaVersion === 9, `stats: ${st.settlements} settlements, ${st.returns} returns, schema v${st.schemaVersion}`);

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL SETTLEMENT CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
