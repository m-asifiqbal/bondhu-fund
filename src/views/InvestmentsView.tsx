import React, { useState, useEffect, useMemo } from 'react';
import { MoneyInput } from '../components/common/MoneyInput';
import { DownloadMenu } from '../components/common/DownloadMenu';
import { cell, type ExportDoc } from '../utils/exportDoc';
import { serial } from '../utils/i18n';
import {
  Plus,
  Download,
  FileText,
  Building,
  Home,
  MapPin,
  Cpu,
  AlertCircle,
  Trash2,
  TrendingUp,
  Pencil,
  BadgeDollarSign,
  Search,
  RotateCcw,
  Briefcase,
  Wallet,
  LineChart,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getInvestments,
  addInvestment,
  updateInvestment,
  updateInvestmentValuation,
  deleteInvestment,
  exportTable,
  toCsv,
} from '../services/db';
import { Investment, InvestmentStatus } from '../types';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { Modal } from '../components/common/Modal';
import { todayISO, daysBetween } from '../utils/date';

const SectorChart = React.lazy(() => import('./InvestmentsSectorChart'));

const SECTOR_COLORS = ['#0f4a3c', '#d97706', '#2563eb', '#9333ea', '#db2777', '#0891b2', '#64748b'];

interface FormState {
  name: string;
  sector: string;
  purchase_date: string;
  invested_amount: string;
  current_estimated_value: string;
  review_date: string;
  location_details: string;
  notes: string;
  status: InvestmentStatus;
  sold_amount: string;
  sold_date: string;
}

const emptyForm = (sector = ''): FormState => ({
  name: '',
  sector,
  purchase_date: todayISO(),
  invested_amount: '',
  current_estimated_value: '',
  review_date: '',
  location_details: '',
  notes: '',
  status: 'Growing',
  sold_amount: '',
  sold_date: todayISO(),
});

