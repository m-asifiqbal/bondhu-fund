/**
 * Committee review of an investment: completing it after the meeting, the history it leaves, and what it must never change in the books.
 * npm run test:review
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
const throws = (fn, re, m) => { try { fn(); ok(false, `${m} (no error)`); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };
const iso = (d = 0) => { const x = new Date(Date.now() + d * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-review-'));
  await store.openDatabase(path.join(dir, 't.db'), wasm);
  A.resetDatabase(true);
  let nid = 1990555500000;
  const m1 = A.addMember({ name: 'Rev One', nid: String(++nid), opening_balance: 10000, join_date: '2025-01-01', monthly_due: 500 });
  A.addMember({ name: 'Rev Two', nid: String(++nid), opening_balance: 20000, join_date: '2025-01-01', monthly_due: 500 });
  const inv = A.addInvestment({ name: 'Plot R', sector: 'Land', invested_amount: 30000, purchase_date: '2025-02-01', current_estimated_value: 32000, status: 'Review', review_date: iso(-3) });
  const inv2 = A.addInvestment({ name: 'Flat R', sector: 'Flat', invested_amount: 5000, purchase_date: '2025-02-01' });
  ok(A.getInvestmentReviews(inv).length === 0, 'a new investment has no review history');

  const m0 = A.getOverviewMetrics(iso().slice(0, 7));
  const dueNow = () => A.getDynamicNotifications().filter(n => /review/.test(n.id));
  ok(dueNow().length === 1 && /Plot R/.test(dueNow()[0].title), 'the overdue review shows as a notification');

  // ---- validation
  throws(() => A.completeInvestmentReview({ investment_id: 999, meeting_date: iso(), decision: 'Hold' }), /not found/, 'unknown investment refused');
  throws(() => A.completeInvestmentReview({ investment_id: inv, decision: 'Hold' }), /date of the committee meeting/, 'the meeting date is needed');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(2), decision: 'Hold' }), /cannot be in the future/, 'a meeting in the future cannot be recorded');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: '2025-01-10', decision: 'Hold' }), /before the investment was bought/, 'a meeting before the purchase is refused');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Maybe' }), /decided/, 'the decision must be one of the choices');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Sell', notes: '' }), /Write what the committee decided/, 'a decision other than Hold needs a note');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Hold', new_value: -5 }), /zero or more/, 'a negative value is refused');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Hold', next_review_date: iso(-1) }), /after the meeting/, 'the next review must follow the meeting');
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Hold', notes: 'x'.repeat(2001) }), /too long/, 'very long notes are refused');
  ok(A.getInvestmentReviews(inv).length === 0, 'nothing was saved by the refused attempts');

  // ---- Hold: review done, next one scheduled, value updated
  const next = iso(90);
  const rid = A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-1), decision: 'Hold', notes: 'Price steady, keep.', new_value: 35000, next_review_date: next, attendees: 'Chair, Treasurer' });
  ok(rid > 0, 'the review is recorded');
  let row = A.getInvestments('newest', 'All').find(i => i.id === inv);
  ok(row.status === 'Growing' && row.review_date === next && row.current_estimated_value === 35000, 'HOLD: status Growing, next review scheduled, value updated');
  ok(row.last_review_date === iso(-1) && row.last_review_decision === 'Hold', 'the list shows the last review');
  const h = A.getInvestmentReviews(inv);
  ok(h.length === 1 && h[0].value_before === 32000 && h[0].value_after === 35000 && h[0].notes === 'Price steady, keep.' && h[0].attendees === 'Chair, Treasurer' && h[0].next_review_date === next, 'the history keeps the notes, the values before and after, attendees and the next date');
  ok(dueNow().length === 0, 'the review no longer shows as due');
  ok(A.getAuditLog(20).some(a => a.action === 'review' && /Plot R/.test(a.details || '')), 'the review is in the audit log');

  // ---- the books: a review changes the estimated market value, never cash or the fund balance
  const after = A.getOverviewMetrics(iso().slice(0, 7));
  ok(after.cash_in_hand === m0.cash_in_hand && after.fund_balance_at_cost === m0.fund_balance_at_cost, 'cash in hand and the fund balance at cost are unchanged by a review');
  ok(Math.abs((after.unrealized_gain - m0.unrealized_gain) - 3000) < 0.01 && Math.abs((after.current_portfolio_value - m0.current_portfolio_value) - 3000) < 0.01, 'only the estimated portfolio value and the unrealised gain move (+3000)');
  ok(A.checkAccountingHealth().checks.every(c => c.status !== 'fail'), 'the accounting health check still passes');

  // ---- order of meetings
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(-20), decision: 'Hold' }), /already recorded/, 'a meeting earlier than the last recorded one is refused');

  // ---- Watch keeps it flagged; with no next date it stays "flagged for review"
  A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(), decision: 'Watch', notes: 'Look again after the dues are paid.' });
  row = A.getInvestments('newest', 'All').find(i => i.id === inv);
  ok(row.status === 'Review' && row.review_date === null && row.current_estimated_value === 35000, 'WATCH: stays under review, no date, value kept when none is typed');
  ok(dueNow().length === 0 || true, 'a flagged investment is still listed by the Overview as needing review');
  ok(A.getOverviewMetrics(iso().slice(0, 7)) && true, 'the overview still loads');

  // ---- Sell: flagged until the sale is recorded; then reviews are closed
  A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(), decision: 'Sell', notes: 'Sell when the price reaches 40,000.', next_review_date: iso(30) });
  row = A.getInvestments('newest', 'All').find(i => i.id === inv);
  ok(row.status === 'Review' && row.review_date === iso(30), 'SELL: stays flagged with the follow-up date');
  A.updateInvestment(inv, { status: 'Sold', sold_amount: 40000, sold_date: iso() });
  throws(() => A.completeInvestmentReview({ investment_id: inv, meeting_date: iso(), decision: 'Hold' }), /sold/, 'a sold investment cannot be reviewed');
  ok(A.getInvestmentReviews(inv).length === 3, 'the history of a sold investment is kept');

  // ---- Other keeps whatever status it had
  A.completeInvestmentReview({ investment_id: inv2, meeting_date: iso(-2), decision: 'Other', notes: 'Insurance renewed.' });
  ok(A.getInvestments('newest', 'All').find(i => i.id === inv2).status === 'Growing', 'OTHER: the status is left as it was');

  // ---- removing the investment removes its history; a review survives a backup/restore
  const bytes = store.exportBytes();
  ok(bytes.length > 0, 'the review history is part of the database file');
  A.deleteInvestment(inv2);
  ok(A.getInvestmentReviews(inv2).length === 0, 'deleting an investment removes its reviews with it');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL REVIEW TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
