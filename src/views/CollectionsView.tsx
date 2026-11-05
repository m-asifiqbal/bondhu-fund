import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowRight,
  Clock,
  Coins,
  CheckCircle2,
  AlertCircle,
  Info,
  Download,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Eye,
  PlusCircle,
  Ban,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCollections, getAppSettings, deletePayment, saveTextFile } from '../services/db';
import { AppSettings, CollectionRecord, CollectionStats, PaymentStatus } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';

type Tab = 'All' | 'Paid' | 'Pending' | 'Overdue';

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
  } = useApp();

  const [allRecords, setAllRecords] = useState<CollectionRecord[]>([]);
  const [stats, setStats] = useState<CollectionStats>(EMPTY_STATS);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<Tab>('All');
  const [selectedRecord, setSelectedRecord] = useState<CollectionRecord | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 10;

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const monthLabel = formatMonth(selectedMonth);

  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch((e: any) => showToast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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
  const hasFilters = !!(searchQuery || startDate || endDate || sortBy !== 'newest');

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

  const handleVoid = async (r: CollectionRecord) => {
    if (r.payment_id == null) return;
    const ok = window.confirm(
      t(
        'collections.voidConfirm',
        `Void the ${formatMonth(r.payment_month)} payment of ${formatCurrency(r.total_amount || 0)} by ${r.member_name}? The due will become unpaid again.`
      )
    );
    if (!ok) return;
    setBusyId(r.payment_id);
    try {
      await deletePayment(r.payment_id);
      showToast(t('collections.voided', 'Payment voided.'));
      if (selectedRecord?.payment_id === r.payment_id) setSelectedRecord(null);
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const voucherText = (r: CollectionRecord) => {
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
      `Member Name      : ${r.member_name || '-'}`,
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
      const res = await saveTextFile(
        `Voucher_${r.member_code || r.member_id}_${r.payment_month}.txt`,
        voucherText(r),
        [{ name: 'Text', extensions: ['txt'] }]
      );
      if (!res.canceled) showToast(t('collections.voucherSaved', 'Voucher saved.'));
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleCopyVoucher = async (r: CollectionRecord) => {
    try {
      await navigator.clipboard.writeText(voucherText(r));
      showToast(t('collections.voucherCopied', 'Voucher copied to clipboard.'));
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
        {t(`status.${status.toLowerCase()}`, status)}
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
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'মাসিক চাঁদা কালেকশন' : 'Monthly collections'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {language === 'bn'
              ? 'সদস্যদের নিয়মিত চাঁদা, বিলম্ব ফি এবং বকেয়ার হিসাব।'
              : 'Track contributions, late payments, and outstanding dues.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} align="right" />
          <button
            onClick={() => {
              setSelectedMemberIdForPayment(null);
              setOpenRecordModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <PlusCircle size={14} />
            <span>{t('collections.recordPayment', 'Record payment')}</span>
          </button>
        </div>
      </div>

      {/* Entry Center banner */}
      <div className="card-base p-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t('collections.entryHint', 'Need to add money, expense, or investment details?')}
        </span>
        <button
          onClick={() => setActiveTab('entry')}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-[#0f4a3c] dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-xl text-xs font-bold transition-all shadow-sm"
        >
          <span>{t('collections.openEntry', 'Open entry center')}</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCard(
          'border-l-purple-500',
          t('collections.expected', `Expected in ${monthLabel}`),
          <Coins size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(stats.expectedAmount),
          'text-slate-900 dark:text-white',
          `${n(stats.totalMembers)} ${t('collections.memberDues', 'member dues')}`
        )}
        {statCard(
          'border-l-emerald-500',
          t('collections.collected', 'Collected'),
          <CheckCircle2 size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(stats.collectedAmount),
          'text-emerald-600 dark:text-emerald-400',
          `${n(stats.percentage)}% ${t('collections.ofExpected', 'of expected')}`,
          'text-emerald-600 dark:text-emerald-400 font-bold'
        )}
        {statCard(
          'border-l-amber-500',
          t('collections.lateFees', 'Late fees'),
          <Clock size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          formatCurrency(stats.lateFeeAmount),
          'text-amber-600 dark:text-amber-400',
          `${n(latePaymentsCount)} ${t('collections.latePayments', 'late payments')}`
        )}
        {statCard(
          'border-l-rose-500',
          t('collections.outstanding', 'Outstanding'),
          <AlertCircle size={16} />,
          'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
          formatCurrency(stats.outstandingAmount),
          'text-rose-600 dark:text-rose-400',
          `${n(stats.pendingCount + stats.overdueCount)} ${t('collections.unpaidDues', 'unpaid dues')}`,
          'text-rose-600 dark:text-rose-400 font-bold'
        )}
      </div>

      {/* Ledger + side panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 card-base p-5 lg:p-6 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {monthLabel} {t('collections.ledger', 'collection ledger')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('collections.ledgerSub', 'Review contribution status and payment details.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center bg-slate-100 dark:bg-[#111e24] p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              {tabs.map(tb => (
                <button
                  key={tb.key}
                  onClick={() => setSelectedTab(tb.key)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    selectedTab === tb.key
                      ? `bg-white dark:bg-[#182830] shadow-sm ${tb.active}`
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t(`status.${tb.key.toLowerCase()}`, tb.key)} {n(tb.count)}
                </button>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="p-3 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder={t('collections.searchPh', 'Search member, code, phone or TRX ID...')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="form-input pl-8"
              />
            </div>
            <div className="w-48">
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="form-select">
                <option value="newest">{t('sort.newest', 'Sort: Newest first')}</option>
                <option value="oldest">{t('sort.oldest', 'Sort: Oldest first')}</option>
                <option value="status">{t('sort.status', 'Status (unpaid first)')}</option>
                <option value="name_asc">{t('sort.nameAsc', 'Member: A to Z')}</option>
                <option value="name_desc">{t('sort.nameDesc', 'Member: Z to A')}</option>
                <option value="amount_high">{t('sort.amountHigh', 'Amount: High to low')}</option>
                <option value="amount_low">{t('sort.amountLow', 'Amount: Low to high')}</option>
                <option value="date_desc">{t('sort.dateDesc', 'Payment date: Latest')}</option>
                <option value="date_asc">{t('sort.dateAsc', 'Payment date: Earliest')}</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2" title={t('collections.dateHint', 'Filters by payment date (unpaid dues are hidden)')}>
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.paidFrom', 'Paid from')}:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.to', 'To')}:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStartDate('');
                  setEndDate('');
                  setSortBy('newest');
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-[#182830] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold transition-colors"
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
                  {t('collections.emptyTitle', `No dues for ${monthLabel}`)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                  {t('collections.emptyBody', 'Dues appear here for every active member who had joined by this month. Add members to start tracking collections.')}
                </p>
              </div>
              <button
                onClick={() => setActiveTab('members')}
                className="px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {t('collections.goMembers', 'Go to members')}
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto w-full">
                <table className="w-full min-w-[820px] text-left text-xs text-slate-800 dark:text-slate-200">
                  <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-3">{t('common.member')}</th>
                      <th className="py-3 px-3">{language === 'bn' ? 'নির্ধারিত তারিখ' : 'Due date'}</th>
                      <th className="py-3 px-3">{t('collections.paidOn', 'Paid on')}</th>
                      <th className="py-3 px-3 text-right">{language === 'bn' ? 'নিয়মিত চাঁদা' : 'Contribution'}</th>
                      <th className="py-3 px-3 text-right">{language === 'bn' ? 'বিলম্ব ফি' : 'Late fee'}</th>
                      <th className="py-3 px-3">{t('common.status')}</th>
                      <th className="py-3 px-3 text-right">{t('common.action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                    {loading && allRecords.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          {t('common.loading', 'Loading...')}
                        </td>
                      </tr>
                    ) : displayedRecords.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          {language === 'bn' ? 'কোনো কালেকশন রেকর্ড পাওয়া যায়নি।' : 'No collection records match your criteria.'}
                        </td>
                      </tr>
                    ) : (
                      displayedRecords.map(r => {
                        const paid = isPaid(r);
                        return (
                          <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                            <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                              {r.member_name}
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
                                  {formatCurrency(dueOf(r))} {t('collections.due', 'due')}
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
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[#0f4a3c] dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg font-bold transition-colors"
                                  >
                                    <Eye size={13} />
                                    <span>{t('common.view')}</span>
                                  </button>
                                  <button
                                    onClick={() => handleDownloadVoucher(r)}
                                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                                    title={t('collections.downloadVoucher', 'Download voucher')}
                                  >
                                    <Download size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleVoid(r)}
                                    disabled={busyId === r.payment_id}
                                    className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={t('collections.voidPayment', 'Void payment')}
                                  >
                                    <Ban size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleRecordPayment(r)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-lg font-bold transition-colors"
                                >
                                  <PlusCircle size={13} />
                                  <span>{t('collections.recordPayment', 'Record payment')}</span>
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
                  {t('common.showing', 'Showing')} {n(startIdx)}-{n(endIdx)} {t('common.of', 'of')} {n(records.length)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-slate-700 dark:text-slate-200"
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
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-slate-700 dark:text-slate-200"
                  >
                    <span>{t('common.next', 'Next')}</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
                <button onClick={() => setActiveTab('members')} className="text-[#0f4a3c] dark:text-emerald-400 hover:underline font-bold">
                  {t('collections.viewMembers', 'View all members')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Side panel */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-6 content-start">
          <div className="card-base p-6">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              {t('collections.progress', 'Collection progress')}
            </h3>
            <div className="text-3xl font-black text-slate-900 dark:text-white mt-2">
              {n(stats.percentage)}%{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t('collections.ofExpected', 'of expected')}</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden mt-3 p-0.5">
              <div
                className="bg-[#0f4a3c] dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="space-y-3 mt-6 text-xs">
              {[
                { dot: 'bg-emerald-600', label: t('status.paid', 'Paid'), count: stats.paidCount, amount: stats.collectedAmount },
                { dot: 'bg-amber-500', label: t('status.pending', 'Pending'), count: stats.pendingCount, amount: pendingAmount },
                { dot: 'bg-rose-500', label: t('status.overdue', 'Overdue'), count: stats.overdueCount, amount: overdueAmount },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${row.dot}`} />
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{row.label}</span>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {n(row.count)} / {formatCurrency(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-5 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-[#0f4a3c] dark:text-emerald-300 font-bold mb-1.5">
              <Info size={16} />
              <span>{t('collections.lateRule', 'Late payment rule')}</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
              {settings
                ? settings.late_fee_amount > 0
                  ? t(
                      'collections.lateRuleBody',
                      `Dues are due by day ${settings.monthly_due_day} of each month. Payments after that are marked Overdue and a late fee of ${formatCurrency(settings.late_fee_amount)} is suggested.`
                    )
                  : t(
                      'collections.lateRuleNoFee',
                      `Dues are due by day ${settings.monthly_due_day} of each month. No late fee is configured.`
                    )
                : t('common.loading', 'Loading...')}
            </p>
            <button onClick={() => setActiveTab('settings')} className="mt-2 text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline">
              {t('collections.changeRule', 'Change in settings')}
            </button>
          </div>
        </div>
      </div>

      {/* Voucher modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-md p-6 text-xs space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('collections.voucher', 'Payment voucher')}</h3>
              <button onClick={() => setSelectedRecord(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
              {[
                [t('common.member', 'Member'), selectedRecord.member_name],
                [t('collections.memberCode', 'Member code'), selectedRecord.member_code],
                [t('collections.month', 'Month'), formatMonth(selectedRecord.payment_month)],
                [t('collections.dueDate', 'Due date'), formatDate(selectedRecord.due_date)],
                [t('collections.paidOn', 'Paid on'), formatDate(selectedRecord.payment_date)],
                [t('collections.method', 'Method'), selectedRecord.payment_method || '—'],
                [t('collections.trx', 'TRX ID'), selectedRecord.trx_id || '—'],
                [t('collections.contribution', 'Contribution'), formatCurrency(selectedRecord.contribution_amount)],
                [t('collections.lateFee', 'Late fee'), formatCurrency(selectedRecord.late_fee || 0)],
                ...(selectedRecord.note ? [[t('common.note', 'Note'), selectedRecord.note]] : []),
              ].map(([k, v]) => (
                <div key={String(k)} className="py-2 flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{k}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-right break-words">{v}</span>
                </div>
              ))}
              <div className="pt-2 flex justify-between items-center">
                <span className="text-slate-700 dark:text-slate-300 font-bold">{t('collections.total', 'Total')}</span>
                <span className="text-base font-extrabold text-[#0f4a3c] dark:text-emerald-400">
                  {formatCurrency(selectedRecord.total_amount || selectedRecord.contribution_amount + (selectedRecord.late_fee || 0))}
                </span>
              </div>
            </div>
            <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => handleVoid(selectedRecord)}
                disabled={busyId === selectedRecord.payment_id}
                className="flex items-center gap-1.5 px-3.5 py-2 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-xl font-bold disabled:opacity-40"
              >
                <Ban size={14} />
                <span>{t('collections.voidPayment', 'Void payment')}</span>
              </button>
              <button
                onClick={() => handleCopyVoucher(selectedRecord)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold"
              >
                {t('common.copy', 'Copy')}
              </button>
              <button
                onClick={() => handleDownloadVoucher(selectedRecord)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold"
              >
                <Download size={14} />
                <span>{t('common.download', 'Download')}</span>
              </button>
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
              >
                {t('common.done', 'Done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
