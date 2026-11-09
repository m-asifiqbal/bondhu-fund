/**
 * Personal-loan engine — pure functions only (no database, no UI). Everything the loan form previews and everything
 * the database books comes from here, so the two can never disagree.
 *
 * Money is kept to 2 decimals. Every schedule is built so that
 *      Σ principal = loan amount        and        Σ installments = Σ principal + Σ interest
 * exactly: the LAST installment absorbs any rounding difference (the usual banking convention).
 *
 * Interest methods
 *   reducing  Equal monthly installment (EMI) on the reducing balance:  EMI = P·r / (1 − (1+r)^−n),  r = annual% / 12 / 100.
 *             Each month: interest = balance × r, the rest of the installment repays principal.
 *   flat      Interest = P × annual% × (n / 12), charged evenly over the n months; principal repaid evenly.
 *   free      No interest (Qard-e-Hasan / interest-free help from the fund): P / n each month.
 */
export type LoanMethod = 'reducing' | 'flat' | 'free';
export const LOAN_METHODS: LoanMethod[] = ['reducing', 'flat', 'free'];

export interface LoanTerms {
  principal: number;
  method: LoanMethod;
  /** nominal annual interest rate in percent (ignored for 'free') */
  annual_rate: number;
  term_months: number;
  /** ISO date of the first installment; the rest follow monthly on the same day (month-end safe) */
  first_due_date: string;
  /** installments are rounded to whole taka (the last one adjusts). Default true. */
  round_to_taka?: boolean;
}

export interface ScheduleRow {
  no: number; due_date: string; principal: number; interest: number; total: number; balance: number;
}

export interface LoanPlan {
  rows: ScheduleRow[];
  /** the regular monthly installment (the last one may differ by a few taka) */
  installment: number;
  lastInstallment: number;
  totalInterest: number;
  totalPayable: number;
  /** equivalent reducing-balance annual rate in percent (shows what a flat rate really costs) */
  effectiveRate: number;
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

/** `iso` plus `n` months, keeping the day of month where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsKeepDay(iso: string, n: number, anchorDay?: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const day = anchorDay ?? d;
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const dim = new Date(ny, nm, 0).getDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day, dim))}`;
}

export function validateTerms(t: LoanTerms): string | null {
  if (!(Number(t.principal) > 0)) return 'Loan amount must be greater than zero.';
  if (Number(t.principal) > 1e9) return 'Loan amount is too large.';
  if (!LOAN_METHODS.includes(t.method)) return 'Choose an interest method.';
  if (!Number.isInteger(Number(t.term_months)) || t.term_months < 1 || t.term_months > 120) return 'Loan term must be a whole number of months from 1 to 120.';
  if (t.method !== 'free') {
    if (!Number.isFinite(Number(t.annual_rate)) || Number(t.annual_rate) < 0 || Number(t.annual_rate) > 100) return 'Interest rate must be between 0 and 100 percent a year.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.first_due_date || ''))) return 'Choose the first installment date.';
  return null;
}

/** Builds the full repayment schedule. Throws on invalid terms (callers validate first for friendly messages). */
export function buildPlan(t: LoanTerms): LoanPlan {
  const err = validateTerms(t);
  if (err) throw new Error(err);
  const P = r2(Number(t.principal));
  const n = Number(t.term_months);
  const rate = t.method === 'free' ? 0 : Number(t.annual_rate);
  const whole = t.round_to_taka !== false;
  const rows: ScheduleRow[] = [];
  const day = Number(t.first_due_date.slice(8, 10));
  const due = (k: number) => addMonthsKeepDay(t.first_due_date, k - 1, day);

  if (t.method === 'reducing' && rate > 0) {
    const r = rate / 1200;
    const exact = (P * r) / (1 - Math.pow(1 + r, -n));
    let emi = whole ? Math.round(exact) : r2(exact);
    if (emi <= P * r) emi = Math.ceil(P * r * 100) / 100 + 0.01;       // never let an installment fall below the monthly interest
    let balance = P;
    for (let k = 1; k <= n && balance > 0.004; k++) {
      const interest = r2(balance * r);
      let principal = k === n ? balance : Math.min(balance, r2(emi - interest));
      principal = r2(principal);
      balance = r2(balance - principal);
      rows.push({ no: k, due_date: due(k), principal, interest, total: r2(principal + interest), balance });
    }
  } else {
    // flat and interest-free share one routine (interest-free = flat at 0 %)
    const I = r2(P * (rate / 100) * (n / 12));
    const inst = whole ? Math.round((P + I) / n) : r2((P + I) / n);
    const perInterest = r2(I / n);
    let paidP = 0, paidI = 0;
    for (let k = 1; k <= n; k++) {
      let interest: number, principal: number;
      if (k === n) { interest = r2(I - paidI); principal = r2(P - paidP); }
      else { interest = perInterest; principal = Math.max(0, Math.min(r2(inst - perInterest), r2(P - paidP))); }
      paidP = r2(paidP + principal); paidI = r2(paidI + interest);
      rows.push({ no: k, due_date: due(k), principal, interest, total: r2(principal + interest), balance: r2(P - paidP) });
    }
  }

  const totalInterest = r2(rows.reduce((a, x) => a + x.interest, 0));
  const totalPayable = r2(P + totalInterest);
  return {
    rows, installment: rows[0]?.total ?? 0, lastInstallment: rows[rows.length - 1]?.total ?? 0,
    totalInterest, totalPayable, effectiveRate: effectiveAnnualRate(P, rows.map(x => x.total)),
  };
}

/**
 * Nominal annual rate (%) of the reducing-balance loan that has exactly this cash flow: solves
 * Σ total_k / (1+i)^k = P for the monthly rate i by bisection, then × 12. For a reducing loan it returns the quoted rate;
 * for a flat loan it shows the (higher) true cost.
 */
export function effectiveAnnualRate(principal: number, installments: number[]): number {
  const total = installments.reduce((a, x) => a + x, 0);
  if (!(principal > 0) || total <= principal + 0.004) return 0;
  const pv = (i: number) => installments.reduce((a, x, k) => a + x / Math.pow(1 + i, k + 1), 0);
  let lo = 0, hi = 1;                                  // monthly rate between 0 % and 100 %
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid; else hi = mid;
  }
  return r2(((lo + hi) / 2) * 1200);
}

