/**
 * Account audit: every kind of entry (payment, late fee, expense, investment, valuation, sale, profit/loss, settlement)
 * is created, changed and removed, while an independent running ledger (plain arithmetic, written here) is kept.
 * After each step the app's figures must equal the independent ones.   npm run test:audit
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`FAIL  ${m}`); } };
const eq = (a, b, m) => ok(Math.abs(a - b) < 0.005, `${m}: app ${a} vs independent ${b}`);
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };

// ---- independent books ----
const book = { opening: 0, collected: 0, contributions: 0, lateFees: 0, expenses: 0, invested: 0, saleProceeds: 0, soldCost: 0, profit: 0, loss: 0, paidOut: 0 };
const fundBalance = () => book.opening + book.collected - book.expenses + (book.saleProceeds - book.soldCost) + book.profit - book.loss - book.paidOut;
const openInvCost = () => book.invested - book.soldCost;

function audit(step, unrealized = 0, portfolio = null) {
  const m = A.getOverviewMetrics('2026-11');
  eq(m.fund_balance_at_cost, fundBalance(), `${step} · fund balance`);
  eq(m.cash_in_hand, fundBalance() - openInvCost(), `${step} · cash in hand`);
  eq(m.invested_assets, openInvCost(), `${step} · invested at cost`);
  eq(m.unrealized_gain, unrealized, `${step} · unrealised gain`);
  eq(m.total_fund_balance, fundBalance() + unrealized, `${step} · total fund (incl. unrealised)`);
  const led = A.getTransactions('2000-01-01', '2100-01-01');
  const credit = led.reduce((s, r) => s + Number(r.credit || 0), 0), debit = led.reduce((s, r) => s + Number(r.debit || 0), 0);
  eq(book.opening + credit - debit, fundBalance() - openInvCost(), `${step} · ledger cash (opening + credits - debits)`);
  const h = A.checkAccountingHealth();
  ok(h.fails === 0, `${step} · health check has no failures (${h.checks.filter(c => c.status === 'fail').map(c => c.title).join('; ')})`);
  ok(h.checks.find(c => c.id === 'reconcile').status === 'pass', `${step} · cash book reconciles`);
  ok(h.checks.find(c => c.id === 'member_totals').status === 'pass', `${step} · member totals add up`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-audit-'));
  await store.openDatabase(path.join(dir, 'a.db'), wasm);
  A.resetDatabase(true);
  A.saveAppSettings({ monthly_due_day: '10', late_fee_amount: '300' });

  // ---------- members ----------
  const m1 = A.addMember({ name: 'Audit One', nid: '1990123450001', opening_balance: 500, join_date: '2026-01-01', monthly_due: 1000 }); book.opening += 500;
  const m2 = A.addMember({ name: 'Audit Two', nid: '1990123450002', opening_balance: 0, join_date: '2026-01-01', monthly_due: 2000 });
  audit('members created');
  throws(() => A.addMember({ name: '' }), /name/i, 'member needs a name');
  throws(() => A.addMember({ name: 'X', monthly_due: -5 }), /positive/i, 'negative due refused');

  // ---------- payments & late fees ----------
  ok(A.suggestLateFee('2026-02', '2026-02-10') === 0, 'no late fee on the due day');
  ok(A.suggestLateFee('2026-02', '2026-02-11') === 300, 'late fee the day after the due day');
  A.recordPayment({ member_id: m1, payment_month: '2026-01', payment_date: '2026-01-05', contribution_amount: 1000, late_fee: 0, payment_method: 'Cash' });
  book.collected += 1000; book.contributions += 1000;
  A.recordPayment({ member_id: m1, payment_month: '2026-02', payment_date: '2026-02-15', contribution_amount: 1000, late_fee: 300, payment_method: 'bKash', trx_id: 'T1' });
  book.collected += 1300; book.contributions += 1000; book.lateFees += 300;
  A.recordPayment({ member_id: m2, payment_month: '2026-01', payment_date: '2026-01-08', contribution_amount: 2000, late_fee: 0, payment_method: 'Bank transfer' });
  book.collected += 2000; book.contributions += 2000;
  audit('3 payments');
  const mm = A.getMembers('', 'All', 1, 20).members;
  eq(Number(mm.find(x => x.id === m1).total_contributed), 500 + 2000, 'M1 total contributed (opening + 2 payments, late fee excluded)');
  eq(Number(mm.find(x => x.id === m2).total_contributed), 2000, 'M2 total contributed');
  throws(() => A.recordPayment({ member_id: m1, payment_month: '2026-03', payment_date: '2026-03-02', contribution_amount: 0, payment_method: 'Cash' }), /greater than zero/, 'zero contribution refused');
  throws(() => A.recordPayment({ member_id: m1, payment_month: '2026-03', payment_date: '2099-01-01', contribution_amount: 5, payment_method: 'Cash' }), /future/, 'future payment refused');
  throws(() => A.recordPayment({ member_id: m1, payment_month: '2026-03', payment_date: '2026-03-02', contribution_amount: 5, late_fee: -1, payment_method: 'Cash' }), /negative/, 'negative late fee refused');

  // same member + month again = correction, not a duplicate
  A.recordPayment({ member_id: m2, payment_month: '2026-01', payment_date: '2026-01-08', contribution_amount: 2500, late_fee: 0, payment_method: 'Bank transfer' });
  book.collected += 500; book.contributions += 500;
  ok(A.getMemberHistory(m2).length === 1, 'correcting a month does not create a second row');
  audit('payment corrected');

  const del = A.getMemberHistory(m1).find(x => x.payment_month === '2026-02');
  A.deletePayment(del.id); book.collected -= 1300; book.contributions -= 1000; book.lateFees -= 300;
  audit('payment voided');
  const col = A.getCollections('2026-01');
  eq(col.stats.collectedAmount, 1000 + 2500, 'Collections screen: January collected');

  // ---------- expenses ----------
  const e1 = A.addExpense({ title: 'Meeting', category: 'Meetup & Events', amount: 800, expense_date: '2026-03-10', payee: 'Venue' }); book.expenses += 800;
  ok(A.getExpenses().find(x => x.id === e1).status === 'Needs receipt', 'expense without receipt is flagged');
  const e2 = A.addExpense({ title: 'Stationery', category: 'Office & Supplies', amount: 200, expense_date: '2026-03-11', payee: 'Shop', receipt_ref: 'V-1' }); book.expenses += 200;
  ok(A.getExpenses().find(x => x.id === e2).status === 'Verified', 'expense with receipt is verified');
  audit('2 expenses');
  A.verifyExpenseReceipt(e1, 'V-2');
  ok(A.getExpenses().find(x => x.id === e1).status === 'Verified', 'receipt verification works');
  A.updateExpense(e2, { amount: 250 }); book.expenses += 50;
  audit('expense edited');
  A.deleteExpense(e2); book.expenses -= 250;
  audit('expense deleted');
  throws(() => A.addExpense({ title: 'Bad', category: 'Meetup & Events', amount: 0, expense_date: '2026-03-10', payee: 'x' }), /greater than zero|amount/i, 'zero expense refused');

  // ---------- investments ----------
  const i1 = A.addInvestment({ name: 'Plot A', sector: 'Plot', invested_amount: 3000, purchase_date: '2026-03-01' }); book.invested += 3000;
  audit('investment bought');
  A.updateInvestmentValuation(i1, 3500);
  audit('valuation up', 500);
  A.updateInvestmentValuation(i1, 2800);
  audit('valuation down', -200);
  const i2 = A.addInvestment({ name: 'FDR B', sector: 'Fixed Deposit', invested_amount: 1000, purchase_date: '2026-04-01' }); book.invested += 1000;
  A.updateInvestment(i2, { status: 'Sold', sold_amount: 1300, sold_date: '2026-06-01' });
  book.saleProceeds += 1300; book.soldCost += 1000;
  audit('investment sold at a gain', -200);
  throws(() => A.updateInvestment(i1, { status: 'Sold' }), /sale amount/, 'sale needs an amount');

  // ---------- profit / loss entries ----------
  A.addInvestmentReturn({ investment_id: i1, entry_type: 'Profit', amount: 100, entry_date: '2026-07-01', payment_method: 'Cash' }); book.profit += 100;
  A.addInvestmentReturn({ investment_id: i1, entry_type: 'Loss', amount: 40, entry_date: '2026-08-01' }); book.loss += 40;
  audit('profit and loss entries', -200);

  // ---------- settlement ----------
  const pv = A.previewMemberSettlement(m2, '2026-09-01');
  eq(pv.principal, 2500, 'M2 principal = contributions');
  A.settleMember({ member_id: m2, settlement_date: '2026-09-01', payment_method: 'Cash', profit_share: pv.profitShare });
  book.paidOut += 2500 + pv.profitShare;
  audit('member settled', -200);
  const s = A.getMemberSettlements().find(x => x.member_id === m2);
  eq(s.total_paid, s.principal + s.profit_share, 'settlement total = principal + share');
  // shares across everyone who was in the fund must never exceed total benefit
  const totalBenefit = (1300 - 1000) + 100 - 40;
  const shareM2 = s.calc_profit_share;
  ok(shareM2 >= 0 && shareM2 <= totalBenefit + 0.01, `M2 share ${shareM2} is within total benefit ${totalBenefit}`);

  // ---------- reports / ledger ----------
  const led = A.getTransactions('2026-01-01', '2026-12-31');
  ok(['collection', 'expense', 'investment', 'sale', 'return', 'settlement'].every(t => led.some(r => r.type === t)), 'ledger contains every entry type');
  const od = A.getOverviewData('2026-11');
  ok(Array.isArray(od.trend) && od.trend.length === 12, 'overview trend builds');
  eq(od.trend[11].fundBalance, fundBalance(), 'trend latest fund balance equals the fund balance');

  // ---------- backup round trip keeps every figure ----------
  const before = A.getOverviewMetrics('2026-11').fund_balance_at_cost;
  store.flush();
  const dbFile = path.join(dir, 'a.db');
  store.replaceWith(fs.readFileSync(dbFile));
  eq(A.getOverviewMetrics('2026-11').fund_balance_at_cost, before, 'figures identical after backup → restore');

  console.log(`${checks} audit checks run`);
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nACCOUNT AUDIT PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
