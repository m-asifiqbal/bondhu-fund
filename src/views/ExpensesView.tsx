import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  FileCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Wallet,
  Receipt,
  Download,
  Clock,
  Pencil,
  Trash2,
  CalendarDays,
  Tag,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  verifyExpenseReceipt,
  getMasterData,
  saveTextFile,
  toCsv,
} from '../services/db';
import { Expense, MasterCategory } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { todayISO, toMonthKey } from '../utils/date';

const PALETTE = [
  { iconBg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400', badgeBg: 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300' },
  { iconBg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400', badgeBg: 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300' },
  { iconBg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400', badgeBg: 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300' },
  { iconBg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400', badgeBg: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300' },
  { iconBg: 'bg-pink-100 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400', badgeBg: 'bg-pink-100 dark:bg-pink-950/80 text-pink-700 dark:text-pink-300' },
  { iconBg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', badgeBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
];

interface FormState {
  title: string;
  category: string;
  amount: string;
  expense_date: string;
  payee: string;
  receipt_ref: string;
  notes: string;
}

const emptyForm = (category = ''): FormState => ({
  title: '',
  category,
  amount: '',
  expense_date: todayISO(),
  payee: '',
  receipt_ref: '',
  notes: '',
});

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
    formatDate,
    formatMonth,
    toBanglaDigits,
    setActiveTab,
  } = useApp();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Add / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  // Verify modal
  const [verifyExpense, setVerifyExpense] = useState<Expense | null>(null);
  const [receiptVoucher, setReceiptVoucher] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 10;

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const monthKey = toMonthKey(selectedMonth);

  useEffect(() => {
    getMasterData('expense_category')
      .then(setCategories)
      .catch((e: any) => showToast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getExpenses(categoryFilter, statusFilter, startDate || undefined, endDate || undefined, searchQuery, sortBy)
      .then(list => alive && setExpenses(list))
      .catch((e: any) => alive && showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter, startDate, endDate, searchQuery, sortBy, refreshKey]);

  useEffect(() => setPage(1), [categoryFilter, statusFilter, startDate, endDate, searchQuery, sortBy]);

  // KPIs from the loaded (filtered) list
  const totalExpense = useMemo(() => expenses.reduce((s, e) => s + (e.amount || 0), 0), [expenses]);
  const monthList = useMemo(() => expenses.filter(e => (e.expense_date || '').slice(0, 7) === monthKey), [expenses, monthKey]);
  const monthTotal = useMemo(() => monthList.reduce((s, e) => s + (e.amount || 0), 0), [monthList]);
  const needsReceipt = useMemo(() => expenses.filter(e => e.status === 'Needs receipt'), [expenses]);
  const needsReceiptAmount = useMemo(() => needsReceipt.reduce((s, e) => s + (e.amount || 0), 0), [needsReceipt]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    expenses.forEach(e => {
      const k = e.category || '—';
      const cur = map.get(k) || { name: k, amount: 0, count: 0 };
      cur.amount += e.amount || 0;
      cur.count += 1;
      map.set(k, cur);
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [expenses]);
  const topCategory = byCategory[0];

  const styleIndex = useMemo(() => {
    const names = [...new Set([...categories.map(c => c.name), ...byCategory.map(c => c.name)])];
    return (name: string) => {
      const i = names.indexOf(name);
      return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
    };
  }, [categories, byCategory]);

  const totalPages = Math.ceil(expenses.length / limit) || 1;
  const safePage = Math.min(page, totalPages);
  const displayedExpenses = expenses.slice((safePage - 1) * limit, safePage * limit);
  const startIdx = expenses.length === 0 ? 0 : (safePage - 1) * limit + 1;
  const endIdx = Math.min(safePage * limit, expenses.length);

  const hasFilters = !!(searchQuery || categoryFilter !== 'All' || statusFilter !== 'All' || startDate || endDate || sortBy !== 'newest');

  const activeCategoryOptions: SelectOption[] = categories.filter(c => c.is_active).map(c => ({ value: c.name, label: c.name }));
  const filterCategoryOptions: SelectOption[] = [
    { value: 'All', label: t('expenses.allCategories', 'All categories') },
    ...categories.map(c => ({ value: c.name, label: c.is_active ? c.name : `${c.name} (${t('common.inactive', 'inactive')})` })),
  ];

  const formCategoryOptions: SelectOption[] =
    editing && form.category && !activeCategoryOptions.some(o => o.value === form.category)
      ? [{ value: form.category, label: form.category }, ...activeCategoryOptions]
      : activeCategoryOptions;

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(activeCategoryOptions[0] ? String(activeCategoryOptions[0].value) : ''));
    setFormOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      title: e.title || '',
      category: e.category || '',
      amount: String(e.amount ?? ''),
      expense_date: (e.expense_date || '').slice(0, 10) || todayISO(),
      payee: e.payee || '',
      receipt_ref: e.receipt_ref || '',
      notes: e.notes || '',
    });
    setFormOpen(true);
  };

  const handleExport = async () => {
    if (expenses.length === 0) {
      showToast(t('expenses.nothingToExport', 'There are no expenses to export.'), 'info');
      return;
    }
    try {
      const csv = toCsv(
        ['Date', 'Title', 'Category', 'Payee', 'Amount', 'Receipt Ref', 'Status', 'Notes'],
        expenses.map(e => [e.expense_date, e.title, e.category, e.payee, e.amount, e.receipt_ref, e.status, e.notes || ''])
      );
      const res = await saveTextFile(`Bondhu_Fund_Expenses_${todayISO()}.csv`, csv, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!res.canceled) showToast(t('common.exported', 'Export saved.'));
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleFormSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    const payload: Partial<Expense> = {
      title: form.title.trim(),
      category: form.category,
      amount: Number(form.amount),
      expense_date: form.expense_date,
      payee: form.payee.trim(),
      receipt_ref: form.receipt_ref.trim(),
      notes: form.notes.trim(),
    };
    setSaving(true);
    try {
      if (editing) {
        await updateExpense(editing.id, { ...payload, status: payload.receipt_ref ? 'Verified' : 'Needs receipt' });
        showToast(t('expenses.updated', `Expense "${payload.title}" updated.`));
      } else {
        await addExpense(payload);
        showToast(t('expenses.added', `Expense "${payload.title}" recorded.`));
      }
      setFormOpen(false);
      setEditing(null);
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifySubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!verifyExpense || saving) return;
    setSaving(true);
    try {
      await verifyExpenseReceipt(verifyExpense.id, receiptVoucher);
      showToast(t('expenses.verified', 'Receipt verified.'));
      setVerifyExpense(null);
      setReceiptVoucher('');
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: Expense) => {
    if (!window.confirm(t('expenses.deleteConfirm', `Delete expense "${e.title}" (${formatCurrency(e.amount)})? This cannot be undone.`))) return;
    setBusyId(e.id);
    try {
      await deleteExpense(e.id);
      showToast(t('expenses.deleted', 'Expense deleted.'));
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: string) => (
    <div className={`card-base border-l-4 ${accent} p-5 flex flex-col justify-between shadow-sm min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className="mt-4 min-w-0">
        <div className={`text-2xl font-black tracking-tight truncate ${valueCls}`}>{value}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 truncate">{sub}</div>
      </div>
    </div>
  );

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const isFreshEmpty = !loading && expenses.length === 0 && !hasFilters;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'পরিচালনা ব্যয় ও খরচের হিসাব' : 'Operating expenses'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {language === 'bn'
              ? 'বন্ধু ফান্ডের দাপ্তরিক খরচ, মিটিং ব্যয় ও অডিট রশিদের হিসাব।'
              : 'Track operational costs, meeting disbursements, and audit receipts.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} align="right" />
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={14} className="text-slate-500" />
            <span>{t('common.export')}</span>
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>{t('expenses.record', 'Record expense')}</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi(
          'border-l-purple-500',
          hasFilters ? t('expenses.totalFiltered', 'Total (filtered)') : t('expenses.totalAll', 'Total expenses'),
          <Wallet size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(totalExpense),
          'text-slate-900 dark:text-white',
          `${n(expenses.length)} ${t('expenses.records', 'records')}`
        )}
        {kpi(
          'border-l-blue-500',
          `${t('expenses.inMonth', 'In')} ${formatMonth(selectedMonth)}`,
          <CalendarDays size={16} />,
          'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          formatCurrency(monthTotal),
          'text-slate-900 dark:text-white',
          `${n(monthList.length)} ${t('expenses.records', 'records')}`
        )}
        {kpi(
          'border-l-amber-500',
          t('expenses.needsReceipt', 'Needs receipt'),
          <Clock size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          n(needsReceipt.length),
          'text-amber-600 dark:text-amber-400',
          `${formatCurrency(needsReceiptAmount)} ${t('expenses.unverified', 'unverified')}`
        )}
        {kpi(
          'border-l-emerald-500',
          t('expenses.topCategory', 'Top category'),
          <Tag size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          topCategory ? topCategory.name : '—',
          'text-slate-900 dark:text-white text-lg',
          topCategory
            ? `${formatCurrency(topCategory.amount)} · ${n(totalExpense > 0 ? Math.round((topCategory.amount / totalExpense) * 100) : 0)}%`
            : t('expenses.noData', 'No expenses yet')
        )}
      </div>

      {/* Category breakdown */}
      {byCategory.length > 0 && (
        <div className="card-base p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('expenses.byCategory', 'Expenses by category')}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">{t('expenses.byCategoryHint', 'Click a category to filter the ledger')}</p>
            </div>
            {categoryFilter !== 'All' && (
              <button
                onClick={() => setCategoryFilter('All')}
                className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
              >
                <RotateCcw size={12} />
                <span>{t('expenses.clearCategory', 'Clear category')} ({categoryFilter})</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {byCategory.slice(0, 6).map(cat => {
              const st = styleIndex(cat.name);
              const isSelected = categoryFilter === cat.name;
              const share = totalExpense > 0 ? Math.round((cat.amount / totalExpense) * 100) : 0;
              return (
                <button
                  key={cat.name}
                  onClick={() => setCategoryFilter(isSelected ? 'All' : cat.name)}
                  className={`p-3 rounded-2xl border text-left transition-all min-w-0 ${
                    isSelected
                      ? 'border-slate-900 dark:border-white shadow-md ring-2 ring-slate-900/10 dark:ring-white/10 bg-slate-50 dark:bg-slate-800'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-[#15232b]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${st.iconBg}`}>
                      <Receipt size={16} />
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${st.badgeBg}`}>{n(share)}%</span>
                  </div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{cat.name}</div>
                  <div className="text-sm font-black text-slate-900 dark:text-white mt-1 truncate">{formatCurrency(cat.amount)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Ledger */}
      <div className="card-base overflow-hidden flex flex-col shadow-sm">
        <div className="p-5 pb-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'পরিচালনা ব্যয়ের লেজার' : 'Expenses ledger'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{t('expenses.ledgerSub', 'Filter by search, category, status or date.')}</p>
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {t('expenses.totalMatching', 'Total matching')}:{' '}
            <span className="text-rose-600 dark:text-rose-400 font-black">{formatCurrency(totalExpense)}</span>
          </div>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2.5 text-xs">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('expenses.searchPh', 'Search title, payee, receipt ref...')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="form-input pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="w-44">
            <SearchableSelect
              options={filterCategoryOptions}
              value={categoryFilter}
              onChange={val => setCategoryFilter(String(val))}
              placeholder={t('expenses.category', 'Category')}
            />
          </div>
          <div className="w-36">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="form-select py-1.5 text-xs">
              <option value="All">{t('common.allStatus', 'All status')}</option>
              <option value="Verified">{t('expenses.statusVerified', 'Verified')}</option>
              <option value="Needs receipt">{t('expenses.needsReceipt', 'Needs receipt')}</option>
            </select>
          </div>
          <div className="w-40">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="form-select py-1.5 text-xs">
              <option value="newest">{t('sort.newest', 'Sort: Newest first')}</option>
              <option value="oldest">{t('sort.oldest', 'Sort: Oldest first')}</option>
              <option value="amount_high">{t('sort.amountHigh', 'Amount: High to low')}</option>
              <option value="amount_low">{t('sort.amountLow', 'Amount: Low to high')}</option>
              <option value="title_asc">{t('sort.titleAsc', 'Title: A to Z')}</option>
              <option value="category">{t('sort.category', 'Category')}</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.from', 'From')}:</span>
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
                setCategoryFilter('All');
                setStatusFilter('All');
                setStartDate('');
                setEndDate('');
                setSortBy('newest');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-[#182830] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold transition-colors"
              title={t('common.reset', 'Reset')}
            >
              <RotateCcw size={12} />
              <span>{t('common.reset', 'Reset')}</span>
            </button>
          )}
        </div>

        {isFreshEmpty ? (
          <div className="py-14 flex flex-col items-center text-center gap-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Receipt size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('expenses.emptyTitle', 'No expenses recorded yet')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                {t('expenses.emptyBody', 'Record meeting costs, office supplies, bank charges and other fund spending here.')}
              </p>
            </div>
            <button
              onClick={openAdd}
              className="px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md"
            >
              {t('expenses.record', 'Record expense')}
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[880px] text-left text-xs text-slate-800 dark:text-slate-200">
                <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">{t('common.date')}</th>
                    <th className="py-3 px-4">{t('expenses.expensePayee', 'Expense & payee')}</th>
                    <th className="py-3 px-4">{t('expenses.category', 'Category')}</th>
                    <th className="py-3 px-4">{t('expenses.receiptRef', 'Receipt ref')}</th>
                    <th className="py-3 px-4 text-right">{t('common.amount')}</th>
                    <th className="py-3 px-4 text-center">{t('common.status')}</th>
                    <th className="py-3 px-4 text-right">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                  {loading && expenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading...')}</td>
                    </tr>
                  ) : displayedExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        {t('expenses.noMatch', 'No expenses match your filters.')}
                      </td>
                    </tr>
                  ) : (
                    displayedExpenses.map(e => {
                      const st = styleIndex(e.category);
                      return (
                        <tr key={e.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(e.expense_date)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${st.iconBg}`}>
                                <Receipt size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 dark:text-white leading-snug">{e.title}</div>
                                {e.payee && (
                                  <div className="text-[10px] text-slate-400 font-normal">
                                    {t('expenses.payee', 'Payee')}: {e.payee}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${st.badgeBg}`}>{e.category}</span>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px]">{e.receipt_ref || '—'}</td>
                          <td className="py-3 px-4 text-right font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">{formatCurrency(e.amount)}</td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {e.status === 'Verified' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                                <CheckCircle size={10} />
                                <span>{t('expenses.statusVerified', 'Verified')}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                <AlertTriangle size={10} />
                                <span>{t('expenses.needsReceipt', 'Needs receipt')}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              {e.status === 'Needs receipt' && (
                                <button
                                  onClick={() => {
                                    setVerifyExpense(e);
                                    setReceiptVoucher('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
                                >
                                  <FileCheck size={12} />
                                  <span>{t('expenses.verify', 'Verify')}</span>
                                </button>
                              )}
                              <button
                                onClick={() => openEdit(e)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                                title={t('common.edit', 'Edit')}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(e)}
                                disabled={busyId === e.id}
                                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                title={t('common.delete', 'Delete')}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-[#132026]/50">
              <span className="font-medium text-[11px]">
                {t('common.showing', 'Showing')} {n(startIdx)}-{n(endIdx)} {t('common.of', 'of')} {n(expenses.length)}
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
                  {n(safePage)} / {n(totalPages)}
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
          </>
        )}
      </div>

      {/* Add / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-lg p-6 text-xs space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editing ? t('expenses.editTitle', 'Edit expense') : t('expenses.addTitle', 'Record expense')}
              </h3>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3">
              <div>
                <label className="form-label">{t('expenses.title', 'Title')} *</label>
                <input type="text" value={form.title} onChange={set('title')} className="form-input" required />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  {formCategoryOptions.length > 0 ? (
                    <SearchableSelect
                      label={t('expenses.category', 'Category')}
                      required
                      options={formCategoryOptions}
                      value={form.category}
                      onChange={val => setForm(f => ({ ...f, category: String(val) }))}
                      placeholder={t('expenses.selectCategory', 'Select category...')}
                    />
                  ) : (
                    <>
                      <label className="form-label">{t('expenses.category', 'Category')} *</label>
                      <p className="form-hint">
                        {t('expenses.noCategories', 'No expense categories yet.')}{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setFormOpen(false);
                            setActiveTab('master');
                          }}
                          className="font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline"
                        >
                          {t('expenses.addCategories', 'Add them in Master data')}
                        </button>
                      </p>
                    </>
                  )}
                </div>
                <div>
                  <label className="form-label">{t('common.amount', 'Amount')} *</label>
                  <input type="number" min="0" step="any" value={form.amount} onChange={set('amount')} className="form-input font-bold" required />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t('expenses.date', 'Expense date')} *</label>
                  <input type="date" max={todayISO()} value={form.expense_date} onChange={set('expense_date')} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">{t('expenses.payeeVendor', 'Payee / vendor')}</label>
                  <input type="text" value={form.payee} onChange={set('payee')} className="form-input" />
                </div>
              </div>

              <div>
                <label className="form-label">{t('expenses.receiptRefOpt', 'Receipt / voucher ref (optional)')}</label>
                <input type="text" value={form.receipt_ref} onChange={set('receipt_ref')} className="form-input font-mono" />
                <p className="form-hint">{t('expenses.receiptHint', 'Leave blank to flag as "Needs receipt" for later verification.')}</p>
              </div>

              <div>
                <label className="form-label">{t('common.notes', 'Notes')}</label>
                <textarea rows={2} value={form.notes} onChange={set('notes')} className="form-input" />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.category}
                  className="px-5 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t('common.saving', 'Saving...') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verify receipt modal */}
      {verifyExpense && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>{t('expenses.verifyTitle', 'Verify receipt')}</span>
            </h3>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800">
              <p className="font-bold text-slate-900 dark:text-white">{verifyExpense.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {formatDate(verifyExpense.expense_date)} · {formatCurrency(verifyExpense.amount)}
              </p>
            </div>
            <form onSubmit={handleVerifySubmit} className="space-y-3">
              <div>
                <label className="form-label">{t('expenses.receiptNumber', 'Receipt / voucher number')} *</label>
                <input
                  type="text"
                  value={receiptVoucher}
                  onChange={e => setReceiptVoucher(e.target.value)}
                  className="form-input font-mono font-bold"
                  autoFocus
                  required
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setVerifyExpense(null)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t('common.saving', 'Saving...') : t('expenses.markVerified', 'Mark as verified')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
