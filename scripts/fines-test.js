/**
 * Fines (late fees on contributions, penalties on loan installments) and the proof that the books balance.
 * Every expected number is worked out by hand in the comments.   npm run test:fines
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
const near = (a, b, m) => ok(Math.abs(a - b) < 0.011, `${m}: ${a} ≈ ${b}`);

const health = id => A.checkAccountingHealth().checks.find(c => c.id === id);
const books = () => A.getFundBooks();
const sum = (xs, k) => xs.reduce((s, x) => s + Number(x[k] || 0), 0);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-fines-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);
  A.saveAppSettings({ late_fee_amount: 100, monthly_due_day: 10, loan_consent_required: false });

  // Members joined 2025-01-01: A opening 10,000, B 20,000, C 0. The due day is the 10th, the usual late fee 100.
  let nid = 1990888800000;
  const mk = (name, opening) => A.addMember({ name, nid: String(++nid), opening_balance: opening, join_date: '2025-01-01', monthly_due: 500 });
  const a = mk('Member A', 10000), b = mk('Member B', 20000), c = mk('Member C', 0);
  const pay = (m, month, date, fee) => A.recordPayment({ member_id: m, payment_month: month, payment_date: date, contribution_amount: 500, late_fee: fee, payment_method: 'Cash' });
  pay(a, '2025-03', '2025-03-08', 0);      // on time, no fine
  pay(a, '2025-04', '2025-04-15', 100);    // 5 days late, fine 100
  pay(b, '2025-04', '2025-04-20', 100);    // 10 days late, fine 100
  pay(b, '2025-05', '2025-05-05', 100);    // paid ON TIME, yet a fine was charged: flagged
  pay(c, '2025-05', '2025-05-30', 0);      // 20 days late, NO fine (a waiver, or a missed fine)
  pay(c, '2025-06', '2025-06-25', 150);    // 15 days late, a different fine (150)

  // ================================================================ the register
  let reg = A.getFineRegister({});
  ok(reg.rows.length === 4 && reg.totals.count === 4, 'four fines are in the register');
  near(reg.totals.total, 450, 'fines collected = 100 + 100 + 100 + 150');
  near(reg.totals.contribution, 450, 'all four are contribution late fees'); near(reg.totals.loan, 0, 'no loan penalty yet');
  ok(reg.totals.members === 3 && reg.totals.onTime === 1, 'three members fined; one fine was charged on a payment made on time');
  const byKey = k => reg.rows.find(r => r.member_code && r.month === k.month && r.name === k.name);
  ok(byKey({ month: '2025-04', name: 'Member A' }).days_late === 5, 'A paid April on 15 Apr: 5 days after the due date (10 Apr)');
  ok(byKey({ month: '2025-04', name: 'Member B' }).days_late === 10, 'B paid April on 20 Apr: 10 days late');
  ok(byKey({ month: '2025-06', name: 'Member C' }).days_late === 15 && byKey({ month: '2025-06', name: 'Member C' }).amount === 150, 'C paid June on 25 Jun: 15 days late, fine 150');
  ok(byKey({ month: '2025-05', name: 'Member B' }).flag === 'on_time' && byKey({ month: '2025-05', name: 'Member B' }).days_late === 0, 'B\'s May fine is flagged: paid by the due date');
  ok(reg.rows.every(r => r.due_date === `${r.month}-10`), 'every due date is the 10th of the month the payment is for');

  // filters and sorting
  ok(A.getFineRegister({ member_id: b }).rows.length === 2, 'filter by member B: two fines'); near(A.getFineRegister({ member_id: b }).totals.total, 200, 'member B fines 200');
  const apr = A.getFineRegister({ start_date: '2025-04-01', end_date: '2025-04-30' });
  ok(apr.rows.length === 2, 'filter by the payment date: April has two fines'); near(apr.totals.total, 200, 'April fines 200');
  ok(A.getFineRegister({ source: 'loan' }).rows.length === 0 && A.getFineRegister({ source: 'contribution' }).rows.length === 4, 'filter by source');
  ok(A.getFineRegister({ search: 'Member C' }).rows.length === 1, 'search by member name');
  ok(A.getFineRegister({ search: '2025-05' }).rows.length === 1, 'search by month');
  ok(A.getFineRegister({ sort_by: 'amount_high' }).rows[0].amount === 150 && A.getFineRegister({ sort_by: 'amount_low' }).rows[0].amount === 100, 'sort by amount');
  ok(A.getFineRegister({ sort_by: 'days_late' }).rows[0].days_late === 15, 'sort by days late');
  ok(A.getFineRegister({ sort_by: 'oldest' }).rows[0].date === '2025-04-15' && A.getFineRegister({ sort_by: 'newest' }).rows[0].date === '2025-06-25', 'sort by date');

  // by month (the day the money was received) and by member
  ok(reg.byMonth.map(m => `${m.month}:${m.total}`).join() === '2025-06:150,2025-05:100,2025-04:200', 'by month: Jun 150, May 100, Apr 200');
  ok(reg.byMember.map(m => `${m.name.slice(-1)}:${m.total}`).join() === 'B:200,C:150,A:100', 'by member: B 200, C 150, A 100');

  // late with no fine, and overdue right now
  ok(reg.lateNoFine.count === 1 && reg.lateNoFine.rows[0].name === 'Member C' && reg.lateNoFine.rows[0].days_late === 20, 'one late payment has no fine: C, May, 20 days late');
  near(reg.lateNoFine.potential, 100, 'worth one usual fine (100)');
  const todayKey = new Date().toISOString().slice(0, 7);
  const monthsBetween = () => { const now = new Date(); const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); let n = 0; for (let y = 2025, m = 1; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1); m === 12 ? (m = 1, y++) : m++) if (new Date(y, m - 1, 10) < today0) n++; return n; };
  const allDue = monthsBetween();
  const overdueA = reg.overdueNow.rows.find(r => r.name === 'Member A');
  ok(overdueA && overdueA.months === allDue - 2, `A has ${allDue - 2} unpaid months past their due date (${allDue} since joining, 2 paid)`);
  near(overdueA.fine_if_paid_today, (allDue - 2) * 100, 'and would be fined 100 for each if paid today');
  ok(reg.overall.rate === 100 && reg.overall.dueDay === 10, 'the page knows the current rate and due day');
  near(reg.overall.total, 450, 'overall: all-time fines 450');

  // ================================================================ the ledger keeps contributions and fines apart
  const led = A.getTransactions('2000-01-01', '2100-01-01');
  near(sum(led.filter(r => r.type === 'collection'), 'credit'), 3000, 'ledger: six contributions of 500 = 3,000');
  near(sum(led.filter(r => r.type === 'fine'), 'credit'), 450, 'ledger: the fines are separate lines = 450');
  ok(led.filter(r => r.type === 'fine').every(r => /^Late fee /.test(r.description)), 'a fine line says "Late fee <month>"');
  ok(A.getTransactions('2000-01-01', '2100-01-01', 'fine').length === 4 && A.getTransactions('2000-01-01', '2100-01-01', 'collection').length === 6, 'the ledger can be filtered to fines only, or contributions only');
  const m0 = A.getOverviewMetrics(todayKey);
  near(m0.fund_balance_at_cost, 30000 + 3450, 'fund balance = openings 30,000 + contributions 3,000 + fines 450');
  near(m0.cash_in_hand, 33450, 'cash in hand = 33,450 (nothing invested yet)');
  ok(health('reconcile').status === 'pass', 'the cash book still reconciles with fines on their own lines');
  ok(health('fine_register').status === 'pass', 'the fine register equals the fines in payments');
  ok(health('fine_on_time').status === 'warn' && health('fine_on_time').count === 1, 'the health check points at the one fine charged on an on-time payment');

  // ================================================================ the books balance, step after step
  let bk = books();
  near(bk.owedToMembers, 33000, 'books: members are owed principal = (10,000+1,000) + (20,000+1,000) + (0+1,000) = 33,000');
  near(bk.fundBalance, 33450, 'books: fund balance 33,450'); near(bk.reserve, 450, 'books: reserve = 33,450 − 33,000 = 450 (the fines)');
  ok(bk.balanced && bk.parts.fines === 450 && bk.parts.expenses === 0, 'books: balanced, and the reserve is exactly the fines');

  A.addExpense({ title: 'Meeting snacks', category: 'Meetup & Events', amount: 120, expense_date: '2025-07-01', payee: 'Shop', receipt_ref: 'R1' });
  bk = books(); near(bk.reserve, 330, 'an expense of 120 comes out of the reserve (450 − 120 = 330)'); ok(bk.balanced && bk.parts.expenses === 120, 'books: still balanced');

  const inv = A.addInvestment({ name: 'Plot F', sector: 'Land', invested_amount: 5000, purchase_date: '2025-02-01' });
  bk = books(); ok(bk.balanced && Math.abs(bk.reserve - 330) < 0.01, 'buying an asset moves cash to the asset: reserve unchanged, still balanced');
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 600, entry_date: '2025-06-30', payment_method: 'Cash' });
  bk = books(); near(bk.owedToMembers, 33600, 'a profit of 600 is shared with the members: now owed 33,600'); ok(bk.balanced && Math.abs(bk.reserve - 330) < 0.01, 'the reserve does not move: the profit belongs to the members');

  // a loan with a penalty: interest is shared like profit, the penalty stays with the fund
  const loan = A.addLoan({ member_id: c, principal: 3000, method: 'reducing', annual_rate: 12, term_months: 6, disbursed_date: '2025-07-01', payment_method: 'Cash', guarantor_type: 'member', guarantor_member_id: a, purpose: 'Test' });
  bk = books(); ok(bk.balanced && Math.abs(bk.reserve - 330) < 0.01, 'lending is a cash → loan transfer: reserve unchanged');
  const q = A.previewLoanRepayment(loan, '2025-08-20');
  A.recordLoanRepayment({ loan_id: loan, paid_date: '2025-08-20', amount: q.principal + q.interest, payment_method: 'Cash', penalty: 40, note: 'late' });
  reg = A.getFineRegister({});
  ok(reg.rows.length === 5 && reg.rows.some(r => r.source === 'loan' && r.amount === 40 && /^Loan PL-/.test(r.label)), 'the loan penalty (40) is in the register as a loan fine');
  near(reg.totals.loan, 40, 'loan fines 40'); near(reg.overall.total, 490, 'overall fines 490 = 450 + 40');
  ok(reg.rows.find(r => r.source === 'loan').days_late === null && reg.rows.find(r => r.source === 'loan').flag === 'ok', 'a loan fine has no due-day arithmetic and is never flagged');
  bk = books(); near(bk.parts.penalties, 40, 'books: loan penalties 40'); ok(bk.balanced, 'books: balanced after interest and penalty');
  near(bk.reserve, 370, 'the reserve grew by exactly the penalty: 330 + 40 = 370'); near(bk.owedToMembers, 33600 + q.interest, `members are owed the interest too (+${q.interest})`);
  const ledAll = A.getTransactions('2000-01-01', '2100-01-01');
  near(sum(ledAll.filter(r => r.type === 'fine'), 'credit'), 490, 'ledger fines = 490 (loan penalty included)');
  near(ledAll.filter(r => r.type === 'loan_repayment')[0].credit, q.principal + q.interest, 'the repayment line excludes the penalty');
  ok(A.checkAccountingHealth().fails === 0 && health('reconcile').status === 'pass', 'the whole health check is clean, cash book reconciles');

  // write the rest of the loan off: a shared loss; the borrower's own savings absorb it first
  A.writeOffLoan({ loan_id: loan, date: '2025-12-01', reason: 'Test' });
  bk = books(); ok(bk.balanced, 'books: balanced after a write-off'); near(bk.reserve, 370, 'a write-off is borne by the members (C first), not by the reserve');

  // settlements: at the suggested payout, then with an adjusted payout
  const sa = A.settleMember({ member_id: a, settlement_date: '2025-12-31', payment_method: 'Cash' });
  bk = books(); ok(bk.balanced && Math.abs(bk.parts.settlementAdjustment) < 0.011, 'settling A at the suggested payout leaves no adjustment'); near(bk.reserve, 370, 'and the reserve is unchanged');
  A.settleMember({ member_id: b, settlement_date: '2025-12-31', payment_method: 'Cash', profit_share: A.previewMemberSettlement(b, '2025-12-31').profitShare + 100, note: 'Goodwill' });
  bk = books(); near(bk.parts.settlementAdjustment, 100, 'B was paid 100 more than the books said'); ok(bk.balanced, 'books: balanced'); near(bk.reserve, 270, 'the extra 100 came out of the reserve (370 − 100)');
  ok(bk.drift.length === 0 && health('set_drift').status === 'pass', 'settled members\' figures match the books');

  // tampering: the share the system calculated at the time no longer matches the books → it is noticed (a deliberate payout change is not)
  const initSqlJs = require(path.join(proj, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs({ wasmBinary: wasm });
  { const raw = new SQL.Database(store.exportBytes()); raw.run('UPDATE member_settlements SET calc_profit_share = calc_profit_share + 50 WHERE member_id = ?', [a]); store.replaceWith(Buffer.from(raw.export())); }
  bk = books(); ok(bk.drift.length === 1 && bk.drift[0].stored - bk.drift[0].now === 50, 'DRIFT: a settlement whose recorded share differs from the books by 50 is reported'); ok(health('set_drift').status === 'warn', 'and the health check warns');
  { const raw = new SQL.Database(store.exportBytes()); raw.run('UPDATE member_settlements SET calc_profit_share = calc_profit_share - 50 WHERE member_id = ?', [a]); store.replaceWith(Buffer.from(raw.export())); }

  // everybody settled: a later benefit has nobody to share it with and stays in the fund
  A.settleMember({ member_id: c, settlement_date: '2025-12-31', payment_method: 'Cash' });
  A.addInvestmentReturn({ investment_id: inv, entry_type: 'Profit', amount: 300, entry_date: '2026-01-15', payment_method: 'Cash' });
  bk = books(); ok(bk.owedToMembers < 0.01 && bk.members === 0, 'no member is left to be owed anything'); near(bk.parts.unshared, 300, 'a profit of 300 with no member in the fund is unshared');
  ok(bk.balanced && Math.abs(bk.reserve - bk.fundBalance) < 0.01, 'books: balanced; the whole fund balance is now the fund\'s own');

  // ================================================================ a fund whose expenses exceed its fines
  A.resetDatabase(true);
  A.saveAppSettings({ late_fee_amount: 100, monthly_due_day: 10 });
  const x = A.addMember({ name: 'Solo', nid: String(++nid), opening_balance: 1000, join_date: '2025-01-01', monthly_due: 500 });
  A.recordPayment({ member_id: x, payment_month: '2025-02', payment_date: '2025-02-20', contribution_amount: 500, late_fee: 100, payment_method: 'Cash' });
  A.addExpense({ title: 'Big bill', category: 'Meetup & Events', amount: 400, expense_date: '2025-03-01', payee: 'Hall', receipt_ref: 'R2' });
  bk = books(); near(bk.reserve, -300, 'fines 100 − expenses 400 = −300: the fund holds 300 less than the member is owed'); ok(bk.balanced, 'the books still balance: the shortfall is explained');
  ok(health('reserve_negative').status === 'warn', 'the health check warns that the fund is short of what members are owed');
  ok(health('books_balance').status === 'pass', 'and says the books themselves balance');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL FINES TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
