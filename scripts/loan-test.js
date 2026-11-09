/**
 * Personal-loan tests: schedule maths (worked by hand in the comments), repayment allocation, and the books
 * (cash in hand, fund balance, member settlement shares, health check).   npm run test:loans
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const L = require(path.join(proj, 'dist-electron', 'loans.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const near = (a, b, m, tol = 0.005) => ok(Math.abs(a - b) <= tol, `${m}: ${a} ≈ ${b}`);
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };
const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------
// 1. Pure maths
// ---------------------------------------------------------------------------------------------------------------
{
  // Reducing balance: 100,000 at 12 % for 12 months. r = 1 %; EMI = 1000 / (1 − 1.01^−12) = 8884.88 → 8,885 (whole taka)
  const p = L.buildPlan({ principal: 100000, method: 'reducing', annual_rate: 12, term_months: 12, first_due_date: '2025-03-01' });
  ok(p.rows.length === 12, 'reducing: 12 installments');
  near(p.installment, 8885, 'reducing: EMI rounded to whole taka');
  near(p.rows[0].interest, 1000, 'reducing: month-1 interest = 100,000 × 1 %');
  near(p.rows[0].principal, 7885, 'reducing: month-1 principal = 8,885 − 1,000');
  near(sum(p.rows, 'principal'), 100000, 'reducing: principal adds up exactly');
  near(p.totalInterest, sum(p.rows, 'interest'), 'reducing: total interest = Σ interest');
  near(p.totalPayable, 100000 + p.totalInterest, 'reducing: payable = principal + interest');
  ok(Math.abs(p.totalInterest - 6618.55) < 6, `reducing: total interest ≈ 6,618.55 (got ${p.totalInterest})`);
  near(p.rows[11].balance, 0, 'reducing: balance ends at zero');
  ok(Math.abs(p.lastInstallment - 8885) < 8, `reducing: last installment absorbs rounding (${p.lastInstallment})`);
  near(p.effectiveRate, 12, 'reducing: effective rate equals quoted rate', 0.15);
  ok(p.rows.every((r, i) => i === 0 || p.rows[i - 1].interest >= r.interest), 'reducing: interest falls every month');

  // Exact (no rounding to taka)
  const e = L.buildPlan({ principal: 100000, method: 'reducing', annual_rate: 12, term_months: 12, first_due_date: '2025-03-01', round_to_taka: false });
  near(e.installment, 8884.88, 'reducing: exact EMI 8,884.88');

  // Flat: 120,000 at 10 % for 12 months → interest 12,000; 11,000 a month = 10,000 principal + 1,000 interest
  const f = L.buildPlan({ principal: 120000, method: 'flat', annual_rate: 10, term_months: 12, first_due_date: '2025-03-01' });
  near(f.totalInterest, 12000, 'flat: total interest = P × 10 % × 1 year');
  ok(f.rows.every(r => r.interest === 1000 && r.principal === 10000 && r.total === 11000), 'flat: every installment is 10,000 + 1,000');
  ok(f.effectiveRate > 17 && f.effectiveRate < 18.5, `flat 10 % really costs ~17.8 % a year on the reducing balance (got ${f.effectiveRate})`);

  // Flat with awkward rounding: 100,000 at 9 % for 7 months → interest 5,250; 105,250 / 7 = 15,035.71 → 15,036 ×6, last 15,034
  const g = L.buildPlan({ principal: 100000, method: 'flat', annual_rate: 9, term_months: 7, first_due_date: '2025-03-01' });
  near(g.totalInterest, 5250, 'flat 7 months: interest 5,250');
  near(g.rows[0].total, 15036, 'flat 7 months: regular installment 15,036');
  near(g.rows[6].total, 15034, 'flat 7 months: last installment 15,034');
  near(sum(g.rows, 'total'), 105250, 'flat 7 months: installments add up to 105,250');
  near(sum(g.rows, 'principal'), 100000, 'flat 7 months: principal adds up');

  // Interest-free
  const z = L.buildPlan({ principal: 50000, method: 'free', annual_rate: 99, term_months: 10, first_due_date: '2025-03-01' });
  ok(z.totalInterest === 0 && z.rows.every(r => r.total === 5000 && r.interest === 0), 'interest-free: 10 × 5,000, rate ignored');
  near(z.effectiveRate, 0, 'interest-free: effective rate 0');

  // Month-end safe dates
  const d = L.buildPlan({ principal: 1000, method: 'free', annual_rate: 0, term_months: 5, first_due_date: '2025-01-31' });
  ok(d.rows.map(r => r.due_date).join() === '2025-01-31,2025-02-28,2025-03-31,2025-04-30,2025-05-31', 'due dates follow the month end (31 Jan, 28 Feb, 31 Mar, 30 Apr…)');
  const leap = L.buildPlan({ principal: 1000, method: 'free', annual_rate: 0, term_months: 2, first_due_date: '2024-01-31' });
  ok(leap.rows[1].due_date === '2024-02-29', 'leap year February');

  // Awkward: tiny loan, long term never produces a negative or zero tail
  const t = L.buildPlan({ principal: 500, method: 'reducing', annual_rate: 24, term_months: 60, first_due_date: '2025-03-01' });
  ok(t.rows.every(r => r.principal > 0 && r.total > 0), 'tiny long loan: every installment is positive');
  near(sum(t.rows, 'principal'), 500, 'tiny long loan: principal adds up');
  // Zero-rate reducing falls back to equal principal
  const zr = L.buildPlan({ principal: 1200, method: 'reducing', annual_rate: 0, term_months: 12, first_due_date: '2025-03-01' });
  ok(zr.totalInterest === 0 && zr.installment === 100, 'reducing at 0 % = equal principal');

  // Validation
  ok(L.validateTerms({ principal: 0, method: 'flat', annual_rate: 5, term_months: 6, first_due_date: '2025-03-01' }), 'zero amount invalid');
  ok(L.validateTerms({ principal: 100, method: 'flat', annual_rate: 5, term_months: 0, first_due_date: '2025-03-01' }), 'zero term invalid');
  ok(L.validateTerms({ principal: 100, method: 'flat', annual_rate: 5, term_months: 121, first_due_date: '2025-03-01' }), 'term over 120 invalid');
  ok(L.validateTerms({ principal: 100, method: 'flat', annual_rate: 101, term_months: 6, first_due_date: '2025-03-01' }), 'rate over 100 invalid');
  ok(L.validateTerms({ principal: 100, method: 'weekly', annual_rate: 5, term_months: 6, first_due_date: '2025-03-01' }), 'unknown method invalid');
  ok(L.validateTerms({ principal: 100, method: 'flat', annual_rate: 5, term_months: 6, first_due_date: '' }), 'missing first date invalid');

  // Term comparison: longer term = smaller installment, more interest
  const cmp = L.compareTerms({ principal: 100000, method: 'reducing', annual_rate: 12, first_due_date: '2025-03-01' }, [6, 12, 24]);
  ok(cmp.length === 3 && cmp[0].installment > cmp[1].installment && cmp[1].installment > cmp[2].installment, 'longer term → smaller installment');
  ok(cmp[0].totalInterest < cmp[1].totalInterest && cmp[1].totalInterest < cmp[2].totalInterest, 'longer term → more total interest');
  near(cmp[0].installment, 17255, '6 months: EMI = 1000/(1 − 1.01^−6) = 17,254.84 → 17,255');
  near(cmp[2].installment, 4707, '24 months: EMI = 4,707.35 → 4,707');

  // Allocation on the flat loan (11,000 = 1,000 interest + 10,000 principal): 15,000 → inst 1 in full + 4,000 of inst 2 (1,000 interest first)
  const a = L.allocatePayment(f.rows, 0, 15000);
  near(a.interest, 2000, 'allocate: 15,000 covers 2 × 1,000 interest'); near(a.principal, 13000, 'allocate: … and 13,000 principal');
  ok(a.lines.length === 2, 'allocate: touches installments 1 and 2');
  const b = L.allocatePayment(f.rows, 15000, 500);          // 15,000 already paid → inside installment 2's principal part
  near(b.interest, 0, 'allocate: next 500 is all principal (inst 2 interest already paid)'); near(b.principal, 500, 'allocate: principal 500');
  const c = L.allocatePayment(f.rows, 11000, 500);          // start of installment 2 → interest first
  near(c.interest, 500, 'allocate: a payment at the start of an installment pays interest first');
  near(L.allocatePayment(f.rows, 0, 11000).interest + L.allocatePayment(f.rows, 11000, 11000).interest, 2000, 'allocate: two exact installments → 2,000 interest');

  // Schedule state
  const st = L.scheduleState(f.rows, 11000 + 5000, '2025-05-15');   // 1 paid, 2 half, due dates 03-01, 04-01, 05-01 …
  ok(st.paidCount === 1 && st.status[1] === 'Overdue' && st.status[2] === 'Overdue' && st.status[3] === 'Due', 'state: #1 paid, #2 and #3 overdue, #4 not due');
  near(st.overdueAmount, 33000 - 16000, 'state: overdue = 3 × 11,000 − 16,000 paid'); ok(st.overdueCount === 2, 'state: 2 installments overdue');
  near(st.nextDueAmount, 6000, 'state: next due is the 6,000 left on installment 2');
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The books
// ---------------------------------------------------------------------------------------------------------------
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-loan-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);
  A.saveAppSettings({ loan_default_rate: 12, loan_default_method: 'reducing', loan_max_multiple: 0, loan_late_fee: 0 });

  let nid = 1990123400000;
  const mk = (name, opening) => A.addMember({ name, nid: String(++nid), opening_balance: opening, join_date: '2025-01-01', monthly_due: 500 });
  const m1 = mk('Borrower One', 10000), m2 = mk('Borrower Two', 10000), m3 = mk('Saver Three', 20000);
  const cashBook = () => { const o = A.getOverviewMetrics('2030-01'); return { fund: o.fund_balance_at_cost, cash: o.cash_in_hand }; };
  near(cashBook().cash, 40000, 'start: cash in hand = 40,000 of opening balances');

  // ---- validation ----
  const base = { member_id: m1, principal: 12000, method: 'reducing', annual_rate: 12, term_months: 12, disbursed_date: '2025-02-01', payment_method: 'Cash' };
  throws(() => A.addLoan({ ...base, member_id: 999 }), /choose the member/, 'unknown member rejected');
  throws(() => A.addLoan({ ...base, principal: 0 }), /greater than zero/, 'zero amount rejected');
  throws(() => A.addLoan({ ...base, term_months: 0 }), /term/, 'zero term rejected');
  throws(() => A.addLoan({ ...base, term_months: 121 }), /term/, 'term over 120 rejected');
  throws(() => A.addLoan({ ...base, annual_rate: 150 }), /rate/, 'rate over 100 rejected');
  throws(() => A.addLoan({ ...base, disbursed_date: '2099-01-01' }), /future/, 'future loan date rejected');
  throws(() => A.addLoan({ ...base, disbursed_date: '2024-06-01' }), /before the member joined/, 'loan before joining rejected');
  throws(() => A.addLoan({ ...base, payment_method: '' }), /how the money was paid/, 'payment medium required');
  throws(() => A.addLoan({ ...base, first_due_date: '2025-01-15' }), /after the loan date/, 'first installment before loan date rejected');
  throws(() => A.addLoan({ ...base, first_due_date: '2025-08-01' }), /three months/, 'first installment too far away rejected');
  throws(() => A.addLoan({ ...base, principal: 1000000 }), /cannot lend/, 'cannot lend more cash than the fund holds');
  ok(A.getLoans().length === 0, 'rejected loans left no trace');
  const pv = A.previewLoan(base);
  ok(pv.valid && pv.plan.rows.length === 12 && pv.options.some(o => o.term === 24), 'preview returns schedule and the other terms');
  ok(!A.previewLoan({ ...base, term_months: 0 }).valid, 'preview of invalid input is a message, not a crash');
  ok(A.previewLoan({ ...base, principal: 1000000 }).warnings.some(w => w.level === 'error'), 'preview warns when cash is short');

  // ---- loan 1: 12,000 at 12 % for 12 months → EMI 1,066.19 → 1,066 ----
  const l1 = A.addLoan({ ...base, purpose: 'Shop stock' });
  let d1 = A.getLoan(l1);
  ok(d1.loan.loan_no === 'PL-0001' && d1.loan.installment === 1066, `loan 1 is PL-0001 with installment ${d1.loan.installment}`);
  near(d1.schedule[0].interest, 120, 'inst 1 interest = 12,000 × 1 %'); near(d1.schedule[0].principal, 946, 'inst 1 principal = 1,066 − 120');
  near(sum(d1.schedule, 'principal'), 12000, 'schedule principal = loan');
  ok(d1.loan.derived_status === 'Overdue', 'a 2025 loan with nothing paid is overdue today');
  let pos = cashBook();
  near(pos.fund, 40000, 'LENDING does not change net worth (fund balance stays 40,000)');
  near(pos.cash, 28000, 'LENDING moves 12,000 out of cash (cash 28,000)');
  near(A.getLoanSummary().outstanding, 12000, 'summary: outstanding 12,000');
  // on 2025-01-15 the fund still had 40,000, but 12,000 has been lent since: a back-dated 30,000 loan would overdraw today's cash
  throws(() => A.addLoan({ member_id: m2, principal: 30000, method: 'free', term_months: 10, disbursed_date: '2025-01-15', payment_method: 'Cash' }), /can lend only TK 28000/, 'a back-dated loan cannot overdraw cash lent or spent since');
  ok(A.previewLoan({ member_id: m2, principal: 30000, method: 'free', term_months: 10, disbursed_date: '2025-01-15' }).warnings.some(w => w.level === 'error'), 'preview shows the same cash warning');

  // ---- repayments ----
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-03-01', amount: 1066, payment_method: '' }), /how the money was received/, 'repayment needs a medium');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-01-15', amount: 1066, payment_method: 'Cash' }), /before the loan was given/, 'repayment before the loan rejected');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2099-01-01', amount: 1066, payment_method: 'Cash' }), /future/, 'future repayment rejected');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-03-01', amount: 0, payment_method: 'Cash' }), /greater than zero/, 'zero repayment rejected');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-03-01', amount: 999999, payment_method: 'Cash' }), /more than the loan still needs/, 'overpayment rejected');
  const q1 = A.previewLoanRepayment(l1, '2025-03-01');
  near(q1.amount, 1066, 'preview defaults to the next installment'); near(q1.interest, 120, 'preview: interest 120'); near(q1.principal, 946, 'preview: principal 946');
  A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-03-01', amount: 1066, payment_method: 'Cash', trx_id: 'R1' });
  pos = cashBook();
  near(pos.fund, 40120, 'REPAYMENT: only the interest (120) raises net worth');
  near(pos.cash, 29066, 'REPAYMENT: cash = 40,000 − 12,000 + 1,066');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-02-20', amount: 100, payment_method: 'Cash' }), /before the previous repayment/, 'repayments must be in date order');

  A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-04-01', amount: 3000, payment_method: 'bKash' });   // covers #2, #3 and part of #4
  d1 = A.getLoan(l1);
  const rep2 = d1.repayments[0];
  near(rep2.principal_paid + rep2.interest_paid, 3000, '3,000 payment splits exactly into principal + interest');
  near(d1.loan.paid_schedule, 4066, 'paid towards schedule 4,066');
  ok(d1.schedule[0].status === 'Paid' && d1.schedule[1].status === 'Paid' && d1.schedule[2].status === 'Paid' && d1.schedule[3].status === 'Overdue', 'installments 1–3 paid, 4 partly paid');
  near(d1.loan.outstanding_principal, 12000 - d1.loan.paid_principal, 'outstanding = loan − principal repaid');
  throws(() => A.deleteLoan(l1), /already has repayments/, 'cannot delete a loan with repayments');
  throws(() => A.deleteLoanRepayment(d1.repayments[1].id), /most recent/, 'only the latest repayment can be removed');

  // ---- early closure at 2025-06-15: installments due by then = #1–#4 (03-01, 04-01, 05-01, 06-01) ----
  const planOf = A.getLoan(l1).schedule;
  const interestDue = planOf.filter(s => s.due_date <= '2025-06-15').reduce((a, s) => a + s.interest, 0);
  const cq = A.previewLoanRepayment(l1, '2025-06-15', undefined, 'Closure');
  const paidInterest = d1.loan.paid_interest;
  near(cq.calcInterest, Math.max(0, interestDue - paidInterest), 'closure interest = interest due to date − interest already paid');
  near(cq.principal, d1.loan.outstanding_principal, 'closure principal = everything still outstanding');
  near(cq.waivedInterest, d1.loan.remaining_interest - cq.interest, 'future interest is waived');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-06-15', kind: 'Closure', interest: cq.calcInterest + 50, payment_method: 'Cash' }), /reason/, 'changing the closure interest needs a note');
  A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-06-15', kind: 'Closure', payment_method: 'Cash', note: 'Settled early' });
  d1 = A.getLoan(l1);
  ok(d1.loan.status === 'Closed' && d1.loan.closed_date === '2025-06-15', 'loan 1 closed on 2025-06-15');
  near(d1.loan.paid_principal, 12000, 'all 12,000 principal came back');
  near(A.getLoanSummary().outstanding, 0, 'nothing outstanding after closure');
  throws(() => A.recordLoanRepayment({ loan_id: l1, paid_date: '2025-07-01', amount: 100, payment_method: 'Cash' }), /fully repaid/, 'closed loan takes no more payments');
  const loan1Interest = d1.loan.paid_interest;
  pos = cashBook();
  near(pos.fund, 40000 + loan1Interest, 'after closure net worth = 40,000 + interest earned');
  near(pos.cash, 40000 + loan1Interest, 'after closure all lent money is back as cash (+ interest)');
  ok(loan1Interest > 120 && loan1Interest < 700, `interest earned on loan 1 = ${loan1Interest}`);

  // ---- loan 2: flat, written off ----
  const l2 = A.addLoan({ member_id: m2, principal: 5000, method: 'flat', annual_rate: 12, term_months: 5, disbursed_date: '2025-07-01', payment_method: 'Bank transfer' });
  near(A.getLoan(l2).loan.total_interest, 250, 'loan 2 flat interest = 5,000 × 12 % × 5/12 = 250');
  near(cashBook().cash, 40000 + loan1Interest - 5000, 'loan 2 lent 5,000 from cash');
  throws(() => A.writeOffLoan({ loan_id: l2, date: '2025-09-01', reason: '' }), /reason/, 'write-off needs a reason');
  A.recordLoanRepayment({ loan_id: l2, paid_date: '2025-08-01', amount: 1050, payment_method: 'Cash' });   // 1,000 principal + 50 interest
  const beforeWO = cashBook();
  A.writeOffLoan({ loan_id: l2, date: '2025-09-01', reason: 'Borrower left the country' });
  const afterWO = cashBook();
  near(beforeWO.fund - afterWO.fund, 4000, 'WRITE-OFF: net worth falls by the 4,000 still owed');
  near(beforeWO.cash - afterWO.cash, 0, 'WRITE-OFF: cash does not change');
  ok(A.getLoan(l2).loan.status === 'Written off' && A.getLoan(l2).loan.written_off_amount === 4000, 'loan 2 written off for 4,000');
  throws(() => A.recordLoanRepayment({ loan_id: l2, paid_date: '2025-09-02', amount: 100, payment_method: 'Cash' }), /written off/, 'written-off loan takes no payments');
  throws(() => A.deleteLoanRepayment(A.getLoan(l2).repayments[0].id), /written off/, 'cannot remove repayments of a written-off loan');


  // ---- loan 3 (flat, 12 % × 3 months on 3,000 = 90 interest, 1,030 a month) ----
  const l3 = A.addLoan({ member_id: m1, principal: 3000, method: 'flat', annual_rate: 12, term_months: 3, disbursed_date: '2025-09-10', payment_method: 'Cash', guarantor: 'Saver Three' });
  near(A.getLoan(l3).loan.installment, 1030, 'loan 3 installment 1,030');
  throws(() => A.settleMember({ member_id: m1, settlement_date: '2025-10-01', payment_method: 'Cash' }), /still owes personal loan PL-0003/, 'a member with an unpaid loan cannot be settled');
  throws(() => A.deleteMember(m1), /personal loan records/, 'a member with loans cannot be deleted');

  // ---- settlement shares: Saver Three owns 20,000 of 40,000 → 50 % of every benefit event ----
  // events up to 2025-10-01: loan-1 interest, loan-2 interest (50), loan-2 write-off (−4,000)
  const l2i = A.getLoan(l2).loan.paid_interest;
  near(l2i, 50, 'loan 2 interest received 50');
  const pv3 = A.previewMemberSettlement(m3, '2025-10-01');
  near(pv3.principal, 20000, 'Saver Three principal 20,000');
  near(pv3.profitShare, Math.round(0.5 * (loan1Interest + l2i - 4000) * 100) / 100, 'Saver Three shares 50 % of loan interest and of the written-off loss');
  ok(pv3.lines.some(x => x.label === 'PL-0002' && x.amount === -4000), 'the write-off appears as a −4,000 event in the settlement lines');
  const beforeSettle = cashBook();
  A.settleMember({ member_id: m3, settlement_date: '2025-10-01', payment_method: 'Cash' });
  near(beforeSettle.fund - cashBook().fund, pv3.suggestedPayout, 'settlement pays out principal + share from the fund');

  // after a settlement, back-dated interest/write-offs are refused (they would change what was already paid)
  throws(() => A.recordLoanRepayment({ loan_id: l3, paid_date: '2025-09-25', amount: 1030, payment_method: 'Cash' }), /already settled/, 'interest dated before a settlement is refused');
  throws(() => A.writeOffLoan({ loan_id: l3, date: '2025-09-20', reason: 'test' }), /already settled/, 'write-off dated before a settlement is refused');
  A.recordLoanRepayment({ loan_id: l3, paid_date: '2025-10-20', amount: 1030, payment_method: 'Cash' });
  A.recordLoanRepayment({ loan_id: l3, paid_date: '2025-11-20', amount: 600, payment_method: 'Cash', penalty: 50, note: 'late' });
  const d3 = A.getLoan(l3);
  near(d3.loan.paid_penalty, 50, 'penalty 50 recorded separately');
  near(d3.loan.paid_principal + d3.loan.paid_interest, 1630, 'penalty is not counted towards the schedule');
  near(d3.loan.paid_schedule, 1630, 'schedule progress 1,630 of 3,090');
  // undo the last repayment (latest only) and re-check
  A.deleteLoanRepayment(d3.latestRepaymentId);
  near(A.getLoan(l3).loan.paid_schedule, 1030, 'removing the latest repayment reverses it');
  A.recordLoanRepayment({ loan_id: l3, paid_date: '2025-11-20', amount: 2060, payment_method: 'Cash' });   // pays the rest exactly
  const e3 = A.getLoan(l3);
  ok(e3.loan.status === 'Closed', 'paying the schedule in full closes the loan automatically');
  near(e3.loan.paid_principal, 3000, 'loan 3 principal repaid exactly 3,000 (no stray cent)');
  near(e3.loan.paid_interest, 90, 'loan 3 interest exactly 90');
  const lastRep = e3.repayments[0];
  A.deleteLoanRepayment(lastRep.id);
  ok(A.getLoan(l3).loan.status === 'Active', 'removing the closing repayment re-opens the loan');
  A.recordLoanRepayment({ loan_id: l3, paid_date: '2025-11-20', amount: 2060, payment_method: 'Cash' });

  // ---- policy limit ----
  A.saveAppSettings({ loan_max_multiple: 1 });
  throws(() => A.addLoan({ member_id: m2, principal: 11000, method: 'free', term_months: 11, disbursed_date: '2025-12-01', payment_method: 'Cash' }), /fund limit/, 'a loan above the limit needs an approval reason');
  const lim = A.addLoan({ member_id: m2, principal: 11000, method: 'free', term_months: 11, disbursed_date: '2025-12-01', payment_method: 'Cash', limit_note: 'Committee approved 2025-11-30' });
  ok(/Over-limit approval/.test(A.getLoan(lim).loan.notes), 'the approval reason is stored on the loan');
  const cashWith = cashBook().cash;
  A.deleteLoan(lim);
  near(cashBook().cash - cashWith, 11000, 'deleting an unpaid loan puts the money back');
  A.saveAppSettings({ loan_max_multiple: 0 });
  throws(() => A.saveAppSettings({ loan_default_rate: 500 }), /between 0 and 100/, 'default rate is validated');

  // ---- lists, filters and the summary ----
  ok(A.getLoans('newest', 'Closed').length === 2, 'filter Closed → loans 1 and 3');
  ok(A.getLoans('newest', 'Written off').length === 1, 'filter Written off → loan 2');
  ok(A.getLoans('newest', 'Open').length === 0, 'no loans are open');
  ok(A.getLoans('amount_high')[0].loan_no === 'PL-0001', 'sort by amount: the 12,000 loan first');
  ok(A.getLoans('newest', 'All', undefined, undefined, 'borrower two').length === 1, 'search by member name');
  ok(A.getLoans('newest', 'All', undefined, undefined, 'pl-0003').length === 1, 'search by loan number');
  ok(A.getLoans('newest', 'All', undefined, undefined, 'shop stock').length === 1, 'search by purpose');
  ok(A.getLoans('newest', 'All', undefined, undefined, '', m1).length === 2, 'member filter: Borrower One has two loans');
  ok(A.getLoans('newest', 'All', '2025-09-01', '2025-12-31').length === 1, 'date filter on the loan date');
  const l5 = A.addLoan({ member_id: m2, principal: 2400, method: 'reducing', annual_rate: 18, term_months: 6, disbursed_date: '2025-10-05', first_due_date: '2025-11-05', payment_method: 'Bank transfer' });
  ok(A.getLoans('newest', 'Overdue').length === 1 && A.getLoans('newest', 'Overdue')[0].id === l5, 'unpaid past installments make a loan Overdue');
  const ov = A.getLoan(l5).loan;
  ok(ov.overdue_count === 6 && ov.days_overdue > 0, `loan 5 is overdue on all ${ov.overdue_count} installments (${ov.days_overdue} days)`);
  near(ov.overdue_amount, ov.total_payable, 'overdue amount = everything scheduled (all dates passed)');
  const sm = A.getLoanSummary();
  near(sm.totalLent, 12000 + 5000 + 3000 + 2400, 'summary: total lent');
  near(sm.outstanding, 2400, 'summary: outstanding = loan 5 only');
  near(sm.writtenOffAmount, 4000, 'summary: written off 4,000');
  ok(sm.closed === 2 && sm.writtenOff === 1 && sm.overdueLoans === 1 && sm.running === 0, 'summary: counts by status');
  near(sm.interestEarned, loan1Interest + 50 + 90, 'summary: interest earned');
  near(sm.penaltyEarned, 0, 'summary: penalty earned (the 50 penalty repayment was removed)');
  ok(A.getDynamicNotifications().some(n => n.targetTab === 'loans'), 'an overdue-loans notification is raised');

  // ---- ledger and health ----
  const ledger = A.getTransactions(undefined, undefined, 'All');
  const cr = sum(ledger, 'credit'), dr = sum(ledger, 'debit');
  near(40000 + cr - dr, cashBook().cash, 'cash book: opening + ledger credits − debits = cash in hand');
  ok(ledger.some(r => r.type === 'loan') && ledger.some(r => r.type === 'loan_repayment'), 'ledger lists loans and repayments');
  ok(A.getTransactions(undefined, undefined, 'loan').every(r => r.type === 'loan' || r.type === 'loan_repayment'), 'ledger can be filtered to loans');
  const h = A.checkAccountingHealth();
  const bad = h.checks.filter(c => c.status === 'fail');
  ok(bad.length === 0, `health check: no failures ${bad.map(c => c.id + ':' + c.details.join('; ')).join(' | ')}`);
  ok(h.checks.find(c => c.id === 'reconcile').status === 'pass', 'health check: cash book reconciles with loans included');
  ok(h.checks.find(c => c.id === 'loan_overdue').status === 'warn', 'health check: warns about the overdue loan');
  const st = A.getDatabaseStats();
  ok(st.loans === 4 && st.schemaVersion === 5, `stats: ${st.loans} loans, schema v${st.schemaVersion}`);

  // ---- backup round trip keeps loans ----
  const bytes = store.exportBytes();
  A.resetDatabase(true);
  ok(A.getLoans().length === 0 && A.getDatabaseStats().loanRepayments === 0, 'reset clears loans and repayments');
  store.replaceWith(bytes);
  ok(A.getLoans().length === 4 && A.getLoan(l1).schedule.length === 12, 'restoring a backup brings the loans back with their schedules');

  // ---- a database from the previous app version (schema 4, no loan tables) upgrades cleanly ----
  const initSqlJs = require(path.join(proj, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs({ wasmBinary: wasm });
  const old = new SQL.Database(store.exportBytes());
  old.run('DROP TABLE loan_repayments'); old.run('DROP TABLE loan_schedule'); old.run('DROP TABLE personal_loans');
  old.run("DELETE FROM app_settings WHERE key LIKE 'loan_%'"); old.run('PRAGMA user_version = 4');
  const oldBytes = Buffer.from(old.export()); old.close();
  store.replaceWith(oldBytes);
  ok(A.getLoans().length === 0 && A.getDatabaseStats().schemaVersion === 5, 'a schema-4 database gains the loan tables and moves to schema 5');
  ok(A.getAppSettings().loan_default_rate === 12 && A.getAppSettings().loan_default_method === 'reducing', 'loan policy defaults appear after the upgrade');
  const lx = A.addLoan({ member_id: m1, principal: 1000, method: 'free', term_months: 4, disbursed_date: '2025-01-05', payment_method: 'Cash' });
  ok(A.getLoan(lx).schedule.length === 4, 'loans work on the upgraded database');
  throws(() => store.replaceWith(Buffer.from(new SQL.Database().export())), /not a Bondhu Fund backup/, 'an unrelated database file is still refused');

  // ---- who may do what (needs the owner's admin password in the environment; it is never stored in the repo) ----
  const adminPw = process.env.BONDHU_ADMIN_PASSWORD;
  if (!adminPw) console.log('SKIP  role checks (set BONDHU_ADMIN_PASSWORD to run them)');
  else {
    A.login('admin', adminPw);
    const aud = A.addUser({ username: 'loan_aud', full_name: 'Loan Auditor', role: 'Auditor', email: '' });
    const tre = A.addUser({ username: 'loan_tre', full_name: 'Loan Treasurer', role: 'Treasurer', email: '' });
    A.setUserPassword(aud, 'Audit0rpass'); A.setUserPassword(tre, 'Tr3asurerpass'); A.logout();
    const loanId = A.getLoans()[0].id;
    A.login('loan_aud', 'Audit0rpass');
    for (const m of ['getLoans', 'getLoan', 'getLoanSummary', 'previewLoan', 'previewLoanRepayment']) store.authorize(m);
    ok(true, 'an Auditor can read loans and use the calculator');
    for (const m of ['addLoan', 'recordLoanRepayment', 'deleteLoan', 'deleteLoanRepayment', 'updateLoan'])
      throws(() => store.authorize(m, [loanId]), /read-only/, `an Auditor cannot ${m}`);
    A.logout();
    A.login('loan_tre', 'Tr3asurerpass');
    for (const m of ['addLoan', 'recordLoanRepayment', 'deleteLoan', 'deleteLoanRepayment', 'updateLoan', 'getLoans']) store.authorize(m, [loanId]);
    ok(true, 'a Treasurer can give loans and record repayments');
    for (const m of ['writeOffLoan', 'cancelLoanWriteOff', 'saveAppSettings'])
      throws(() => store.authorize(m, [loanId]), /Only an Admin/, `a Treasurer cannot ${m}`);
    A.logout();
    A.login('admin', adminPw);
    store.authorize('writeOffLoan', [{ loan_id: loanId }]); store.authorize('cancelLoanWriteOff', [loanId]); store.authorize('saveAppSettings', [{}]);
    ok(true, 'an Admin can write off loans and change the loan policy');
    A.logout();
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL LOAN TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
