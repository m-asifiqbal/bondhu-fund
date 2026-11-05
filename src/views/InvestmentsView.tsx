import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Download,
  FileText,
  Building,
  Home,
  MapPin,
  Cpu,
  AlertCircle,
  X,
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
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useApp } from '../context/AppContext';
import {
  getInvestments,
  addInvestment,
  updateInvestment,
  updateInvestmentValuation,
  deleteInvestment,
  getMasterData,
  saveTextFile,
  toCsv,
} from '../services/db';
import { Investment, InvestmentStatus, MasterCategory } from '../types';
import { CustomChartTooltip } from '../components/common/CustomChartTooltip';
import { todayISO, daysBetween } from '../utils/date';

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

export const InvestmentsView: React.FC = () => {
  const {
    setActiveTab,
    setEntryCenterInitialTab,
    showToast,
    refreshKey,
    triggerRefresh,
    language,
    t,
    formatCurrency,
    formatDate,
    toBanglaDigits,
  } = useApp();

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [sectors, setSectors] = useState<MasterCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState('newest');
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
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

  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v))}`;
  const gainCls = (v: number) =>
    v > 0 ? 'text-emerald-700 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300';

  useEffect(() => {
    getMasterData('investment_sector')
      .then(setSectors)
      .catch((e: any) => showToast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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

  const totalInvested = active.reduce((a, i) => a + (i.invested_amount || 0), 0);
  const currentValue = active.reduce((a, i) => a + (i.current_estimated_value || 0), 0);
  const unrealized = currentValue - totalInvested;
  const realized = sold.reduce((a, i) => a + realizedGain(i), 0);

  const bySector = useMemo(() => {
    const map = new Map<string, { name: string; invested: number; estimated: number; count: number }>();
    active.forEach(i => {
      const k = i.sector || '—';
      const cur = map.get(k) || { name: k, invested: 0, estimated: 0, count: 0 };
      cur.invested += i.invested_amount || 0;
      cur.estimated += i.current_estimated_value || 0;
      cur.count += 1;
      map.set(k, cur);
    });
    return [...map.values()].sort((a, b) => b.invested - a.invested);
  }, [active]);

  // Review alerts: status 'Review' or review date within the next 30 days (or past).
  const today = todayISO();
  const reviewAlerts = useMemo(
    () =>
      active
        .filter(i => i.status === 'Review' || (i.review_date && daysBetween(today, i.review_date.slice(0, 10)) <= 30))
        .sort((a, b) => (a.review_date || '9999').localeCompare(b.review_date || '9999')),
    [active, today]
  );

  const hasFilters = !!(searchQuery || statusFilter !== 'All' || startDate || endDate || sortBy !== 'newest');
  const isFreshEmpty = !loading && investments.length === 0 && !hasFilters;

  const activeSectorNames = sectors.filter(s => s.is_active).map(s => s.name);
  const sectorChoices =
    form.sector && !activeSectorNames.includes(form.sector) ? [form.sector, ...activeSectorNames] : activeSectorNames;

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
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls[s] || cls.Growing}`}>
        {t(`investments.status${s}`, s)}
      </span>
    );
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

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
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
        showToast(t('investments.updated', `Investment "${payload.name}" updated.`));
      } else {
        await addInvestment(payload);
        showToast(t('investments.added', `Investment "${payload.name}" added.`));
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

  const handleValuationUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valuationInv || saving) return;
    setSaving(true);
    try {
      await updateInvestmentValuation(valuationInv.id, Number(newEstVal));
      showToast(t('investments.valuationUpdated', `Valuation updated for ${valuationInv.name}.`));
      setValuationInv(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellInv || saving) return;
    setSaving(true);
    try {
      await updateInvestment(sellInv.id, { status: 'Sold', sold_amount: Number(soldAmount), sold_date: soldDate });
      showToast(t('investments.markedSold', `"${sellInv.name}" marked as sold.`));
      setSellInv(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (inv: Investment) => {
    if (!window.confirm(t('investments.deleteConfirm', `Delete investment "${inv.name}"? This cannot be undone.`))) return;
    setBusyId(inv.id);
    try {
      await deleteInvestment(inv.id);
      showToast(t('investments.deleted', `Investment "${inv.name}" deleted.`));
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

  const handleExport = async () => {
    if (investments.length === 0) {
      showToast(t('investments.nothingToExport', 'There are no investments to export.'), 'info');
      return;
    }
    try {
      const csv = toCsv(
        ['Name', 'Sector', 'Purchase Date', 'Invested', 'Estimated Value', 'Unrealized Gain', 'Status', 'Review Date', 'Sold Date', 'Sold Amount', 'Realized Gain', 'Location', 'Notes'],
        investments.map(i => [
          i.name,
          i.sector,
          i.purchase_date,
          i.invested_amount,
          i.current_estimated_value,
          i.status === 'Sold' ? '' : i.gain_loss,
          i.status,
          i.review_date || '',
          i.sold_date || '',
          i.sold_amount ?? '',
          i.status === 'Sold' ? realizedGain(i) : '',
          i.location_details || '',
          i.notes || '',
        ])
      );
      const res = await saveTextFile(`Bondhu_Fund_Investments_${todayISO()}.csv`, csv, [{ name: 'CSV', extensions: ['csv'] }]);
      if (!res.canceled) showToast(t('common.exported', 'Export saved.'));
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: React.ReactNode) => (
    <div className={`card-base p-5 border-l-4 ${accent} min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className={`text-2xl font-black tracking-tight mt-3 truncate ${valueCls}`}>{value}</div>
      <div className="text-[11px] font-semibold mt-1 truncate">{sub}</div>
    </div>
  );

  const btnPrimary =
    'px-5 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed';
  const btnGhost = 'px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'বিনিয়োগ পোর্টফোলিও' : 'Investment portfolio'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('investments.subtitle', 'Grow the fund through shared, long-term assets.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setEntryCenterInitialTab('investment');
              setActiveTab('entry');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <FileText size={14} className="text-slate-500 dark:text-slate-400" />
            <span>{t('investments.detailedForm', 'Use detailed entry form')}</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={14} className="text-slate-500 dark:text-slate-400" />
            <span>{t('common.export', 'Export')}</span>
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>{t('investments.add', 'Add investment')}</span>
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
              {t('investments.reviewDue', 'Committee review due')} ({n(reviewAlerts.length)})
            </h4>
          </div>
          <div className="space-y-2">
            {reviewAlerts.slice(0, 3).map(i => {
              const days = i.review_date ? daysBetween(today, i.review_date.slice(0, 10)) : null;
              const when =
                days === null
                  ? t('investments.flaggedReview', 'flagged for review')
                  : days < 0
                  ? `${t('investments.reviewOverdue', 'review overdue since')} ${formatDate(i.review_date)}`
                  : `${t('investments.reviewOn', 'review scheduled for')} ${formatDate(i.review_date)}`;
              return (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 pl-12">
                  <p className={`text-[11px] ${days !== null && days < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}`}>
                    <span className="font-bold">{i.name}</span> — {when}
                  </p>
                  <button
                    onClick={() => openValuation(i)}
                    className="px-3 py-1.5 bg-white dark:bg-[#1a2830] hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-xl text-[11px] font-bold shadow-sm transition-colors"
                  >
                    {t('investments.openReview', 'Open review')}
                  </button>
                </div>
              );
            })}
            {reviewAlerts.length > 3 && (
              <p className="pl-12 text-[11px] text-slate-500 dark:text-slate-400">
                +{n(reviewAlerts.length - 3)} {t('investments.more', 'more')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi(
          'border-l-purple-500',
          t('investments.totalInvested', 'Invested (active)'),
          <Wallet size={16} />,
          'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
          formatCurrency(totalInvested),
          'text-slate-900 dark:text-white',
          <span className="text-slate-500 dark:text-slate-400">
            {n(active.length)} {t('investments.activeAcross', 'active across')} {n(bySector.length)} {t('investments.sectors', 'sectors')}
          </span>
        )}
        {kpi(
          'border-l-emerald-500',
          t('investments.currentValue', 'Current estimated value'),
          <LineChart size={16} />,
          'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(currentValue),
          'text-slate-900 dark:text-white',
          <span className={gainCls(unrealized)}>
            {signed(unrealized)} {t('investments.unrealized', 'unrealized')}
          </span>
        )}
        {kpi(
          'border-l-blue-500',
          t('investments.realized', 'Realized gain'),
          <CheckCircle2 size={16} />,
          'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          signed(realized),
          gainCls(realized),
          <span className="text-slate-500 dark:text-slate-400">
            {n(sold.length)} {t('investments.soldCount', 'sold')}
          </span>
        )}
        {kpi(
          'border-l-amber-500',
          t('investments.underReview', 'Needs review'),
          <AlertCircle size={16} />,
          'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          n(reviewAlerts.length),
          'text-amber-600 dark:text-amber-400',
          <span className="text-slate-500 dark:text-slate-400">{t('investments.reviewHint', 'Review status or due within 30 days')}</span>
        )}
      </div>

      {/* Charts (active only) */}
      {bySector.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card-base p-5 lg:p-6 flex flex-col">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">{t('investments.allocation', 'Portfolio allocation')}</h3>
            <div className="w-full h-4 rounded-full overflow-hidden flex p-0.5 bg-slate-100 dark:bg-slate-800">
              {bySector.map((s, idx) => {
                const pct = totalInvested > 0 ? (s.invested / totalInvested) * 100 : 0;
                return (
                  <div
                    key={s.name}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${pct}%`, backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length] }}
                    title={`${s.name} ${pct.toFixed(1)}%`}
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
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">{s.name}</span>
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
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('investments.returnSnapshot', 'Return snapshot')}</h3>
              <div className="flex items-center gap-4 text-[11px] font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0f4a3c]" />
                  <span className="text-slate-700 dark:text-slate-300">{t('investments.invested', 'Invested')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#d97706]" />
                  <span className="text-slate-700 dark:text-slate-300">{t('investments.estimated', 'Estimated value')}</span>
                </div>
              </div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySector} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={v => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    content={<CustomChartTooltip currencyPrefix={language === 'bn' ? '৳' : 'TK'} />}
                  />
                  <Bar dataKey="invested" name={t('investments.invested', 'Invested')} fill="#0f4a3c" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="estimated" name={t('investments.estimated', 'Estimated value')} fill="#d97706" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">
              {t('investments.chartNote', 'Active investments by sector (sold investments excluded).')}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card-base overflow-hidden">
        <div className="p-5 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('investments.list', 'Investments')}</h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
            {n(investments.length)} {t('investments.records', 'records')}
          </span>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2.5 text-xs">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('investments.searchPh', 'Search name, sector, location...')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="form-input pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="w-36">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="form-select py-1.5 text-xs">
              <option value="All">{t('common.allStatus', 'All status')}</option>
              <option value="Growing">{t('investments.statusGrowing', 'Growing')}</option>
              <option value="Review">{t('investments.statusReview', 'Review')}</option>
              <option value="Sold">{t('investments.statusSold', 'Sold')}</option>
            </select>
          </div>
          <div className="w-44">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="form-select py-1.5 text-xs">
              <option value="newest">{t('sort.newest', 'Sort: Newest first')}</option>
              <option value="oldest">{t('sort.oldest', 'Sort: Oldest first')}</option>
              <option value="date_desc">{t('sort.purchaseDesc', 'Purchase date: Latest')}</option>
              <option value="name_asc">{t('sort.nameAsc', 'Name: A to Z')}</option>
              <option value="val_high">{t('sort.valHigh', 'Value: High to low')}</option>
              <option value="val_low">{t('sort.valLow', 'Value: Low to high')}</option>
              <option value="gain_high">{t('sort.gainHigh', 'Gain: High to low')}</option>
              <option value="gain_low">{t('sort.gainLow', 'Gain: Low to high')}</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">{t('investments.purchasedFrom', 'Purchased from')}:</span>
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
                setStatusFilter('All');
                setStartDate('');
                setEndDate('');
                setSortBy('newest');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-[#182830] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
            >
              <RotateCcw size={12} />
              <span>{t('common.reset', 'Reset')}</span>
            </button>
          )}
        </div>

        {isFreshEmpty ? (
          <div className="py-14 flex flex-col items-center text-center gap-3 px-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Briefcase size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('investments.emptyTitle', 'No investments yet')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                {t('investments.emptyBody', 'Add land, flats, plots or other assets the fund buys to track their value and returns.')}
              </p>
            </div>
            <button onClick={openAdd} className={`${btnPrimary} text-xs`}>
              {t('investments.add', 'Add investment')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[960px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">{t('investments.investment', 'Investment')}</th>
                  <th className="py-3 px-4">{t('investments.sector', 'Sector')}</th>
                  <th className="py-3 px-4">{t('investments.purchased', 'Purchased')}</th>
                  <th className="py-3 px-4 text-right">{t('investments.invested', 'Invested')}</th>
                  <th className="py-3 px-4 text-right">{t('investments.valueOrSale', 'Value / sale')}</th>
                  <th className="py-3 px-4 text-right">{t('investments.gain', 'Gain')}</th>
                  <th className="py-3 px-4">{t('common.status')}</th>
                  <th className="py-3 px-4 text-right">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {loading && investments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading...')}</td>
                  </tr>
                ) : investments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">{t('investments.noMatch', 'No investments match your filters.')}</td>
                  </tr>
                ) : (
                  investments.map(inv => {
                    const isSold = inv.status === 'Sold';
                    const gain = isSold ? realizedGain(inv) : inv.gain_loss ?? (inv.current_estimated_value - inv.invested_amount);
                    const reviewSoon = !isSold && inv.review_date && daysBetween(today, inv.review_date.slice(0, 10)) <= 30;
                    return (
                      <tr key={inv.id} className={`hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors ${isSold ? 'opacity-80' : ''}`}>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                              {sectorIcon(inv.sector)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 dark:text-white block">{inv.name}</span>
                              {inv.location_details && (
                                <span className="text-[10px] text-slate-400 block truncate max-w-[220px]">{inv.location_details}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{inv.sector}</td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatDate(inv.purchase_date)}
                          {!isSold && inv.review_date && (
                            <span className={`block text-[10px] ${reviewSoon ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-400'}`}>
                              {t('investments.reviewShort', 'Review')}: {formatDate(inv.review_date)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(inv.invested_amount)}</td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {isSold ? (
                            <>
                              {formatCurrency(inv.sold_amount ?? 0)}
                              <span className="block text-[10px] font-medium text-slate-400">
                                {t('investments.soldOn', 'Sold')} {formatDate(inv.sold_date)}
                              </span>
                            </>
                          ) : (
                            formatCurrency(inv.current_estimated_value)
                          )}
                        </td>
                        <td className={`py-3 px-4 text-right font-black whitespace-nowrap ${gainCls(gain)}`}>
                          {signed(gain)}
                          <span className="block text-[10px] font-medium text-slate-400">
                            {isSold ? t('investments.realizedShort', 'realized') : t('investments.unrealizedShort', 'unrealized')}
                          </span>
                        </td>
                        <td className="py-3 px-4">{statusBadge(inv.status)}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {!isSold && (
                              <>
                                <button
                                  onClick={() => openValuation(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[#0f4a3c] dark:text-emerald-400 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 transition-colors"
                                  title={t('investments.updateValuation', 'Update valuation')}
                                >
                                  <TrendingUp size={12} />
                                  <span>{t('investments.value', 'Value')}</span>
                                </button>
                                <button
                                  onClick={() => openSell(inv)}
                                  className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40"
                                  title={t('investments.markSold', 'Mark as sold')}
                                >
                                  <BadgeDollarSign size={15} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => openEdit(inv)}
                              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              title={t('common.edit', 'Edit')}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(inv)}
                              disabled={busyId === inv.id}
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
        )}
      </div>

      {/* Add / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-lg p-6 text-xs space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editing ? t('investments.editTitle', 'Edit investment') : t('investments.addTitle', 'Add investment')}
              </h3>
              <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3">
              <div>
                <label className="form-label">{t('investments.name', 'Investment name')} *</label>
                <input type="text" value={form.name} onChange={set('name')} className="form-input" required />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t('investments.sector', 'Sector')} *</label>
                  {sectorChoices.length > 0 ? (
                    <select value={form.sector} onChange={set('sector')} className="form-select" required>
                      {!form.sector && <option value="">{t('investments.selectSector', 'Select sector...')}</option>}
                      {sectorChoices.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="form-hint">
                      {t('investments.noSectors', 'No sectors yet.')}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setFormOpen(false);
                          setActiveTab('master');
                        }}
                        className="font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline"
                      >
                        {t('investments.addSectors', 'Add them in Master data')}
                      </button>
                    </p>
                  )}
                </div>
                <div>
                  <label className="form-label">{t('common.status', 'Status')}</label>
                  <select value={form.status} onChange={set('status')} className="form-select">
                    <option value="Growing">{t('investments.statusGrowing', 'Growing')}</option>
                    <option value="Review">{t('investments.statusReview', 'Review')}</option>
                    {editing && <option value="Sold">{t('investments.statusSold', 'Sold')}</option>}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t('investments.invested', 'Invested')} *</label>
                  <input type="number" min="0" step="any" value={form.invested_amount} onChange={set('invested_amount')} className="form-input font-bold" required />
                </div>
                <div>
                  <label className="form-label">{t('investments.currentValue', 'Current estimated value')}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.current_estimated_value}
                    onChange={set('current_estimated_value')}
                    placeholder={t('investments.sameAsInvested', 'Same as invested')}
                    className="form-input font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t('investments.purchaseDate', 'Purchase date')} *</label>
                  <input type="date" max={todayISO()} value={form.purchase_date} onChange={set('purchase_date')} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">{t('investments.reviewDate', 'Next review date')}</label>
                  <input type="date" value={form.review_date} onChange={set('review_date')} className="form-input" />
                </div>
              </div>

              {form.status === 'Sold' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800">
                  <div>
                    <label className="form-label">{t('investments.soldAmount', 'Sale amount')} *</label>
                    <input type="number" min="0" step="any" value={form.sold_amount} onChange={set('sold_amount')} className="form-input font-bold" required />
                  </div>
                  <div>
                    <label className="form-label">{t('investments.soldDate', 'Sale date')} *</label>
                    <input type="date" max={todayISO()} value={form.sold_date} onChange={set('sold_date')} className="form-input" required />
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">{t('investments.location', 'Location / deed details')}</label>
                <input type="text" value={form.location_details} onChange={set('location_details')} className="form-input" />
              </div>
              <div>
                <label className="form-label">{t('common.notes', 'Notes')}</label>
                <textarea rows={2} value={form.notes} onChange={set('notes')} className="form-input" />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => setFormOpen(false)} className={btnGhost}>
                  {t('common.cancel', 'Cancel')}
                </button>
                <button type="submit" disabled={saving || !form.sector} className={btnPrimary}>
                  {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Valuation modal */}
      {valuationInv && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('investments.updateValuation', 'Update valuation')}</h3>
              <button onClick={() => setValuationInv(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="bg-slate-100 dark:bg-[#121f26] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-bold text-slate-900 dark:text-white text-sm">{valuationInv.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">{valuationInv.sector}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                {t('investments.invested', 'Invested')}: <span className="font-bold">{formatCurrency(valuationInv.invested_amount)}</span>
                {' · '}
                {t('investments.current', 'Current')}: <span className="font-bold">{formatCurrency(valuationInv.current_estimated_value)}</span>
              </p>
              {valuationInv.review_date && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('investments.reviewDate', 'Next review date')}: {formatDate(valuationInv.review_date)}
                </p>
              )}
            </div>
            <form onSubmit={handleValuationUpdate} className="space-y-3">
              <div>
                <label className="form-label">{t('investments.newValue', 'New estimated market value')} *</label>
                <input type="number" min="0" step="any" value={newEstVal} onChange={e => setNewEstVal(e.target.value)} className="form-input font-bold" required autoFocus />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const inv = valuationInv;
                    setValuationInv(null);
                    openEdit(inv);
                  }}
                  className="mr-auto text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline"
                >
                  {t('investments.editDetails', 'Edit details / review date')}
                </button>
                <button type="button" onClick={() => setValuationInv(null)} className={btnGhost}>
                  {t('common.cancel', 'Cancel')}
                </button>
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? t('common.saving', 'Saving...') : t('investments.updateValuation', 'Update valuation')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mark as sold modal */}
      {sellInv && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('investments.markSold', 'Mark as sold')}</h3>
              <button onClick={() => setSellInv(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="bg-slate-100 dark:bg-[#121f26] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-bold text-slate-900 dark:text-white text-sm">{sellInv.name}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {t('investments.invested', 'Invested')}: <span className="font-bold">{formatCurrency(sellInv.invested_amount)}</span>
              </p>
            </div>
            <form onSubmit={handleSell} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label">{t('investments.soldAmount', 'Sale amount')} *</label>
                  <input type="number" min="0" step="any" value={soldAmount} onChange={e => setSoldAmount(e.target.value)} className="form-input font-bold" required autoFocus />
                </div>
                <div>
                  <label className="form-label">{t('investments.soldDate', 'Sale date')} *</label>
                  <input type="date" max={todayISO()} value={soldDate} onChange={e => setSoldDate(e.target.value)} className="form-input" required />
                </div>
              </div>
              {soldAmount !== '' && (
                <p className={`text-[11px] font-bold ${gainCls(Number(soldAmount) - sellInv.invested_amount)}`}>
                  {t('investments.realized', 'Realized gain')}: {signed(Number(soldAmount) - sellInv.invested_amount)}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => setSellInv(null)} className={btnGhost}>
                  {t('common.cancel', 'Cancel')}
                </button>
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? t('common.saving', 'Saving...') : t('investments.confirmSold', 'Mark as sold')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
