import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileText, Calendar, Users, TrendingUp, Receipt, Clock, Layers, Columns3,
  AlertTriangle, ShieldCheck, Loader2, Inbox, RefreshCw, ChevronDown, Check, Search,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getAllMembersLite, saveTextFile, savePdf, toCsv } from '../services/db';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { BUILDERS, ReportData, ReportId, ColumnDef } from '../components/reports/reportBuilders';
import { ReportTableView, formatCell, totalsFor, Formatters } from '../components/reports/ReportTableView';
import { addMonths, currentMonthKey, fiscalYearRange, toMonthKey, todayISO, monthKeyToName } from '../utils/date';

type Scope = 'range' | 'month' | 'member' | 'none';
type Preset = 'today' | 'this_month' | 'last_month' | 'this_fy' | 'last_12' | 'custom';

interface ReportDef {
  id: ReportId; title: string; desc: string; file: string;
  icon: React.ElementType; scope: Scope;
}

// Titles/descriptions are translated via t(`reports.r_${id}` / `reports.r_${id}_desc`).
const REPORTS: ReportDef[] = [
  { id: 'cashbook', title: 'Cash Book', desc: 'Day / date-range ledger with running balance', file: 'CashBook', icon: Clock, scope: 'range' },
  { id: 'collections', title: 'Monthly Collection Sheet', desc: 'All members due: paid, pending, overdue', file: 'CollectionSheet', icon: Calendar, scope: 'month' },
  { id: 'fiscal', title: 'Fiscal-Year Statement', desc: 'Month totals and member-wise yearly contribution', file: 'FiscalYear', icon: Layers, scope: 'month' },
  { id: 'member', title: 'Member Statement', desc: 'Month-by-month history incl. unpaid months', file: 'MemberStatement', icon: Users, scope: 'member' },
  { id: 'defaulters', title: 'Defaulters / Arrears', desc: 'Members with unpaid months and amounts', file: 'Arrears', icon: AlertTriangle, scope: 'month' },
  { id: 'expenses', title: 'Expenses Report', desc: 'Expenses with category subtotals', file: 'Expenses', icon: Receipt, scope: 'range' },
  { id: 'investments', title: 'Investment Portfolio', desc: 'Active and sold assets with gains', file: 'Investments', icon: TrendingUp, scope: 'none' },
  { id: 'audit', title: 'Audit Trail', desc: 'Who changed what, and when', file: 'AuditTrail', icon: ShieldCheck, scope: 'range' },
];

const PRESETS: Array<{ id: Preset; en: string }> = [
  { id: 'today', en: 'Today' },
  { id: 'this_month', en: 'This month' },
  { id: 'last_month', en: 'Last month' },
  { id: 'this_fy', en: 'This fiscal year' },
  { id: 'last_12', en: 'Last 12 months' },
  { id: 'custom', en: 'Custom' },
];

const monthEnd = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

function presetRange(p: Preset, fyStart: number): { start: string; end: string } | null {
  const today = todayISO();
  const cur = currentMonthKey();
  switch (p) {
    case 'today': return { start: today, end: today };
    case 'this_month': return { start: `${cur}-01`, end: monthEnd(cur) };
    case 'last_month': { const k = addMonths(cur, -1); return { start: `${k}-01`, end: monthEnd(k) }; }
    case 'this_fy': { const fy = fiscalYearRange(cur, fyStart); return { start: fy.start, end: fy.end }; }
    case 'last_12': return { start: `${addMonths(cur, -11)}-01`, end: today };
    default: return null;
  }
}

const defaultCols = (cols: ColumnDef[]) => new Set(cols.filter(c => c.default !== false).map(c => c.key));

