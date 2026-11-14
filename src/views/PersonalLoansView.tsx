import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, RotateCcw, Landmark, Wallet, Percent, AlertTriangle, Users, CalendarClock, ShieldCheck, Ban, CheckCircle2,
  SlidersHorizontal, HandCoins, Eye, Banknote, FileSignature, FileCheck2, Clock,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getLoans, getLoanSummary, getLoanApplications, getAllMembersLite, exportTable } from '../services/db';
import type { Loan, LoanSummary, LoanApplication, LoanApplicationDetail } from '../types';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { DownloadMenu } from '../components/common/DownloadMenu';
import { cell, type ExportDoc } from '../utils/exportDoc';
import { serial } from '../utils/i18n';
import { todayISO } from '../utils/date';
import { LoanFormModal } from '../components/loans/LoanFormModal';
import { LoanDetailModal } from '../components/loans/LoanDetailModal';
import { LoanApplicationModal } from '../components/loans/LoanApplicationModal';
import { LoanRepaymentModal } from '../components/loans/LoanRepaymentModal';
import { LoanPolicyModal } from '../components/loans/LoanPolicyModal';
import { LoanStatusBadge, ProgressBar, useMoney, useNum, useRateText, useMethodText } from '../components/loans/loanUi';

const EMPTY: LoanSummary = {
  loans: 0, running: 0, overdueLoans: 0, closed: 0, writtenOff: 0, borrowers: 0, totalLent: 0, outstanding: 0, principalRepaid: 0, interestEarned: 0, penaltyEarned: 0,
  drafts: 0, draftsAmount: 0, interestExpected: 0, totalCollected: 0, overdueAmount: 0, overduePrincipal: 0, dueNext30: 0, writtenOffAmount: 0, onTrackPct: 100, cashInHand: 0, fundBalance: 0, lentPctOfFund: 0, avgRate: 0,
};

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Personal loans: money the fund lends to its members, repaid monthly with (optional) interest. */
export const PersonalLoansView: React.FC = () => {
  const { t, formatDate, showToast, refreshKey, isAdmin, session, settings, language, bnName, memberFilterStatus, setMemberFilterStatus } = useApp();
  const n = useNum();
  const formatCurrency = useMoney();
  const rateText = useRateText();
  const mt = useMethodText();
  const readOnly = session?.user.role === 'Auditor';

  const [loans, setLoans] = useState<Loan[]>([]);
  const [sum, setSum] = useState<LoanSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Array<{ id: number; member_code: string; name: string; name_bn?: string | null }>>([]);

  const [sortBy, setSortBy] = useState('newest');
  const [statusFilter, setStatusFilter] = useState('All');
  const [memberFilter, setMemberFilter] = useState<number | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim(), 250);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<LoanApplication[]>([]);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [editApp, setEditApp] = useState<LoanApplicationDetail | null>(null);
  const [payLoan, setPayLoan] = useState<Loan | null>(null);

  // arriving from the "loans overdue" notification
  useEffect(() => {
    if (memberFilterStatus === 'Overdue' || memberFilterStatus === 'Draft') { setStatusFilter(memberFilterStatus); setMemberFilterStatus('All'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { getAllMembersLite().then(l => setMembers(l as any)).catch(() => undefined); }, [refreshKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const mid = memberFilter === '' ? undefined : Number(memberFilter);
    Promise.all([getLoans(sortBy, statusFilter, startDate || undefined, endDate || undefined, search, mid), getLoanSummary(), getLoanApplications(search, mid, startDate || undefined, endDate || undefined)])
      .then(([l, s, dr]) => { if (alive) { setLoans(l); setSum(s); setDrafts(dr); } })
      .catch((e: any) => alive && showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, statusFilter, startDate, endDate, search, memberFilter, refreshKey]);

  const hasFilters = !!(searchInput || statusFilter !== 'All' || memberFilter !== '' || startDate || endDate || sortBy !== 'newest');
  const isFreshEmpty = !loading && sum.loans === 0 && sum.drafts === 0;
  const shownDrafts = statusFilter === 'All' || statusFilter === 'Draft' ? drafts : [];
  const resetFilters = () => { setSearchInput(''); setStatusFilter('All'); setMemberFilter(''); setStartDate(''); setEndDate(''); setSortBy('newest'); };

  const statusOptions = useMemo<SelectOption[]>(() => [
    { value: 'All', label: t('finance.all_statuses', 'All statuses') },
    { value: 'Draft', label: t('loan.s_draft', 'Draft') },
    { value: 'Open', label: t('loan.f_open', 'Open (running + overdue)') },
    { value: 'Overdue', label: t('loan.s_overdue', 'Overdue') },
    { value: 'Running', label: t('loan.s_running', 'Running') },
    { value: 'Closed', label: t('loan.s_closed', 'Repaid') },
    { value: 'Written off', label: t('loan.s_written_off', 'Written off') },
  ], [t]);
  const sortOptions = useMemo<SelectOption[]>(() => [
    { value: 'newest', label: t('finance.sort_newest', 'Newest first') },
    { value: 'oldest', label: t('finance.sort_oldest', 'Oldest first') },
    { value: 'amount_high', label: t('loan.sort_amount_high', 'Amount: high to low') },
    { value: 'amount_low', label: t('loan.sort_amount_low', 'Amount: low to high') },
    { value: 'outstanding_high', label: t('loan.sort_owed_high', 'Owed: high to low') },
    { value: 'overdue_high', label: t('loan.sort_overdue', 'Most overdue first') },
    { value: 'due_soon', label: t('loan.sort_due_soon', 'Next due: soonest') },
    { value: 'progress_high', label: t('loan.sort_progress', 'Most repaid first') },
    { value: 'name_asc', label: t('finance.sort_name_asc', 'Name: A to Z') },
  ], [t]);
  const memberOptions = useMemo<SelectOption[]>(
    () => members.map(m => ({ value: m.id, label: bnName(m.name, m.name_bn), subLabel: m.member_code })),
    [members, bnName],
  );

  // numbers for the borrower strip when one member is picked
  const picked = useMemo(() => {
    if (memberFilter === '') return null;
    const m = members.find(x => x.id === Number(memberFilter));
    const sumOf = (f: (l: Loan) => number) => loans.reduce((a, l) => a + f(l), 0);
    return {
      name: m ? bnName(m.name, m.name_bn) : '', code: m?.member_code || '',
      count: loans.length, borrowed: sumOf(l => l.principal), owed: sumOf(l => l.outstanding_principal), repaid: sumOf(l => l.total_paid),
      interest: sumOf(l => l.paid_interest), overdue: sumOf(l => l.overdue_amount), late: loans.filter(l => l.derived_status === 'Overdue').length,
    };
  }, [memberFilter, members, loans, bnName]);

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: React.ReactNode) => (
    <div className={`card-base p-5 border-l-4 ${accent} min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className={`text-2xl font-black tracking-tight mt-3 truncate ${valueCls}`} title={value}>{value}</div>
      <div className="text-[11px] font-semibold mt-1 text-slate-500 dark:text-slate-400 truncate">{sub}</div>
    </div>
  );

  // lent money by state (adds up to "total lent")
  const segments = useMemo(() => {
    const total = sum.totalLent;
    const parts = [
      { key: 'repaid', label: t('loan.seg_repaid', 'Repaid'), value: sum.principalRepaid, cls: 'bg-emerald-600' },
      { key: 'running', label: t('loan.seg_running', 'Owed, on time'), value: Math.max(0, sum.outstanding - sum.overduePrincipal), cls: 'bg-sky-500' },
      { key: 'overdue', label: t('loan.seg_overdue', 'Owed, overdue'), value: sum.overduePrincipal, cls: 'bg-rose-500' },
      { key: 'wo', label: t('loan.seg_wo', 'Written off'), value: sum.writtenOffAmount, cls: 'bg-amber-500' },
    ];
    return parts.map(p => ({ ...p, pct: total > 0 ? (p.value / total) * 100 : 0 }));
  }, [sum, t]);

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    if (loans.length === 0) { showToast(t('loan.nothing_export', 'There are no loans to export.'), 'info'); return; }
    try {
      const m = (v: number) => cell(v, formatCurrency(v));
      const status = (l: Loan) => l.derived_status === 'Running' ? t('loan.s_running', 'Running') : l.derived_status === 'Overdue' ? t('loan.s_overdue', 'Overdue') : l.derived_status === 'Closed' ? t('loan.s_closed', 'Repaid') : t('loan.s_written_off', 'Written off');
      const doc: ExportDoc = {
        orgName: settings?.organization_name || 'Bondhu Fund', title: t('loan.title', 'Personal loans'), lang: language === 'bn' ? 'bn' : 'en', landscape: true, generatedOn: todayISO(),
        summary: [
          [t('loan.kpi_lent', 'Total lent'), formatCurrency(loans.reduce((a, l) => a + l.principal, 0))],
          [t('loan.kpi_owed', 'Principal owed'), formatCurrency(loans.reduce((a, l) => a + l.outstanding_principal, 0))],
          [t('loan.kpi_interest', 'Interest earned'), formatCurrency(loans.reduce((a, l) => a + l.paid_interest, 0))],
          [t('finance.records', 'records'), String(loans.length)],
        ],
        sections: [{
          columns: [
            { header: t('loan.loan_no', 'Loan') }, { header: t('common.member', 'Member') }, { header: t('loan.date', 'Loan date'), kind: 'date' }, { header: t('loan.amount', 'Loan amount'), kind: 'money' },
            { header: t('loan.period_short', 'Period') }, { header: t('loan.rate_short', 'Rate') }, { header: t('loan.monthly', 'Monthly installment'), kind: 'money' },
            { header: t('loan.repaid_so_far', 'Repaid so far'), kind: 'money' }, { header: t('loan.interest_paid', 'Interest paid'), kind: 'money' }, { header: t('loan.outstanding', 'Principal owed'), kind: 'money' },
            { header: t('loan.overdue_short', 'Overdue'), kind: 'money' }, { header: t('loan.next_due', 'Next installment'), kind: 'date' }, { header: t('common.status', 'Status') }, { header: t('loan.guarantor', 'Guarantor') },
          ],
          rows: loans.map(l => [
            cell(l.loan_no), cell(`${bnName(l.member_name, l.member_name_bn)} (${l.member_code})`), cell(l.disbursed_date, formatDate(l.disbursed_date)), m(l.principal),
            cell(`${l.term_months} ${t('loan.months_short', 'months')}`), cell(l.method === 'free' ? mt.label('free') : `${l.annual_rate}% ${mt.label(l.method)}`), m(l.installment),
            m(l.total_paid), m(l.paid_interest), m(l.outstanding_principal), m(l.overdue_amount), cell(l.next_due_date, l.next_due_date ? formatDate(l.next_due_date) : ''), cell(status(l)), cell(l.guarantor || ''),
          ]),
        }],
      };
      const res = await exportTable(doc, format, `Bondhu_Fund_Personal_Loans_${todayISO()}`);
      if (!res.canceled) showToast(t('finance.export_saved', 'Export saved.'));
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const th = 'py-3 px-3';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      {/* header */}
      <section className="card-base px-5 py-4 lg:px-6">
       <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-x-8 gap-y-3 items-center">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">{t('loan.title', 'Personal loans')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('loan.subtitle', 'Money the fund lends to its members, repaid month by month. Installments, interest and balances are calculated automatically.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {isAdmin && (
            <button type="button" onClick={() => setPolicyOpen(true)} className="btn btn-outline">
              <SlidersHorizontal size={14} className="text-slate-500 dark:text-slate-400" /><span>{t('loan.policy', 'Loan policy')}</span>
            </button>
          )}
          <DownloadMenu label={t('common.export', 'Export')} title={t('common.export', 'Export')} onPick={handleExport} />
          {!readOnly && (
            <button type="button" onClick={() => setFormOpen(true)} className="btn btn-primary">
              <Plus size={16} strokeWidth={2.5} /><span>{t('loan.add', 'Add personal loan')}</span>
            </button>
          )}
        </div>
       </div>
      </section>

      {/* drafts waiting for the signed paper */}
      {sum.drafts > 0 && statusFilter !== 'Draft' && (
        <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 border border-amber-300 dark:border-amber-800"><FileSignature size={18} /></div>
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              {t('loan.draft_alert', '{n} loan draft(s), {amt} in total, are waiting for the signed consent paper. No money has been disbursed.').replace('{n}', n(sum.drafts)).replace('{amt}', formatCurrency(sum.draftsAmount))}
            </p>
          </div>
          <button type="button" onClick={() => setStatusFilter('Draft')} className="btn btn-outline btn-sm">{t('loan.show_drafts', 'Show drafts')}</button>
        </div>
      )}

      {/* overdue alert */}
      {sum.overdueLoans > 0 && (
        <div className="bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0 border border-rose-300 dark:border-rose-800"><AlertTriangle size={18} /></div>
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              {t('loan.alert', '{n} loan(s) have overdue installments, {amt} in total.').replace('{n}', n(sum.overdueLoans)).replace('{amt}', formatCurrency(sum.overdueAmount))}
            </p>
          </div>
          {statusFilter !== 'Overdue' && <button type="button" onClick={() => setStatusFilter('Overdue')} className="btn btn-outline btn-sm">{t('loan.show_overdue', 'Show overdue loans')}</button>}
        </div>
      )}

      {/* summary cards */}
      <div className="kpi-zoom grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi('border-l-emerald-500', t('loan.kpi_lent', 'Total lent'), <Landmark size={16} />, 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(sum.totalLent), 'text-slate-900 dark:text-white', t('loan.kpi_lent_sub', '{n} loans to {b} borrowers now').replace('{n}', n(sum.loans)).replace('{b}', n(sum.borrowers)))}
        {kpi('border-l-amber-500', t('loan.kpi_owed', 'Principal owed'), <Wallet size={16} />, 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          formatCurrency(sum.outstanding), 'text-amber-700 dark:text-amber-400', t('loan.kpi_owed_sub', '{p}% of the fund is lent out').replace('{p}', n(+sum.lentPctOfFund.toFixed(1))))}
        {kpi('border-l-blue-500', t('loan.kpi_interest', 'Interest earned'), <Percent size={16} />, 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          formatCurrency(sum.interestEarned), 'text-emerald-700 dark:text-emerald-400', t('loan.kpi_interest_sub', '{amt} more expected').replace('{amt}', formatCurrency(sum.interestExpected)))}
        {kpi('border-l-rose-500', t('loan.kpi_overdue', 'Overdue now'), <AlertTriangle size={16} />, 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
          formatCurrency(sum.overdueAmount), sum.overdueAmount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white', t('loan.kpi_overdue_sub', 'across {n} loans').replace('{n}', n(sum.overdueLoans)))}
      </div>
      <div className="kpi-zoom grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi('border-l-sky-500', t('loan.kpi_running', 'Running loans'), <Users size={16} />, 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400',
          n(sum.running + sum.overdueLoans), 'text-slate-900 dark:text-white', t('loan.kpi_running_sub', '{c} repaid · {w} written off').replace('{c}', n(sum.closed)).replace('{w}', n(sum.writtenOff)) + (sum.drafts > 0 ? ' · ' + t('loan.kpi_drafts', '{d} draft(s)').replace('{d}', n(sum.drafts)) : ''))}
        {kpi('border-l-purple-500', t('loan.kpi_due30', 'Due in 30 days'), <CalendarClock size={16} />, 'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(sum.dueNext30), 'text-slate-900 dark:text-white', t('loan.kpi_due30_sub', 'installments coming up'))}
        {kpi('border-l-emerald-500', t('loan.kpi_ontrack', 'On-time rate'), <ShieldCheck size={16} />, 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          `${n(+sum.onTrackPct.toFixed(1))}%`, sum.onTrackPct >= 90 ? 'text-emerald-700 dark:text-emerald-400' : sum.onTrackPct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400',
          t('loan.kpi_ontrack_sub', 'of everything due so far is paid'))}
        {kpi('border-l-slate-400', t('loan.kpi_cash', 'Cash available to lend'), <Banknote size={16} />, 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
          formatCurrency(sum.cashInHand), sum.cashInHand < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white',
          sum.avgRate > 0 ? t('loan.kpi_cash_sub', 'average rate on loans: {r}%').replace('{r}', n(sum.avgRate)) : t('loan.kpi_cash_sub0', 'cash in hand today'))}
      </div>

      {/* where the lent money stands */}
      {sum.totalLent > 0 && (
        <div className="card-base p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('loan.portfolio', 'Where the lent money stands')}</h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">{t('loan.portfolio_total', 'Total lent {amt}').replace('{amt}', formatCurrency(sum.totalLent))}</span>
          </div>
          <div className="w-full h-3.5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800 gap-0.5 p-0.5" role="img"
            aria-label={segments.map(s => `${s.label} ${s.pct.toFixed(0)}%`).join(', ')}>
            {segments.filter(s => s.value > 0).map(s => <div key={s.key} className={`h-full rounded-full ${s.cls}`} style={{ width: `${s.pct}%` }} title={`${s.label}: ${formatCurrency(s.value)}`} />)}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {segments.map(s => (
              <div key={s.key} className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.cls}`} />
                <div className="min-w-0"><div className="font-bold text-slate-800 dark:text-slate-200 truncate">{s.label}</div><div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{formatCurrency(s.value)} · {n(+s.pct.toFixed(0))}%</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* table */}
      <div className="card-base overflow-hidden">
        <div className="p-5 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('loan.history_title', 'Loan history')}</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{n(loans.length + shownDrafts.length)} {t('finance.records', 'records')}</span>
        </div>

        <div className="tbl-filter p-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
          <div className="relative filter-search">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder={t('loan.search_ph', 'Search member, loan no., purpose…')} aria-label={t('common.search', 'Search')}
              value={searchInput} onChange={e => setSearchInput(e.target.value)} className="form-input pl-8 py-1.5 text-xs" />
          </div>
          <div className="filter-select">
            <SearchableSelect size="sm" options={memberOptions} value={memberFilter === '' ? null : memberFilter} onChange={v => setMemberFilter(v == null || v === '' ? '' : Number(v))}
              clearable={memberFilter !== ''} placeholder={t('loan.all_members', 'All members')} searchPlaceholder={t('common.search', 'Search')} />
          </div>
          <div className="filter-select">
            <SearchableSelect size="sm" options={statusOptions} value={statusFilter} onChange={v => setStatusFilter(v == null || v === '' ? 'All' : String(v))}
              clearable={statusFilter !== 'All'} placeholder={t('common.status', 'Status')} />
          </div>
          <div className="filter-select">
            <SearchableSelect size="sm" options={sortOptions} value={sortBy} onChange={v => setSortBy(v == null || v === '' ? 'newest' : String(v))} placeholder={t('common.sort', 'Sort')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('loan.given_from', 'Given from')}</span>
            <div className="min-w-[150px]"><DatePicker size="sm" clearable value={startDate} onChange={setStartDate} max={endDate || undefined} placeholder={t('finance.start_date', 'Start date')} /></div>
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.to', 'To')}</span>
            <div className="min-w-[150px]"><DatePicker size="sm" clearable value={endDate} onChange={setEndDate} min={startDate || undefined} placeholder={t('finance.end_date', 'End date')} /></div>
          </div>
          {hasFilters && (
            <button type="button" onClick={resetFilters} title={t('finance.reset_filters', 'Reset filters')} className="btn btn-outline btn-sm">
              <RotateCcw size={12} /><span>{t('finance.reset', 'Reset')}</span>
            </button>
          )}
        </div>

        {/* one borrower's history at a glance */}
        {picked && (
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-950/20 flex flex-wrap items-center gap-x-8 gap-y-2 text-xs">
            <div className="font-black text-slate-900 dark:text-white">{picked.name} <span className="font-semibold text-slate-500 dark:text-slate-400">· {picked.code}</span></div>
            {[
              [t('loan.b_loans', 'Loans taken'), n(picked.count)], [t('loan.b_borrowed', 'Total borrowed'), formatCurrency(picked.borrowed)], [t('loan.b_repaid', 'Repaid'), formatCurrency(picked.repaid)],
              [t('loan.outstanding', 'Principal owed'), formatCurrency(picked.owed)], [t('loan.b_interest', 'Interest paid'), formatCurrency(picked.interest)],
            ].map(([k, v]) => <div key={k as string}><span className="text-slate-500 dark:text-slate-400 font-semibold">{k}: </span><span className="font-black tabular-nums text-slate-900 dark:text-white">{v}</span></div>)}
            {picked.late > 0 && <div className="font-black text-rose-600 dark:text-rose-400">{t('loan.b_late', '{amt} overdue').replace('{amt}', formatCurrency(picked.overdue))}</div>}
          </div>
        )}

        {isFreshEmpty ? (
          <div className="py-14 flex flex-col items-center text-center gap-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"><HandCoins size={22} /></div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('loan.empty_title', 'No personal loans yet')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{t('loan.empty_body', 'Give a member a loan for 6, 12, 24 months or any period. The installment and every balance are worked out for you.')}</p>
            </div>
            {!readOnly && <button type="button" onClick={() => setFormOpen(true)} className="btn btn-primary">{t('loan.add', 'Add personal loan')}</button>}
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[1240px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className={`${th} text-center sticky left-0 z-20 bg-slate-50 dark:bg-[#111e24]`} style={{ width: '3.25rem', minWidth: '3.25rem', maxWidth: '3.25rem' }}>{t('common.no', 'No.')}</th>
                  <th className={`${th} sticky z-20 bg-slate-50 dark:bg-[#111e24] sticky-col-edge`} style={{ left: '3.25rem', minWidth: '14rem' }}>{t('common.member', 'Member')}</th>
                  <th className={th}>{t('loan.loan_no', 'Loan')}</th>
                  <th className={th}>{t('loan.date', 'Loan date')}</th>
                  <th className={`${th} text-right`}>{t('loan.amount', 'Loan amount')}</th>
                  <th className={th}>{t('loan.terms', 'Terms')}</th>
                  <th className={`${th} text-right`}>{t('loan.monthly', 'Monthly installment')}</th>
                  <th className={th} style={{ minWidth: '9rem' }}>{t('loan.repaid_so_far', 'Repaid so far')}</th>
                  <th className={`${th} text-right`}>{t('loan.outstanding', 'Principal owed')}</th>
                  <th className={th}>{t('loan.next_due', 'Next installment')}</th>
                  <th className={th}>{t('common.status', 'Status')}</th>
                  <th className={`${th} text-right`}>{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {loading && loans.length + shownDrafts.length === 0 ? (
                  <tr><td colSpan={12} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading…')}</td></tr>
                ) : loans.length + shownDrafts.length === 0 ? (
                  <tr><td colSpan={12} className="py-8 text-center text-slate-400">{t('loan.no_match', 'No loans match your filters.')}</td></tr>
                ) : [...shownDrafts.map((a, i) => {
                  const ready = a.has_consent && a.consent_file_exists;
                  return (
                    <tr key={`d${a.id}`} onClick={() => setDraftId(a.id)} className="group bg-amber-50/40 dark:bg-amber-950/10 hover:bg-[#f0f7f3] dark:hover:bg-[#1a2b34] transition-colors cursor-pointer">
                      <td className="py-3 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums sticky left-0 z-10 bg-amber-50 dark:bg-[#1c2420] group-hover:bg-[#f0f7f3] dark:group-hover:bg-[#1a2b34]" style={{ width: '3.25rem', minWidth: '3.25rem', maxWidth: '3.25rem' }}>{serial(i + 1)}</td>
                      <td className="py-3 px-3 sticky z-10 sticky-col-edge bg-amber-50 dark:bg-[#1c2420] group-hover:bg-[#f0f7f3] dark:group-hover:bg-[#1a2b34]" style={{ left: '3.25rem', minWidth: '14rem' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{a.avatar_initials || '?'}</div>
                          <div className="min-w-0"><span className="font-bold text-slate-900 dark:text-white block truncate">{bnName(a.member_name, a.member_name_bn)}</span><span className="text-[10px] text-slate-400 block">{a.member_code}</span></div>
                        </div>
                      </td>
                      <td className="py-3 px-3"><span className="font-bold text-slate-900 dark:text-white block">{a.app_no}</span>{a.purpose && <span className="text-[10px] text-slate-400 block truncate max-w-[150px]" title={a.purpose}>{a.purpose}</span>}</td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(a.disbursed_date)}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap tabular-nums">{formatCurrency(a.principal)}</td>
                      <td className="py-3 px-3 whitespace-nowrap"><span className="font-bold block">{n(a.term_months)} {t('loan.months_short', 'months')}</span><span className="text-[10px] text-slate-400 block">{rateText(a.method, a.annual_rate)}</span></td>
                      <td className="py-3 px-3 text-right whitespace-nowrap tabular-nums font-bold">{formatCurrency(a.installment)}</td>
                      <td className="py-3 px-3" colSpan={2}>
                        {ready
                          ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400"><FileCheck2 size={13} />{t('loan.row_ready', 'Signed paper uploaded — ready to disburse')}</span>
                          : <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400"><Clock size={13} />{t('loan.row_waiting', 'Waiting for the signed paper')}{a.age_days > 0 ? ` · ${t('loan.row_days', '{d} days').replace('{d}', n(a.age_days))}` : ''}</span>}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDate(a.first_due_date)}</td>
                      <td className="py-3 px-3"><span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800">{t('loan.s_draft', 'Draft')}</span></td>
                      <td className="py-3 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1"><button type="button" onClick={() => setDraftId(a.id)} className="btn btn-green-outline btn-sm"><FileSignature size={12} /><span>{t('loan.open_draft', 'Open')}</span></button></div>
                      </td>
                    </tr>
                  );
                }), ...loans.map((l, i) => {
                  const open = l.status === 'Active';
                  const late = l.derived_status === 'Overdue';
                  return (
                    <tr key={l.id} onClick={() => setDetailId(l.id)} className="group hover:bg-[#f0f7f3] dark:hover:bg-[#1a2b34] transition-colors cursor-pointer">
                      <td className="py-3 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums sticky left-0 z-10 bg-white dark:bg-[#142026] group-hover:bg-[#f0f7f3] dark:group-hover:bg-[#1a2b34]" style={{ width: '3.25rem', minWidth: '3.25rem', maxWidth: '3.25rem' }}>{serial(shownDrafts.length + i + 1)}</td>
                      <td className="py-3 px-3 sticky z-10 sticky-col-edge bg-white dark:bg-[#142026] group-hover:bg-[#f0f7f3] dark:group-hover:bg-[#1a2b34]" style={{ left: '3.25rem', minWidth: '14rem' }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-800 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{l.avatar_initials || '?'}</div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-white block truncate">{bnName(l.member_name, l.member_name_bn)}</span>
                            <span className="text-[10px] text-slate-400 block">{l.member_code}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3"><span className="font-bold text-slate-900 dark:text-white block">{l.loan_no}</span>{l.purpose && <span className="text-[10px] text-slate-400 block truncate max-w-[150px]" title={l.purpose}>{l.purpose}</span>}</td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(l.disbursed_date)}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap tabular-nums">{formatCurrency(l.principal)}</td>
                      <td className="py-3 px-3 whitespace-nowrap"><span className="font-bold block">{n(l.term_months)} {t('loan.months_short', 'months')}</span><span className="text-[10px] text-slate-400 block">{rateText(l.method, l.annual_rate)}</span></td>
                      <td className="py-3 px-3 text-right whitespace-nowrap tabular-nums font-bold">{formatCurrency(l.installment)}</td>
                      <td className="py-3 px-3">
                        <div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{formatCurrency(l.total_paid)}</div>
                        <ProgressBar pct={l.progress_pct} tone={late ? 'rose' : l.status === 'Written off' ? 'amber' : 'green'} className="mt-1.5 max-w-[8rem]" />
                        <div className="text-[10px] text-slate-400 mt-0.5">{n(l.installments_paid)}/{n(l.installments_total)} {t('loan.installments_word', 'installments')}</div>
                      </td>
                      <td className={`py-3 px-3 text-right font-black whitespace-nowrap tabular-nums ${l.outstanding_principal > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>{l.outstanding_principal > 0 ? formatCurrency(l.outstanding_principal) : '—'}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {open ? (
                          <>
                            <span className={`font-bold block ${late ? 'text-rose-600 dark:text-rose-400' : ''}`}>{late ? formatCurrency(l.overdue_amount) : formatCurrency(l.next_due_amount)}</span>
                            <span className={`text-[10px] block ${late ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-400'}`}>
                              {late ? t('loan.days_late', '{d} days late').replace('{d}', n(l.days_overdue)) : formatDate(l.next_due_date)}
                            </span>
                          </>
                        ) : l.status === 'Closed' ? (
                          <span className="text-[11px] text-slate-400 flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-600" />{formatDate(l.closed_date)}</span>
                        ) : (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1"><Ban size={12} />{formatDate(l.written_off_date)}</span>
                        )}
                      </td>
                      <td className="py-3 px-3"><LoanStatusBadge status={l.derived_status} /></td>
                      <td className="py-3 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {open && !readOnly && (
                            <button type="button" onClick={() => setPayLoan(l)} className="btn btn-green-outline btn-sm" title={t('loan.record_repayment', 'Record repayment')}>
                              <HandCoins size={12} /><span>{t('loan.pay', 'Pay')}</span>
                            </button>
                          )}
                          <button type="button" onClick={() => setDetailId(l.id)} className="btn btn-outline btn-sm btn-icon" title={t('common.view', 'View')} aria-label={t('common.view', 'View')}><Eye size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })]}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LoanFormModal
        open={formOpen || !!editApp} application={editApp} presetMemberId={memberFilter === '' ? null : Number(memberFilter)}
        onClose={() => { const back = editApp?.application.id ?? null; setFormOpen(false); setEditApp(null); if (back) setDraftId(back); }}
        onSaved={(id, kind) => { setFormOpen(false); setEditApp(null); if (kind === 'draft') setDraftId(id); else setDetailId(id); }} />
      <LoanApplicationModal applicationId={draftId} onClose={() => setDraftId(null)} onChanged={() => undefined}
        onEdit={d => { setDraftId(null); setEditApp(d); }} onDisbursed={id => { setDraftId(null); setDetailId(id); }} />
      <LoanDetailModal loanId={detailId} onClose={() => setDetailId(null)} onOpenLoan={id => setDetailId(id)} onChanged={() => undefined} />
      <LoanRepaymentModal loan={payLoan} kind="Installment" onClose={() => setPayLoan(null)} onDone={() => setPayLoan(null)} />
      <LoanPolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  );
};