export interface TermOption { term: number; installment: number; totalInterest: number; totalPayable: number; effectiveRate: number }

/** The "what if" table: same loan over several terms, so the borrower can pick an installment they can carry. */
export function compareTerms(base: Omit<LoanTerms, 'term_months'>, terms: number[]): TermOption[] {
  const out: TermOption[] = [];
  for (const term of [...new Set(terms)].sort((a, b) => a - b)) {
    if (term < 1 || term > 120) continue;
    const p = buildPlan({ ...base, term_months: term });
    out.push({ term, installment: p.installment, totalInterest: p.totalInterest, totalPayable: p.totalPayable, effectiveRate: p.effectiveRate });
  }
  return out;
}

export const COMMON_TERMS = [3, 6, 9, 12, 18, 24, 36, 48, 60];

// ---------------------------------------------------------------------------------------------------------------
// Repayment allocation
// ---------------------------------------------------------------------------------------------------------------
export interface AllocLine { no: number; principal: number; interest: number }

/**
 * Splits a payment between interest and principal. Money is applied to the schedule in order — installment 1 first,
 * interest before principal inside each installment — starting after what was already paid (`paidBefore`, the sum
 * of the principal + interest of all earlier installment payments).
 */
export function allocatePayment(rows: Array<Pick<ScheduleRow, 'no' | 'principal' | 'interest' | 'total' | 'due_date'>>, paidBefore: number, amount: number) {
  const lo = r2(paidBefore), hi = r2(paidBefore + amount);
  let pos = 0, interest = 0;
  const lines: AllocLine[] = [];
  const touched: Array<{ no: number; due_date: string }> = [];
  for (const row of rows) {
    const start = pos, mid = r2(start + row.interest), end = r2(start + row.total);
    pos = end;
    const iOv = Math.max(0, Math.min(hi, mid) - Math.max(lo, start));
    const pOv = Math.max(0, Math.min(hi, end) - Math.max(lo, mid));
    if (iOv > 0.0001 || pOv > 0.0001) {
      lines.push({ no: row.no, interest: r2(iOv), principal: r2(pOv) });
      touched.push({ no: row.no, due_date: row.due_date });
      interest = r2(interest + iOv);
    }
  }
  const total = r2(amount);
  interest = Math.min(interest, total);
  return { interest, principal: r2(total - interest), lines, touched };
}

/** Where a loan stands against its schedule, given what was paid towards installments (principal + interest). */
export function scheduleState(rows: Array<Pick<ScheduleRow, 'no' | 'due_date' | 'principal' | 'interest' | 'total'>>, paidTowardsSchedule: number, today: string) {
  let cum = 0, paidCount = 0;
  let nextIdx = -1, lastOverdueIdx = -1;
  const status: Array<'Paid' | 'Partial' | 'Due' | 'Overdue'> = [];
  const cums: number[] = [];
  rows.forEach((row, i) => {
    const start = cum; cum = r2(cum + row.total); cums.push(cum);
    const fullyPaid = paidTowardsSchedule >= cum - 0.005;
    const touched = paidTowardsSchedule > start + 0.005;
    if (fullyPaid) { paidCount++; status.push('Paid'); return; }
    if (nextIdx < 0) nextIdx = i;
    const late = row.due_date < today;
    if (late) lastOverdueIdx = i;
    status.push(late ? 'Overdue' : touched ? 'Partial' : 'Due');
  });
  const next = nextIdx >= 0 ? rows[nextIdx] : null;
  return {
    status, paidCount,
    nextDueDate: next?.due_date ?? null,
    nextDueAmount: nextIdx >= 0 ? r2(cums[nextIdx] - paidTowardsSchedule) : 0,
    overdueCount: lastOverdueIdx < 0 ? 0 : status.slice(0, lastOverdueIdx + 1).filter(s => s !== 'Paid').length,
    overdueAmount: lastOverdueIdx < 0 ? 0 : r2(cums[lastOverdueIdx] - paidTowardsSchedule),
    firstOverdueDate: lastOverdueIdx < 0 ? null : (rows.find((_, i) => status[i] !== 'Paid')?.due_date ?? null),
  };
}

/** Whole days from `a` to `b` (ISO dates). */
export function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number), [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}
