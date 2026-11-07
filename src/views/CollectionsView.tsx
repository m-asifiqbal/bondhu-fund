import React, { useState, useEffect, useMemo } from 'react';
import { serial } from '../utils/i18n';
import {
  ArrowRight,
  Clock,
  Coins,
  CheckCircle2,
  AlertCircle,
  Info,
  Download,
  Receipt,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Eye,
  PlusCircle,
  Ban,
  Users,
} from 'lucide-react';
import { ChipTabs } from '../components/common/ChipTabs';
import { useApp } from '../context/AppContext';
import { getCollections, deletePayment, exportVoucher } from '../services/db';
import { CollectionRecord, CollectionStats, PaymentStatus } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { Modal } from '../components/common/Modal';
import { todayISO } from '../utils/date';

type Tab = 'All' | 'Paid' | 'Pending' | 'Overdue';

/** Fill {placeholders} in a translated template. */
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
/** Bangla name, when the API provides it (member_name_bn is optional on collection rows). */
type Rec = CollectionRecord & { member_name_bn?: string | null };

const EMPTY_STATS: CollectionStats = {
  totalMembers: 0,
  paidCount: 0,
  pendingCount: 0,
  overdueCount: 0,
  collectedAmount: 0,
  lateFeeAmount: 0,
  expectedAmount: 0,
  outstandingAmount: 0,
  percentage: '0',
};

