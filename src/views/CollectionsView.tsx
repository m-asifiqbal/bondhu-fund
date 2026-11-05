import React, { useState, useEffect } from 'react';
import {
  Calendar,
  ChevronDown,
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
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getCollections } from '../services/db';
import { CollectionRecord, PaymentStatus } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';

export const CollectionsView: React.FC = () => {
  const { setActiveTab, refreshKey, selectedMonth, setSelectedMonth, showToast, language, t, formatCurrency, toBanglaDigits } = useApp();
  const [records, setRecords] = useState<CollectionRecord[]>([]);
  const [stats, setStats] = useState<any>({
    totalMembers: 48,
    paidCount: 42,
    pendingCount: 3,
    overdueCount: 3,
    collectedAmount: 84000,
    lateFeeAmount: 1200,
    expectedAmount: 96000,
    outstandingAmount: 12000,
    percentage: '87.5',
  });
  const [selectedTab, setSelectedTab] = useState<'All' | 'Paid' | 'Pending' | 'Overdue'>('All');
  const [selectedRecord, setSelectedRecord] = useState<CollectionRecord | null>(null);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);

  // Search, Date Range, Sort, & Pagination Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 6;

  const months = ['April 2024', 'May 2024', 'June 2024', 'July 2024'];

  useEffect(() => {
    getCollections(selectedMonth, selectedTab, startDate, endDate, searchQuery, sortBy).then(res => {
      setRecords(res.records);
      setStats(res.stats);
    });
  }, [selectedMonth, selectedTab, startDate, endDate, searchQuery, sortBy, refreshKey]);

  const totalPages = Math.ceil(records.length / limit) || 1;
  const safePage = Math.min(page, totalPages);
  const displayedRecords = records.slice((safePage - 1) * limit, safePage * limit);
  const startIdx = records.length === 0 ? 0 : (safePage - 1) * limit + 1;
  const endIdx = Math.min(safePage * limit, records.length);

  const handleDownloadVoucher = (r: CollectionRecord) => {
    showToast(`Downloading Official Payment Voucher for ${r.member_name}...`);
    const voucherText = `========================================================
             BONDHU FUND - UNION FINANCE DESK
                 OFFICIAL PAYMENT VOUCHER
========================================================
Receipt / TRX ID : ${r.trx_id || 'TRX-DEFAULT'}
Payment Month    : ${r.payment_month}
Payment Date     : ${r.payment_date || new Date().toLocaleDateString('en-GB')}
--------------------------------------------------------
Member Code      : ${r.member_code}
Member Name      : ${r.member_name}
Payment Method   : ${r.payment_method}
--------------------------------------------------------
Monthly Due      : TK 2,000
Late Fine        : TK ${r.late_fee}
--------------------------------------------------------
TOTAL RECEIVED   : TK ${(r.contribution_amount + r.late_fee).toLocaleString()}
Status           : ${r.status}
Notes            : ${r.note || 'Monthly union contribution'}
========================================================
Audited & Verified via Local SQLite Database
========================================================`;

    const blob = new Blob([voucherText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Voucher_${r.member_code}_${r.payment_month.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Paid
          </span>
        );
      case 'Pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Pending
          </span>
        );
      case 'Overdue':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            Overdue
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header Row */}
      <div className="flex items-center justify-between">
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

        {/* Visual Month Picker (Replaced select dropdown) */}
        <MonthPicker
          value={selectedMonth}
          onChange={(m) => {
            setSelectedMonth(m);
            showToast(language === 'bn' ? `নির্বাচিত মাস: ${m}` : `Loaded ledger for ${m}`);
          }}
        />
      </div>

      {/* Entry Center Quick Action Banner (Matching Image 3) */}
      <div className="card-base p-4 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Need to add money, expense, or investment details?
        </span>
        <button
          onClick={() => setActiveTab('entry')}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-[#0f4a3c] dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-xl text-xs font-bold transition-all shadow-sm"
        >
          <span>Open entry center</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Expected this month */}
        <div className="card-base p-5 border-l-4 border-l-purple-500 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Expected this<br />month
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Coins size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              TK {stats.expectedAmount.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
              {stats.totalMembers} member contributions
            </div>
          </div>
        </div>

        {/* Card 2: Collected */}
        <div className="card-base p-5 border-l-4 border-l-emerald-500 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Collected</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
              TK {stats.collectedAmount.toLocaleString()}
            </div>
            <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {stats.percentage}% of expected
            </div>
          </div>
        </div>

        {/* Card 3: Late fees */}
        <div className="card-base p-5 border-l-4 border-l-amber-500 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Late fees</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
              TK {stats.lateFeeAmount.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
              4 late payments
            </div>
          </div>
        </div>

        {/* Card 4: Outstanding */}
        <div className="card-base p-5 border-l-4 border-l-rose-500 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Outstanding</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertCircle size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
              TK {stats.outstandingAmount.toLocaleString()}
            </div>
            <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold mt-1">
              {stats.pendingCount + stats.overdueCount} member dues
            </div>
          </div>
        </div>
      </div>

      {/* Middle Split: Ledger on Left, Progress & Late Rule on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: June 2024 Collection Ledger */}
        <div className="lg:col-span-2 card-base p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{selectedMonth} collection ledger</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Review contribution status and payment details.</p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center bg-slate-100 dark:bg-[#111e24] p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <button
                onClick={() => { setSelectedTab('All'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  selectedTab === 'All'
                    ? 'bg-white dark:bg-[#182830] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All {stats.totalMembers}
              </button>
              <button
                onClick={() => { setSelectedTab('Paid'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  selectedTab === 'Paid'
                    ? 'bg-white dark:bg-[#182830] text-emerald-700 dark:text-emerald-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Paid {stats.paidCount}
              </button>
              <button
                onClick={() => { setSelectedTab('Pending'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  selectedTab === 'Pending'
                    ? 'bg-white dark:bg-[#182830] text-amber-700 dark:text-amber-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Pending {stats.pendingCount}
              </button>
              <button
                onClick={() => { setSelectedTab('Overdue'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  selectedTab === 'Overdue'
                    ? 'bg-white dark:bg-[#182830] text-rose-700 dark:text-rose-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Overdue {stats.overdueCount}
              </button>
            </div>
          </div>

          {/* Search, Sort & Date Range Filter Bar */}
          <div className="p-3 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search member, code, or TRX ID..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                className="form-input pl-8"
              />
            </div>

            {/* Sort Dropdown */}
            <div className="w-44">
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); setPage(1); }}
                className="form-select"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="amount_high">Amount: High to Low</option>
                <option value="amount_low">Amount: Low to High</option>
                <option value="name_asc">Member: A to Z</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setPage(1); }}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setPage(1); }}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
            </div>

            {(searchQuery || startDate || endDate || sortBy !== 'newest') && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setStartDate(''); setEndDate(''); setSortBy('newest'); setPage(1); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-[#182830] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold transition-colors"
                title="Reset filters"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Table with Guaranteed Horizontal Scroll */}
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[750px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-3">{t('common.member')}</th>
                  <th className="py-3 px-3">{language === 'bn' ? 'নির্ধারিত তারিখ' : 'Due date'}</th>
                  <th className="py-3 px-3">{language === 'bn' ? 'নিয়মিত চাঁদা' : 'Contribution'}</th>
                  <th className="py-3 px-3">{language === 'bn' ? 'বিলম্ব ফি' : 'Late fee'}</th>
                  <th className="py-3 px-3">{t('common.status')}</th>
                  <th className="py-3 px-3 text-right">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {displayedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      {language === 'bn' ? 'কোনো কালেকশন রেকর্ড পাওয়া যায়নি।' : 'No collection records match your criteria.'}
                    </td>
                  </tr>
                ) : (
                  displayedRecords.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                      <td className="py-3.5 px-3 font-bold text-slate-900 dark:text-white">
                        {r.member_name}
                        {r.member_code && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal ml-1">
                            ({r.member_code})
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 dark:text-slate-400">{r.due_date}</td>
                      <td className="py-3.5 px-3 font-black text-slate-900 dark:text-white">
                        {formatCurrency(2000)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-700 dark:text-slate-300 font-semibold">
                        {formatCurrency(r.late_fee)}
                      </td>
                      <td className="py-3.5 px-3">{getStatusBadge(r.status)}</td>
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
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
                            title="Download Voucher"
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination & Footer */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">
              Showing {startIdx}-{endIdx} of {records.length} records
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-slate-700 dark:text-slate-200"
              >
                <ChevronLeft size={13} />
                <span>Previous</span>
              </button>

              <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 px-2">
                Page {safePage} of {totalPages}
              </span>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-slate-700 dark:text-slate-200"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            </div>

            <button
              onClick={() => setActiveTab('members')}
              className="text-[#0f4a3c] dark:text-emerald-400 hover:underline font-bold"
            >
              View all members
            </button>
          </div>
        </div>

        {/* Right 1 Col: Collection Progress & Late Payment Rule */}
        <div className="space-y-6">
          {/* Collection Progress Card */}
          <div className="card-base p-6">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Collection progress</h3>
            <div className="text-3xl font-black text-slate-900 dark:text-white mt-2">
              {stats.percentage}% <span className="text-xs font-normal text-slate-500 dark:text-slate-400">of expected</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden mt-3 p-0.5">
              <div
                className="bg-[#0f4a3c] dark:bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>

            {/* Breakdown List */}
            <div className="space-y-3 mt-6 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-600" />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Paid</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white">
                  {stats.paidCount} / TK {stats.collectedAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500" />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Pending</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white">
                  {stats.pendingCount} / TK {(stats.pendingCount * 2000).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-500" />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Overdue</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white">
                  {stats.overdueCount} / TK {(stats.overdueCount * 2000).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Late Payment Rule Callout (Matching Image 3) */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl p-5 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-[#0f4a3c] dark:text-emerald-300 font-bold mb-1.5">
              <Info size={16} />
              <span>Late payment rule</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
              A TK 300 fine is added when a member pays the previous month after the due date.
            </p>
          </div>
        </div>
      </div>

      {/* Record View Voucher Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-md p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Official Payment Voucher</h3>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
              <div className="pb-2 flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Member:</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">{selectedRecord.member_name}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Member Code:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedRecord.member_code}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Billing Month:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.payment_month}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Due Date:</span>
                <span className="text-slate-800 dark:text-slate-200">{selectedRecord.due_date}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment Date:</span>
                <span className="text-slate-800 dark:text-slate-200">{selectedRecord.payment_date || 'Pending'}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Contribution:</span>
                <span className="font-bold text-slate-900 dark:text-white">TK {selectedRecord.contribution_amount.toLocaleString()}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Late Fee Fine:</span>
                <span className="font-bold text-slate-900 dark:text-white">TK {selectedRecord.late_fee.toLocaleString()}</span>
              </div>
              <div className="pt-2 flex justify-between items-center">
                <span className="text-slate-700 dark:text-slate-300 font-bold">Total Amount:</span>
                <span className="text-base font-extrabold text-[#0f4a3c] dark:text-emerald-400">
                  TK {(selectedRecord.contribution_amount + selectedRecord.late_fee).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => handleDownloadVoucher(selectedRecord)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold"
              >
                <Download size={14} />
                <span>Download Voucher</span>
              </button>
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
