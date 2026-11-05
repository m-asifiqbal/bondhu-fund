/**
 * Report builders for the Reports & Export center.
 * Each builder calls the typed API in services/db (no SQL here) and returns raw,
 * machine-friendly values (numbers, ISO dates, 'YYYY-MM' months). Formatting for the
 * screen happens in the view; CSV exports keep the raw values.
 */
import {
  getTransactions, getCollections, getMembers, getMemberStatement, getOverviewData,
  getExpenses, getInvestments, getAuditLog,
} from '../../services/db';
import { addMonths, currentMonthKey, fiscalYearRange, toMonthKey, todayISO } from '../../utils/date';

export type ReportId = 'cashbook' | 'collections' | 'fiscal' | 'member' | 'defaulters' | 'expenses' | 'investments' | 'audit';
export type CellKind = 'text' | 'money' | 'date' | 'month' | 'number' | 'status' | 'datetime' | 'percent';

export interface ColumnDef {
  key: string;
  label: string; // English (CSV header)
  bn: string;
  kind?: CellKind;
  /** Shown/exported by default (column chooser). */
  default?: boolean;
  /** Summed into the totals row. */
  total?: boolean;
}

export interface SummaryItem { label: string; bn: string; value: number | string; kind?: CellKind; tone?: 'good' | 'bad' | 'brand' }

export interface ReportTable { title: string; bn: string; columns: ColumnDef[]; rows: Record<string, any>[] }

export interface ReportData {
  columns: ColumnDef[];
  rows: Record<string, any>[];
  summary: SummaryItem[];
  /** Additional fixed tables (e.g. category subtotals); exported as extra CSV sections. */
  extra?: ReportTable[];
  /** Period shown in the header (already localized). */
  periodLabel: string;
  /** English, filename-safe period tag. */
  fileTag: string;
}

export interface ReportParams {
  start: string;
  end: string;
  /** 'YYYY-MM' */
  month: string;
  memberId: number | null;
  fyStartMonth: number;
  filters: Record<string, string>;
  fmtDate: (iso?: string | null) => string;
  fmtMonth: (key?: string | null) => string;
  bn: boolean;
}