export const CollectionsView: React.FC = () => {
  const {
    setActiveTab,
    refreshKey,
    triggerRefresh,
    selectedMonth,
    setSelectedMonth,
    showToast,
    language,
    t,
    formatCurrency,
    formatDate,
    formatMonth,
    toBanglaDigits,
    setOpenRecordModal,
    setSelectedMemberIdForPayment,
    settings,
    tv,
    bnName,
  } = useApp();

  const [allRecords, setAllRecords] = useState<Rec[]>([]);
  const [stats, setStats] = useState<CollectionStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<Tab>('All');
  const [selectedRecord, setSelectedRecord] = useState<Rec | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<Rec | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 10;

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const monthLabel = formatMonth(selectedMonth);

  const memberName = (r: Rec) => bnName(r.member_name, r.member_name_bn);

  // Debounce the search box before querying.
  useEffect(() => {
    const h = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(h);
  }, [searchInput]);

  const sortOptions = useMemo<SelectOption[]>(() => [
    { value: 'newest', label: t('members.col_sort_newest', 'Newest first') },
    { value: 'oldest', label: t('members.col_sort_oldest', 'Oldest first') },
    { value: 'status', label: t('members.col_sort_status', 'Status (unpaid first)') },
    { value: 'name_asc', label: t('members.col_sort_nameAsc', 'Member: A to Z') },
    { value: 'name_desc', label: t('members.col_sort_nameDesc', 'Member: Z to A') },
    { value: 'amount_high', label: t('members.col_sort_amountHigh', 'Amount: high to low') },
    { value: 'amount_low', label: t('members.col_sort_amountLow', 'Amount: low to high') },
    { value: 'date_desc', label: t('members.col_sort_dateDesc', 'Payment date: latest') },
    { value: 'date_asc', label: t('members.col_sort_dateAsc', 'Payment date: earliest') },
  ], [t]);

  // Stats are computed by the API after the status filter, so we always load the
  // full month (statusTab 'All') and filter the tab locally to keep tab counts correct.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCollections(selectedMonth, 'All', startDate || undefined, endDate || undefined, searchQuery, sortBy)
      .then(res => {
        if (!alive) return;
        setAllRecords(res.records);
        setStats(res.stats);
      })
      .catch((e: any) => {
        if (alive) showToast(e.message, 'error');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, startDate, endDate, searchQuery, sortBy, refreshKey]);

  useEffect(() => setPage(1), [selectedMonth, selectedTab, startDate, endDate, searchQuery, sortBy]);

  const records = useMemo(
    () => (selectedTab === 'All' ? allRecords : allRecords.filter(r => r.status === selectedTab)),
    [allRecords, selectedTab]
  );

  const dueOf = (r: CollectionRecord) => r.monthly_due ?? r.contribution_amount ?? 0;
  const pendingAmount = useMemo(
    () => allRecords.filter(r => r.status === 'Pending').reduce((a, r) => a + dueOf(r), 0),
    [allRecords]
  );
  const overdueAmount = useMemo(
    () => allRecords.filter(r => r.status === 'Overdue').reduce((a, r) => a + dueOf(r), 0),
    [allRecords]
  );
  const latePaymentsCount = useMemo(() => allRecords.filter(r => (r.late_fee || 0) > 0).length, [allRecords]);

  const pct = Math.max(0, Math.min(100, parseFloat(stats.percentage) || 0));
  const hasFilters = !!(searchInput || startDate || endDate || sortBy !== 'newest');

  const totalPages = Math.ceil(records.length / limit) || 1;
  const safePage = Math.min(page, totalPages);
  const displayedRecords = records.slice((safePage - 1) * limit, safePage * limit);
  const startIdx = records.length === 0 ? 0 : (safePage - 1) * limit + 1;
  const endIdx = Math.min(safePage * limit, records.length);

  const isPaid = (r: CollectionRecord) => r.payment_id != null && r.status === 'Paid';

  const handleRecordPayment = (r: CollectionRecord) => {
    setSelectedMemberIdForPayment(r.member_id);
    setOpenRecordModal(true);
  };

  const handleVoid = async () => {
    const r = confirmVoid;
    if (!r || r.payment_id == null || busyId != null) return;
    setBusyId(r.payment_id);
    try {
      await deletePayment(r.payment_id);
      showToast(t('members.col_voided', 'Payment voided.'));
      if (selectedRecord?.payment_id === r.payment_id) setSelectedRecord(null);
      setConfirmVoid(null);
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // The saved/copied voucher file stays in English (plain-text record); the on-screen voucher is translated.
  const voucherText = (r: Rec) => {
    const cur = settings?.currency_symbol || 'TK';
    const money = (v: number) => `${cur} ${(v || 0).toLocaleString('en-US')}`;
    return [
      '========================================================',
      `  ${(settings?.organization_name || 'Bondhu Fund').toUpperCase()}`,
      '  OFFICIAL PAYMENT VOUCHER',
      '========================================================',
      `Receipt / TRX ID : ${r.trx_id || '-'}`,
      `Payment Month    : ${formatMonth(r.payment_month)}`,
      `Payment Date     : ${formatDate(r.payment_date)}`,
      '--------------------------------------------------------',
      `Member Code      : ${r.member_code || '-'}`,
      `Member Name      : ${[r.member_name, r.member_name_bn].filter(Boolean).join(' / ') || '-'}`,
      `Payment Method   : ${r.payment_method || '-'}`,
      '--------------------------------------------------------',
      `Contribution     : ${money(r.contribution_amount)}`,
      `Late Fee         : ${money(r.late_fee)}`,
      '--------------------------------------------------------',
      `TOTAL RECEIVED   : ${money(r.total_amount || r.contribution_amount + r.late_fee)}`,
      `Notes            : ${r.note || '-'}`,
      '========================================================',
    ].join('\r\n');
  };

  const handleDownloadVoucher = async (r: CollectionRecord) => {
    try {
      const res = await exportVoucher({
        orgName: settings?.organization_name || 'Bondhu Fund', lang: language === 'bn' ? 'bn' : 'en', no: String(r.payment_id ?? r.id ?? ''),
        member_code: r.member_code, member_name: r.member_name, member_name_bn: r.member_name_bn, payment_month: r.payment_month, monthLabel: formatMonth(r.payment_month),
        payment_date: r.payment_date, payment_method: r.payment_method, trx_id: r.trx_id, note: r.note,
        contribution: Number(r.contribution_amount) || 0, late_fee: Number(r.late_fee) || 0, total: Number(r.total_amount || (Number(r.contribution_amount) || 0) + (Number(r.late_fee) || 0)),
        currency: language === 'bn' ? '৳' : (settings?.currency_symbol || 'TK'), generatedOn: todayISO(),
      });
      if (!res.canceled) showToast(t('members.col_voucherSaved', 'Voucher saved.'));
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleCopyVoucher = async (r: CollectionRecord) => {
    try {
      await navigator.clipboard.writeText(voucherText(r));
      showToast(t('members.col_voucherCopied', 'Voucher copied to clipboard.'));
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const getStatusBadge = (status: PaymentStatus) => {
    const cls: Record<PaymentStatus, string> = {
      Paid: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      Pending: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      Overdue: 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls[status] || ''}`}>
        {tv(status)}
      </span>
    );
  };

  const tabs: { key: Tab; count: number; active: string }[] = [
    { key: 'All', count: stats.totalMembers, active: 'text-slate-900 dark:text-white' },
    { key: 'Paid', count: stats.paidCount, active: 'text-emerald-700 dark:text-emerald-400' },
    { key: 'Pending', count: stats.pendingCount, active: 'text-amber-700 dark:text-amber-400' },
    { key: 'Overdue', count: stats.overdueCount, active: 'text-rose-700 dark:text-rose-400' },
  ];

  const statCard = (
    accent: string,
    label: string,
    icon: React.ReactNode,
    iconCls: string,
    value: string,
    valueCls: string,
    sub: string,
    subCls = 'text-slate-500 dark:text-slate-400 font-medium'
  ) => (
    <div className={`card-base p-5 border-l-4 ${accent} flex flex-col justify-between min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className="mt-4 min-w-0">
        <div className={`text-2xl font-black tracking-tight truncate ${valueCls}`}>{value}</div>
        <div className={`text-[11px] mt-1 ${subCls}`}>{sub}</div>
      </div>
    </div>
  );

  const showNoDues = !loading && stats.totalMembers === 0 && !hasFilters;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {t('members.col_title', 'Monthly collections')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('members.col_subtitle', 'Track contributions, late payments, and outstanding dues.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} align="right" />
          <button
            onClick={() => {
              setSelectedMemberIdForPayment(null);
              setOpenRecordModal(true);
            }}
            className="btn btn-primary"
          >
            <PlusCircle size={14} />
            <span>{t('members.col_recordPayment', 'Record payment')}</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-zoom grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCard(
          'border-l-purple-500',
          fill(t('members.col_expected', 'Expected in {month}'), { month: monthLabel }),
          <Coins size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(stats.expectedAmount),
          'text-slate-900 dark:text-white',
          `${n(stats.totalMembers)} ${t('members.col_memberDues', 'member dues')}`
        )}
        {statCard(
          'border-l-emerald-500',
          t('members.col_collected', 'Collected'),
          <CheckCircle2 size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(stats.collectedAmount),
          'text-emerald-600 dark:text-emerald-400',
          `${n(stats.percentage)}% ${t('members.col_ofExpected', 'of expected')}`,
          'text-emerald-600 dark:text-emerald-400 font-bold'
        )}
        {statCard(
          'border-l-amber-500',
          t('members.col_lateFees', 'Late fees'),
          <Clock size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          formatCurrency(stats.lateFeeAmount),
          'text-amber-600 dark:text-amber-400',
          `${n(latePaymentsCount)} ${t('members.col_latePayments', 'late payments')}`
        )}
        {statCard(
          'border-l-rose-500',
          t('members.col_outstanding', 'Outstanding'),
          <AlertCircle size={16} />,
          'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
          formatCurrency(stats.outstandingAmount),
          'text-rose-600 dark:text-rose-400',
          `${n(stats.pendingCount + stats.overdueCount)} ${t('members.col_unpaidDues', 'unpaid dues')}`,
          'text-rose-600 dark:text-rose-400 font-bold'
        )}
      </div>

      {/* Ledger + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17.5rem] gap-5 items-start">
        <div className="card-base p-5 lg:p-6 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {fill(t('members.col_ledger', '{month} collection ledger'), { month: monthLabel })}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('members.col_ledgerSub', 'Review contribution status and payment details.')}
              </p>
            </div>
            <ChipTabs ariaLabel={t('members.col_status', 'Payment status')} value={selectedTab} onChange={setSelectedTab}
              items={tabs.map(tb => ({ key: tb.key, label: tb.key === 'All' ? t('common.all', 'All') : tv(tb.key), count: n(tb.count) }))} />
          </div>

          {/* Filters */}
          <div className="p-3 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder={t('members.col_searchPh', 'Search member, NID, code, phone or TRX ID…')}
                aria-label={t('members.col_searchPh', 'Search member, code, phone or TRX ID…')}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="form-input pl-8"
              />
            </div>
            <SearchableSelect
              size="sm"
              className="min-w-[200px]"
              options={sortOptions}
              value={sortBy}
              onChange={v => setSortBy(String(v || 'newest'))}
            />
            <div className="flex flex-wrap items-center gap-2" title={t('members.col_dateHint', 'Filters by payment date (unpaid dues are hidden)')}>
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('members.col_paidFrom', 'Paid from')}</span>
              <DatePicker size="sm" className="min-w-[150px]" value={startDate} max={endDate || todayISO()} onChange={setStartDate} />
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('members.to', 'to')}</span>
              <DatePicker size="sm" className="min-w-[150px]" value={endDate} min={startDate || undefined} max={todayISO()} onChange={setEndDate} />
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSearchQuery('');
                  setStartDate('');
                  setEndDate('');
                  setSortBy('newest');
                }}
                className="btn btn-outline btn-sm"
              >
                <RotateCcw size={12} />
                <span>{t('common.reset', 'Reset')}</span>
              </button>
            )}
          </div>

          {showNoDues ? (
            <div className="py-12 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                <Users size={22} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {fill(t('members.col_emptyTitle', 'No dues for {month}'), { month: monthLabel })}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                  {t('members.col_emptyBody', 'Dues appear here for every active member who had joined by this month. Add members to start tracking collections.')}
                </p>
              </div>
              <button
                onClick={() => setActiveTab('members')}
                className="btn btn-outline"
              >
                {t('members.col_goMembers', 'Go to members')}
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto w-full">
                <table className="w-full min-w-[640px] text-left text-xs text-slate-800 dark:text-slate-200">
                  <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
<th className="py-3 px-3 w-12 text-center">{t('common.no', 'No.')}</th>
                      <th className="py-3 px-3">{t('common.member', 'Member')}</th>
                      <th className="py-3 px-3">{t('members.col_dueDate', 'Due date')}</th>
                      <th className="py-3 px-3">{t('members.col_paidOn', 'Paid on')}</th>
                      <th className="py-3 px-3 text-right">{t('members.col_contribution', 'Contribution')}</th>
                      <th className="py-3 px-3 text-right">{t('members.late_fee', 'Late fee')}</th>
                      <th className="py-3 px-3">{t('common.status', 'Status')}</th>
                      <th className="py-3 px-3 text-right">{t('common.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                    {loading && allRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          {t('common.loading', 'Loading...')}
                        </td>
                      </tr>
                    ) : displayedRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          {t('members.col_noRecords', 'No collection records match your criteria.')}
                        </td>
                      </tr>
                    ) : (
                      displayedRecords.map((r, __i) => {
                        const paid = isPaid(r);
                        return (
                          <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
<td className="py-3 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial((safePage - 1) * limit + __i + 1)}</td>
                            <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                              <span title={bnName(r.member_name) !== memberName(r) ? r.member_name : undefined}>{memberName(r)}</span>
                              {r.member_code && (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal ml-1">({r.member_code})</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(r.due_date)}</td>
                            <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {paid ? formatDate(r.payment_date) : '—'}
                            </td>
                            <td className="py-3 px-3 text-right font-black text-slate-900 dark:text-white whitespace-nowrap">
                              {paid ? (
                                formatCurrency(r.contribution_amount)
                              ) : (
                                <span className="text-slate-400 font-semibold">
                                  {formatCurrency(dueOf(r))} {t('members.col_due', 'due')}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                              {paid ? formatCurrency(r.late_fee || 0) : '—'}
                            </td>
                            <td className="py-3 px-3">{getStatusBadge(r.status)}</td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              {paid ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => setSelectedRecord(r)}
                                    className="btn btn-outline btn-sm btn-icon"
                                    title={t('common.view', 'View')}
                                    aria-label={t('common.view', 'View')}
                                  >
                                    <Eye size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDownloadVoucher(r)}
                                    className="btn btn-outline btn-sm btn-icon"
                                    title={t('members.col_downloadVoucher', 'Download voucher')}
                                    aria-label={t('members.col_downloadVoucher', 'Download voucher')}
                                  >
                                    <Download size={14} />
                                  </button>
                                  <button
                                    onClick={() => setConfirmVoid(r)}
                                    disabled={busyId === r.payment_id}
                                    className="btn btn-danger-outline btn-sm btn-icon"
                                    title={t('members.col_voidPayment', 'Void payment')}
                                    aria-label={t('members.col_voidPayment', 'Void payment')}
                                  >
                                    <Ban size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleRecordPayment(r)}
                                  className="btn btn-primary btn-sm btn-icon"
                                  title={t('members.col_recordPayment', 'Record payment')}
                                  aria-label={t('members.col_recordPayment', 'Record payment')}
                                >
                                  <PlusCircle size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">
                  {fill(t('members.col_showing', 'Showing {from}–{to} of {total}'), { from: n(startIdx), to: n(endIdx), total: n(records.length) })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="btn btn-outline btn-sm"
                  >
                    <ChevronLeft size={13} />
                    <span>{t('common.previous', 'Previous')}</span>
                  </button>
                  <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 px-2">
                    {n(safePage)} / {n(totalPages)}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="btn btn-outline btn-sm"
                  >
                    <span>{t('common.next', 'Next')}</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
                <button onClick={() => setActiveTab('members')} className="btn btn-outline">
                  {t('members.col_viewMembers', 'View all members')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Side panel */}
        <div className="grid grid-cols-1 gap-4 content-start">
          <div className="card-base p-4">
            <h3 className="text-[13px] font-bold text-slate-900 dark:text-white">
              {t('members.col_progress', 'Collection progress')}
            </h3>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {n(stats.percentage)}%{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t('members.col_ofExpected', 'of expected')}</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mt-2.5 p-0.5">
              <div
                className="bg-[#0f4a3c] dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="space-y-2 mt-4 text-[11px]">
              {[
                { dot: 'bg-emerald-600', label: t('status.paid', 'Paid'), count: stats.paidCount, amount: stats.collectedAmount },
                { dot: 'bg-amber-500', label: t('status.pending', 'Pending'), count: stats.pendingCount, amount: pendingAmount },
                { dot: 'bg-rose-500', label: t('status.overdue', 'Overdue'), count: stats.overdueCount, amount: overdueAmount },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${row.dot}`} />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{row.label}</span>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {n(row.count)} / {formatCurrency(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-4 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-[#0f4a3c] dark:text-emerald-300 font-bold mb-1.5 text-[12px]">
              <Info size={16} />
              <span>{t('members.col_lateRule', 'Late payment rule')}</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
              {settings
                ? settings.late_fee_amount > 0
                  ? fill(t('members.col_lateRuleBody',
                      'Dues are due by day {day} of each month. Payments after that are marked Overdue and a late fee of {fee} is suggested.'),
                      { day: n(settings.monthly_due_day), fee: formatCurrency(settings.late_fee_amount) })
                  : fill(t('members.col_lateRuleNoFee', 'Dues are due by day {day} of each month. No late fee is configured.'),
                      { day: n(settings.monthly_due_day) })
                : t('common.loading', 'Loading...')}
            </p>
            <button onClick={() => setActiveTab('settings')} className="btn btn-outline btn-sm mt-2">
              {t('members.col_changeRule', 'Change in settings')}
            </button>
          </div>
        </div>
      </div>

      {/* Entry Center suggestion (kept below the ledger) */}
      <div className="card-base p-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t('members.col_entryHint', 'Need to add money, expense, or investment details?')}
        </span>
        <button
          onClick={() => setActiveTab('entry')}
          className="btn btn-outline"
        >
          <span>{t('members.col_openEntry', 'Open entry center')}</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Voucher modal */}
      <Modal
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        size="sm"
        icon={<Receipt size={18} />}
        title={t('members.col_voucher', 'Payment voucher')}
        subtitle={selectedRecord ? `${memberName(selectedRecord)} · ${formatMonth(selectedRecord.payment_month)}` : undefined}
        footer={selectedRecord && (
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <button
              onClick={() => setConfirmVoid(selectedRecord)}
              disabled={busyId === selectedRecord.payment_id}
              className="btn btn-danger"
            >
              <Ban size={14} />
              <span>{t('members.col_voidPayment', 'Void payment')}</span>
            </button>
            <button
              onClick={() => handleCopyVoucher(selectedRecord)}
              className="btn btn-outline"
            >
              {t('members.copy', 'Copy')}
            </button>
            <button
              onClick={() => handleDownloadVoucher(selectedRecord)}
              className="btn btn-outline"
            >
              <Download size={14} />
              <span>{t('members.download', 'Download')}</span>
            </button>
            <button
              onClick={() => setSelectedRecord(null)}
              className="btn btn-cancel"
            >
              {t('members.done', 'Done')}
            </button>
          </div>
        )}
      >
        {selectedRecord && (
          <div className="text-xs">
            <div className="p-4 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
              {[
                [t('common.member', 'Member'), memberName(selectedRecord)],
                [t('members.col_memberCode', 'Member code'), selectedRecord.member_code],
                [t('members.col_month', 'Month'), formatMonth(selectedRecord.payment_month)],
                [t('members.col_dueDate', 'Due date'), formatDate(selectedRecord.due_date)],
                [t('members.col_paidOn', 'Paid on'), formatDate(selectedRecord.payment_date)],
                [t('members.col_method', 'Payment method'), tv(selectedRecord.payment_method) || '—'],
                [t('members.col_trx', 'Transaction ID'), selectedRecord.trx_id || '—'],
                [t('members.col_contribution', 'Contribution'), formatCurrency(selectedRecord.contribution_amount)],
                [t('members.late_fee', 'Late fee'), formatCurrency(selectedRecord.late_fee || 0)],
                ...(selectedRecord.note ? [[t('members.note', 'Note'), selectedRecord.note]] : []),
              ].map(([k, v]) => (
                <div key={String(k)} className="py-2 flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{k}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-right break-words">{v}</span>
                </div>
              ))}
              <div className="pt-2 flex justify-between items-center">
                <span className="text-slate-700 dark:text-slate-300 font-bold">{t('members.col_total', 'Total')}</span>
                <span className="text-base font-extrabold text-[#0f4a3c] dark:text-emerald-400">
                  {formatCurrency(selectedRecord.total_amount || selectedRecord.contribution_amount + (selectedRecord.late_fee || 0))}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Void confirmation */}
      <Modal
        open={!!confirmVoid}
        onClose={() => busyId == null && setConfirmVoid(null)}
        locked={busyId != null}
        size="sm" tone="danger"
        icon={<Ban size={18} />}
        title={t('members.col_voidTitle', 'Void this payment?')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmVoid(null)}
              disabled={busyId != null}
              className="btn btn-cancel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleVoid}
              disabled={busyId != null}
              className="btn btn-danger"
            >
              <Ban size={14} />
              <span>{busyId != null ? t('members.col_voiding', 'Voiding…') : t('members.col_voidPayment', 'Void payment')}</span>
            </button>
          </>
        }
      >
        {confirmVoid && (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {fill(t('members.col_voidConfirm', 'Void the {month} payment of {amount} by {name}? The due will become unpaid again.'), {
              month: formatMonth(confirmVoid.payment_month),
              amount: formatCurrency(confirmVoid.total_amount || 0),
              name: memberName(confirmVoid),
            })}
          </p>
        )}
      </Modal>
    </div>
  );
};
