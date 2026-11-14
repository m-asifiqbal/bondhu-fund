import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gavel, CalendarClock, ShieldCheck, AlertTriangle, Scale, Users, Search, RotateCcw, Hourglass, HandCoins, Info, CheckCircle2, Plus, Minus, Equal } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DownloadMenu } from '../components/common/DownloadMenu';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { cell, type ExportDoc } from '../utils/exportDoc';
import { todayISO } from '../utils/date';
import { serial } from '../utils/i18n';
import { getFineRegister, getAllMembersLite, exportTable } from '../services/db';
import type { FineRegister, FineRow } from '../types';

type Tab = 'register' | 'month' | 'member' | 'nofine' | 'overdue';

/**
 * Fines: every late fee (on contributions) and every late penalty (on loan installments) the fund has collected, in one place:
 * who paid, for which month, how late, plus the proof of where the money sits (the fund's own reserve) and what has been missed.
 */
export const FinesView: React.FC = () => {
  const { t, formatCurrency, formatDate, formatMonth, settings, language, toBanglaDigits, bnName, showToast, refreshKey, setActiveTab } = useApp();
  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const [data, setData] = useState<FineRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('register');
  const [members, setMembers] = useState<SelectOption[]>([]);
  const [memberId, setMemberId] = useState<string | number>('');
  const [source, setSource] = useState<'All' | 'contribution' | 'loan'>('All');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');

  useEffect(() => { const id = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(id); }, [search]);
  useEffect(() => { getAllMembersLite().then(ms => setMembers(ms.map(m => ({ value: m.id, label: `${m.member_code} · ${bnName(m.name, m.name_bn)}` }))), () => undefined); }, [bnName]);

  const load = useCallback(() => {
    setLoading(true); setErr('');
    getFineRegister({ start_date: start || undefined, end_date: end || undefined, member_id: memberId || undefined, source, search: q || undefined, sort_by: sort })
      .then(setData, e => setErr(e.message)).finally(() => setLoading(false));
  }, [start, end, memberId, source, q, sort]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = !!(start || end || memberId || source !== 'All' || q);
  const reset = () => { setStart(''); setEnd(''); setMemberId(''); setSource('All'); setSearch(''); setQ(''); setSort('newest'); };
  const nm = (r: { name: string; name_bn?: string | null }) => bnName(r.name, r.name_bn);
  const money = (v: number) => formatCurrency(v);
  const dash = <span className="text-slate-400">—</span>;
  const rate = data?.overall.rate ?? 0;

  const sortOptions: SelectOption[] = [
    { value: 'newest', label: t('fines.sort_newest', 'Newest first') }, { value: 'oldest', label: t('fines.sort_oldest', 'Oldest first') },
    { value: 'amount_high', label: t('fines.sort_amount_high', 'Largest fine') }, { value: 'amount_low', label: t('fines.sort_amount_low', 'Smallest fine') },
    { value: 'days_late', label: t('fines.sort_days', 'Most days late') }, { value: 'member', label: t('fines.sort_member', 'Member') },
  ];

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, sub?: React.ReactNode) => (
    <div className={`card-base p-5 border-l-4 ${accent} min-w-0`}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div></div>
      <div className="text-2xl font-black tracking-tight mt-3 truncate text-slate-900 dark:text-white" title={value}>{value}</div>
      {sub && <div className="text-[11px] font-semibold mt-1 text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );

  const sourceBadge = (r: FineRow) => (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${r.source === 'loan'
      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900' : 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900'}`}>
      {r.source === 'loan' ? t('fines.src_loan', 'Loan penalty') : t('fines.src_contribution', 'Late fee')}</span>
  );

  // ---- export of whatever the active tab shows
  const exportCurrent = async (format: 'pdf' | 'xlsx') => {
    if (!data) return;
    const m = (v: number) => cell(v, money(v));
    let title = t('fines.title', 'Fines');
    let section: ExportDoc['sections'][number];
    if (tab === 'month') {
      title += ` · ${t('fines.tab_month', 'By month')}`;
      section = { columns: [{ header: t('common.no', 'No.'), kind: 'int' }, { header: t('common.month', 'Month') }, { header: t('fines.src_contribution', 'Late fee'), kind: 'money' }, { header: t('fines.src_loan', 'Loan penalty'), kind: 'money' }, { header: t('fines.total', 'Total'), kind: 'money' }, { header: t('fines.count', 'Fines'), kind: 'int' }],
        rows: data.byMonth.map((b, i) => [cell(i + 1), cell(b.month, formatMonth(b.month)), m(b.contribution), m(b.loan), m(b.total), cell(b.count)]) };
    } else if (tab === 'member') {
      title += ` · ${t('fines.tab_member', 'By member')}`;
      section = { columns: [{ header: t('common.no', 'No.'), kind: 'int' }, { header: t('fines.member_id', 'Member ID') }, { header: t('fines.member', 'Member') }, { header: t('fines.count', 'Fines'), kind: 'int' }, { header: t('fines.total', 'Total'), kind: 'money' }, { header: t('fines.last', 'Last fine'), kind: 'date' }],
        rows: data.byMember.map((b, i) => [cell(i + 1), cell(b.member_code), cell(nm(b)), cell(b.count), m(b.total), cell(b.last_date, formatDate(b.last_date))]) };
    } else if (tab === 'nofine') {
      title += ` · ${t('fines.tab_nofine', 'Late, no fine')}`;
      section = { columns: [{ header: t('common.no', 'No.'), kind: 'int' }, { header: t('fines.paid_on', 'Paid on'), kind: 'date' }, { header: t('fines.member', 'Member') }, { header: t('common.month', 'Month') }, { header: t('fines.due', 'Due date'), kind: 'date' }, { header: t('fines.days_late', 'Days late'), kind: 'int' }, { header: t('fines.contribution', 'Contribution'), kind: 'money' }],
        rows: data.lateNoFine.rows.map((r, i) => [cell(i + 1), cell(r.date, formatDate(r.date)), cell(`${r.member_code} ${nm(r)}`), cell(r.month, formatMonth(r.month)), cell(r.due_date, formatDate(r.due_date)), cell(r.days_late), m(r.amount)]) };
    } else if (tab === 'overdue') {
      title += ` · ${t('fines.tab_overdue', 'Overdue now')}`;
      section = { columns: [{ header: t('common.no', 'No.'), kind: 'int' }, { header: t('fines.member', 'Member') }, { header: t('fines.months_overdue', 'Months overdue'), kind: 'int' }, { header: t('fines.owed', 'Contributions owed'), kind: 'money' }, { header: t('fines.fine_if_paid', 'Fine if paid today'), kind: 'money' }],
        rows: data.overdueNow.rows.map((r, i) => [cell(i + 1), cell(`${r.member_code} ${nm(r)}`), cell(r.months), m(r.owed), m(r.fine_if_paid_today)]) };
    } else {
      section = { columns: [{ header: t('common.no', 'No.'), kind: 'int' }, { header: t('common.date', 'Date'), kind: 'date' }, { header: t('fines.member', 'Member') }, { header: t('fines.for', 'For') }, { header: t('fines.due', 'Due date'), kind: 'date' }, { header: t('fines.days_late', 'Days late'), kind: 'int' }, { header: t('fines.type', 'Type') }, { header: t('fines.amount', 'Fine'), kind: 'money' }, { header: t('fines.method', 'Method') }, { header: t('fines.ref', 'Reference') }],
        rows: data.rows.map((r, i) => [cell(i + 1), cell(r.date, formatDate(r.date)), cell(`${r.member_code} ${nm(r)}`), cell(r.label), cell(r.due_date || '', r.due_date ? formatDate(r.due_date) : ''), cell(r.days_late ?? ''), cell(r.source === 'loan' ? t('fines.src_loan', 'Loan penalty') : t('fines.src_contribution', 'Late fee')), m(r.amount), cell(r.method || ''), cell(r.trx_id || '')]),
        totals: [cell(''), cell(t('fines.total', 'Total')), cell(''), cell(''), cell(''), cell(''), cell(''), m(data.totals.total), cell(''), cell('')] };
    }
    try {
      const doc: ExportDoc = {
        orgName: settings?.organization_name || 'Bondhu Fund', title, lang: language === 'bn' ? 'bn' : 'en', landscape: true, generatedOn: todayISO(),
        subtitle: [start && `${t('fines.from', 'From')} ${formatDate(start)}`, end && `${t('fines.to', 'to')} ${formatDate(end)}`].filter(Boolean).join(' '),
        summary: [[t('fines.k_total', 'Fines collected'), money(data.overall.total)], [t('fines.shown', 'Shown'), money(data.totals.total)], [t('fines.k_reserve', 'Fund reserve'), money(data.books.reserve)]],
        sections: [section],
      };
      const res = await exportTable(doc, format, `Bondhu_Fund_Fines_${todayISO()}`);
      if (!res.canceled) showToast(t('finance.export_saved', 'Export saved.'));
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const th = 'py-2.5 px-3 font-bold';
  const tableWrap = (children: React.ReactNode) => <div className="overflow-x-auto"><table className="w-full text-left text-xs">{children}</table></div>;
  const thead = (cols: Array<[string, string?]>) => <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400"><tr>{cols.map(([c, cls], i) => <th key={i} className={`${th} ${cls || ''}`}>{c}</th>)}</tr></thead>;
  const tbody = 'divide-y divide-slate-100 dark:divide-slate-800/80 font-medium';
  const empty = (text: string) => <p className="p-10 text-center text-xs text-slate-400">{text}</p>;

  const b = data?.books;
  const line = (sign: '+' | '−' | '=', label: string, value: number, hint?: string, strong?: boolean) => (
    <div className={`flex items-start justify-between gap-3 py-2 ${strong ? 'border-t-2 border-slate-300 dark:border-slate-600 mt-1 pt-3' : 'border-t border-slate-100 dark:border-slate-800/80'} first:border-t-0`}>
      <div className="flex items-start gap-2 min-w-0"><span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-[11px] font-black mt-0.5 ${sign === '+' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : sign === '−' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>{sign === '+' ? <Plus size={11} /> : sign === '−' ? <Minus size={11} /> : <Equal size={11} />}</span>
        <div className="min-w-0"><div className={`text-xs ${strong ? 'font-black text-slate-900 dark:text-white' : 'font-semibold text-slate-700 dark:text-slate-200'}`}>{label}</div>{hint && <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{hint}</div>}</div></div>
      <div className={`tabular-nums shrink-0 ${strong ? 'text-base font-black text-slate-900 dark:text-white' : 'text-xs font-bold text-slate-800 dark:text-slate-100'}`}>{money(value)}</div>
    </div>
  );

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('fines.title', 'Fines')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('fines.subtitle', 'Every late fee and loan penalty the fund has collected, who paid it, and where the money sits.')}</p>
        </div>
        <DownloadMenu label={t('common.export', 'Export')} title={t('common.export', 'Export')} onPick={exportCurrent} />
      </div>

      {err && <p className="text-xs font-semibold text-rose-600">{err}</p>}

      {data && (
        <>
          <div className="kpi-zoom grid grid-cols-2 xl:grid-cols-6 gap-4">
            {kpi('border-l-orange-500', t('fines.k_total', 'Fines collected'), <Gavel size={16} />, 'bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400', money(data.overall.total),
              <>{t('fines.k_split', '{a} late fees · {b} loan penalties').replace('{a}', money(data.overall.contribution)).replace('{b}', money(data.overall.loan))}</>)}
            {kpi('border-l-emerald-500', t('fines.k_month', 'This month'), <CalendarClock size={16} />, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400', money(data.overall.thisMonth), t('fines.k_month_sub', 'received this month'))}
            {kpi('border-l-sky-500', t('fines.k_year', 'This year'), <Scale size={16} />, 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400', money(data.overall.thisYear), t('fines.k_count', '{n} fines in all').replace('{n}', n(data.overall.count)))}
            {kpi('border-l-violet-500', t('fines.k_members', 'Members fined'), <Users size={16} />, 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400', n(data.byMember.length), filtered ? t('fines.in_view', 'in the current view') : t('fines.k_avg', 'average fine {a}').replace('{a}', money(data.totals.average)))}
            {kpi('border-l-amber-500', t('fines.k_nofine', 'Late, no fine'), <HandCoins size={16} />, 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400', n(data.lateNoFine.count), data.lateNoFine.count ? t('fines.k_nofine_sub', 'worth {a} at the usual fine').replace('{a}', money(data.lateNoFine.potential)) : t('fines.none', 'none'))}
            {kpi('border-l-rose-500', t('fines.k_overdue', 'Overdue now'), <Hourglass size={16} />, 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400', n(data.overdueNow.count), data.overdueNow.count ? t('fines.k_overdue_sub', '{a} in fines if paid today').replace('{a}', money(data.overdueNow.potential)) : t('fines.none', 'none'))}
          </div>

          {/* where the money sits: the books-balance proof */}
          {b && (
            <div className="card-base p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center shrink-0"><Scale size={22} /></div>
                  <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('fines.books_title', 'Where the fine money sits: the fund\'s own reserve')}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed max-w-3xl">{b.reserve < 0
                      ? t('fines.books_desc_neg', 'The fund holds {fund} but members are owed {owed} (their savings plus their share of the profit): {x} short. The fund\'s own money is the fines, and the operating expenses ({e}) are more than the fines and penalties collected ({f}).').replace('{fund}', money(b.fundBalance)).replace('{owed}', money(b.owedToMembers)).replace('{x}', money(-b.reserve)).replace('{e}', money(b.parts.expenses)).replace('{f}', money(b.parts.fines + b.parts.penalties))
                      : t('fines.books_desc', 'The fund holds {fund}. Members are owed {owed} (their savings plus their share of the profit). What is left, {res}, belongs to the fund itself. It is made of the fines, less the operating expenses.').replace('{fund}', money(b.fundBalance)).replace('{owed}', money(b.owedToMembers)).replace('{res}', money(b.reserve))}</p></div>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-black ${b.balanced ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900' : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900'}`}>
                  {b.balanced ? <><CheckCircle2 size={13} />{t('fines.balanced', 'The books balance')}</> : <><AlertTriangle size={13} />{t('fines.not_balanced', 'Difference of {x}').replace('{x}', money(b.residual))}</>}</span>
              </div>
              <div className="grid lg:grid-cols-2 gap-x-10 gap-y-4 mt-5">
                <div>
                  {line('+', t('fines.l_fines', 'Late fees on contributions'), b.parts.fines, t('fines.l_fines_h', 'collected from members'))}
                  {line('+', t('fines.l_pen', 'Penalties on loan installments'), b.parts.penalties)}
                  {line('−', t('fines.l_exp', 'Operating expenses'), b.parts.expenses, t('fines.l_exp_h', 'paid from the fund, not charged to members'))}
                  {Math.abs(b.parts.settlementAdjustment) >= 0.005 && line(b.parts.settlementAdjustment > 0 ? '−' : '+', t('fines.l_adj', 'Settlements paid above / below the books'), Math.abs(b.parts.settlementAdjustment), t('fines.l_adj_h', 'a committee decision when a member left'))}
                  {Math.abs(b.parts.unshared) >= 0.005 && line(b.parts.unshared > 0 ? '+' : '−', t('fines.l_unshared', 'Profit nobody could share'), Math.abs(b.parts.unshared), t('fines.l_unshared_h', 'earned when no member was in the fund'))}
                  {line('=', t('fines.l_reserve', 'The fund\'s own reserve'), b.reserve, undefined, true)}
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800 p-4 text-xs space-y-2.5 self-start">
                  <div className="flex justify-between"><span className="text-slate-500">{t('fines.b_fund', 'Fund balance (at cost)')}</span><b className="tabular-nums">{money(b.fundBalance)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('fines.b_owed', 'Owed to {n} members').replace('{n}', n(b.members))}</span><b className="tabular-nums">− {money(b.owedToMembers)}</b></div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2"><span className="font-bold text-slate-800 dark:text-slate-100">{t('fines.l_reserve', 'The fund\'s own reserve')}</span><b className={`tabular-nums ${b.reserve < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{money(b.reserve)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t('fines.b_cash', 'Cash in hand')}</span><b className="tabular-nums">{money(b.cashInHand)}</b></div>
                  {b.reserve < -0.005 && <p className="flex items-start gap-1.5 text-rose-700 dark:text-rose-300 font-semibold leading-relaxed"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{t('fines.short', 'The fund holds {x} less than its members are owed: the expenses are higher than the fines collected.').replace('{x}', money(-b.reserve))}</p>}
                  {b.drift.length > 0 && <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300 font-semibold leading-relaxed"><Info size={13} className="shrink-0 mt-0.5" />{t('fines.drift', '{n} settled member(s) no longer match the books. See the accounting health check.').replace('{n}', n(b.drift.length))}</p>}
                </div>
              </div>
            </div>
          )}

          {/* the register and its views */}
          <div className="card-base overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedTabs<Tab> size="sm" value={tab} onChange={setTab} items={[
                  { key: 'register', label: t('fines.tab_register', 'Register'), count: n(data.totals.count) },
                  { key: 'month', label: t('fines.tab_month', 'By month') },
                  { key: 'member', label: t('fines.tab_member', 'By member') },
                  { key: 'nofine', label: t('fines.tab_nofine', 'Late, no fine'), count: n(data.lateNoFine.count) },
                  { key: 'overdue', label: t('fines.tab_overdue', 'Overdue now'), count: n(data.overdueNow.count) },
                ]} />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t('fines.shown', 'Shown')}: {money(data.totals.total)}</span>
              </div>
              {tab !== 'overdue' && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="form-input !pl-9 w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('fines.search', 'Search member, month, reference…')} /></div>
                  <div className="w-56"><SearchableSelect options={members} value={memberId} onChange={setMemberId} placeholder={t('fines.all_members', 'All members')} searchPlaceholder={t('common.search', 'Search…')} /></div>
                  <div className="w-40"><DatePicker value={start} onChange={setStart} placeholder={t('fines.from', 'From')} max={end || undefined} /></div>
                  <div className="w-40"><DatePicker value={end} onChange={setEnd} placeholder={t('fines.to', 'to')} min={start || undefined} /></div>
                  {tab === 'register' && <div className="w-44"><SearchableSelect options={sortOptions} value={sort} onChange={(v: string) => setSort(v || 'newest')} /></div>}
                  <SegmentedTabs<'All' | 'contribution' | 'loan'> size="sm" value={source} onChange={setSource} items={[{ key: 'All', label: t('common.all', 'All') }, { key: 'contribution', label: t('fines.src_contribution', 'Late fee') }, { key: 'loan', label: t('fines.src_loan', 'Loan penalty') }]} />
                  {filtered && <button type="button" onClick={reset} className="btn btn-outline btn-sm"><RotateCcw size={13} />{t('fines.clear', 'Clear filters')}</button>}
                </div>
              )}
            </div>

            {tab === 'register' && (data.rows.length === 0 ? empty(filtered ? t('fines.no_match', 'No fine matches these filters.') : t('fines.empty', 'No fine has been collected yet. Late fees appear here as payments are recorded after the due date.')) : tableWrap(<>
              {thead([[t('common.no', 'No.'), 'w-12 text-center'], [t('common.date', 'Date')], [t('fines.member', 'Member')], [t('fines.for', 'For')], [t('fines.due', 'Due date')], [t('fines.days_late', 'Days late'), 'text-right'], [t('fines.type', 'Type')], [t('fines.amount', 'Fine'), 'text-right'], [t('fines.method', 'Method')]])}
              <tbody className={tbody}>{data.rows.map((r, i) => (
                <tr key={r.key} className="align-middle">
                  <td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(i + 1)}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-2.5 px-3"><div className="font-bold text-slate-900 dark:text-white">{nm(r)}</div><div className="text-[10px] text-slate-500">{r.member_code}</div></td>
                  <td className="py-2.5 px-3">{r.source === 'contribution' ? formatMonth(r.month) : r.label}{r.trx_id && <div className="text-[10px] text-slate-400">{r.trx_id}</div>}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{r.due_date ? formatDate(r.due_date) : dash}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{r.days_late === null ? dash : r.flag === 'on_time' ? <span className="text-amber-700 dark:text-amber-400 font-bold" title={t('fines.on_time_hint', 'The fine was charged although this payment was made by the due date.')}>0 ⚠</span> : n(r.days_late)}</td>
                  <td className="py-2.5 px-3">{sourceBadge(r)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-black text-slate-900 dark:text-white">{money(r.amount)}</td>
                  <td className="py-2.5 px-3">{r.method || dash}</td>
                </tr>))}</tbody>
              <tfoot><tr className="bg-slate-50 dark:bg-[#111e24] font-black"><td className="py-2.5 px-3" colSpan={7}>{t('fines.total', 'Total')} · {t('fines.n_fines', '{n} fines').replace('{n}', n(data.totals.count))}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(data.totals.total)}</td><td /></tr></tfoot>
            </>))}

            {tab === 'month' && (data.byMonth.length === 0 ? empty(t('fines.no_match', 'No fine matches these filters.')) : tableWrap(<>
              {thead([[t('common.no', 'No.'), 'w-12 text-center'], [t('common.month', 'Month')], [t('fines.src_contribution', 'Late fee'), 'text-right'], [t('fines.src_loan', 'Loan penalty'), 'text-right'], [t('fines.total', 'Total'), 'text-right'], [t('fines.count', 'Fines'), 'text-right']])}
              <tbody className={tbody}>{data.byMonth.map((m, i) => (
                <tr key={m.month}><td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(i + 1)}</td><td className="py-2.5 px-3 font-bold">{formatMonth(m.month)}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(m.contribution)}</td><td className="py-2.5 px-3 text-right tabular-nums">{m.loan ? money(m.loan) : dash}</td><td className="py-2.5 px-3 text-right tabular-nums font-black">{money(m.total)}</td><td className="py-2.5 px-3 text-right tabular-nums">{n(m.count)}</td></tr>))}</tbody>
              <tfoot><tr className="bg-slate-50 dark:bg-[#111e24] font-black"><td className="py-2.5 px-3" colSpan={2}>{t('fines.total', 'Total')}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(data.totals.contribution)}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(data.totals.loan)}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(data.totals.total)}</td><td className="py-2.5 px-3 text-right tabular-nums">{n(data.totals.count)}</td></tr></tfoot>
            </>))}

            {tab === 'member' && (data.byMember.length === 0 ? empty(t('fines.no_match', 'No fine matches these filters.')) : tableWrap(<>
              {thead([[t('common.no', 'No.'), 'w-12 text-center'], [t('fines.member', 'Member')], [t('fines.count', 'Fines'), 'text-right'], [t('fines.total', 'Total'), 'text-right'], [t('fines.share', 'Share'), 'text-right'], [t('fines.last', 'Last fine')]])}
              <tbody className={tbody}>{data.byMember.map((m, i) => (
                <tr key={m.member_id}><td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(i + 1)}</td><td className="py-2.5 px-3"><div className="font-bold text-slate-900 dark:text-white">{nm(m)}</div><div className="text-[10px] text-slate-500">{m.member_code}</div></td><td className="py-2.5 px-3 text-right tabular-nums">{n(m.count)}</td><td className="py-2.5 px-3 text-right tabular-nums font-black">{money(m.total)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">{data.totals.total ? n((100 * m.total / data.totals.total).toFixed(1)) + '%' : '—'}</td><td className="py-2.5 px-3 whitespace-nowrap">{formatDate(m.last_date)}</td></tr>))}</tbody>
            </>))}

            {tab === 'nofine' && (<>
              <p className="px-4 pt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('fines.nofine_note', 'Payments made after the due date with no fine charged. Each may be a waiver the committee agreed, or a fine that was missed (the usual fine is {r}).').replace('{r}', money(rate))}</p>
              {data.lateNoFine.rows.length === 0 ? empty(t('fines.nofine_none', 'Every late payment carried a fine.')) : tableWrap(<>
                {thead([[t('common.no', 'No.'), 'w-12 text-center'], [t('fines.paid_on', 'Paid on')], [t('fines.member', 'Member')], [t('common.month', 'Month')], [t('fines.due', 'Due date')], [t('fines.days_late', 'Days late'), 'text-right'], [t('fines.contribution', 'Contribution'), 'text-right']])}
                <tbody className={tbody}>{data.lateNoFine.rows.map((r, i) => (
                  <tr key={r.id}><td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(i + 1)}</td><td className="py-2.5 px-3 whitespace-nowrap">{formatDate(r.date)}</td><td className="py-2.5 px-3"><div className="font-bold text-slate-900 dark:text-white">{nm(r)}</div><div className="text-[10px] text-slate-500">{r.member_code}</div></td><td className="py-2.5 px-3">{formatMonth(r.month)}</td><td className="py-2.5 px-3 whitespace-nowrap">{formatDate(r.due_date)}</td><td className="py-2.5 px-3 text-right tabular-nums font-bold text-amber-700 dark:text-amber-400">{n(r.days_late)}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(r.amount)}</td></tr>))}</tbody>
              </>)}
            </>)}

            {tab === 'overdue' && (<>
              <p className="px-4 pt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('fines.overdue_note', 'Active members with months already past their due day (the {d}th) and not yet paid. A late fee of {r} applies to each month when it is paid.').replace('{d}', n(data.overall.dueDay)).replace('{r}', money(rate))}</p>
              {data.overdueNow.rows.length === 0 ? empty(t('fines.overdue_none', 'Nobody is overdue.')) : tableWrap(<>
                {thead([[t('common.no', 'No.'), 'w-12 text-center'], [t('fines.member', 'Member')], [t('fines.months_overdue', 'Months overdue'), 'text-right'], [t('fines.owed', 'Contributions owed'), 'text-right'], [t('fines.fine_if_paid', 'Fine if paid today'), 'text-right'], ['']])}
                <tbody className={tbody}>{data.overdueNow.rows.map((r, i) => (
                  <tr key={r.member_id}><td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(i + 1)}</td><td className="py-2.5 px-3"><div className="font-bold text-slate-900 dark:text-white">{nm(r)}</div><div className="text-[10px] text-slate-500">{r.member_code}</div></td><td className="py-2.5 px-3 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400">{n(r.months)}</td><td className="py-2.5 px-3 text-right tabular-nums">{money(r.owed)}</td><td className="py-2.5 px-3 text-right tabular-nums font-black">{money(r.fine_if_paid_today)}</td>
                    <td className="py-2.5 px-3 text-right"><button type="button" className="btn btn-green-outline btn-sm" onClick={() => setActiveTab('collections')}>{t('fines.open_collections', 'Open Collections')}</button></td></tr>))}</tbody>
              </>)}
            </>)}
          </div>
        </>
      )}
      {!data && !err && loading && <p className="text-xs text-slate-400">{t('common.loading', 'Loading…')}</p>}
    </div>
  );
};