export const ReportsView: React.FC = () => {
  const {
    t, tv, bnName, language, formatCurrency, formatDate, formatMonth, toBanglaDigits, selectedMonth, showToast, refreshKey,
    settings, orgName, masterData,
  } = useApp();
  const bn = language === 'bn';
  const num = (n: number | string) => (bn ? toBanglaDigits(n) : String(n));

  const [reportId, setReportId] = useState<ReportId>('cashbook');
  const def = REPORTS.find(r => r.id === reportId)!;
  const rTitle = (r: ReportDef) => t(`reports.r_${r.id}`, r.title);

  // Settings & lookups (settings / master data come from the app context)
  const fyStart = Number(settings?.fiscal_year_start_month) || 7;
  const [memberList, setMemberList] = useState<Array<{ id: number; member_code: string; name: string; name_bn?: string | null; phone: string; status: string }>>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  // Filters
  const [preset, setPreset] = useState<Preset>('this_month');
  const initial = presetRange('this_month', 7)!;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [month, setMonth] = useState(() => selectedMonth || monthKeyToName(currentMonthKey()));
  const [memberId, setMemberId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const setFilter = (k: string, v: string) => setFilters(prev => ((prev[k] || '') === v ? prev : { ...prev, [k]: v }));
  const [searchText, setSearchText] = useState('');

  // Data
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, Set<string>>>({});
  const [chooserOpen, setChooserOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [generatedAt, setGeneratedAt] = useState(todayISO());
  const chooserRef = useRef<HTMLDivElement>(null);

  // Members lookup
  useEffect(() => {
    let alive = true;
    setLookupsLoading(true);
    getAllMembersLite()
      .then(ms => { if (alive) setMemberList(ms as any); })
      .catch((e: any) => showToast(e.message, 'error'))
      .finally(() => { if (alive) setLookupsLoading(false); });
    return () => { alive = false; };
  }, [refreshKey, showToast]);

  const memberOptions = useMemo<SelectOption[]>(() => memberList.map(m => ({
    value: m.id, label: bnName(m.name, m.name_bn), subLabel: `${num(m.member_code)}${m.phone ? ' · ' + num(m.phone) : ''}`,
    badge: tv(m.status), badgeColor: m.status === 'Active' ? 'emerald' : 'slate',
  })), [memberList, bnName, tv, bn]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameBnMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of memberList) if (m.name_bn) map.set(m.name, m.name_bn);
    return map;
  }, [memberList]);

  const categoryOptions = useMemo<SelectOption[]>(() => masterData
    .filter(c => c.type === 'expense_category')
    .map(c => ({ value: c.name, label: tv(c.name) })), [masterData, tv]);

  const ledgerOptions = useMemo<SelectOption[]>(() => [
    { value: 'collection', label: t('reports.collections_only', 'Collections only') },
    { value: 'expense', label: t('reports.expenses_only', 'Expenses only') },
    { value: 'investment', label: t('reports.investments_only', 'Investments only') },
  ], [t]);
  const statusOptions = useMemo(() => {
    const mk = (vals: string[]): SelectOption[] => vals.map(v => ({ value: v, label: tv(v) }));
    return {
      collections: mk(['Paid', 'Pending', 'Overdue']),
      expenses: mk(['Verified', 'Needs receipt']),
      investments: mk(['Growing', 'Review', 'Sold']),
    };
  }, [tv]);

  // Debounced audit search
  useEffect(() => {
    const h = setTimeout(() => setFilter('search', searchText.trim()), 250);
    return () => clearTimeout(h);
  }, [searchText]);

  // Re-apply preset when fiscal-year start becomes known
  useEffect(() => {
    const r = presetRange(preset, fyStart);
    if (r) { setStart(r.start); setEnd(r.end); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyStart]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p, fyStart);
    if (r) { setStart(r.start); setEnd(r.end); }
  };

  // Load the report
  const monthKey = toMonthKey(month);
  const rangeValid = !!start && !!end && start <= end;
  useEffect(() => {
    if (def.scope === 'range' && !rangeValid) { setData(null); setError(t('reports.invalid_range', 'Start date must be on or before end date.')); return; }
    if (def.scope === 'member' && !memberId) { setData(null); setError(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    BUILDERS[reportId]({
      start, end, month: monthKey, memberId, fyStartMonth: fyStart, filters,
      fmtDate: formatDate, fmtMonth: formatMonth, bn,
    }).then(d => {
      if (!alive) return;
      setData(d);
      setGeneratedAt(todayISO());
      setVisible(prev => (prev[reportId] ? prev : { ...prev, [reportId]: defaultCols(d.columns) }));
    }).catch((e: any) => {
      if (!alive) return;
      setData(null);
      setError(e.message);
      showToast(e.message, 'error');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, start, end, monthKey, memberId, fyStart, filters, refreshKey, language]);

  // Close column chooser on outside click
  useEffect(() => {
    if (!chooserOpen) return;
    const h = (e: MouseEvent) => { if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setChooserOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [chooserOpen]);

  const visibleSet = visible[reportId];
  const shownColumns = useMemo(
    () => (data ? data.columns.filter(c => (visibleSet ? visibleSet.has(c.key) : c.default !== false)) : []),
    [data, visibleSet],
  );
  const extraTables = useMemo(() => (data?.extra || []).filter(x => x.rows.length), [data]);

  const toggleCol = (key: string) => {
    if (!data) return;
    setVisible(prev => {
      const s = new Set(prev[reportId] || defaultCols(data.columns));
      if (s.has(key)) { if (s.size > 1) s.delete(key); } else s.add(key);
      return { ...prev, [reportId]: s };
    });
  };

  const fmt = useMemo<Formatters>(() => ({
    bn, formatCurrency, formatDate, formatMonth, toBanglaDigits, tv,
    memberName: (name: string) => bnName(name, nameBnMap.get(name)),
  }), [bn, formatCurrency, formatDate, formatMonth, toBanglaDigits, tv, bnName, nameBnMap]);
  const title = rTitle(def);
  const totalLabel = t('reports.total', 'Total');
  const fileBase = data ? `BondhuFund_${def.file}_${data.fileTag}`.replace(/[\\/:*?"<>|\s]+/g, '_') : '';

  // ---- Export (CSV keeps English headers + raw values) -------------------------
  const csvSection = (cols: ColumnDef[], rows: Record<string, any>[]) => {
    const body = rows.map(r => cols.map(c => r[c.key] ?? ''));
    if (cols.some(c => c.total) && rows.length) {
      const tot = totalsFor(cols, rows);
      body.push(cols.map((c, i) => (c.total ? tot[c.key] : i === 0 ? 'TOTAL' : '')));
    }
    return toCsv(cols.map(c => c.label), body);
  };

  const exportCsv = async () => {
    if (!data || !data.rows.length) return;
    setExporting('csv');
    try {
      const meta = toCsv([], [
        [settings?.organization_name || 'Bondhu Fund'],
        [def.title],
        ['Period', data.fileTag],
        ['Generated', generatedAt],
        ...data.summary.map(s => [s.label, s.value]),
      ]).replace(/^\r\n/, '');
      const parts = [meta, csvSection(shownColumns, data.rows)];
      for (const x of data.extra || []) if (x.rows.length) parts.push(toCsv([x.title], []).trim() + '\r\n' + csvSection(x.columns, x.rows));
      const res = await saveTextFile(`${fileBase}.csv`, parts.join('\r\n\r\n'), [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
      if (!res.canceled) showToast(t('reports.csv_saved', 'CSV saved') + (res.filePath ? `: ${res.filePath}` : ''), 'success');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (!data) return;
    setExporting('pdf');
    setChooserOpen(false);
    try {
      // Wide tables print in landscape so columns aren't squeezed.
      const res = await savePdf(`${fileBase}.pdf`, shownColumns.length > 6);
      if (!res.canceled) showToast(t('reports.pdf_saved', 'PDF saved') + (res.filePath ? `: ${res.filePath}` : ''), 'success');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  // ---- Filter controls --------------------------------------------------------
  const sel = (key: string, options: SelectOption[], allLabel: string) => (
    <SearchableSelect key={key} size="sm" clearable className="min-w-[180px]" options={options}
      value={filters[key] || ''} onChange={v => setFilter(key, v ? String(v) : '')}
      placeholder={allLabel} searchPlaceholder={t('common.search_options', 'Search…')} />
  );
  const allStatus = t('reports.all_status', 'All statuses');
  const perReportFilters = (): React.ReactNode => {
    switch (reportId) {
      case 'cashbook': return sel('ledgerType', ledgerOptions, t('reports.all_types', 'All transactions'));
      case 'collections': return sel('status', statusOptions.collections, allStatus);
      case 'expenses':
        return (
          <>
            {sel('category', categoryOptions, t('reports.all_categories', 'All categories'))}
            {sel('status', statusOptions.expenses, allStatus)}
          </>
        );
      case 'investments': return sel('status', statusOptions.investments, allStatus);
      case 'audit':
        return (
          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="form-input !py-2 !pl-8 w-full" placeholder={t('reports.search_audit', 'Search user, action, details…')}
              aria-label={t('reports.search_audit', 'Search user, action, details…')}
              value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>
        );
      default:
        return null;
    }
  };
  const filterControls = perReportFilters();

  const changeReport = (id: ReportId) => {
    if (id === reportId) return;
    setReportId(id);
    setFilters({});
    setSearchText('');
    setData(null);
    setChooserOpen(false);
  };

  const toneCls = (tone?: string) =>
    tone === 'good' ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
        : tone === 'brand' ? 'text-[#0f4a3c] dark:text-emerald-300'
          : 'text-slate-900 dark:text-white';

  const hasRows = !!data && (data.rows.length > 0 || extraTables.length > 0);

  return (
    <div className="report-page p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet size={24} className="text-[#0f4a3c] dark:text-emerald-400" />
            <span>{t('nav.reports', 'Reports & Export')}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('reports.subtitle', 'Preview any report, choose columns, then export to Excel (CSV) or PDF.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCsv} disabled={!data || !data.rows.length || !!exporting || loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#142026] border border-slate-300 dark:border-[#283d47] text-slate-800 dark:text-slate-100 hover:border-[#0f4a3c] rounded-xl text-xs font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {exporting === 'csv' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} className="text-emerald-600" />}
            <span>{t('reports.export_csv', 'Export CSV')}</span>
          </button>
          <button onClick={exportPdf} disabled={!data || !!exporting || loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
            {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            <span>{t('reports.save_pdf', 'Save PDF')}</span>
          </button>
        </div>
      </div>

      {/* Report picker */}
      <div className="no-print grid grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORTS.map(r => {
          const Icon = r.icon;
          const active = r.id === reportId;
          return (
            <button key={r.id} onClick={() => changeReport(r.id)}
              className={`text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${active
                ? 'bg-[#0f4a3c] border-[#0f4a3c] text-white shadow-md dark:bg-emerald-800 dark:border-emerald-700'
                : 'card-base hover:border-[#0f4a3c]/50 dark:hover:border-emerald-700'}`}>
              <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center border ${active
                ? 'bg-white/15 border-white/20 text-white'
                : 'bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'}`}>
                <Icon size={17} />
              </div>
              <div className="min-w-0">
                <div className={`text-xs font-bold ${active ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{rTitle(r)}</div>
                <div className={`text-[11px] leading-snug mt-0.5 ${active ? 'text-emerald-100' : 'text-slate-500 dark:text-slate-400'}`}>{t(`reports.r_${r.id}_desc`, r.desc)}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="no-print card-base p-4 flex flex-wrap items-end gap-3">
        {def.scope === 'range' && (
          <>
            <div className="min-w-0">
              <label className="form-label">{t('reports.period', 'Period')}</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(p => (
                  <button key={p.id} onClick={() => applyPreset(p.id)}
                    className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border whitespace-nowrap ${preset === p.id
                      ? 'bg-[#0f4a3c] text-white border-[#0f4a3c] dark:bg-emerald-700 dark:border-emerald-700'
                      : 'bg-white dark:bg-[#101b21] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#283d47] hover:border-[#0f4a3c]'}`}>
                    {t(`reports.preset_${p.id}`, p.en)}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-[160px]">
              <label className="form-label">{t('reports.from', 'From')}</label>
              <DatePicker size="sm" clearable={false} value={start} max={end || undefined}
                onChange={v => { setPreset('custom'); setStart(v); }} />
            </div>
            <div className="min-w-[160px]">
              <label className="form-label">{t('reports.to', 'To')}</label>
              <DatePicker size="sm" clearable={false} value={end} min={start || undefined}
                onChange={v => { setPreset('custom'); setEnd(v); }} />
            </div>
          </>
        )}
        {def.scope === 'month' && (
          <div>
            <label className="form-label">{reportId === 'fiscal' ? t('reports.fy_containing', 'Fiscal year containing') : t('reports.month', 'Month')}</label>
            <MonthPicker value={month} onChange={setMonth} align="left" />
          </div>
        )}
        {def.scope === 'member' && (
          <div className="w-80 max-w-full">
            <label className="form-label">{t('reports.member', 'Member')}</label>
            <SearchableSelect size="sm" options={memberOptions} value={memberId ?? ''} onChange={v => setMemberId(v ? Number(v) : null)}
              isLoading={lookupsLoading}
              placeholder={t('reports.select_member', 'Select a member…')}
              searchPlaceholder={t('reports.search_member', 'Search name, ID or phone…')} />
          </div>
        )}
        {filterControls && (
          <div className="min-w-0">
            <label className="form-label">{t('reports.filter', 'Filter')}</label>
            <div className="flex flex-wrap gap-3">{filterControls}</div>
          </div>
        )}

        <div className="ml-auto flex items-end gap-2">
          {data && (
            <div className="relative" ref={chooserRef}>
              <button onClick={() => setChooserOpen(o => !o)} aria-expanded={chooserOpen}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-[#283d47] bg-white dark:bg-[#101b21] text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-[#0f4a3c] whitespace-nowrap">
                <Columns3 size={14} />
                <span>{t('reports.columns', 'Columns')} ({num(shownColumns.length)}/{num(data.columns.length)})</span>
                <ChevronDown size={13} />
              </button>
              {chooserOpen && (
                <div className="absolute right-0 mt-2 w-64 z-30 card-base p-2 shadow-xl max-h-80 overflow-y-auto">
                  {data.columns.map(c => {
                    const on = shownColumns.some(s => s.key === c.key);
                    return (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-[#1a2b34] cursor-pointer text-xs text-slate-700 dark:text-slate-200">
                        <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-[#0f4a3c] border-[#0f4a3c] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                          {on && <Check size={11} />}
                        </span>
                        <input type="checkbox" className="hidden" checked={on} onChange={() => toggleCol(c.key)} />
                        <span>{bn ? c.bn : c.label}</span>
                      </label>
                    );
                  })}
                  <button onClick={() => setVisible(prev => ({ ...prev, [reportId]: defaultCols(data.columns) }))}
                    className="w-full mt-1 px-2 py-1.5 text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline text-left">
                    {t('reports.reset_columns', 'Reset to default')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview (this is what prints to PDF) */}
      <div id="report-print-area" className="card-base p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-[#22353f] pb-4">
          <div className="flex items-start gap-3 min-w-0">
            {settings?.org_logo && (
              <img src={settings.org_logo} alt="" className="w-10 h-10 rounded-lg object-contain shrink-0 border border-slate-200 dark:border-[#22353f] bg-white" />
            )}
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#0f4a3c] dark:text-emerald-400">{orgName}</div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('reports.period', 'Period')}: <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {data?.periodLabel || (def.scope === 'member' ? '—' : def.scope === 'month' ? formatMonth(monthKey) : `${formatDate(start)} – ${formatDate(end)}`)}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
            <div>{t('reports.generated', 'Generated')}: <span className="font-semibold">{formatDate(generatedAt)}</span></div>
            {data && <div>{t('reports.records', 'Records')}: <span className="font-semibold">{num(data.rows.length)}</span></div>}
            {loading && <div className="no-print flex items-center justify-end gap-1 mt-1 text-[#0f4a3c] dark:text-emerald-400"><RefreshCw size={11} className="animate-spin" /> {t('reports.updating', 'Updating…')}</div>}
          </div>
        </div>

        {loading && !data ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
            <Loader2 size={24} className="animate-spin text-[#0f4a3c] dark:text-emerald-400" />
            {t('reports.loading', 'Preparing report…')}
          </div>
        ) : def.scope === 'member' && !memberId ? (
          <EmptyState icon={Users} text={t('reports.pick_member', 'Select a member above to view their statement.')} />
        ) : error ? (
          <EmptyState icon={AlertTriangle} text={error} tone="bad" />
        ) : data ? (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 report-summary">
              {data.summary.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-200 dark:border-[#22353f] bg-slate-50/60 dark:bg-[#101b21] px-3.5 py-2.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{bn ? s.bn : s.label}</div>
                  <div className={`text-sm font-black mt-0.5 tabular-nums break-words ${toneCls(s.tone)}`}>
                    {s.kind ? formatCell(s.value, s.kind, fmt) : String(s.value)}
                  </div>
                </div>
              ))}
            </div>

            {hasRows ? (
              <>
                {data.rows.length > 0 ? (
                  <ReportTableView columns={shownColumns} rows={data.rows} f={fmt} totalLabel={totalLabel} />
                ) : (
                  <EmptyState icon={Inbox} text={t('reports.no_rows', 'No records for this period.')} />
                )}
                {extraTables.map(x => (
                  <div key={x.title} className="space-y-2 report-section">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{bn ? x.bn : x.title}</h3>
                    <ReportTableView columns={x.columns} rows={x.rows} f={fmt} totalLabel={totalLabel} />
                  </div>
                ))}
              </>
            ) : (
              <EmptyState icon={Inbox}
                text={t('reports.no_data', 'No records found for the selected filters. Try a wider period, or add data from the Entry Center.')} />
            )}

            <div className="print-only text-[10px] text-slate-500 pt-2 border-t border-slate-200">
              {orgName} · {title} · {formatDate(generatedAt)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.ElementType; text: string; tone?: 'bad' }> = ({ icon: Icon, text, tone }) => (
  <div className="py-14 flex flex-col items-center text-center gap-2">
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${tone === 'bad'
      ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/40'
      : 'bg-emerald-50 text-[#0f4a3c] dark:bg-emerald-950/40 dark:text-emerald-400'}`}>
      <Icon size={22} />
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">{text}</p>
  </div>
);

export default ReportsView;
