import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  CheckCircle,
  AlertTriangle,
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
  saveTextFile,
  toCsv,
} from '../services/db';
import { Expense } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { Modal } from '../components/common/Modal';
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

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const ExpensesView: React.FC = () => {
  const {
    showToast,
    refreshKey,
    triggerRefresh,
    selectedMonth,
    setSelectedMonth,
    t,
    tv,
    formatCurrency,
    formatDate,
    formatMonth,
    toBanglaDigits,
    language,
    setActiveTab,
    masterData,
  } = useApp();

  const [expenses, setExpenses] = useState<Expense[]>([]);
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

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebounced(searchInput.trim(), 250);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);
  const limit = 10;

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const monthKey = toMonthKey(selectedMonth);
  const today = todayISO();

  const categories = useMemo(() => masterData.filter(m => m.type === 'expense_category'), [masterData]);

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

  const hasFilters = !!(searchInput || categoryFilter !== 'All' || statusFilter !== 'All' || startDate || endDate || sortBy !== 'newest');

  const activeCategoryOptions = useMemo<SelectOption[]>(
    () => categories.filter(c => c.is_active).map(c => ({ value: c.name, label: tv(c.name) })),
    [categories, tv]
  );
  const filterCategoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'All', label: t('finance.exp_all_categories', 'All categories') },
      ...categories.map(c => ({ value: c.name, label: c.is_active ? tv(c.name) : `${tv(c.name)} (${t('status.inactive', 'Inactive')})` })),
    ],
    [categories, t, tv]
  );
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'All', label: t('finance.all_statuses', 'All statuses') },
      { value: 'Verified', label: tv('Verified') },
      { value: 'Needs receipt', label: tv('Needs receipt') },
    ],
    [t, tv]
  );
  const sortOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'newest', label: t('finance.sort_newest', 'Newest first') },
      { value: 'oldest', label: t('finance.sort_oldest', 'Oldest first') },
      { value: 'amount_high', label: t('finance.sort_amount_high', 'Amount: high to low') },
      { value: 'amount_low', label: t('finance.sort_amount_low', 'Amount: low to high') },
      { value: 'title_asc', label: t('finance.sort_title_asc', 'Title: A to Z') },
      { value: 'category', label: t('finance.exp_category', 'Category') },
    ],
    [t]
  );

  const formCategoryOptions: SelectOption[] =
    editing && form.category && !activeCategoryOptions.some(o => o.value === form.category)
      ? [{ value: form.category, label: tv(form.category) }, ...activeCategoryOptions]
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

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
  };

  const handleExport = async () => {
    if (expenses.length === 0) {
      showToast(t('finance.exp_nothing_to_export', 'There are no expenses to export.'), 'info');
      return;
    }
    try {
      const csv = toCsv(
        ['Date', 'Title', 'Category', 'Payee', 'Amount', 'Receipt Ref', 'Status', 'Notes'],
        expenses.map(e => [e.expense_date, e.title, e.category, e.payee, e.amount, e.receipt_ref, e.status, e.notes || ''])
      );
      const res = await saveTextFile(`Bondhu_Fund_Expenses_${todayISO()}.csv`, csv, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!res.canceled) showToast(t('finance.export_saved', 'Export saved.'));
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleFormSubmit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (saving) return;
    if (!form.title.trim() || !form.category || !form.amount || !form.expense_date) {
      showToast(t('finance.fill_required', 'Please fill in all required fields.'), 'error');
      return;
    }
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
        showToast(t('finance.exp_updated', 'Expense "{title}" updated.').replace('{title}', payload.title || ''));
      } else {
        await addExpense(payload);
        showToast(t('finance.exp_added', 'Expense "{title}" recorded.').replace('{title}', payload.title || ''));
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

  const handleVerifySubmit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!verifyExpense || saving || !receiptVoucher.trim()) return;
    setSaving(true);
    try {
      await verifyExpenseReceipt(verifyExpense.id, receiptVoucher);
      showToast(t('finance.exp_verified', 'Receipt verified.'));
      setVerifyExpense(null);
      setReceiptVoucher('');
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const e = confirmDelete;
    if (!e) return;
    setBusyId(e.id);
    try {
      await deleteExpense(e.id);
      showToast(t('finance.exp_deleted', 'Expense deleted.'));
      setConfirmDelete(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setCategoryFilter('All');
    setStatusFilter('All');
    setStartDate('');
    setEndDate('');
    setSortBy('newest');
  };

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: string) => (
    <div className={`card-base border-l-4 ${accent} p-5 flex flex-col justify-between shadow-sm min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className="mt-4 min-w-0">
        <div className={`text-2xl font-black tracking-tight truncate ${valueCls}`} title={value}>{value}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 truncate" title={sub}>{sub}</div>
      </div>
    </div>
  );

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const isFreshEmpty = !loading && expenses.length === 0 && !hasFilters;
  const recordsLabel = t('finance.records', 'records');

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {t('finance.exp_title', 'Operating expenses')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('finance.exp_subtitle', 'Track operational costs, meeting disbursements, and audit receipts.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} align="right" />
          <button
            onClick={handleExport}
            className="btn btn-outline"
          >
            <Download size={14} className="text-slate-500" />
            <span>{t('common.export_csv', 'Export CSV')}</span>
          </button>
          <button
            onClick={openAdd}
            className="btn btn-primary"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>{t('finance.exp_record', 'Record expense')}</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi(
          'border-l-purple-500',
          hasFilters ? t('finance.exp_total_filtered', 'Total (filtered)') : t('finance.exp_total_all', 'Total expenses'),
          <Wallet size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(totalExpense),
          'text-slate-900 dark:text-white',
          `${n(expenses.length)} ${recordsLabel}`
        )}
        {kpi(
          'border-l-blue-500',
          t('finance.exp_in_month', 'In {month}').replace('{month}', formatMonth(selectedMonth)),
          <CalendarDays size={16} />,
          'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          formatCurrency(monthTotal),
          'text-slate-900 dark:text-white',
          `${n(monthList.length)} ${recordsLabel}`
        )}
        {kpi(
          'border-l-amber-500',
          tv('Needs receipt'),
          <Clock size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          n(needsReceipt.length),
          'text-amber-600 dark:text-amber-400',
          `${formatCurrency(needsReceiptAmount)} ${t('finance.exp_unverified', 'unverified')}`
        )}
        {kpi(
          'border-l-emerald-500',
          t('finance.exp_top_category', 'Top category'),
          <Tag size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          topCategory ? tv(topCategory.name) : '—',
          'text-slate-900 dark:text-white text-lg',
          topCategory
            ? `${formatCurrency(topCategory.amount)} · ${n(totalExpense > 0 ? Math.round((topCategory.amount / totalExpense) * 100) : 0)}%`
            : t('finance.exp_no_data', 'No expenses yet')
        )}
      </div>

      {/* Category breakdown */}
      {byCategory.length > 0 && (
        <div className="card-base p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('finance.exp_by_category', 'Expenses by category')}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">{t('finance.exp_by_category_hint', 'Click a category to filter the ledger')}</p>
            </div>
            {categoryFilter !== 'All' && (
              <button
                onClick={() => setCategoryFilter('All')}
                className="btn btn-outline"
              >
                <RotateCcw size={12} />
                <span>{t('finance.exp_clear_category', 'Clear category')} ({tv(categoryFilter)})</span>
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
                  title={tv(cat.name)}
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
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{tv(cat.name)}</div>
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
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('finance.exp_ledger', 'Expenses ledger')}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{t('finance.exp_ledger_sub', 'Filter by search, category, status or date.')}</p>
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {t('finance.total_matching', 'Total matching')}:{' '}
            <span className="text-rose-600 dark:text-rose-400 font-black">{formatCurrency(totalExpense)}</span>
          </div>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('finance.exp_search_ph', 'Search title, payee, receipt ref…')}
              aria-label={t('common.search', 'Search')}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="form-input pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="min-w-[180px] flex-1 sm:flex-none sm:w-48">
            <SearchableSelect
              size="sm"
              options={filterCategoryOptions}
              value={categoryFilter}
              onChange={val => setCategoryFilter(val == null || val === '' ? 'All' : String(val))}
              clearable={categoryFilter !== 'All'}
              placeholder={t('finance.exp_category', 'Category')}
            />
          </div>
          <div className="min-w-[160px] flex-1 sm:flex-none sm:w-44">
            <SearchableSelect
              size="sm"
              options={statusOptions}
              value={statusFilter}
              onChange={val => setStatusFilter(val == null || val === '' ? 'All' : String(val))}
              clearable={statusFilter !== 'All'}
              placeholder={t('common.status', 'Status')}
            />
          </div>
          <div className="min-w-[180px] flex-1 sm:flex-none sm:w-52">
            <SearchableSelect
              size="sm"
              options={sortOptions}
              value={sortBy}
              onChange={val => setSortBy(val == null || val === '' ? 'newest' : String(val))}
              placeholder={t('common.sort', 'Sort')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.from', 'From')}</span>
            <div className="min-w-[150px]">
              <DatePicker
                size="sm"
                clearable
                value={startDate}
                onChange={setStartDate}
                max={endDate || today}
                placeholder={t('finance.start_date', 'Start date')}
              />
            </div>
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('common.to', 'To')}</span>
            <div className="min-w-[150px]">
              <DatePicker
                size="sm"
                clearable
                value={endDate}
                onChange={setEndDate}
                min={startDate || undefined}
                placeholder={t('finance.end_date', 'End date')}
              />
            </div>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="btn btn-outline btn-sm"
              title={t('finance.reset_filters', 'Reset filters')}
            >
              <RotateCcw size={12} />
              <span>{t('finance.reset', 'Reset')}</span>
            </button>
          )}
        </div>

        {isFreshEmpty ? (
          <div className="py-14 flex flex-col items-center text-center gap-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Receipt size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('finance.exp_empty_title', 'No expenses recorded yet')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                {t('finance.exp_empty_body', 'Record meeting costs, office supplies, bank charges and other fund spending here.')}
              </p>
            </div>
            <button
              onClick={openAdd}
              className="btn btn-primary"
            >
              {t('finance.exp_record', 'Record expense')}
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[880px] text-left text-xs text-slate-800 dark:text-slate-200">
                <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">{t('common.date', 'Date')}</th>
                    <th className="py-3 px-4">{t('finance.exp_expense_payee', 'Expense & payee')}</th>
                    <th className="py-3 px-4">{t('finance.exp_category', 'Category')}</th>
                    <th className="py-3 px-4">{t('finance.exp_receipt_ref', 'Receipt ref')}</th>
                    <th className="py-3 px-4 text-right">{t('common.amount', 'Amount')}</th>
                    <th className="py-3 px-4 text-center">{t('common.status', 'Status')}</th>
                    <th className="py-3 px-4 text-right">{t('common.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                  {loading && expenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading…')}</td>
                    </tr>
                  ) : displayedExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        {t('finance.exp_no_match', 'No expenses match your filters.')}
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
                                    {t('finance.exp_payee', 'Payee')}: {e.payee}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${st.badgeBg}`}>{tv(e.category)}</span>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-600 dark:text-slate-400 text-[11px]">{e.receipt_ref || '—'}</td>
                          <td className="py-3 px-4 text-right font-black text-rose-600 dark:text-rose-400 whitespace-nowrap">{formatCurrency(e.amount)}</td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {e.status === 'Verified' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                                <CheckCircle size={10} />
                                <span>{tv('Verified')}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                <AlertTriangle size={10} />
                                <span>{tv('Needs receipt')}</span>
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
                                  className="btn btn-outline btn-sm"
                                >
                                  <FileCheck size={12} />
                                  <span>{t('finance.exp_verify', 'Verify')}</span>
                                </button>
                              )}
                              <button
                                onClick={() => openEdit(e)}
                                className="btn btn-outline btn-sm btn-icon"
                                title={t('common.edit', 'Edit')}
                                aria-label={t('common.edit', 'Edit')}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => setConfirmDelete(e)}
                                disabled={busyId === e.id}
                                className="btn btn-danger-outline btn-sm btn-icon"
                                title={t('common.delete', 'Delete')}
                                aria-label={t('common.delete', 'Delete')}
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
                {t('finance.showing_range', 'Showing {from}–{to} of {total}')
                  .replace('{from}', n(startIdx))
                  .replace('{to}', n(endIdx))
                  .replace('{total}', n(expenses.length))}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  title={t('finance.prev_page', 'Previous page')}
                  aria-label={t('finance.prev_page', 'Previous page')}
                  className="btn btn-outline btn-sm btn-icon"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  {n(safePage)} / {n(totalPages)}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  title={t('finance.next_page', 'Next page')}
                  aria-label={t('finance.next_page', 'Next page')}
                  className="btn btn-outline btn-sm btn-icon"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add / Edit modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        locked={saving}
        size="md"
        icon={<Receipt size={18} />}
        title={editing ? t('finance.exp_edit_title', 'Edit expense') : t('finance.exp_add_title', 'Record expense')}
        subtitle={editing ? editing.title : t('finance.exp_add_sub', 'Add a fund spending entry to the ledger.')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="btn btn-cancel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              form="expense-form"
              disabled={saving || !form.category}
              className="btn btn-primary"
            >
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
          </div>
        }
      >
        <form id="expense-form" onSubmit={handleFormSubmit} className="text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 items-start">
            <div className="sm:col-span-2">
              <label className="form-label">{t('finance.exp_field_title', 'Title')} <span className="text-rose-500">*</span></label>
              <input
                type="text"
                value={form.title}
                onChange={set('title')}
                className="form-input"
                placeholder={t('finance.exp_title_ph', 'e.g. Monthly meeting snacks')}
                required
              />
            </div>

            {formCategoryOptions.length > 0 ? (
              <SearchableSelect
                label={t('finance.exp_category', 'Category')}
                required
                options={formCategoryOptions}
                value={form.category}
                onChange={val => setForm(f => ({ ...f, category: String(val ?? '') }))}
                placeholder={t('finance.exp_select_category', 'Select category…')}
              />
            ) : (
              <div>
                <label className="form-label">{t('finance.exp_category', 'Category')} <span className="text-rose-500">*</span></label>
                <button type="button" onClick={() => { setFormOpen(false); setActiveTab('master'); }} className="btn btn-outline btn-block">
                  {t('finance.exp_add_categories', 'Add them in Master data')}
                </button>
              </div>
            )}
            <div>
              <label className="form-label">{t('common.amount', 'Amount')} <span className="text-rose-500">*</span></label>
              <input type="number" min="0" step="any" value={form.amount} onChange={set('amount')} className="form-input font-bold tabular-nums" placeholder="0" required />
            </div>

            <DatePicker
              label={t('finance.exp_date', 'Expense date')}
              required
              max={today}
              value={form.expense_date}
              onChange={iso => setForm(f => ({ ...f, expense_date: iso }))}
            />
            <div>
              <label className="form-label">{t('finance.exp_payee_vendor', 'Payee / vendor')}</label>
              <input type="text" value={form.payee} onChange={set('payee')} className="form-input" />
            </div>

            <div>
              <label className="form-label">{t('finance.exp_receipt_ref_opt', 'Receipt / voucher ref (optional)')}</label>
              <input type="text" value={form.receipt_ref} onChange={set('receipt_ref')} className="form-input font-mono" />
            </div>
            <div>
              <label className="form-label">{t('common.notes', 'Notes')}</label>
              <input type="text" value={form.notes} onChange={set('notes')} className="form-input" />
            </div>
          </div>
          <p className="form-hint mt-4">{t('finance.exp_receipt_hint', 'Leave blank to flag as "Needs receipt" for later verification.')}</p>
        </form>
      </Modal>

      {/* Verify receipt modal */}
      <Modal
        open={!!verifyExpense}
        onClose={() => !saving && setVerifyExpense(null)}
        locked={saving}
        size="sm"
        icon={<FileCheck size={18} />}
        title={t('finance.exp_verify_title', 'Verify receipt')}
        subtitle={verifyExpense ? `${formatDate(verifyExpense.expense_date)} · ${formatCurrency(verifyExpense.amount)}` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setVerifyExpense(null)}
              disabled={saving}
              className="btn btn-cancel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              form="verify-form"
              disabled={saving || !receiptVoucher.trim()}
              className="btn btn-primary"
            >
              {saving ? t('common.saving', 'Saving…') : t('finance.exp_mark_verified', 'Mark as verified')}
            </button>
          </div>
        }
      >
        {verifyExpense && (
          <form id="verify-form" onSubmit={handleVerifySubmit} className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800">
              <p className="font-bold text-slate-900 dark:text-white">{verifyExpense.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{tv(verifyExpense.category)}</p>
            </div>
            <div>
              <label className="form-label">{t('finance.exp_receipt_number', 'Receipt / voucher number')} <span className="text-rose-500">*</span></label>
              <input
                type="text"
                value={receiptVoucher}
                onChange={e => setReceiptVoucher(e.target.value)}
                className="form-input font-mono font-bold"
                autoFocus
                required
              />
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => busyId === null && setConfirmDelete(null)}
        locked={busyId !== null}
        size="sm" tone="danger"
        icon={<Trash2 size={18} />}
        title={t('finance.exp_delete_title', 'Delete expense?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              disabled={busyId !== null}
              className="btn btn-cancel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busyId !== null}
              className="btn btn-danger"
            >
              {busyId !== null ? t('finance.deleting', 'Deleting…') : t('common.delete', 'Delete')}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('finance.exp_delete_body', 'Delete expense "{title}" ({amount})? This cannot be undone.')
              .replace('{title}', confirmDelete.title)
              .replace('{amount}', formatCurrency(confirmDelete.amount))}
          </p>
        )}
      </Modal>
    </div>
  );
};
