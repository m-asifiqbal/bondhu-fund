import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  Calendar,
  X,
  FileCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Wallet,
  Receipt,
  Building,
  TrendingUp,
  Download,
  Users,
  Eye,
  FileText,
  Clock,
  Briefcase,
  Layers,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getExpenses, addExpense, verifyExpenseReceipt, getMasterData } from '../services/db';
import { Expense, MasterCategory } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';

export const ExpensesView: React.FC = () => {
  const {
    showToast,
    refreshKey,
    triggerRefresh,
    selectedMonth,
    setSelectedMonth,
    language,
    t,
    formatCurrency,
    toBanglaDigits,
  } = useApp();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [verifyExpenseId, setVerifyExpenseId] = useState<number | null>(null);
  const [receiptVoucher, setReceiptVoucher] = useState('');

  // Filter, Sort & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 8;

  // Add Expense form states
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Meetup & Events');
  const [amount, setAmount] = useState<number>(2500);
  const [expenseDate, setExpenseDate] = useState('28 Jun 2024');
  const [payee, setPayee] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    getExpenses(categoryFilter, statusFilter, startDate, endDate, searchQuery, sortBy).then(setExpenses);
    getMasterData('expense_category').then(setCategories);
  }, [categoryFilter, statusFilter, startDate, endDate, searchQuery, sortBy, refreshKey]);

  const totalExpense = useMemo(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);
  const pendingReceiptsCount = useMemo(() => expenses.filter(e => e.status === 'Needs receipt').length, [expenses]);
  const verifiedCount = useMemo(() => expenses.filter(e => e.status === 'Verified').length, [expenses]);

  const totalPages = Math.ceil(expenses.length / limit) || 1;
  const safePage = Math.min(page, totalPages);
  const displayedExpenses = expenses.slice((safePage - 1) * limit, safePage * limit);
  const startIdx = expenses.length === 0 ? 0 : (safePage - 1) * limit + 1;
  const endIdx = Math.min(safePage * limit, expenses.length);

  // Authentic Union Operational Category Filter Chips
  const unionCategoryCards = [
    {
      id: 'meetup',
      name: language === 'bn' ? 'সভা ও অনুষ্ঠান' : 'Meetup & Events',
      filterVal: 'Meetup & Events',
      icon: Users,
      color: '#8b5cf6',
      iconBg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
      badgeBg: 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300',
      amount: 6800,
      pct: '34%',
    },
    {
      id: 'supplies',
      name: language === 'bn' ? 'দাপ্তরিক সামগ্রী' : 'Office Supplies',
      filterVal: 'Office Supplies',
      icon: Briefcase,
      color: '#3b82f6',
      iconBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
      badgeBg: 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300',
      amount: 2200,
      pct: '11%',
    },
    {
      id: 'legal',
      name: language === 'bn' ? 'আইনি ও দলিল' : 'Legal & Documentation',
      filterVal: 'Legal & Documentation',
      icon: FileText,
      color: '#f59e0b',
      iconBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
      badgeBg: 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300',
      amount: 4500,
      pct: '23%',
    },
    {
      id: 'maintenance',
      name: language === 'bn' ? 'রক্ষণাবেক্ষণ' : 'Maintenance',
      filterVal: 'Maintenance',
      icon: Building,
      color: '#10b981',
      iconBg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
      badgeBg: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300',
      amount: 3800,
      pct: '19%',
    },
    {
      id: 'refreshments',
      name: language === 'bn' ? 'কমিটি আপ্যায়ন' : 'Refreshments',
      filterVal: 'Committee Refreshments',
      icon: Receipt,
      color: '#ec4899',
      iconBg: 'bg-pink-100 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400',
      badgeBg: 'bg-pink-100 dark:bg-pink-950/80 text-pink-700 dark:text-pink-300',
      amount: 1800,
      pct: '9%',
    },
    {
      id: 'bank',
      name: language === 'bn' ? 'ব্যাংক ও এসএমএস' : 'Bank & SMS',
      filterVal: 'Bank Charges & SMS',
      icon: Layers,
      color: '#64748b',
      iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
      badgeBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
      amount: 1150,
      pct: '4%',
    },
  ];

  // Helper for Category Styling in Table
  const getCategoryDetails = (catName: string) => {
    const lower = catName.toLowerCase();
    if (lower.includes('meet') || lower.includes('event')) {
      return {
        icon: Users,
        iconBg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
        badgeBg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
      };
    }
    if (lower.includes('legal') || lower.includes('doc')) {
      return {
        icon: FileText,
        iconBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
        badgeBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
      };
    }
    if (lower.includes('suppl') || lower.includes('stat')) {
      return {
        icon: Briefcase,
        iconBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
        badgeBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300',
      };
    }
    if (lower.includes('maint') || lower.includes('gen')) {
      return {
        icon: Building,
        iconBg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
        badgeBg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
      };
    }
    if (lower.includes('refr') || lower.includes('tea') || lower.includes('snack')) {
      return {
        icon: Receipt,
        iconBg: 'bg-pink-100 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400',
        badgeBg: 'bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300',
      };
    }
    return {
      icon: Receipt,
      iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
      badgeBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
    };
  };

  const handleExportExpenses = () => {
    showToast(
      language === 'bn'
        ? 'পরিচালনা ব্যয়ের অডিট রিপোর্ট ডাউনলোড হচ্ছে...'
        : 'Downloading Operating Expenses Audit Log...'
    );

    const header = ['Expense Title', 'Category', 'Amount', 'Date', 'Payee', 'Receipt Ref', 'Audit Status', 'Notes'];
    const rows = expenses.map(e => [
      `"${e.title}"`,
      `"${e.category}"`,
      e.amount,
      `"${e.expense_date}"`,
      `"${e.payee}"`,
      `"${e.receipt_ref || '-'}"`,
      `"${e.status}"`,
      `"${e.notes || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.href = encodedUri;
    link.download = `Bondhu_Fund_Expenses_${selectedMonth.replace(/\s+/g, '_')}.csv`;
    link.click();
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !payee.trim()) return;

    try {
      await addExpense({
        title,
        category,
        amount: Number(amount),
        expense_date: expenseDate,
        payee,
        receipt_ref: receiptRef || 'RCP-PENDING',
        status: receiptRef ? 'Verified' : 'Needs receipt',
        notes,
      });

      showToast(
        language === 'bn'
          ? `ব্যয় "${title}" সফলভাবে SQLite ডাটাবেজে সংরক্ষণ করা হয়েছে!`
          : `Expense "${title}" recorded successfully in SQLite!`
      );
      triggerRefresh();
      setShowAddModal(false);
      setTitle('');
      setPayee('');
      setReceiptRef('');
      setNotes('');
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyExpenseId || !receiptVoucher.trim()) return;

    try {
      await verifyExpenseReceipt(verifyExpenseId, receiptVoucher);
      showToast(
        language === 'bn'
          ? 'রশিদ সফলভাবে অডিট ও যাচাইকরণ সম্পন্ন হয়েছে!'
          : 'Receipt voucher verified and cleared by auditor!'
      );
      triggerRefresh();
      setVerifyExpenseId(null);
      setReceiptVoucher('');
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  // Convert Master Categories to SearchableSelect options
  const categoryOptions: SelectOption[] = categories.length > 0
    ? categories.map(c => ({ value: c.name, label: c.name }))
    : [
        { value: 'Meetup & Events', label: 'Meetup & Events' },
        { value: 'Office Supplies', label: 'Office Supplies' },
        { value: 'Legal & Documentation', label: 'Legal & Documentation' },
        { value: 'Maintenance', label: 'Maintenance' },
        { value: 'Committee Refreshments', label: 'Committee Refreshments' },
        { value: 'Bank Charges & SMS', label: 'Bank Charges & SMS' },
      ];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header - Authentic Union Finance Desk */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'পরিচালনা ব্যয় ও খরচের হিসাব' : 'Operating Expenses'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {language === 'bn'
              ? 'বন্ধু ফান্ডের দাপ্তরিক খরচ, মিটিং ব্যয় ও অডিট রশিদের হিসাব।'
              : 'Track union operational costs, meeting disbursements, and audit receipts.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Visual Month Picker */}
          <MonthPicker
            value={selectedMonth}
            onChange={(m) => {
              setSelectedMonth(m);
              showToast(language === 'bn' ? `নির্বাচিত মাস: ${m}` : `Viewing expenses for ${m}`);
            }}
          />

          {/* Export Report Action */}
          <button
            onClick={handleExportExpenses}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={14} className="text-slate-500" />
            <span>{t('common.export')}</span>
          </button>

          {/* Primary Action Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>{language === 'bn' ? '+ খরচ এন্ট্রি' : '+ Record Expense'}</span>
          </button>
        </div>
      </div>

      {/* Top 4 Metric Cards with Left-Accent Border */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Operating Expenses (Purple Accent) */}
        <div className="card-base border-l-4 border-l-purple-500 p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'মোট পরিচালনা ব্যয়' : 'Total Operating Expenses'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Wallet size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {formatCurrency(totalExpense)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
              {language === 'bn' ? 'লোকাল SQLite লেজারে সংরক্ষিত' : 'Recorded in local SQLite ledger'}
            </div>
          </div>
        </div>

        {/* Card 2: Pending Receipts (Amber Accent) */}
        <div className="card-base border-l-4 border-l-amber-500 p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'অপেক্ষমাণ রশিদ ভাউচার' : 'Pending Receipt Vouchers'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
              {language === 'bn' ? toBanglaDigits(pendingReceiptsCount) : pendingReceiptsCount}
            </div>
            <div className="text-[11px] text-amber-600 dark:text-amber-400 font-bold mt-1">
              {language === 'bn' ? 'অডিটর যাচাইকরণ প্রয়োজন' : 'Requires treasurer verification'}
            </div>
          </div>
        </div>

        {/* Card 3: Verified Receipts (Emerald Accent) */}
        <div className="card-base border-l-4 border-l-emerald-500 p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'যাচাইকৃত ভাউচার' : 'Verified Receipts'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
              {language === 'bn' ? toBanglaDigits(verifiedCount) : verifiedCount}
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold mt-1">
              {language === 'bn' ? 'সম্পূর্ণ অডিট ক্লিয়ারেন্সপ্রাপ্ত' : 'Full auditor clearance'}
            </div>
          </div>
        </div>

        {/* Card 4: Operating Reserve (Blue Accent) */}
        <div className="card-base border-l-4 border-l-blue-500 p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'মোট তহবিল ব্যালেন্স' : 'Net Fund Reserve'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Building size={16} />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {formatCurrency(1284600)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
              {language === 'bn' ? 'অর্থবছর ২০২৪-২০২৫' : 'Fiscal Year 2024-2025'}
            </div>
          </div>
        </div>
      </div>

      {/* Spending by Operational Category - Quick Interactive Filter Cards */}
      <div className="card-base p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'খাতভিত্তিক পরিচালনা ব্যয়' : 'Expenses by Union Category'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {language === 'bn' ? 'খাত অনুযায়ী দ্রুত ফিল্টার করতে ক্লিক করুন' : 'Click any category card to quick-filter your ledger'}
            </p>
          </div>
          {categoryFilter !== 'All' ? (
            <button
              onClick={() => setCategoryFilter('All')}
              className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
            >
              <RotateCcw size={12} />
              <span>{language === 'bn' ? `ফিল্টার মুছুন (${categoryFilter})` : `Clear Filter (${categoryFilter})`}</span>
            </button>
          ) : (
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'সকল খাত সক্রিয়' : 'All Categories Active'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {unionCategoryCards.map(cat => {
            const Icon = cat.icon;
            const isSelected = categoryFilter.toLowerCase() === cat.filterVal.toLowerCase();
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(isSelected ? 'All' : cat.filterVal)}
                className={`p-3 rounded-2xl border text-left transition-all relative ${
                  isSelected
                    ? 'border-slate-900 dark:border-white shadow-md ring-2 ring-slate-900/10 dark:ring-white/10 bg-slate-50 dark:bg-slate-800'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-[#15232b]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cat.iconBg}`}>
                    <Icon size={16} />
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${cat.badgeBg}`}>
                    {language === 'bn' ? toBanglaDigits(cat.pct) : cat.pct}
                  </span>
                </div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                  {cat.name}
                </div>
                <div className="text-sm font-black text-slate-900 dark:text-white mt-1">
                  {formatCurrency(cat.amount)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Expenses Ledger Table with Search, Filter & Guaranteed Horizontal Scroll */}
      <div className="card-base overflow-hidden flex flex-col justify-between shadow-sm">
        <div>
          <div className="p-5 pb-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {language === 'bn' ? 'পরিচালনা ব্যয়ের লেজার' : 'Operating Expenses Ledger'}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {language === 'bn'
                  ? 'তারিখ, খাত এবং অডিট স্ট্যাটাস অনুযায়ী ব্যয়ের হিসাব'
                  : 'Filter disbursements by search query, date, or status.'}
              </p>
            </div>

            <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {language === 'bn' ? 'মোট মিলানো হয়েছে:' : 'Total Matching:'}{' '}
              <span className="text-rose-600 dark:text-rose-400 font-black">
                {formatCurrency(totalExpense)}
              </span>
            </div>
          </div>

          {/* Filter Bar with Searchable Category Dropdown */}
          <div className="p-3 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2.5 text-xs">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={language === 'bn' ? 'বিবরণ, প্রাপক, রশিদ দিয়ে খুঁজুন...' : 'Search description, payee, ref...'}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                className="form-input pl-8 py-1.5 text-xs"
              />
            </div>

            <div className="w-44">
              <SearchableSelect
                options={[{ value: 'All', label: language === 'bn' ? 'সকল খাত' : 'All Categories' }, ...categoryOptions]}
                value={categoryFilter}
                onChange={val => { setCategoryFilter(String(val)); setPage(1); }}
                placeholder="Category..."
              />
            </div>

            <div className="w-32">
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                className="form-select py-1.5 text-xs"
              >
                <option value="All">{language === 'bn' ? 'সকল অবস্থা' : 'All Status'}</option>
                <option value="Verified">{language === 'bn' ? 'যাচাইকৃত' : 'Verified'}</option>
                <option value="Needs receipt">{language === 'bn' ? 'রশিদ বাকি' : 'Needs receipt'}</option>
              </select>
            </div>

            <div className="w-36">
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); setPage(1); }}
                className="form-select py-1.5 text-xs"
              >
                <option value="newest">{language === 'bn' ? 'নতুন আগে' : 'Sort: Newest'}</option>
                <option value="oldest">{language === 'bn' ? 'পুরাতন আগে' : 'Sort: Oldest'}</option>
                <option value="amount_high">{language === 'bn' ? 'টাকার অংক (বেশি)' : 'Amount: High-Low'}</option>
                <option value="amount_low">{language === 'bn' ? 'টাকার অংক (কম)' : 'Amount: Low-High'}</option>
              </select>
            </div>

            {(searchQuery || categoryFilter !== 'All' || statusFilter !== 'All' || sortBy !== 'newest') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('All');
                  setStatusFilter('All');
                  setSortBy('newest');
                  setPage(1);
                }}
                className="px-2.5 py-1.5 bg-white dark:bg-[#182830] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold transition-colors"
                title="Reset filters"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          {/* Table with Horizontal Scroll (min-w-[820px]) */}
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[820px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">{t('common.date')}</th>
                  <th className="py-3 px-4">{language === 'bn' ? 'খরচের বিবরণ ও প্রাপক' : 'Expense & Payee'}</th>
                  <th className="py-3 px-4">{language === 'bn' ? 'খাত' : 'Category'}</th>
                  <th className="py-3 px-4">{language === 'bn' ? 'রশিদ ভাউচার' : 'Receipt Ref'}</th>
                  <th className="py-3 px-4 text-right">{t('common.amount')}</th>
                  <th className="py-3 px-4 text-center">{t('common.status')}</th>
                  <th className="py-3 px-4 text-right">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {displayedExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      {language === 'bn'
                        ? 'কোনো খরচ পাওয়া যায়নি।'
                        : 'No operating expenses found matching your criteria.'}
                    </td>
                  </tr>
                ) : (
                  displayedExpenses.map(e => {
                    const details = getCategoryDetails(e.category);
                    const Icon = details.icon;
                    return (
                      <tr key={e.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {e.expense_date}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${details.iconBg}`}>
                              <Icon size={14} />
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white leading-snug">{e.title}</div>
                              <div className="text-[10px] text-slate-400 font-normal">
                                {language === 'bn' ? 'প্রাপক: ' : 'Payee: '}{e.payee}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${details.badgeBg}`}>
                            {e.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px]">
                          {e.receipt_ref || '-'}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">
                          {formatCurrency(e.amount)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {e.status === 'Verified' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              <CheckCircle size={10} />
                              <span>{language === 'bn' ? 'যাচাইকৃত' : 'Verified'}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                              <AlertTriangle size={10} />
                              <span>{language === 'bn' ? 'রশিদ বাকি' : 'Needs receipt'}</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {e.status === 'Needs receipt' ? (
                            <button
                              onClick={() => {
                                setVerifyExpenseId(e.id);
                                setReceiptVoucher(`RCP-${Date.now().toString().slice(-6)}`);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition-colors"
                            >
                              <FileCheck size={12} />
                              <span>{language === 'bn' ? 'যাচাই' : 'Verify'}</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                showToast(`Voucher ref: ${e.receipt_ref} verified for ${e.title}`);
                              }}
                              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="View Audit Record"
                            >
                              <Eye size={14} />
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
        </div>

        {/* Pagination Controls */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-[#132026]/50">
          <span className="font-medium text-[11px]">
            {language === 'bn'
              ? `প্রদর্শন ${toBanglaDigits(startIdx)}-${toBanglaDigits(endIdx)} (মোট ${toBanglaDigits(expenses.length)} টি)`
              : `Showing ${startIdx}-${endIdx} of ${expenses.length} records`}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 font-bold"
            >
              <ChevronLeft size={12} />
            </button>
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              {language === 'bn'
                ? `${toBanglaDigits(safePage)} / ${toBanglaDigits(totalPages)}`
                : `${safePage} / ${totalPages}`}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 font-bold"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Record Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-md p-6 text-xs space-y-4 shadow-2xl overflow-visible">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {language === 'bn' ? 'পরিচালনা ব্যয় লিপিবদ্ধ করুন' : 'Record Operating Expense'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="form-label">{language === 'bn' ? 'খরচের বিবরণ *' : 'Expense Title *'}</label>
                <input
                  type="text"
                  placeholder={language === 'bn' ? 'যেমন: সভার হল বুকিং বা স্টেশনারি' : 'e.g. Venue booking or Meeting snacks'}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <SearchableSelect
                    label={language === 'bn' ? 'খাত' : 'Category'}
                    required
                    options={categoryOptions}
                    value={category}
                    onChange={val => setCategory(String(val))}
                    placeholder="Select category..."
                  />
                </div>
                <div>
                  <label className="form-label">{language === 'bn' ? 'পরিমাণ (TK) *' : 'Amount (TK) *'}</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="form-input font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{language === 'bn' ? 'খরচের তারিখ' : 'Expense Date'}</label>
                  <input
                    type="text"
                    value={expenseDate}
                    onChange={e => setExpenseDate(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">{language === 'bn' ? 'প্রাপক ব্যক্তি / প্রতিষ্ঠান *' : 'Payee / Vendor *'}</label>
                  <input
                    type="text"
                    value={payee}
                    onChange={e => setPayee(e.target.value)}
                    placeholder={language === 'bn' ? 'যেমন: রফিক হাসান / ডাচ-বাংলা' : 'Person / Vendor name'}
                    className="form-input"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label">{language === 'bn' ? 'রশিদ ভাউচার নম্বর (যদি থাকে)' : 'Receipt Voucher Ref (Optional)'}</label>
                <input
                  type="text"
                  placeholder="e.g. RCP-240628-09"
                  value={receiptRef}
                  onChange={e => setReceiptRef(e.target.value)}
                  className="form-input font-mono"
                />
                <p className="form-hint">
                  {language === 'bn'
                    ? 'খালি রাখলে অডিট বাকি হিসেবে চিহ্নিত থাকবে।'
                    : 'Leave blank to flag as Needs receipt for later auditor clearance.'}
                </p>
              </div>

              <div>
                <label className="form-label">{language === 'bn' ? 'অডিট নোট / মন্তব্য' : 'Audit Notes'}</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl font-bold shadow-md"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verify Receipt Modal */}
      {verifyExpenseId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>{language === 'bn' ? 'রশিদ যাচাই ও অডিট ক্লিয়ারেন্স' : 'Verify Receipt & Clear Audit Flag'}</span>
            </h3>

            <form onSubmit={handleVerifySubmit} className="space-y-3">
              <div>
                <label className="form-label">{language === 'bn' ? 'রশিদ ভাউচার নম্বর *' : 'Receipt Voucher Number *'}</label>
                <input
                  type="text"
                  value={receiptVoucher}
                  onChange={e => setReceiptVoucher(e.target.value)}
                  className="form-input font-mono font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setVerifyExpenseId(null)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-md"
                >
                  {language === 'bn' ? 'যাচাই সম্পন্ন করুন' : 'Mark as Verified'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