const realizedGain = (i: Investment) => (i.sold_amount ?? 0) - (i.invested_amount || 0);

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const InvestmentsView: React.FC = () => {
  const {
    setActiveTab,
    setEntryCenterInitialTab,
    showToast,
    refreshKey,
    triggerRefresh,
    t,
    tv,
    formatCurrency,
    formatDate,
    toBanglaDigits,
    language,
    masterData,
    settings,
  } = useApp();

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState('newest');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebounced(searchInput.trim(), 250);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Add / edit
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Investment | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  // Valuation
  const [valuationInv, setValuationInv] = useState<Investment | null>(null);
  const [newEstVal, setNewEstVal] = useState('');

  // Sell
  const [sellInv, setSellInv] = useState<Investment | null>(null);
  const [soldAmount, setSoldAmount] = useState('');
  const [soldDate, setSoldDate] = useState(todayISO());

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<Investment | null>(null);

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v))}`;
  const gainCls = (v: number) =>
    v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300';

  const sectors = useMemo(() => masterData.filter(m => m.type === 'investment_sector'), [masterData]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getInvestments(sortBy, statusFilter, startDate || undefined, endDate || undefined, searchQuery)
      .then(list => alive && setInvestments(list))
      .catch((e: any) => alive && showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, statusFilter, startDate, endDate, searchQuery, refreshKey]);

  const active = useMemo(() => investments.filter(i => i.status !== 'Sold'), [investments]);
  const sold = useMemo(() => investments.filter(i => i.status === 'Sold'), [investments]);

  const { totalInvested, currentValue, realized } = useMemo(
    () => ({
      totalInvested: active.reduce((a, i) => a + (i.invested_amount || 0), 0),
      currentValue: active.reduce((a, i) => a + (i.current_estimated_value || 0), 0),
      realized: sold.reduce((a, i) => a + realizedGain(i), 0),
    }),
    [active, sold]
  );
  const unrealized = currentValue - totalInvested;

  const bySector = useMemo(() => {
    const map = new Map<string, { name: string; label: string; invested: number; estimated: number; count: number }>();
    active.forEach(i => {
      const k = i.sector || '—';
      const cur = map.get(k) || { name: k, label: tv(k) || k, invested: 0, estimated: 0, count: 0 };
      cur.invested += i.invested_amount || 0;
      cur.estimated += i.current_estimated_value || 0;
      cur.count += 1;
      map.set(k, cur);
    });
    return [...map.values()].sort((a, b) => b.invested - a.invested);
  }, [active, tv]);

  // Review alerts: status 'Review' or review date within the next 30 days (or past).
  const today = todayISO();
  const reviewAlerts = useMemo(
    () =>
      active
        .filter(i => i.status === 'Review' || (i.review_date && daysBetween(today, i.review_date.slice(0, 10)) <= 30))
        .sort((a, b) => (a.review_date || '9999').localeCompare(b.review_date || '9999')),
    [active, today]
  );

  const hasFilters = !!(searchInput || statusFilter !== 'All' || startDate || endDate || sortBy !== 'newest');
  const isFreshEmpty = !loading && investments.length === 0 && !hasFilters;

  const activeSectorNames = useMemo(() => sectors.filter(s => s.is_active).map(s => s.name), [sectors]);
  const sectorOptions = useMemo<SelectOption[]>(() => {
    const names = form.sector && !activeSectorNames.includes(form.sector) ? [form.sector, ...activeSectorNames] : activeSectorNames;
    return names.map(s => ({ value: s, label: tv(s) }));
  }, [activeSectorNames, form.sector, tv]);

  const statusFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'All', label: t('finance.all_statuses', 'All statuses') },
      { value: 'Growing', label: tv('Growing') },
      { value: 'Review', label: tv('Review') },
      { value: 'Sold', label: tv('Sold') },
    ],
    [t, tv]
  );
  const formStatusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'Growing', label: tv('Growing') },
      { value: 'Review', label: tv('Review') },
      ...(editing ? [{ value: 'Sold', label: tv('Sold') }] : []),
    ],
    [tv, editing]
  );
  const sortOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'newest', label: t('finance.sort_newest', 'Newest first') },
      { value: 'oldest', label: t('finance.sort_oldest', 'Oldest first') },
      { value: 'date_desc', label: t('finance.sort_purchase_desc', 'Purchase date: latest') },
      { value: 'name_asc', label: t('finance.sort_name_asc', 'Name: A to Z') },
      { value: 'val_high', label: t('finance.sort_val_high', 'Value: high to low') },
      { value: 'val_low', label: t('finance.sort_val_low', 'Value: low to high') },
      { value: 'gain_high', label: t('finance.sort_gain_high', 'Gain: high to low') },
      { value: 'gain_low', label: t('finance.sort_gain_low', 'Gain: low to high') },
    ],
    [t]
  );

  const investedLabel = t('finance.inv_invested', 'Invested');
  const estimatedLabel = t('finance.inv_estimated', 'Estimated value');

  const sectorIcon = (name: string) => {
    const s = (name || '').toLowerCase();
    if (s.includes('land')) return <MapPin size={16} className="text-emerald-700 dark:text-emerald-400" />;
    if (s.includes('flat')) return <Home size={16} className="text-amber-700 dark:text-amber-400" />;
    if (s.includes('plot')) return <Building size={16} className="text-blue-700 dark:text-blue-400" />;
    return <Cpu size={16} className="text-purple-700 dark:text-purple-400" />;
  };

  const statusBadge = (s: InvestmentStatus) => {
    const cls: Record<InvestmentStatus, string> = {
      Growing: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      Review: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      Sold: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    };
    return <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls[s] || cls.Growing}`}>{tv(s)}</span>;
  };

  // ---- actions --------------------------------------------------------------
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(activeSectorNames[0] || ''));
    setFormOpen(true);
  };

  const openEdit = (i: Investment) => {
    setEditing(i);
    setForm({
      name: i.name || '',
      sector: i.sector || '',
      purchase_date: (i.purchase_date || '').slice(0, 10),
      invested_amount: String(i.invested_amount ?? ''),
      current_estimated_value: String(i.current_estimated_value ?? ''),
      review_date: (i.review_date || '').slice(0, 10),
      location_details: i.location_details || '',
      notes: i.notes || '',
      status: i.status,
      sold_amount: i.sold_amount != null ? String(i.sold_amount) : '',
      sold_date: (i.sold_date || '').slice(0, 10) || todayISO(),
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    if (!saving) setFormOpen(false);
  };

  const handleFormSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!form.name.trim() || !form.sector || form.invested_amount === '' || !form.purchase_date ||
      (form.status === 'Sold' && (form.sold_amount === '' || !form.sold_date))) {
      showToast(t('finance.fill_required', 'Please fill in all required fields.'), 'error');
      return;
    }
    const payload: Partial<Investment> = {
      name: form.name.trim(),
      sector: form.sector,
      purchase_date: form.purchase_date,
      invested_amount: Number(form.invested_amount),
      current_estimated_value: form.current_estimated_value === '' ? Number(form.invested_amount) : Number(form.current_estimated_value),
      review_date: form.review_date,
      location_details: form.location_details.trim(),
      notes: form.notes.trim(),
      status: form.status,
    };
    if (form.status === 'Sold') {
      payload.sold_amount = Number(form.sold_amount);
      payload.sold_date = form.sold_date;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateInvestment(editing.id, payload);
        showToast(t('finance.inv_updated', 'Investment "{name}" updated.').replace('{name}', payload.name || ''));
      } else {
        await addInvestment(payload);
        showToast(t('finance.inv_added', 'Investment "{name}" added.').replace('{name}', payload.name || ''));
      }
      setFormOpen(false);
      setEditing(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleValuationUpdate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valuationInv || saving || newEstVal === '') return;
    setSaving(true);
    try {
      await updateInvestmentValuation(valuationInv.id, Number(newEstVal));
      showToast(t('finance.inv_valuation_updated', 'Valuation updated for {name}.').replace('{name}', valuationInv.name));
      setValuationInv(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSell = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sellInv || saving || soldAmount === '' || !soldDate) return;
    setSaving(true);
    try {
      await updateInvestment(sellInv.id, { status: 'Sold', sold_amount: Number(soldAmount), sold_date: soldDate });
      showToast(t('finance.inv_marked_sold', '"{name}" marked as sold.').replace('{name}', sellInv.name));
      setSellInv(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const inv = confirmDelete;
    if (!inv) return;
    setBusyId(inv.id);
    try {
      await deleteInvestment(inv.id);
      showToast(t('finance.inv_deleted', 'Investment "{name}" deleted.').replace('{name}', inv.name));
      setConfirmDelete(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openValuation = (i: Investment) => {
    setValuationInv(i);
    setNewEstVal(String(i.current_estimated_value ?? ''));
  };

  const openSell = (i: Investment) => {
    setSellInv(i);
    setSoldAmount(String(i.current_estimated_value ?? ''));
    setSoldDate(todayISO());
  };

  const resetFilters = () => {
    setSearchInput('');
    setStatusFilter('All');
    setStartDate('');
    setEndDate('');
    setSortBy('newest');
  };

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    if (investments.length === 0) {
      showToast(t('finance.inv_nothing_to_export', 'There are no investments to export.'), 'info');
      return;
    }
    try {
      const sumCost = investments.reduce((a, i) => a + (Number(i.invested_amount) || 0), 0);
      const sumVal = investments.reduce((a, i) => a + (i.status === 'Sold' ? Number(i.sold_amount) || 0 : Number(i.current_estimated_value) || 0), 0);
      const m = (n: any) => cell(n, n === null || n === undefined || n === '' ? '' : formatCurrency(Number(n)));
      const doc: ExportDoc = {
        orgName: settings?.organization_name || 'Bondhu Fund', title: t('finance.inv_title', 'Investment portfolio'), lang: language === 'bn' ? 'bn' : 'en', landscape: true, generatedOn: todayISO(),
        summary: [[investedLabel, formatCurrency(sumCost)], [estimatedLabel, formatCurrency(sumVal)], [t('finance.records', 'records'), String(investments.length)]],
        sections: [{
          columns: [
            { header: t('finance.inv_investment', 'Investment') }, { header: t('finance.inv_sector', 'Sector') }, { header: t('finance.inv_purchased', 'Purchased'), kind: 'date' },
            { header: investedLabel, kind: 'money' }, { header: estimatedLabel, kind: 'money' }, { header: t('finance.inv_gain', 'Gain'), kind: 'money' }, { header: t('common.status', 'Status') },
            { header: t('finance.inv_review', 'Review date'), kind: 'date' }, { header: t('finance.inv_sold_date', 'Sold date'), kind: 'date' }, { header: t('finance.inv_sold_amount', 'Sold amount'), kind: 'money' }, { header: t('finance.inv_location', 'Location') },
          ],
          rows: investments.map(i => [
            cell(i.name), cell(tv(i.sector)), cell(i.purchase_date, formatDate(i.purchase_date)), m(i.invested_amount), m(i.current_estimated_value),
            m(i.status === 'Sold' ? realizedGain(i) : i.gain_loss), cell(tv(i.status)), cell(i.review_date, i.review_date ? formatDate(i.review_date) : ''),
            cell(i.sold_date, i.sold_date ? formatDate(i.sold_date) : ''), m(i.sold_amount ?? null), cell(i.location_details),
          ]),
        }],
      };
      const res = await exportTable(doc, format, `Bondhu_Fund_Investments_${todayISO()}`);
      if (!res.canceled) showToast(t('finance.export_saved', 'Export saved.'));
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: React.ReactNode) => (
    <div className={`card-base p-5 border-l-4 ${accent} min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className={`text-2xl font-black tracking-tight mt-3 truncate ${valueCls}`} title={value}>{value}</div>
      <div className="text-[11px] font-semibold mt-1">{sub}</div>
    </div>
  );

  const axisTick = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 100000) return `${n(+(v / 100000).toFixed(1))}${t('finance.lakh_short', 'L')}`;
    if (abs >= 1000) return `${n((v / 1000).toFixed(0))}${t('finance.thousand_short', 'k')}`;
    return n(v);
  };

  const ChartTooltip = ({ active: on, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
    if (!on || !payload || !payload.length) return null;
    return (
      <div className="bg-slate-900/95 dark:bg-[#0c161c]/95 border border-slate-700/80 p-3 rounded-xl shadow-2xl text-xs min-w-[160px] pointer-events-none">
        {label && <div className="font-bold text-slate-300 text-[11px] pb-1.5 mb-1.5 border-b border-slate-800">{label}</div>}
        <div className="space-y-1.5">
          {payload.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.fill }} />
                <span className="text-[11px] text-slate-300 truncate">{entry.name}</span>
              </div>
              <span className="font-black text-white text-[12px] whitespace-nowrap">
                {typeof entry.value === 'number' ? formatCurrency(entry.value) : entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const btnPrimary = 'btn btn-primary';
  const btnGhost = 'btn btn-outline';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {t('finance.inv_title', 'Investment portfolio')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('finance.inv_subtitle', 'Grow the fund through shared, long-term assets.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setEntryCenterInitialTab('investment');
              setActiveTab('entry');
            }}
            className="btn btn-outline"
          >
            <FileText size={14} className="text-slate-500 dark:text-slate-400" />
            <span>{t('finance.inv_detailed_form', 'Use detailed entry form')}</span>
          </button>
          <DownloadMenu label={t('common.export', 'Export')} title={t('common.export', 'Export')} onPick={handleExport} />
          <button
            onClick={openAdd}
            className="btn btn-primary"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>{t('finance.inv_add', 'Add investment')}</span>
          </button>
        </div>
      </div>

      {/* Review alerts (derived from data) */}
      {reviewAlerts.length > 0 && (
        <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-2xl p-4 lg:p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 flex items-center justify-center shrink-0 border border-amber-300 dark:border-amber-700">
              <AlertCircle size={18} />
            </div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              {t('finance.inv_review_due', 'Committee review due')} ({n(reviewAlerts.length)})
            </h4>
          </div>
          <div className="space-y-2">
            {reviewAlerts.slice(0, 3).map(i => {
              const days = i.review_date ? daysBetween(today, i.review_date.slice(0, 10)) : null;
              const when =
                days === null
                  ? t('finance.inv_flagged_review', 'flagged for review')
                  : days < 0
                  ? t('finance.inv_review_overdue', 'review overdue since {date}').replace('{date}', formatDate(i.review_date))
                  : t('finance.inv_review_on', 'review scheduled for {date}').replace('{date}', formatDate(i.review_date));
              return (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 pl-12">
                  <p className={`text-[11px] ${days !== null && days < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}`}>
                    <span className="font-bold">{i.name}</span> — {when}
                  </p>
                  <button
                    onClick={() => openValuation(i)}
                    className="btn btn-outline btn-sm"
                  >
                    {t('finance.inv_open_review', 'Open review')}
                  </button>
                </div>
              );
            })}
            {reviewAlerts.length > 3 && (
              <p className="pl-12 text-[11px] text-slate-500 dark:text-slate-400">
                {t('finance.inv_more', '+{count} more').replace('{count}', n(reviewAlerts.length - 3))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-zoom grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi(
          'border-l-purple-500',
          t('finance.inv_total_invested', 'Invested (active)'),
          <Wallet size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(totalInvested),
          'text-slate-900 dark:text-white',
          <span className="text-slate-500 dark:text-slate-400">
            {t('finance.inv_active_across', '{count} active across {sectors} sectors')
              .replace('{count}', n(active.length))
              .replace('{sectors}', n(bySector.length))}
          </span>
        )}
        {kpi(
          'border-l-emerald-500',
          t('finance.inv_current_value', 'Current estimated value'),
          <LineChart size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(currentValue),
          'text-slate-900 dark:text-white',
          <span className={gainCls(unrealized)}>
            {signed(unrealized)} {t('finance.inv_unrealized', 'unrealized')}
          </span>
        )}
        {kpi(
          'border-l-blue-500',
          t('finance.inv_realized_gain', 'Realized gain'),
          <CheckCircle2 size={16} />,
          'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          signed(realized),
          gainCls(realized),
          <span className="text-slate-500 dark:text-slate-400">
            {t('finance.inv_sold_count', '{count} sold').replace('{count}', n(sold.length))}
          </span>
        )}
        {kpi(
          'border-l-amber-500',
          t('finance.inv_needs_review', 'Needs review'),
          <AlertCircle size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          n(reviewAlerts.length),
          'text-amber-600 dark:text-amber-400',
          <span className="text-slate-500 dark:text-slate-400">{t('finance.inv_review_hint', 'Review status or due within 30 days')}</span>
        )}
      </div>

      {/* Charts (active only) */}
      {bySector.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card-base p-5 lg:p-6 flex flex-col">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('finance.inv_allocation', 'Portfolio allocation')}</h3>
            <div className="w-full h-4 rounded-full overflow-hidden flex p-0.5 bg-slate-100 dark:bg-slate-800">
              {bySector.map((s, idx) => {
                const pct = totalInvested > 0 ? (s.invested / totalInvested) * 100 : 0;
                return (
                  <div
                    key={s.name}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${pct}%`, backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length] }}
                    title={`${s.label} ${n(pct.toFixed(1))}%`}
                  />
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 text-xs">
              {bySector.map((s, idx) => {
                const pct = totalInvested > 0 ? Math.round((s.invested / totalInvested) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length] }} />
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate" title={s.label}>{s.label}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {n(pct)}% · {formatCurrency(s.invested)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card-base p-5 lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('finance.inv_return_snapshot', 'Return snapshot')}</h3>
              <div className="flex flex-wrap items-center gap-4 text-[11px] font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0f4a3c]" />
                  <span className="text-slate-700 dark:text-slate-300">{investedLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#d97706]" />
                  <span className="text-slate-700 dark:text-slate-300">{estimatedLabel}</span>
                </div>
              </div>
            </div>
            <div className="h-56 w-full" role="img" aria-label={t('finance.inv_chart_aria', 'Invested vs estimated value by sector')}>
              <React.Suspense fallback={null}>
                <SectorChart data={bySector} axisTick={axisTick} tooltip={<ChartTooltip />} investedLabel={investedLabel} estimatedLabel={estimatedLabel} />
              </React.Suspense>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">
              {t('finance.inv_chart_note', 'Active investments by sector (sold investments excluded).')}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card-base overflow-hidden">
        <div className="p-5 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('finance.inv_list', 'Investments')}</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
            {n(investments.length)} {t('finance.records', 'records')}
          </span>
        </div>

        <div className="tbl-filter p-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('finance.inv_search_ph', 'Search name, sector, location…')}
              aria-label={t('common.search', 'Search')}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="form-input pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="min-w-[160px] flex-1 sm:flex-none sm:w-44">
            <SearchableSelect
              size="sm"
              options={statusFilterOptions}
              value={statusFilter}
              onChange={val => setStatusFilter(val == null || val === '' ? 'All' : String(val))}
              clearable={statusFilter !== 'All'}
              placeholder={t('common.status', 'Status')}
            />
          </div>
          <div className="min-w-[180px] flex-1 sm:flex-none sm:w-56">
            <SearchableSelect
              size="sm"
              options={sortOptions}
              value={sortBy}
              onChange={val => setSortBy(val == null || val === '' ? 'newest' : String(val))}
              placeholder={t('common.sort', 'Sort')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('finance.inv_purchased_from', 'Purchased from')}</span>
            <div className="min-w-[150px]">
              <DatePicker
                size="sm"
                clearable
                value={startDate}
                onChange={setStartDate}
                max={endDate || undefined}
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
              title={t('finance.reset_filters', 'Reset filters')}
              className="btn btn-outline btn-sm"
            >
              <RotateCcw size={12} />
              <span>{t('finance.reset', 'Reset')}</span>
            </button>
          )}
        </div>

        {isFreshEmpty ? (
          <div className="py-14 flex flex-col items-center text-center gap-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Briefcase size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('finance.inv_empty_title', 'No investments yet')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                {t('finance.inv_empty_body', 'Add land, flats, plots or other assets the fund buys to track their value and returns.')}
              </p>
            </div>
            <button onClick={openAdd} className={btnPrimary}>
              {t('finance.inv_add', 'Add investment')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[880px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
<th className="py-3 px-2.5 w-12 text-center">{t('common.no', 'No.')}</th>
                  <th className="py-3 px-2.5">{t('finance.inv_investment', 'Investment')}</th>
                  <th className="py-3 px-2.5">{t('finance.inv_sector', 'Sector')}</th>
                  <th className="py-3 px-2.5">{t('finance.inv_purchased', 'Purchased')}</th>
                  <th className="py-3 px-2.5 text-right">{investedLabel}</th>
                  <th className="py-3 px-2.5 text-right">{t('finance.inv_value_or_sale', 'Value / sale')}</th>
                  <th className="py-3 px-2.5 text-right">{t('finance.inv_gain', 'Gain')}</th>
                  <th className="py-3 px-2.5">{t('common.status', 'Status')}</th>
                  <th className="py-3 px-2.5 text-right">{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {loading && investments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading…')}</td>
                  </tr>
                ) : investments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">{t('finance.inv_no_match', 'No investments match your filters.')}</td>
                  </tr>
                ) : (
                  investments.map((inv, __i) => {
                    const isSold = inv.status === 'Sold';
                    const gain = isSold ? realizedGain(inv) : inv.gain_loss ?? (inv.current_estimated_value - inv.invested_amount);
                    const reviewSoon = !isSold && inv.review_date && daysBetween(today, inv.review_date.slice(0, 10)) <= 30;
                    return (
                      <tr key={inv.id} className={`hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors ${isSold ? 'opacity-80' : ''}`}>
<td className="py-3 px-2.5 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(0 + __i + 1)}</td>
                        <td className="py-3 px-2.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                              {sectorIcon(inv.sector)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 dark:text-white block">{inv.name}</span>
                              {inv.location_details && (
                                <span className="text-[10px] text-slate-400 block truncate max-w-[220px]" title={inv.location_details}>
                                  {inv.location_details}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2.5 text-slate-700 dark:text-slate-300">{tv(inv.sector)}</td>
                        <td className="py-3 px-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatDate(inv.purchase_date)}
                          {!isSold && inv.review_date && (
                            <span className={`block text-[10px] ${reviewSoon ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-400'}`}>
                              {t('finance.inv_review_short', 'Review')}: {formatDate(inv.review_date)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2.5 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(inv.invested_amount)}</td>
                        <td className="py-3 px-2.5 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {isSold ? (
                            <>
                              {formatCurrency(inv.sold_amount ?? 0)}
                              <span className="block text-[10px] font-medium text-slate-400">
                                {t('finance.inv_sold_on', 'Sold {date}').replace('{date}', formatDate(inv.sold_date))}
                              </span>
                            </>
                          ) : (
                            formatCurrency(inv.current_estimated_value)
                          )}
                        </td>
                        <td className={`py-3 px-2.5 text-right font-black whitespace-nowrap ${gainCls(gain)}`}>
                          {signed(gain)}
                          <span className="block text-[10px] font-medium text-slate-400">
                            {isSold ? t('finance.inv_realized', 'realized') : t('finance.inv_unrealized', 'unrealized')}
                          </span>
                        </td>
                        <td className="py-3 px-2.5">{statusBadge(inv.status)}</td>
                        <td className="py-3 px-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {!isSold && (
                              <>
                                <button
                                  onClick={() => openValuation(inv)}
                                  className="btn btn-green-outline btn-sm"
                                  title={t('finance.inv_update_valuation', 'Update valuation')}
                                >
                                  <TrendingUp size={12} />
                                  <span>{t('finance.inv_value', 'Value')}</span>
                                </button>
                                <button
                                  onClick={() => openSell(inv)}
                                  className="btn btn-outline btn-sm btn-icon"
                                  title={t('finance.inv_mark_sold', 'Mark as sold')}
                                  aria-label={t('finance.inv_mark_sold', 'Mark as sold')}
                                >
                                  <BadgeDollarSign size={15} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => openEdit(inv)}
                              className="btn btn-outline btn-sm btn-icon"
                              title={t('common.edit', 'Edit')}
                              aria-label={t('common.edit', 'Edit')}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(inv)}
                              disabled={busyId === inv.id}
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
        )}
      </div>

      {/* Add / Edit modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        locked={saving}
        size="lg"
        icon={<Briefcase size={18} />}
        title={editing ? t('finance.inv_edit_title', 'Edit investment') : t('finance.inv_add_title', 'Add investment')}
        subtitle={editing ? editing.name : t('finance.inv_add_sub', 'Record an asset the fund has bought.')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeForm} disabled={saving} className="btn btn-cancel">
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" form="investment-form" disabled={saving || !form.sector} className="btn btn-primary">
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
          </div>
        }
      >
        <form id="investment-form" onSubmit={handleFormSubmit} className="text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4 items-start">
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="form-label">{t('finance.inv_name', 'Investment name')} <span className="text-rose-500">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={set('name')}
                className="form-input"
                placeholder={t('finance.inv_name_ph', 'e.g. Savar land plot')}
                required
              />
            </div>
            {sectorOptions.length > 0 ? (
              <SearchableSelect
                label={t('finance.inv_sector', 'Sector')}
                required
                options={sectorOptions}
                value={form.sector}
                onChange={val => setForm(f => ({ ...f, sector: String(val ?? '') }))}
                placeholder={t('finance.inv_select_sector', 'Select sector…')}
              />
            ) : (
              <div>
                <label className="form-label">{t('finance.inv_sector', 'Sector')} <span className="text-rose-500">*</span></label>
                <button type="button" onClick={() => { setFormOpen(false); setActiveTab('master'); }} className="btn btn-outline btn-block">
                  {t('finance.exp_add_categories', 'Add them in Master data')}
                </button>
              </div>
            )}

            <SearchableSelect
              label={t('common.status', 'Status')}
              options={formStatusOptions}
              value={form.status}
              onChange={val => setForm(f => ({ ...f, status: (val || 'Growing') as InvestmentStatus }))}
            />
            <div>
              <label className="form-label">{investedLabel} <span className="text-rose-500">*</span></label>
              <MoneyInput min="0" step="any" value={form.invested_amount} onChange={set('invested_amount')} className="form-input font-bold tabular-nums" placeholder="0" required />
            </div>
            <div>
              <label className="form-label">{t('finance.inv_current_value', 'Current estimated value')}</label>
              <MoneyInput
                min="0"
                step="any"
                value={form.current_estimated_value}
                onChange={set('current_estimated_value')}
                placeholder={t('finance.inv_same_as_invested', 'Same as invested')}
                className="form-input font-bold tabular-nums"
              />
            </div>

            <DatePicker
              label={t('finance.inv_purchase_date', 'Purchase date')}
              required
              max={today}
              value={form.purchase_date}
              onChange={iso => setForm(f => ({ ...f, purchase_date: iso }))}
            />
            <DatePicker
              label={t('finance.inv_review_date', 'Next review date')}
              clearable
              value={form.review_date}
              onChange={iso => setForm(f => ({ ...f, review_date: iso }))}
              placeholder={t('finance.inv_review_date_ph', 'Not scheduled')}
            />
            <div>
              <label className="form-label">{t('finance.inv_location', 'Location / deed details')}</label>
              <input type="text" value={form.location_details} onChange={set('location_details')} className="form-input" />
            </div>

            {form.status === 'Sold' && (
              <>
                <div>
                  <label className="form-label">{t('finance.inv_sold_amount', 'Sale amount')} <span className="text-rose-500">*</span></label>
                  <MoneyInput min="0" step="any" value={form.sold_amount} onChange={set('sold_amount')} className="form-input font-bold tabular-nums" required />
                </div>
                <DatePicker
                  label={t('finance.inv_sold_date', 'Sale date')}
                  required
                  max={today}
                  min={form.purchase_date || undefined}
                  value={form.sold_date}
                  onChange={iso => setForm(f => ({ ...f, sold_date: iso }))}
                />
              </>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="form-label">{t('common.notes', 'Notes')}</label>
              <input type="text" value={form.notes} onChange={set('notes')} className="form-input" />
            </div>
          </div>
        </form>
      </Modal>

      {/* Valuation modal */}
      <Modal
        open={!!valuationInv}
        onClose={() => !saving && setValuationInv(null)}
        locked={saving}
        size="sm"
        icon={<TrendingUp size={18} />}
        title={t('finance.inv_update_valuation', 'Update valuation')}
        subtitle={valuationInv ? `${valuationInv.name} · ${tv(valuationInv.sector)}` : undefined}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const inv = valuationInv;
                setValuationInv(null);
                if (inv) openEdit(inv);
              }}
              className="btn btn-outline mr-auto"
            >
              {t('finance.inv_edit_details', 'Edit details / review date')}
            </button>
            <button type="button" onClick={() => setValuationInv(null)} disabled={saving} className="btn btn-cancel">
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" form="valuation-form" disabled={saving || newEstVal === ''} className="btn btn-primary">
              {saving ? t('common.saving', 'Saving…') : t('finance.inv_update_valuation', 'Update valuation')}
            </button>
          </div>
        }
      >
        {valuationInv && (
          <form id="valuation-form" onSubmit={handleValuationUpdate} className="space-y-4 text-xs">
            <div className="bg-slate-100 dark:bg-[#121f26] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                {investedLabel}: <span className="font-bold">{formatCurrency(valuationInv.invested_amount)}</span>
                {' · '}
                {t('finance.inv_current', 'Current')}: <span className="font-bold">{formatCurrency(valuationInv.current_estimated_value)}</span>
              </p>
              {valuationInv.review_date && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('finance.inv_review_date', 'Next review date')}: {formatDate(valuationInv.review_date)}
                </p>
              )}
            </div>
            <div>
              <label className="form-label">{t('finance.inv_new_value', 'New estimated market value')} <span className="text-rose-500">*</span></label>
              <MoneyInput min="0" step="any" value={newEstVal} onChange={e => setNewEstVal(e.target.value)} className="form-input font-bold" required autoFocus />
            </div>
          </form>
        )}
      </Modal>

      {/* Mark as sold modal */}
      <Modal
        open={!!sellInv}
        onClose={() => !saving && setSellInv(null)}
        locked={saving}
        size="sm"
        icon={<BadgeDollarSign size={18} />}
        title={t('finance.inv_mark_sold', 'Mark as sold')}
        subtitle={sellInv ? `${sellInv.name} · ${investedLabel}: ${formatCurrency(sellInv.invested_amount)}` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setSellInv(null)} disabled={saving} className="btn btn-cancel">
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" form="sell-form" disabled={saving || soldAmount === '' || !soldDate} className="btn btn-primary">
              {saving ? t('common.saving', 'Saving…') : t('finance.inv_mark_sold', 'Mark as sold')}
            </button>
          </div>
        }
      >
        {sellInv && (
          <form id="sell-form" onSubmit={handleSell} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('finance.inv_sold_amount', 'Sale amount')} <span className="text-rose-500">*</span></label>
                <MoneyInput min="0" step="any" value={soldAmount} onChange={e => setSoldAmount(e.target.value)} className="form-input font-bold" required autoFocus />
              </div>
              <div>
                <DatePicker
                  label={t('finance.inv_sold_date', 'Sale date')}
                  required
                  max={today}
                  min={(sellInv.purchase_date || '').slice(0, 10) || undefined}
                  value={soldDate}
                  onChange={setSoldDate}
                />
              </div>
            </div>
            {soldAmount !== '' && (
              <p className={`text-[11px] font-bold ${gainCls(Number(soldAmount) - sellInv.invested_amount)}`}>
                {t('finance.inv_realized_gain', 'Realized gain')}: {signed(Number(soldAmount) - sellInv.invested_amount)}
              </p>
            )}
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
        title={t('finance.inv_delete_title', 'Delete investment?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={busyId !== null} className="btn btn-cancel">
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
            {t('finance.inv_delete_body', 'Delete investment "{name}"? This cannot be undone.').replace('{name}', confirmDelete.name)}
          </p>
        )}
      </Modal>
    </div>
  );
};
