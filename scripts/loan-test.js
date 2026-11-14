/**
 * Personal-loan tests: schedule maths (worked by hand in the comments), repayment allocation, and the books
 * (cash in hand, fund balance, member settlement shares, health check).   npm run test:loans
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, process.env.BF_DIST || 'dist-electron', 'database.js'));
const L = require(path.join(proj, process.env.BF_DIST || 'dist-electron', 'loans.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const near = (a, b, m, tol = 0.005) => ok(Math.abs(a - b) <= tol, `${m}: ${a} ≈ ${b}`);
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };
// every loan needs a guarantor: most tests use an outside one (members who guarantee a running loan cannot be settled)
const OUTSIDER = { guarantor_type: 'outsider', guarantor_name: 'Rahim Uddin', guarantor_address: 'House 12, Road 5, Mirpur 10, Dhaka', guarantor_nid: '1234567890' };
const addLoanG = d => A.addLoan({ ...OUTSIDER, ...d });
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
  // whole-taka rounding must never leave empty trailing installments (audit): 100 over 36 months = 3 a month, repaid in 34
  const sm = L.buildPlan({ principal: 100, method: 'free', annual_rate: 0, term_months: 36, first_due_date: '2025-03-01' });
  ok(sm.rows.length === 34 && sm.rows.every(r => r.total > 0) && Math.abs(sum(sm.rows, 'principal') - 100) < 0.005, `100 over 36 months: ${sm.rows.length} real installments, no empty rows, principal adds up`);
  const sf = L.buildPlan({ principal: 250, method: 'flat', annual_rate: 12, term_months: 120, first_due_date: '2025-03-01' });
  ok(sf.rows.every(r => r.principal > 0 && r.total > 0) && Math.abs(sum(sf.rows, 'principal') - 250) < 0.005, `250 flat over 120 months: ${sf.rows.length} installments, every row positive`);
  // Zero-rate reducing falls back to equal principal
  const zr = L.buildPlan({ principal: 1200, method: 'reducing', annual_rate: 0, term_months: 12, first_due_date: '2025-03-01' });
  ok(zr.totalInterest === 0 && zr.installment === 100, 'reducing at 0 % = equal principal');

  // Validation
  ok(L.validateTerms({ principal: 0, method: 'flat', annual_rate: 5, term_months: 6, first_due_date: '2025-03-01' }), 'zero amount invalid');
  ok(L.validateTerms({ principal: 0.01, method: 'free', annual_rate: 0, term_months: 60, first_due_date: '2025-03-01' }), 'a one-paisa loan over 60 months is refused (zero installments)');
  ok(L.validateTerms({ principal: 30, method: 'free', annual_rate: 0, term_months: 60, first_due_date: '2025-03-01' }), 'an amount smaller than the number of months is refused');
  ok(!L.validateTerms({ principal: 60, method: 'free', annual_rate: 0, term_months: 60, first_due_date: '2025-03-01' }), 'TK 1 a month is the smallest allowed');
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
  A.saveAppSettings({ loan_default_rate: 12, loan_default_method: 'reducing', loan_max_multiple: 0, loan_late_fee: 0, loan_consent_required: false });   // the older tests give loans directly

  let nid = 1990123400000;
  const mk = (name, opening) => A.addMember({ name, nid: String(++nid), opening_balance: opening, join_date: '2025-01-01', monthly_due: 500 });
  const m1 = mk('Borrower One', 10000), m2 = mk('Borrower Two', 10000), m3 = mk('Saver Three', 20000);
  const cashBook = () => { const o = A.getOverviewMetrics('2030-01'); return { fund: o.fund_balance_at_cost, cash: o.cash_in_hand }; };
  near(cashBook().cash, 40000, 'start: cash in hand = 40,000 of opening balances');

  // ---- validation ----
  const base = { member_id: m1, principal: 12000, method: 'reducing', annual_rate: 12, term_months: 12, disbursed_date: '2025-02-01', payment_method: 'Cash' };
  throws(() => addLoanG({ ...base, member_id: 999 }), /choose the member/, 'unknown member rejected');
  throws(() => addLoanG({ ...base, principal: 0 }), /greater than zero/, 'zero amount rejected');
  throws(() => addLoanG({ ...base, term_months: 0 }), /term/, 'zero term rejected');
  throws(() => addLoanG({ ...base, term_months: 121 }), /term/, 'term over 120 rejected');
  throws(() => addLoanG({ ...base, annual_rate: 150 }), /rate/, 'rate over 100 rejected');
  throws(() => addLoanG({ ...base, disbursed_date: '2099-01-01' }), /future/, 'future loan date rejected');
  throws(() => addLoanG({ ...base, disbursed_date: '2024-06-01' }), /before the member joined/, 'loan before joining rejected');
  throws(() => addLoanG({ ...base, payment_method: '' }), /how the money will be paid/, 'payment medium required');
  throws(() => addLoanG({ ...base, first_due_date: '2025-01-15' }), /after the loan date/, 'first installment before loan date rejected');
  throws(() => addLoanG({ ...base, first_due_date: '2025-08-01' }), /three months/, 'first installment too far away rejected');
  throws(() => addLoanG({ ...base, principal: 1000000 }), /cannot lend/, 'cannot lend more cash than the fund holds');
  ok(A.getLoans().length === 0, 'rejected loans left no trace');
  const pv = A.previewLoan(base);
  ok(pv.valid && pv.plan.rows.length === 12 && pv.options.some(o => o.term === 24), 'preview returns schedule and the other terms');
  ok(!A.previewLoan({ ...base, term_months: 0 }).valid, 'preview of invalid input is a message, not a crash');
  ok(A.previewLoan({ ...base, principal: 1000000 }).warnings.some(w => w.level === 'error'), 'preview warns when cash is short');

  // ---- loan 1: 12,000 at 12 % for 12 months → EMI 1,066.19 → 1,066 ----
  const l1 = addLoanG({ ...base, purpose: 'Shop stock' });
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
  throws(() => addLoanG({ member_id: m2, principal: 30000, method: 'free', term_months: 10, disbursed_date: '2025-01-15', payment_method: 'Cash' }), /can lend only TK 28000/, 'a back-dated loan cannot overdraw cash lent or spent since');
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
  const l2 = addLoanG({ member_id: m2, principal: 5000, method: 'flat', annual_rate: 12, term_months: 5, disbursed_date: '2025-07-01', payment_method: 'Bank transfer' });
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
  const l3 = addLoanG({ member_id: m1, principal: 3000, method: 'flat', annual_rate: 12, term_months: 3, disbursed_date: '2025-09-10', payment_method: 'Cash', guarantor: 'Saver Three' });
  near(A.getLoan(l3).loan.installment, 1030, 'loan 3 installment 1,030');
  throws(() => A.settleMember({ member_id: m1, settlement_date: '2025-10-01', payment_method: 'Cash' }), /still owes personal loan PL-0003/, 'a member with an unpaid loan cannot be settled');
  throws(() => A.deleteMember(m1), /personal loan records/, 'a member with loans cannot be deleted');

  // ---- settlement shares: Saver Three owns 20,000 of 40,000 → 50 % of every benefit event ----
  // events up to 2025-10-01: loan-1 interest, loan-2 interest (50), loan-2 write-off (−4,000)
  const l2i = A.getLoan(l2).loan.paid_interest;
  near(l2i, 50, 'loan 2 interest received 50');
  const pv3 = A.previewMemberSettlement(m3, '2025-10-01');
  near(pv3.principal, 20000, 'Saver Three principal 20,000');
  // loan 2 (Borrower Two, savings 10,000) was written off for 4,000: the borrower's own savings absorb it, so Saver Three bears none of it
  near(pv3.profitShare, Math.round(0.5 * (loan1Interest + l2i) * 100) / 100, 'Saver Three shares 50 % of the loan interest, and none of the loss of a defaulter whose own savings cover it');
  ok(!pv3.lines.some(x => x.label === 'PL-0002' && x.amount < 0), 'the covered write-off does not appear in the settlement lines of the other member');
  const pb2 = A.previewMemberSettlement(m2, '2025-10-01');
  ok(pb2.lines.some(x => x.label === 'PL-0002' && x.amount === -4000 && Math.abs(x.share + 4000) < 0.01), 'the defaulter bears the whole 4,000 write-off in their own settlement');
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
  throws(() => addLoanG({ member_id: m2, principal: 11000, method: 'free', term_months: 11, disbursed_date: '2025-12-01', payment_method: 'Cash' }), /fund limit/, 'a loan above the limit needs an approval reason');
  const lim = addLoanG({ member_id: m2, principal: 11000, method: 'free', term_months: 11, disbursed_date: '2025-12-01', payment_method: 'Cash', limit_note: 'Committee approved 2025-11-30' });
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
  const l5 = addLoanG({ member_id: m2, principal: 2400, method: 'reducing', annual_rate: 18, term_months: 6, disbursed_date: '2025-10-05', first_due_date: '2025-11-05', payment_method: 'Bank transfer' });
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
  ok(st.loans === 4 && st.schemaVersion === 9, `stats: ${st.loans} loans, schema v${st.schemaVersion}`);

  // ---- backup round trip keeps loans ----
  const bytes = store.exportBytes();
  A.resetDatabase(true);
  ok(A.getLoans().length === 0 && A.getDatabaseStats().loanRepayments === 0, 'reset clears loans and repayments');
  store.replaceWith(bytes);
  ok(A.getLoans().length === 4 && A.getLoan(l1).schedule.length === 12, 'restoring a backup brings the loans back with their schedules');

  // ---- guarantor rules (a guarantor is mandatory) ----
  const nidOfM1 = A.getMembers('', 'All', 1, 20).members.find(x => x.id === m1).nid;
  const gb = { member_id: m2, principal: 1000, method: 'free', term_months: 4, disbursed_date: '2025-12-02', payment_method: 'Cash' };
  throws(() => A.addLoan({ ...gb }), /guarantor is required/, 'a loan without a guarantor is refused');
  throws(() => A.addLoan({ ...gb, guarantor_type: 'member' }), /Choose the member who is the guarantor/, 'member guarantor must be chosen');
  throws(() => A.addLoan({ ...gb, guarantor_type: 'member', guarantor_member_id: m2 }), /own guarantor/, 'a borrower cannot guarantee their own loan');
  throws(() => A.addLoan({ ...gb, guarantor_type: 'member', guarantor_member_id: m3 }), /not an active member/, 'a settled (inactive) member cannot be a guarantor');
  throws(() => A.addLoan({ ...gb, guarantor_type: 'member', guarantor_member_id: 9999 }), /not found/, 'unknown guarantor member refused');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_name: 'Al' }), /full name/, 'outsider needs a full name');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_name: '12345 678' }), /full name/, 'outsider name needs letters');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_address: 'Dhaka' }), /full address/, 'outsider needs a full address');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_nid: '' }), /NID/, 'outsider NID is required');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_nid: '12345' }), /10, 13 or 17/, 'outsider NID length is checked');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_nid: '12345abcde' }), /digits only/, 'outsider NID must be digits');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_nid: nidOfM1 }), /belongs to member/, 'an outsider NID that belongs to a member is refused (use the member option)');
  throws(() => A.addLoan({ ...gb, ...OUTSIDER, guarantor_phone: 'abc' }), /phone/, 'a bad guarantor phone is refused');
  throws(() => A.addLoan({ ...gb, guarantor_type: 'friend' }), /guarantor is required/, 'unknown guarantor type refused');
  ok(!A.previewGuarantor({ ...gb, ...OUTSIDER, guarantor_address: 'x' }).ok && A.previewGuarantor({ ...gb, ...OUTSIDER }).ok, 'previewGuarantor applies the same rules');
  ok(!A.previewGuarantor({}).ok, 'previewGuarantor: nothing chosen is not ok');
  const gl = A.addLoan({ ...gb, guarantor_type: 'member', guarantor_member_id: m1, guarantor_relation: 'Cousin', reference: 'BANK-777' });
  const gd = A.getLoan(gl);
  ok(gd.guarantor.type === 'member' && gd.guarantor.code === 'BF-0001' && gd.guarantor.nid === nidOfM1 && gd.guarantor.relation === 'Cousin', 'member guarantor is stored and resolved (code, NID, relation)');
  ok(A.getLoans('newest', 'All', undefined, undefined, 'BF-0001').some(x => x.id === gl), 'a loan can be found by its guarantor member code');
  ok(gd.loan.reference === 'BANK-777', 'a reference typed by the user is kept');
  throws(() => A.settleMember({ member_id: m1, settlement_date: '2026-01-01', payment_method: 'Cash' }), /guarantor of running loan/, 'a member guaranteeing a running loan cannot be settled');
  throws(() => A.deleteMember(m1), /loan records/, 'a guarantor member cannot be deleted');
  const ol = addLoanG({ member_id: m2, principal: 1000, method: 'free', term_months: 4, disbursed_date: '2025-12-02', payment_method: 'Cash', guarantor_phone: '017 1100-0000', guarantor_relation: 'Neighbour' });
  const od = A.getLoan(ol);
  ok(od.guarantor.type === 'outsider' && od.guarantor.nid === '1234567890' && od.guarantor.phone === '01711000000' && od.guarantor.address.includes('Mirpur'), 'outsider guarantor is stored (name, address, NID, phone)');
  ok(od.loan.guarantor === 'Rahim Uddin', 'the guarantor name is kept on the loan for search and lists');
  // auto reference numbers
  ok(/^DISB-PL-\d{4}$/.test(od.loan.reference) && od.loan.reference === `DISB-${od.loan.loan_no}`, `disbursement reference is generated automatically (${od.loan.reference})`);
  ok(A.previewLoan({ member_id: m2, principal: 1000, method: 'free', term_months: 4, disbursed_date: '2025-12-02' }).autoReference === `DISB-${A.previewLoan({ member_id: m2, principal: 1000, method: 'free', term_months: 4 }).nextLoanNo}`, 'the form can show the next automatic reference');
  A.recordLoanRepayment({ loan_id: ol, paid_date: '2025-12-20', amount: 250, payment_method: 'Cash' });
  A.recordLoanRepayment({ loan_id: ol, paid_date: '2025-12-21', amount: 250, payment_method: 'Cash', trx_id: 'TX-OWN-1' });
  const reps = A.getLoan(ol).repayments;
  ok(/^RCPT-PL-\d{4}-\d+$/.test(reps[1].trx_id), `repayment receipt number is generated automatically (${reps[1].trx_id})`);
  ok(reps[0].trx_id === 'TX-OWN-1', 'a transaction number typed by the user is kept');
  ok(new Set(reps.map(r => r.trx_id)).size === 2, 'receipt numbers are unique');
  ok(A.getTransactions(undefined, undefined, 'loan').some(r => r.reference === reps[1].trx_id), 'the automatic receipt number shows in the ledger');
  ok(A.checkAccountingHealth().checks.find(c => c.id === 'loan_guarantor').status === 'pass', 'health check: every loan has complete guarantor details');
  A.deleteLoanRepayment(reps[0].id); A.deleteLoanRepayment(reps[1].id); A.deleteLoan(ol); A.deleteLoan(gl);

  // ---- a schema-5 database (loans with only a free-text guarantor) upgrades and keeps its loans ----
  {
    const initSql = require(path.join(proj, 'node_modules', 'sql.js'));
    const S = await initSql({ wasmBinary: wasm });
    const v5 = new S.Database(store.exportBytes());
    v5.run('DROP TABLE loan_repayments'); v5.run('DROP TABLE loan_schedule'); v5.run('DROP TABLE personal_loans');
    v5.run(`CREATE TABLE personal_loans (id INTEGER PRIMARY KEY AUTOINCREMENT, loan_no TEXT NOT NULL UNIQUE, member_id INTEGER NOT NULL REFERENCES members(id), principal REAL NOT NULL CHECK (principal > 0),
      method TEXT NOT NULL, annual_rate REAL NOT NULL DEFAULT 0, term_months INTEGER NOT NULL, disbursed_date TEXT NOT NULL, first_due_date TEXT NOT NULL, installment REAL NOT NULL, total_interest REAL NOT NULL,
      total_payable REAL NOT NULL, payment_method TEXT, reference TEXT, purpose TEXT, guarantor TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'Active', closed_date TEXT, written_off_amount REAL NOT NULL DEFAULT 0,
      written_off_date TEXT, written_off_reason TEXT, created_by TEXT, created_at TEXT, updated_at TEXT)`);
    v5.run(`INSERT INTO personal_loans (loan_no, member_id, principal, method, annual_rate, term_months, disbursed_date, first_due_date, installment, total_interest, total_payable, payment_method, guarantor)
            VALUES ('PL-0001', ${m1}, 1000, 'free', 0, 2, '2025-01-05', '2025-02-05', 500, 0, 1000, 'Cash', 'Old Friend')`);
    v5.run('PRAGMA user_version = 5');
    const v5bytes = Buffer.from(v5.export()); v5.close();
    store.replaceWith(v5bytes);
    const legacy = A.getLoans();
    ok(legacy.length === 1 && A.getDatabaseStats().schemaVersion === 9, 'a schema-5 database upgrades to the current schema and keeps its loan');
    ok(A.getLoan(legacy[0].id).guarantor.type === 'legacy' && A.getLoan(legacy[0].id).guarantor.name === 'Old Friend', 'an older loan shows its free-text guarantor as "legacy"');
    ok(A.checkAccountingHealth().checks.find(c => c.id === 'loan_guarantor').status === 'warn', 'health check warns about the loan with no structured guarantor');
    ok(A.getLoans('newest', 'All', undefined, undefined, 'old friend').length === 1, 'the old guarantor name is still searchable');
  }

  // ---- a database from the previous app version (schema 4, no loan tables) upgrades cleanly ----
  const initSqlJs = require(path.join(proj, 'node_modules', 'sql.js'));
  const SQL = await initSqlJs({ wasmBinary: wasm });
  const old = new SQL.Database(store.exportBytes());
  old.run('DROP TABLE loan_repayments'); old.run('DROP TABLE loan_schedule'); old.run('DROP TABLE personal_loans');
  old.run("DELETE FROM app_settings WHERE key LIKE 'loan_%'"); old.run('PRAGMA user_version = 4');
  const oldBytes = Buffer.from(old.export()); old.close();
  store.replaceWith(oldBytes);
  ok(A.getLoans().length === 0 && A.getDatabaseStats().schemaVersion === 9, 'a schema-4 database gains the loan tables and moves to the current schema');
  ok(A.getAppSettings().loan_default_rate === 12 && A.getAppSettings().loan_default_method === 'reducing', 'loan policy defaults appear after the upgrade');
  ok(A.getAppSettings().loan_consent_required === true, 'after the upgrade the signed consent paper is required by default');
  A.saveAppSettings({ loan_consent_required: false });
  const lx = addLoanG({ member_id: m1, principal: 1000, method: 'free', term_months: 4, disbursed_date: '2025-01-05', payment_method: 'Cash' });
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
      throws(() => store.authorize(m, [loanId]), /Only an Admin|edit access to Settings/, `a Treasurer cannot ${m}`);
    A.logout();
    A.login('admin', adminPw);
    store.authorize('writeOffLoan', [{ loan_id: loanId }]); store.authorize('cancelLoanWriteOff', [loanId]); store.authorize('saveAppSettings', [{}]);
    ok(true, 'an Admin can write off loans and change the loan policy');
    A.logout();
  }

  // ---- a defaulter's loss is netted against their own savings first (audit finding) ----
  {
    A.resetDatabase(true); A.saveAppSettings({ loan_max_multiple: 0 });
    const x = A.addMember({ name: 'Defaulter', nid: '1990999900001', opening_balance: 50000, join_date: '2025-01-01', monthly_due: 500 });
    const y = A.addMember({ name: 'Honest', nid: '1990999900002', opening_balance: 50000, join_date: '2025-01-01', monthly_due: 500 });
    const big = addLoanG({ member_id: x, principal: 50000, method: 'free', term_months: 10, disbursed_date: '2025-02-01', payment_method: 'Cash' });
    A.writeOffLoan({ loan_id: big, date: '2025-06-01', reason: 'Absconded' });
    const px = A.previewMemberSettlement(x, '2025-07-01'), py = A.previewMemberSettlement(y, '2025-07-01');
    near(px.principal + px.profitShare, 0, 'defaulter owes 50,000 and has 50,000 saved: payout is 0');
    near(py.principal + py.profitShare, 50000, 'the honest member loses nothing when the savings of the defaulter cover the loan');
    near(px.principal + px.profitShare + py.principal + py.profitShare, A.getOverviewMetrics('2030-01').fund_balance_at_cost, 'payouts add up to the fund balance (50,000)');
    // a loan bigger than the borrower's savings: the borrower loses everything, the rest is shared by the others
    A.resetDatabase(true);
    const x2 = A.addMember({ name: 'Defaulter Two', nid: '1990999900011', opening_balance: 10000, join_date: '2025-01-01', monthly_due: 500 });
    const y2 = A.addMember({ name: 'Honest Two', nid: '1990999900012', opening_balance: 30000, join_date: '2025-01-01', monthly_due: 500 });
    const z2 = A.addMember({ name: 'Honest Three', nid: '1990999900013', opening_balance: 10000, join_date: '2025-01-01', monthly_due: 500 });
    const l9 = addLoanG({ member_id: x2, principal: 20000, method: 'free', term_months: 10, disbursed_date: '2025-02-01', payment_method: 'Cash' });
    A.writeOffLoan({ loan_id: l9, date: '2025-06-01', reason: 'Cannot pay' });
    const a2 = A.previewMemberSettlement(x2, '2025-07-01'), b2 = A.previewMemberSettlement(y2, '2025-07-01'), c2 = A.previewMemberSettlement(z2, '2025-07-01');
    near(a2.principal + a2.profitShare, 0, 'savings of 10,000 are used up against a 20,000 loan');
    near(b2.principal + b2.profitShare, 30000 - 7500, 'the other 10,000 of loss is shared by savings (30,000 / 40,000 = 7,500)');
    near(c2.principal + c2.profitShare, 10000 - 2500, 'Honest Three bears 2,500');
    near(a2.principal + a2.profitShare + b2.principal + b2.profitShare + c2.principal + c2.profitShare, A.getOverviewMetrics('2030-01').fund_balance_at_cost, 'payouts add up to the fund balance (30,000)');
    A.settleMember({ member_id: y2, settlement_date: '2025-07-01', payment_method: 'Cash' });
    throws(() => A.settleMember({ member_id: z2, settlement_date: '2025-06-30', payment_method: 'Cash' }), /earlier than the latest settlement/, 'a settlement cannot be dated before an earlier payout');

    // ---- input validation hardening (audit) ----
    const okBase = { member_id: z2, principal: 1000, method: 'free', term_months: 4, payment_method: 'Cash' };
    throws(() => addLoanG({ ...okBase, disbursed_date: '2025-99-99' }), /not a valid date/, 'an impossible loan date is refused, not replaced by today');
    throws(() => addLoanG({ ...okBase, disbursed_date: '2025-12-01', first_due_date: '2025-02-30' }), /not a valid date/, 'an impossible first-installment date is refused');
    ok(store.toISODate('2025-02-30') === null && store.toISODate('2025-02-28') === '2025-02-28' && store.toISODate('2024-02-29') === '2024-02-29', 'toISODate accepts only real calendar dates');
    throws(() => A.updateMember(z2, { status: 'Suspended' }), /Active or Inactive/, 'a member cannot be given an invented status');
    const l10 = addLoanG({ ...okBase, disbursed_date: '2025-12-01' });
    throws(() => A.recordLoanRepayment({ loan_id: l10, paid_date: '2025-13-40', amount: 250, payment_method: 'Cash' }), /not a valid date/, 'an impossible repayment date is refused');
    throws(() => A.recordLoanRepayment({ loan_id: l10, paid_date: '2025-12-20', amount: 250, penalty: Infinity, payment_method: 'Cash' }), /normal amount/, 'an infinite penalty is refused');
    throws(() => A.recordLoanRepayment({ loan_id: l10, paid_date: '2025-12-20', amount: 1e12, payment_method: 'Cash' }), /amount received|more than the loan/, 'an absurd repayment amount is refused');
    throws(() => addLoanG({ ...okBase, principal: 0.01, term_months: 60, disbursed_date: '2025-12-01' }), /too small|at least TK 1/, 'a one-paisa loan over 60 months is refused');
  }

  // ---- loan drafts and the signed consent paper ----
  {
    A.resetDatabase(true);
    A.saveAppSettings({ loan_max_multiple: 0, loan_consent_required: true });
    ok(A.getAppSettings().loan_consent_required === true, 'signed consent paper is required by default policy once switched on');
    const bo = A.addMember({ name: 'Draft Borrower', nid: '1990888800001', opening_balance: 50000, join_date: '2025-01-01', monthly_due: 500 });
    const gu = A.addMember({ name: 'Draft Guarantor', nid: '1990888800002', opening_balance: 20000, join_date: '2025-01-01', monthly_due: 500 });
    const dbase = { member_id: bo, principal: 12000, method: 'reducing', annual_rate: 12, term_months: 12, disbursed_date: '2025-02-01', first_due_date: '2025-03-01', payment_method: 'Cash', purpose: 'Shop', guarantor_type: 'member', guarantor_member_id: gu };
    const before = A.getOverviewMetrics('2030-01');
    throws(() => A.addLoan({ ...dbase, first_due_date: undefined }), /signed consent paper is required/, 'with consent required a loan cannot be given directly: it must be a draft');
    const dr = A.createLoanApplication(dbase);
    const dd = A.getLoanApplication(dr);
    ok(dd.application.app_no === 'LA-0001' && dd.application.status === 'Draft' && !dd.application.has_consent, 'a draft is created as LA-0001 with no signed paper');
    near(dd.application.installment, 1066, 'the draft stores the installment printed on the paper');
    ok(dd.guarantor.type === 'member' && dd.guarantor.code === 'BF-0002', 'the draft keeps its guarantor');
    const after = A.getOverviewMetrics('2030-01');
    near(after.cash_in_hand, before.cash_in_hand, 'A DRAFT MOVES NO MONEY: cash in hand is unchanged');
    near(after.fund_balance_at_cost, before.fund_balance_at_cost, 'A DRAFT MOVES NO MONEY: fund balance is unchanged');
    ok(A.getLoans().length === 0 && A.getLoanSummary().totalLent === 0 && A.getLoanSummary().drafts === 1 && A.getLoanSummary().draftsAmount === 12000, 'the draft is not a loan: no loans, nothing lent, one draft of 12,000');
    ok(A.getTransactions(undefined, undefined, 'All').length === 0, 'a draft does not appear in the ledger');
    ok(A.checkAccountingHealth().checks.filter(c => c.status === 'fail').length === 0, 'health check: no failures with a draft present');
    ok(A.getDynamicNotifications().some(n => n.targetTab === 'loans' && n.targetFilter === 'Draft'), 'a notification reminds that a draft is waiting for its signed paper');
    ok(A.getLoanApplications('draft borrower').length === 1 && A.getLoanApplications('zzz').length === 0 && A.getLoanApplications('', bo).length === 1 && A.getLoanApplications('', gu).length === 0, 'drafts can be searched and filtered by member');
    ok(A.getLoanApplications('BF-0002').length === 1, 'a draft can be found by its guarantor');
    const today = store.todayISO();
    throws(() => A.activateLoanApplication({ id: dr, disbursed_date: today }), /first installment date/, 'a draft whose first installment date is not after the disbursement date cannot be disbursed');
    throws(() => A.deleteMember(gu), /loan draft/, 'a member named on a draft cannot be deleted');
    throws(() => A.createLoanApplication({ ...dbase, guarantor_type: undefined }), /guarantor is required/, 'a draft also needs a guarantor');
    throws(() => A.createLoanApplication({ ...dbase, term_months: 0 }), /term/, 'a draft is validated like a loan');
    const okDraft = A.createLoanApplication({ ...dbase, disbursed_date: today, first_due_date: undefined });   // first installment = one month after today
    throws(() => A.activateLoanApplication({ id: okDraft, disbursed_date: today }), /Upload the signed consent paper first/, 'NO MONEY WITHOUT THE SIGNED PAPER: a draft without the uploaded paper cannot be disbursed');
    ok(A.getLoans().length === 0, 'the refused disbursement created no loan');

    // upload needs a signed-in writer; the owner password is only ever passed through the environment
    const adminPw = process.env.BONDHU_ADMIN_PASSWORD;
    if (!adminPw) console.log('SKIP  upload / disbursement flow (set BONDHU_ADMIN_PASSWORD to run it)');
    else {
      A.login('admin', adminPw);
      const mkfile = (name) => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.concat([Buffer.from('%PDF-1.4 signed scan '), Buffer.alloc(2000, 7)])); return { file: f, name, size: fs.statSync(f).size, sha256: 'a'.repeat(64) }; };
      const paper1 = mkfile('signed-1.pdf');
      store.attachConsentDocument('application', okDraft, paper1);
      ok(A.getLoanApplication(okDraft).application.has_consent && A.getLoanApplication(okDraft).application.consent_file_exists, 'the signed paper is attached to the draft');
      // editing without changing the signed terms keeps the paper; changing them removes it
      let r = A.updateLoanApplication(okDraft, { ...dbase, disbursed_date: today, first_due_date: undefined, purpose: 'Shop stock' });
      ok(!r.consentRemoved && A.getLoanApplication(okDraft).application.has_consent, 'editing only the purpose keeps the uploaded paper');
      r = A.updateLoanApplication(okDraft, { ...dbase, disbursed_date: today, first_due_date: undefined, principal: 15000 });
      ok(r.consentRemoved && !A.getLoanApplication(okDraft).application.has_consent && !fs.existsSync(paper1.file), 'changing the amount removes the uploaded paper (it must be signed again) and deletes the old file');
      near(A.getLoanApplication(okDraft).application.installment, 1333, 'the draft installment was recalculated for 15,000 (1,332.73 → 1,333)');
      throws(() => A.activateLoanApplication({ id: okDraft, disbursed_date: today }), /Upload the signed consent paper first/, 'after the change the new paper is needed again');
      const paper2 = mkfile('signed-2.pdf');
      store.attachConsentDocument('application', okDraft, paper2);
      const cashBefore = A.getOverviewMetrics('2030-01').cash_in_hand;
      throws(() => A.activateLoanApplication({ id: okDraft, disbursed_date: '2099-01-01' }), /future/, 'cannot disburse in the future');
      const loanId = A.activateLoanApplication({ id: okDraft, disbursed_date: today });
      const lo = A.getLoan(loanId);
      ok(lo.loan.status === 'Active' && lo.loan.consent_status === 'Signed' && lo.loan.application_no === 'LA-0002' && lo.loan.consent_name === 'signed-2.pdf', 'uploading the signed paper and disbursing creates the loan with the paper linked (draft LA-0002)');
      ok(lo.loan.principal === 15000 && lo.schedule.length === 12 && lo.guarantor.code === 'BF-0002', 'the loan has exactly the terms of the draft');
      near(cashBefore - A.getOverviewMetrics('2030-01').cash_in_hand, 15000, 'ONLY NOW does money leave the fund: cash falls by 15,000');
      ok(A.getLoanApplications().length === 1 && A.getLoanApplications()[0].app_no === 'LA-0001' && A.getLoanSummary().drafts === 1, 'the disbursed draft is closed; only the other draft (LA-0001) is still waiting');
      throws(() => A.activateLoanApplication({ id: okDraft, disbursed_date: today }), /already been disbursed/, 'a draft cannot be disbursed twice');
      throws(() => A.deleteLoanApplication(okDraft), /Only a draft/, 'a disbursed draft cannot be deleted');
      ok(A.checkAccountingHealth().checks.find(c => c.id === 'loan_consent').status === 'pass', 'health check: the signed paper is on file');
      fs.unlinkSync(paper2.file);
      ok(A.checkAccountingHealth().checks.find(c => c.id === 'loan_consent').status === 'warn', 'health check warns when the signed paper file goes missing');
      // attach / replace on a disbursed loan
      const paper3 = mkfile('signed-3.pdf');
      store.attachConsentDocument('loan', loanId, paper3);
      ok(A.getLoan(loanId).loan.consent_name === 'signed-3.pdf' && store.consentDocumentPath('loan', loanId).name === 'signed-3.pdf', 'a signed paper can be replaced on a disbursed loan');
      // a draft can be deleted; its file goes with it
      const dd2 = A.createLoanApplication({ ...dbase, disbursed_date: today, first_due_date: undefined, principal: 5000 });
      const paper4 = mkfile('signed-4.pdf'); store.attachConsentDocument('application', dd2, paper4);
      A.deleteLoanApplication(dd2);
      ok(A.getLoanApplications().length === 1 && !fs.existsSync(paper4.file), 'deleting a draft removes it and its uploaded file');
      const dd3 = A.createLoanApplication({ ...dbase, disbursed_date: today, first_due_date: undefined, principal: 1000, term_months: 2 });
      ok(A.getLoanApplication(dd3).application.app_no === 'LA-0004', 'the number of a deleted draft (LA-0003) is never reused');
      A.deleteLoanApplication(dd3);
      // auditors may not upload
      const aud = A.addUser({ username: 'consent_aud', full_name: 'Consent Auditor', role: 'Auditor', email: '' });
      A.setUserPassword(aud, 'Audit0rpass2'); A.logout(); A.login('consent_aud', 'Audit0rpass2');
      throws(() => store.attachConsentDocument('loan', loanId, mkfile('x.pdf')), /read-only/, 'an Auditor cannot upload a signed paper');
      for (const m of ['createLoanApplication', 'updateLoanApplication', 'deleteLoanApplication', 'activateLoanApplication']) throws(() => store.authorize(m, [1]), /read-only/, `an Auditor cannot ${m}`);
      for (const m of ['getLoanApplications', 'getLoanApplication']) store.authorize(m, [1]);
      A.logout();
    }

    // ---- switching the requirement off ----
    A.saveAppSettings({ loan_consent_required: false });
    throws(() => A.createLoanApplication({ ...dbase, disbursed_date: today, first_due_date: undefined }), /switched off/, 'with the requirement off new drafts are not created');
    const direct = A.addLoan({ ...dbase, principal: 3000, term_months: 6, disbursed_date: today, first_due_date: undefined });
    ok(A.getLoan(direct).loan.consent_status === 'Waived' && !A.getLoan(direct).loan.application_no, 'with the requirement off a loan is disbursed at once and marked "Waived"');
    const leftover = A.getLoanApplications();
    ok(leftover.length === 1 && leftover[0].app_no === 'LA-0001', 'the older draft is still waiting');
    A.saveAppSettings({ loan_consent_required: true });
    const dw = A.createLoanApplication({ ...dbase, principal: 2000, term_months: 4, disbursed_date: today, first_due_date: undefined });
    A.saveAppSettings({ loan_consent_required: false });
    const wl = A.activateLoanApplication({ id: dw, disbursed_date: today });
    ok(A.getLoan(wl).loan.consent_status === 'Waived' && A.getLoan(wl).loan.application_no === 'LA-0005', 'a draft waiting when the requirement is switched off can be disbursed without a paper (marked Waived)');
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL LOAN TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