const sum = (rows: Record<string, any>[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

export function shiftDay(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}

const rangeLabel = (p: ReportParams) =>
  p.start === p.end ? p.fmtDate(p.start) : `${p.fmtDate(p.start)} – ${p.fmtDate(p.end)}`;
const rangeTag = (p: ReportParams) => (p.start === p.end ? p.start : `${p.start}_to_${p.end}`);

async function allMembers() {
  return (await getMembers('', 'All', 1, 100000, undefined, undefined, undefined, 'code_asc')).members;
}

// ---------------------------------------------------------------------------
async function cashbook(p: ReportParams): Promise<ReportData> {
  const type = (p.filters.ledgerType || 'All') as 'All' | 'collection' | 'expense' | 'investment';
  const [txs, before, members] = await Promise.all([
    getTransactions(p.start, p.end, type),
    type === 'All' ? getTransactions(undefined, shiftDay(p.start, -1), 'All') : Promise.resolve([]),
    type === 'All' ? allMembers() : Promise.resolve([]),
  ]);
  // Opening cash = members' opening balances + net ledger movement before the period.
  const opening = type === 'All'
    ? sum(members as any[], 'opening_balance') + before.reduce((s, r) => s + (Number(r.credit) || 0) - (Number(r.debit) || 0), 0)
    : 0;
  let bal = opening;
  const rows = txs.map(r => {
    bal += (Number(r.credit) || 0) - (Number(r.debit) || 0);
    return { ...r, balance: bal };
  });
  const credit = sum(rows, 'credit'), debit = sum(rows, 'debit');
  const summary: SummaryItem[] = [
    ...(type === 'All' ? [{ label: 'Opening balance', bn: 'প্রারম্ভিক জের', value: opening, kind: 'money' as CellKind }] : []),
    { label: 'Total credit (in)', bn: 'মোট জমা', value: credit, kind: 'money', tone: 'good' },
    { label: 'Total debit (out)', bn: 'মোট খরচ', value: debit, kind: 'money', tone: 'bad' },
    { label: 'Net movement', bn: 'নিট পরিবর্তন', value: credit - debit, kind: 'money' },
    ...(type === 'All' ? [{ label: 'Closing balance', bn: 'সমাপনী জের', value: opening + credit - debit, kind: 'money' as CellKind, tone: 'brand' as const }] : []),
    { label: 'Entries', bn: 'এন্ট্রি', value: rows.length, kind: 'number' },
  ];
  return {
    columns: [
      { key: 'date', label: 'Date', bn: 'তারিখ', kind: 'date', default: true },
      { key: 'type', label: 'Type', bn: 'ধরন', kind: 'status', default: true },
      { key: 'party', label: 'Party', bn: 'পক্ষ', default: true },
      { key: 'description', label: 'Description', bn: 'বিবরণ', default: true },
      { key: 'method', label: 'Method', bn: 'মাধ্যম', default: false },
      { key: 'reference', label: 'Reference', bn: 'রেফারেন্স', default: true },
      { key: 'credit', label: 'Credit', bn: 'জমা', kind: 'money', default: true, total: true },
      { key: 'debit', label: 'Debit', bn: 'খরচ', kind: 'money', default: true, total: true },
      { key: 'balance', label: type === 'All' ? 'Balance' : 'Running net', bn: 'ব্যালেন্স', kind: 'money', default: true },
    ],
    rows, summary, periodLabel: rangeLabel(p), fileTag: rangeTag(p),
  };
}

// ---------------------------------------------------------------------------
async function collections(p: ReportParams): Promise<ReportData> {
  const { records, stats } = await getCollections(p.month, p.filters.status || 'All', undefined, undefined, '', 'name_asc');
  const rows = records.map(r => ({ ...r, payment_date: r.payment_id ? r.payment_date : null }));
  return {
    columns: [
      { key: 'member_code', label: 'Member ID', bn: 'সদস্য আইডি', default: true },
      { key: 'member_name', label: 'Member name', bn: 'সদস্যের নাম', default: true },
      { key: 'member_phone', label: 'Phone', bn: 'ফোন', default: false },
      { key: 'monthly_due', label: 'Monthly due', bn: 'মাসিক চাঁদা', kind: 'money', default: true, total: true },
      { key: 'due_date', label: 'Due date', bn: 'নির্ধারিত তারিখ', kind: 'date', default: false },
      { key: 'payment_date', label: 'Paid on', bn: 'পরিশোধের তারিখ', kind: 'date', default: true },
      { key: 'contribution_amount', label: 'Contribution', bn: 'চাঁদা', kind: 'money', default: true, total: true },
      { key: 'late_fee', label: 'Late fee', bn: 'বিলম্ব ফি', kind: 'money', default: true, total: true },
      { key: 'total_amount', label: 'Total', bn: 'মোট', kind: 'money', default: true, total: true },
      { key: 'status', label: 'Status', bn: 'অবস্থা', kind: 'status', default: true },
      { key: 'payment_method', label: 'Method', bn: 'মাধ্যম', default: true },
      { key: 'trx_id', label: 'TRX ID', bn: 'ট্রানজেকশন আইডি', default: true },
      { key: 'note', label: 'Note', bn: 'নোট', default: false },
    ],
    rows,
    summary: [
      { label: 'Members due', bn: 'দেয় সদস্য', value: stats.totalMembers, kind: 'number' },
      { label: 'Paid', bn: 'পরিশোধিত', value: stats.paidCount, kind: 'number', tone: 'good' },
      { label: 'Pending', bn: 'বাকি', value: stats.pendingCount, kind: 'number' },
      { label: 'Overdue', bn: 'মেয়াদোত্তীর্ণ', value: stats.overdueCount, kind: 'number', tone: 'bad' },
      { label: 'Expected', bn: 'প্রত্যাশিত', value: stats.expectedAmount, kind: 'money' },
      { label: 'Collected', bn: 'সংগৃহীত', value: stats.collectedAmount, kind: 'money', tone: 'brand' },
      { label: 'Late fees', bn: 'বিলম্ব ফি', value: stats.lateFeeAmount, kind: 'money' },
      { label: 'Outstanding', bn: 'বকেয়া', value: stats.outstandingAmount, kind: 'money', tone: 'bad' },
      { label: 'Collection rate', bn: 'আদায়ের হার', value: Number(stats.percentage) || 0, kind: 'percent' },
    ],
    periodLabel: p.fmtMonth(p.month), fileTag: p.month,
  };
}

// ---------------------------------------------------------------------------
async function fiscal(p: ReportParams): Promise<ReportData> {
  const fy = fiscalYearRange(p.month, p.fyStartMonth);
  const startKey = fy.start.slice(0, 7), endKey = fy.end.slice(0, 7);
  const [txs, paid, members] = await Promise.all([
    getTransactions(fy.start, fy.end, 'All'),
    getCollections('All', 'All'),
    allMembers(),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(startKey, i));
  const byMonth = new Map(months.map(m => [m, { month: m, collections: 0, sales: 0, expenses: 0, investments: 0, net: 0, cumulative: 0 }]));
  for (const t of txs) {
    const b = byMonth.get(String(t.date).slice(0, 7));
    if (!b) continue;
    if (t.type === 'collection') b.collections += Number(t.credit) || 0;
    else if (t.type === 'sale') b.sales += Number(t.credit) || 0;
    else if (t.type === 'expense') b.expenses += Number(t.debit) || 0;
    else if (t.type === 'investment') b.investments += Number(t.debit) || 0;
  }
  let cum = 0;
  const rows = months.map(m => {
    const b = byMonth.get(m)!;
    b.net = b.collections + b.sales - b.expenses - b.investments;
    cum += b.net;
    b.cumulative = cum;
    return b;
  });

  // Per-member contribution for dues months inside the fiscal year.
  const fyPaid = paid.records.filter(r => {
    const k = toMonthKey(r.payment_month);
    return k >= startKey && k <= endKey;
  });
  const lastDueKey = endKey < currentMonthKey() ? endKey : currentMonthKey();
  const memberRows = members.map(m => {
    const own = fyPaid.filter(r => r.member_id === m.id);
    const joinKey = String(m.join_date || '').slice(0, 7) || startKey;
    const from = joinKey > startKey ? joinKey : startKey;
    let monthsDue = 0;
    if (m.status === 'Active') for (let k = from; k <= lastDueKey; k = addMonths(k, 1)) monthsDue++;
    const unpaidMonths = Math.max(0, monthsDue - own.length);
    return {
      member_code: m.member_code, name: m.name, status: m.status, monthly_due: m.monthly_due,
      months_due: monthsDue, months_paid: own.length,
      contribution: sum(own, 'contribution_amount'), late_fee: sum(own, 'late_fee'), total: sum(own, 'total_amount'),
      arrears: unpaidMonths * (Number(m.monthly_due) || 0),
    };
  }).filter(r => r.months_paid > 0 || r.months_due > 0);

  const tot = (k: string) => sum(rows, k);
  return {
    columns: [
      { key: 'month', label: 'Month', bn: 'মাস', kind: 'month', default: true },
      { key: 'collections', label: 'Collections', bn: 'সংগ্রহ', kind: 'money', default: true, total: true },
      { key: 'sales', label: 'Investment sales', bn: 'বিনিয়োগ বিক্রয়', kind: 'money', default: true, total: true },
      { key: 'expenses', label: 'Expenses', bn: 'খরচ', kind: 'money', default: true, total: true },
      { key: 'investments', label: 'Investments', bn: 'বিনিয়োগ', kind: 'money', default: true, total: true },
      { key: 'net', label: 'Net cash flow', bn: 'নিট নগদ প্রবাহ', kind: 'money', default: true, total: true },
      { key: 'cumulative', label: 'Cumulative', bn: 'ক্রমযোজিত', kind: 'money', default: true },
    ],
    rows,
    extra: [{
      title: 'Member-wise contribution', bn: 'সদস্যভিত্তিক চাঁদা',
      columns: [
        { key: 'member_code', label: 'Member ID', bn: 'সদস্য আইডি' },
        { key: 'name', label: 'Member name', bn: 'সদস্যের নাম' },
        { key: 'status', label: 'Status', bn: 'অবস্থা', kind: 'status' },
        { key: 'monthly_due', label: 'Monthly due', bn: 'মাসিক চাঁদা', kind: 'money' },
        { key: 'months_due', label: 'Months due', bn: 'দেয় মাস', kind: 'number', total: true },
        { key: 'months_paid', label: 'Months paid', bn: 'পরিশোধিত মাস', kind: 'number', total: true },
        { key: 'contribution', label: 'Contribution', bn: 'চাঁদা', kind: 'money', total: true },
        { key: 'late_fee', label: 'Late fee', bn: 'বিলম্ব ফি', kind: 'money', total: true },
        { key: 'total', label: 'Total paid', bn: 'মোট পরিশোধ', kind: 'money', total: true },
        { key: 'arrears', label: 'Arrears', bn: 'বকেয়া', kind: 'money', total: true },
      ],
      rows: memberRows,
    }],
    summary: [
      { label: 'Collections', bn: 'সংগ্রহ', value: tot('collections'), kind: 'money', tone: 'good' },
      { label: 'Investment sales', bn: 'বিনিয়োগ বিক্রয়', value: tot('sales'), kind: 'money' },
      { label: 'Expenses', bn: 'খরচ', value: tot('expenses'), kind: 'money', tone: 'bad' },
      { label: 'New investments', bn: 'নতুন বিনিয়োগ', value: tot('investments'), kind: 'money' },
      { label: 'Net cash flow', bn: 'নিট নগদ প্রবাহ', value: tot('net'), kind: 'money', tone: 'brand' },
      { label: 'Member arrears', bn: 'সদস্য বকেয়া', value: sum(memberRows, 'arrears'), kind: 'money', tone: 'bad' },
    ],
    periodLabel: `${fy.label} (${p.fmtDate(fy.start)} – ${p.fmtDate(fy.end)})`,
    fileTag: fy.label.replace(/\s+/g, ''),
  };
}

// ---------------------------------------------------------------------------
async function member(p: ReportParams): Promise<ReportData> {
  if (!p.memberId) throw new Error('Select a member to view the statement.');
  const st = await getMemberStatement(p.memberId);
  const rows = [...st.rows].reverse().map(r => ({
    ...r,
    contribution_amount: r.contribution_amount || 0,
    late_fee: r.late_fee || 0,
    total_amount: r.total_amount || 0,
    payment_date: r.status === 'Paid' ? r.payment_date : null,
  }));
  const paidRows = rows.filter(r => r.status === 'Paid');
  const overdue = rows.filter(r => r.status === 'Overdue');
  const m = st.member;
  const opening = Number(m.opening_balance) || 0;
  return {
    columns: [
      { key: 'payment_month', label: 'Month', bn: 'মাস', kind: 'month', default: true },
      { key: 'due_date', label: 'Due date', bn: 'নির্ধারিত তারিখ', kind: 'date', default: false },
      { key: 'monthly_due', label: 'Due', bn: 'দেয়', kind: 'money', default: true, total: true },
      { key: 'payment_date', label: 'Paid on', bn: 'পরিশোধের তারিখ', kind: 'date', default: true },
      { key: 'contribution_amount', label: 'Contribution', bn: 'চাঁদা', kind: 'money', default: true, total: true },
      { key: 'late_fee', label: 'Late fee', bn: 'বিলম্ব ফি', kind: 'money', default: true, total: true },
      { key: 'total_amount', label: 'Total', bn: 'মোট', kind: 'money', default: true, total: true },
      { key: 'status', label: 'Status', bn: 'অবস্থা', kind: 'status', default: true },
      { key: 'payment_method', label: 'Method', bn: 'মাধ্যম', default: true },
      { key: 'trx_id', label: 'TRX ID', bn: 'ট্রানজেকশন আইডি', default: false },
      { key: 'note', label: 'Note', bn: 'নোট', default: false },
    ],
    rows,
    summary: [
      { label: 'Member', bn: 'সদস্য', value: `${m.member_code} · ${m.name}` },
      { label: 'Joined', bn: 'যোগদান', value: m.join_date, kind: 'date' },
      { label: 'Opening balance', bn: 'প্রারম্ভিক জমা', value: opening, kind: 'money' },
      { label: 'Months paid', bn: 'পরিশোধিত মাস', value: `${paidRows.length} / ${rows.length}` },
      { label: 'Contributions', bn: 'চাঁদা', value: sum(paidRows, 'contribution_amount'), kind: 'money', tone: 'good' },
      { label: 'Late fees', bn: 'বিলম্ব ফি', value: sum(paidRows, 'late_fee'), kind: 'money' },
      { label: 'Lifetime contributed', bn: 'মোট অবদান', value: opening + sum(paidRows, 'contribution_amount'), kind: 'money', tone: 'brand' },
      { label: `Arrears (${overdue.length} mo)`, bn: `বকেয়া (${overdue.length} মাস)`, value: sum(overdue, 'monthly_due'), kind: 'money', tone: 'bad' },
    ],
    periodLabel: `${m.member_code} · ${m.name}`,
    fileTag: m.member_code || String(m.id),
  };
}

// ---------------------------------------------------------------------------
async function defaulters(p: ReportParams): Promise<ReportData> {
  const ov = await getOverviewData(p.month);
  const rows = [...ov.arrears].sort((a, b) => b.amount - a.amount);
  return {
    columns: [
      { key: 'member_code', label: 'Member ID', bn: 'সদস্য আইডি', default: true },
      { key: 'name', label: 'Member name', bn: 'সদস্যের নাম', default: true },
      { key: 'phone', label: 'Phone', bn: 'ফোন', default: true },
      { key: 'monthly_due', label: 'Monthly due', bn: 'মাসিক চাঁদা', kind: 'money', default: true },
      { key: 'months', label: 'Unpaid months', bn: 'অপরিশোধিত মাস', kind: 'number', default: true, total: true },
      { key: 'amount', label: 'Arrears', bn: 'বকেয়া', kind: 'money', default: true, total: true },
    ],
    rows,
    summary: [
      { label: 'Members in arrears', bn: 'বকেয়াদার সদস্য', value: ov.kpis.membersInArrears ?? rows.length, kind: 'number', tone: 'bad' },
      { label: 'Total arrears', bn: 'মোট বকেয়া', value: ov.kpis.totalArrears ?? sum(rows, 'amount'), kind: 'money', tone: 'bad' },
      { label: 'Overdue this month', bn: 'এ মাসে মেয়াদোত্তীর্ণ', value: ov.kpis.overdue, kind: 'number' },
      { label: 'Outstanding this month', bn: 'এ মাসের বকেয়া', value: ov.kpis.outstanding, kind: 'money' },
    ],
    periodLabel: p.fmtMonth(p.month), fileTag: p.month,
  };
}

// ---------------------------------------------------------------------------
async function expenses(p: ReportParams): Promise<ReportData> {
  const rows = await getExpenses(p.filters.category || 'All', p.filters.status || 'All', p.start, p.end, '', 'oldest');
  const total = sum(rows, 'amount');
  const cats = new Map<string, { category: string; count: number; amount: number; share: number }>();
  for (const e of rows) {
    const c = cats.get(e.category) || { category: e.category, count: 0, amount: 0, share: 0 };
    c.count++; c.amount += Number(e.amount) || 0;
    cats.set(e.category, c);
  }
  const catRows = [...cats.values()].map(c => ({ ...c, share: total ? Math.round((c.amount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const needs = rows.filter(r => r.status === 'Needs receipt');
  return {
    columns: [
      { key: 'expense_date', label: 'Date', bn: 'তারিখ', kind: 'date', default: true },
      { key: 'title', label: 'Title', bn: 'শিরোনাম', default: true },
      { key: 'category', label: 'Category', bn: 'ক্যাটাগরি', default: true },
      { key: 'payee', label: 'Paid to', bn: 'প্রাপক', default: true },
      { key: 'receipt_ref', label: 'Receipt ref', bn: 'রসিদ নং', default: true },
      { key: 'status', label: 'Status', bn: 'অবস্থা', kind: 'status', default: true },
      { key: 'notes', label: 'Notes', bn: 'নোট', default: false },
      { key: 'amount', label: 'Amount', bn: 'পরিমাণ', kind: 'money', default: true, total: true },
    ],
    rows,
    extra: catRows.length ? [{
      title: 'Category subtotals', bn: 'ক্যাটাগরিভিত্তিক মোট',
      columns: [
        { key: 'category', label: 'Category', bn: 'ক্যাটাগরি' },
        { key: 'count', label: 'Entries', bn: 'এন্ট্রি', kind: 'number', total: true },
        { key: 'share', label: 'Share %', bn: 'অংশ %', kind: 'percent' },
        { key: 'amount', label: 'Amount', bn: 'পরিমাণ', kind: 'money', total: true },
      ],
      rows: catRows,
    }] : [],
    summary: [
      { label: 'Total expenses', bn: 'মোট খরচ', value: total, kind: 'money', tone: 'bad' },
      { label: 'Entries', bn: 'এন্ট্রি', value: rows.length, kind: 'number' },
      { label: 'Verified', bn: 'যাচাইকৃত', value: total - sum(needs, 'amount'), kind: 'money', tone: 'good' },
      { label: `Needs receipt (${needs.length})`, bn: `রসিদ প্রয়োজন (${needs.length})`, value: sum(needs, 'amount'), kind: 'money' },
      { label: 'Categories', bn: 'ক্যাটাগরি', value: catRows.length, kind: 'number' },
    ],
    periodLabel: rangeLabel(p), fileTag: rangeTag(p),
  };
}

// ---------------------------------------------------------------------------
async function investments(p: ReportParams): Promise<ReportData> {
  const list = await getInvestments('newest', p.filters.status || 'All');
  const rows = list.map(i => {
    const sold = i.status === 'Sold';
    const cost = Number(i.invested_amount) || 0;
    const value = sold ? Number(i.sold_amount) || 0 : Number(i.current_estimated_value) || 0;
    const gain = value - cost;
    return {
      ...i,
      value,
      realized_gain: sold ? gain : 0,
      unrealized_gain: sold ? 0 : gain,
      gain_pct: cost ? Math.round((gain / cost) * 1000) / 10 : 0,
    };
  });
  const active = rows.filter(r => r.status !== 'Sold');
  const sold = rows.filter(r => r.status === 'Sold');
  return {
    columns: [
      { key: 'name', label: 'Asset', bn: 'সম্পদ', default: true },
      { key: 'sector', label: 'Sector', bn: 'খাত', default: true },
      { key: 'purchase_date', label: 'Purchased', bn: 'ক্রয়ের তারিখ', kind: 'date', default: true },
      { key: 'status', label: 'Status', bn: 'অবস্থা', kind: 'status', default: true },
      { key: 'invested_amount', label: 'Cost', bn: 'ক্রয়মূল্য', kind: 'money', default: true, total: true },
      { key: 'value', label: 'Value / Sold for', bn: 'বর্তমান / বিক্রয় মূল্য', kind: 'money', default: true, total: true },
      { key: 'sold_date', label: 'Sold on', bn: 'বিক্রয়ের তারিখ', kind: 'date', default: false },
      { key: 'realized_gain', label: 'Realized gain', bn: 'অর্জিত লাভ', kind: 'money', default: true, total: true },
      { key: 'unrealized_gain', label: 'Unrealized gain', bn: 'অনর্জিত লাভ', kind: 'money', default: true, total: true },
      { key: 'gain_pct', label: 'Gain %', bn: 'লাভ %', kind: 'percent', default: true },
      { key: 'review_date', label: 'Review date', bn: 'পর্যালোচনার তারিখ', kind: 'date', default: false },
      { key: 'location_details', label: 'Location', bn: 'অবস্থান', default: false },
      { key: 'notes', label: 'Notes', bn: 'নোট', default: false },
    ],
    rows,
    summary: [
      { label: `Active assets (${active.length})`, bn: `সক্রিয় সম্পদ (${active.length})`, value: sum(active, 'invested_amount'), kind: 'money' },
      { label: 'Current value', bn: 'বর্তমান মূল্য', value: sum(active, 'value'), kind: 'money', tone: 'brand' },
      { label: 'Unrealized gain', bn: 'অনর্জিত লাভ', value: sum(active, 'unrealized_gain'), kind: 'money', tone: sum(active, 'unrealized_gain') >= 0 ? 'good' : 'bad' },
      { label: `Sold (${sold.length})`, bn: `বিক্রিত (${sold.length})`, value: sum(sold, 'value'), kind: 'money' },
      { label: 'Realized gain', bn: 'অর্জিত লাভ', value: sum(sold, 'realized_gain'), kind: 'money', tone: sum(sold, 'realized_gain') >= 0 ? 'good' : 'bad' },
    ],
    periodLabel: p.fmtDate(todayISO()), fileTag: todayISO(),
  };
}

// ---------------------------------------------------------------------------
async function audit(p: ReportParams): Promise<ReportData> {
  const q = (p.filters.search || '').trim().toLowerCase();
  const rows = (await getAuditLog(1000)).filter(a => {
    const d = String(a.at || '').slice(0, 10);
    if (d < p.start || d > p.end) return false;
    if (!q) return true;
    return [a.user_name, a.action, a.entity, a.details].some(v => String(v || '').toLowerCase().includes(q));
  });
  return {
    columns: [
      { key: 'at', label: 'Timestamp', bn: 'সময়', kind: 'datetime', default: true },
      { key: 'user_name', label: 'User', bn: 'ব্যবহারকারী', default: true },
      { key: 'action', label: 'Action', bn: 'কার্যক্রম', default: true },
      { key: 'entity', label: 'Entity', bn: 'বিষয়', default: true },
      { key: 'entity_id', label: 'Record ID', bn: 'রেকর্ড আইডি', default: false },
      { key: 'details', label: 'Details', bn: 'বিস্তারিত', default: true },
    ],
    rows,
    summary: [
      { label: 'Entries', bn: 'এন্ট্রি', value: rows.length, kind: 'number', tone: 'brand' },
      { label: 'Users', bn: 'ব্যবহারকারী', value: new Set(rows.map(r => r.user_name)).size, kind: 'number' },
      { label: 'Entities', bn: 'বিষয়', value: new Set(rows.map(r => r.entity)).size, kind: 'number' },
    ],
    periodLabel: rangeLabel(p), fileTag: rangeTag(p),
  };
}

export const BUILDERS: Record<ReportId, (p: ReportParams) => Promise<ReportData>> = {
  cashbook, collections, fiscal, member, defaulters, expenses, investments, audit,
};
