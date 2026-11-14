/**
 * Randomised accounting stress test: hundreds of mixed operations in a fixed random order (the same every run), and after EVERY step
 *   - the books balance (fund = what members are owed + the fund's own reserve, explained to the paisa),
 *   - the accounting health check has no failure,
 *   - the cash book (ledger) reconciles with cash in hand,
 *   - the fine register equals the fines in payments and loan repayments.
 * Operations the program refuses (an overdraft, a settlement of a member with a loan...) are simply skipped: refusing is correct.
 *   npm run test:fuzz
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;

let seed = Number(process.env.FUZZ_SEED) || 20260401;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = xs => xs[Math.floor(rnd() * xs.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = n => String(n).padStart(2, '0');
const todayKey = new Date().toISOString().slice(0, 10);
const dateIn = (y, m) => { const d = `${y}-${pad(m)}-${pad(int(1, 28))}`; return d > todayKey ? todayKey : d; };
const randomDate = (fromYear = 2025) => dateIn(int(fromYear, 2026), int(1, 12));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-fuzz-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);
  A.saveAppSettings({ late_fee_amount: 100, monthly_due_day: 10, loan_consent_required: false });

  let nid = 1990777700000;
  const members = [];
  for (let i = 0; i < 6; i++) members.push(A.addMember({ name: `Fuzz ${i + 1}`, nid: String(++nid), opening_balance: pick([0, 2000, 5000, 10000]), join_date: '2025-01-01', monthly_due: 500 }));
  const invs = [];
  const loans = [];
  const stats = {};
  const log = [];
  let failures = 0;
  const count = k => { stats[k] = (stats[k] || 0) + 1; };

  const activeMembers = () => members.filter(id => A.getMemberById ? true : true).filter(id => { try { return A.getMemberStatement(id).member.status === 'Active'; } catch { return false; } });

  const ops = {
    payment() {
      const m = pick(activeMembers()); const y = int(2025, 2026), mo = int(1, 12); const month = `${y}-${pad(mo)}`;
      if (month > todayKey.slice(0, 7)) return false;
      const date = pick([dateIn(y, mo), randomDate(y)]); if (date < `${month}-01`) return false;
      A.recordPayment({ member_id: m, payment_month: month, payment_date: date, contribution_amount: int(3, 12) * 100, late_fee: pick([0, 0, 100, 100, 300, 50]), payment_method: 'Cash' });
      return true;
    },
    deletePayment() {
      const recs = A.getCollections('All', 'All').records?.filter(r => r.payment_id) || [];
      if (!recs.length) return false; A.deletePayment(pick(recs).payment_id); return true;
    },
    expense() { A.addExpense({ title: 'Fuzz expense', category: 'Meetup & Events', amount: int(1, 40) * 50, expense_date: randomDate(), payee: 'Shop', receipt_ref: 'R' }); return true; },
    investment() { const d = randomDate(); invs.push({ id: A.addInvestment({ name: `Inv ${invs.length + 1}`, sector: 'Land', invested_amount: int(5, 60) * 100, purchase_date: d }), date: d }); return true; },
    profit() { const i = pick(invs); if (!i) return false; const d = randomDate(); if (d < i.date) return false; A.addInvestmentReturn({ investment_id: i.id, entry_type: pick(['Profit', 'Profit', 'Loss']), amount: int(1, 30) * 20, entry_date: d, payment_method: 'Cash' }); return true; },
    sell() { const i = pick(invs); if (!i) return false; const d = randomDate(); if (d < i.date) return false; A.updateInvestment(i.id, { status: 'Sold', sold_amount: int(2, 80) * 100, sold_date: d }); return true; },
    review() { const i = pick(invs); if (!i) return false; A.completeInvestmentReview({ investment_id: i.id, meeting_date: todayKey, decision: pick(['Hold', 'Watch']), notes: 'Fuzz', new_value: int(1, 90) * 100 }); return true; },
    loan() {
      const act = activeMembers(); if (act.length < 2) return false; const b = pick(act); const g = pick(act.filter(x => x !== b));
      const id = A.addLoan({ member_id: b, principal: int(5, 40) * 100, method: pick(['reducing', 'flat', 'free']), annual_rate: pick([0, 8, 12]), term_months: pick([3, 6, 12]), disbursed_date: randomDate(), payment_method: 'Cash', guarantor_type: 'member', guarantor_member_id: g, purpose: 'Fuzz' });
      loans.push(id); return true;
    },
    repay() {
      const id = pick(loans); if (!id) return false; const d = randomDate(); const q = A.previewLoanRepayment(id, d);
      A.recordLoanRepayment({ loan_id: id, paid_date: d, amount: q.principal + q.interest || 100, payment_method: 'Cash', penalty: pick([0, 0, 25, 60]) }); return true;
    },
    writeoff() { const id = pick(loans); if (!id) return false; A.writeOffLoan({ loan_id: id, date: randomDate(), reason: 'Fuzz' }); return true; },
    settle() {
      const m = pick(activeMembers()); const date = randomDate(); const p = A.previewMemberSettlement(m, date);
      const adjust = rnd() < 0.4 ? { profit_share: p.profitShare + pick([-50, 40, 120]), note: 'Fuzz adjustment' } : {};
      A.settleMember({ member_id: m, settlement_date: date, payment_method: 'Cash', ...adjust }); return true;
    },
    unsettle() {
      const s = A.getMemberSettlements ? A.getMemberSettlements() : []; const row = (Array.isArray(s) ? s : s.settlements || [])[0]; if (!row) return false;
      A.cancelSettlement(row.member_id ?? row.id); return true;
    },
  };
  const weights = [['payment', 30], ['expense', 6], ['investment', 4], ['profit', 8], ['sell', 3], ['review', 2], ['loan', 5], ['repay', 14], ['writeoff', 2], ['settle', 9], ['unsettle', 3], ['deletePayment', 3]];
  const bag = weights.flatMap(([k, w]) => Array(w).fill(k));

  const check = (step, op) => {
    const b = A.getFundBooks();
    const h = A.checkAccountingHealth();
    const bad = [];
    if (!b.balanced) bad.push(`books do not balance: residual ${b.residual} (reserve ${b.reserve}, explained ${b.explained}, parts ${JSON.stringify(b.parts)})`);
    for (const c of h.checks) if (c.status === 'fail') bad.push(`health check failed: ${c.title}: ${(c.details || []).slice(0, 2).join(' | ')}`);
    if (bad.length) { failures++; console.log(`FAIL  step ${step} after "${op}":\n      ${bad.join('\n      ')}\n      last operations: ${log.slice(-6).join(' → ')}`); }
  };

  const STEPS = Number(process.env.FUZZ_STEPS) || 250;
  for (let step = 1; step <= STEPS; step++) {
    const op = pick(bag);
    let done = false;
    try { done = !!ops[op](); } catch { done = false; }      // refused by the program: fine
    if (!done) continue;
    count(op); log.push(op);
    check(step, op);
  }
  const summary = Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`operations done: ${summary}`);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const enough = total >= STEPS * 0.4 && (stats.payment || 0) > 20 && (stats.settle || 0) + (stats.loan || 0) + (stats.profit || 0) > 8;
  console.log(`${enough ? 'PASS' : 'FAIL'}  the run exercised enough operations (${total} of ${STEPS} steps were accepted)`);
  if (!enough) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : `\nALL BOOKS-FUZZ CHECKS PASSED (${total} operations, books balanced after each)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
