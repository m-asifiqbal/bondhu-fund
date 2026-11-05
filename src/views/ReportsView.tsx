import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileText, Calendar, Users, TrendingUp, Receipt, Clock, Layers, Columns3,
  AlertTriangle, ShieldCheck, Loader2, Inbox, RefreshCw, ChevronDown, Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getAppSettings, getAllMembersLite, getMasterData, saveTextFile, savePdf, toCsv,
} from '../services/db';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { BUILDERS, ReportData, ReportId, ColumnDef } from '../components/reports/reportBuilders';
import { ReportTableView, formatCell, totalsFor, Formatters } from '../components/reports/ReportTableView';
import { addMonths, currentMonthKey, fiscalYearRange, toMonthKey, todayISO, monthKeyToName } from '../utils/date';

type Scope = 'range' | 'month' | 'member' | 'none';
type Preset = 'today' | 'this_month' | 'last_month' | 'this_fy' | 'last_12' | 'custom';

interface ReportDef {
  id: ReportId; title: string; bn: string; desc: string; descBn: string; file: string;
  icon: React.ElementType; scope: Scope;
}

const REPORTS: ReportDef[] = [
  { id: 'cashbook', title: 'Cash Book', bn: 'ক্যাশ বই', desc: 'Day / date-range ledger with running balance', descBn: 'তারিখভিত্তিক লেজার ও চলমান ব্যালেন্স', file: 'CashBook', icon: Clock, scope: 'range' },
  { id: 'collections', title: 'Monthly Collection Sheet', bn: 'মাসিক আদায় শিট', desc: 'All members due: paid, pending, overdue', descBn: 'সকল সদস্যের মাসিক চাঁদার অবস্থা', file: 'CollectionSheet', icon: Calendar, scope: 'month' },
  { id: 'fiscal', title: 'Fiscal-Year Statement', bn: 'অর্থবছর বিবরণী', desc: 'Month totals and member-wise yearly contribution', descBn: 'মাসভিত্তিক মোট ও সদস্যভিত্তিক বার্ষিক চাঁদা', file: 'FiscalYear', icon: Layers, scope: 'month' },
  { id: 'member', title: 'Member Statement', bn: 'সদস্য বিবরণী', desc: 'Month-by-month history incl. unpaid months', descBn: 'অপরিশোধিত মাসসহ মাসভিত্তিক ইতিহাস', file: 'MemberStatement', icon: Users, scope: 'member' },
  { id: 'defaulters', title: 'Defaulters / Arrears', bn: 'বকেয়াদার তালিকা', desc: 'Members with unpaid months and amounts', descBn: 'অপরিশোধিত মাস ও বকেয়ার পরিমাণ', file: 'Arrears', icon: AlertTriangle, scope: 'month' },
  { id: 'expenses', title: 'Expenses Report', bn: 'খরচের রিপোর্ট', desc: 'Expenses with category subtotals', descBn: 'ক্যাটাগরিভিত্তিক মোটসহ খরচ', file: 'Expenses', icon: Receipt, scope: 'range' },
  { id: 'investments', title: 'Investment Portfolio', bn: 'বিনিয়োগ পোর্টফোলিও', desc: 'Active and sold assets with gains', descBn: 'সক্রিয় ও বিক্রিত সম্পদ এবং লাভ', file: 'Investments', icon: TrendingUp, scope: 'none' },
  { id: 'audit', title: 'Audit Trail', bn: 'অডিট ট্রেইল', desc: 'Who changed what, and when', descBn: 'কে, কখন, কী পরিবর্তন করেছেন', file: 'AuditTrail', icon: ShieldCheck, scope: 'range' },
];

const PRESETS: Array<{ id: Preset; en: string; bn: string }> = [
  { id: 'today', en: 'Today', bn: 'আজ' },
  { id: 'this_month', en: 'This month', bn: 'চলতি মাস' },
  { id: 'last_month', en: 'Last month', bn: 'গত মাস' },
  { id: 'this_fy', en: 'This fiscal year', bn: 'চলতি অর্থবছর' },
  { id: 'last_12', en: 'Last 12 months', bn: 'গত ১২ মাস' },
  { id: 'custom', en: 'Custom', bn: 'কাস্টম' },
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
  const { t, language, formatCurrency, formatDate, formatMonth, toBanglaDigits, selectedMonth, showToast, refreshKey } = useApp();
  const bn = language === 'bn';
  /** Translation key if available, else inline Bangla/English. */
  const L = useCallback((key: string, en: string, bnText: string) => {
    const v = t(key, '');
    return v && v !== key ? v : bn ? bnText : en;
  }, [t, bn]);

  const [reportId, setReportId] = useState<ReportId>('cashbook');
  const def = REPORTS.find(r => r.id === reportId)!;

  // Settings & lookups
  const [orgName, setOrgName] = useState('');
  const [fyStart, setFyStart] = useState(7);
  const [members, setMembers] = useState<SelectOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  // Filters
  const [preset, setPreset] = useState<Preset>('this_month');
  const initial = presetRange('this_month', 7)!;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [month, setMonth] = useState(() => selectedMonth || monthKeyToName(currentMonthKey()));
  const [memberId, setMemberId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const setFilter = (k: string, v: string) => setFilters(prev => ({ ...prev, [k]: v }));

  // Data
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, Set<string>>>({});
  const [chooserOpen, setChooserOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [generatedAt, setGeneratedAt] = useState(todayISO());
  const chooserRef = useRef<HTMLDivElement>(null);

  // Lookups
  useEffect(() => {
    let alive = true;
    (async () => {
      setLookupsLoading(true);
      try {
        const [s, ms, cats] = await Promise.all([getAppSettings(), getAllMembersLite(), getMasterData('expense_category')]);
        if (!alive) return;
        setOrgName(s.organization_name || '');
        setFyStart(Number(s.fiscal_year_start_month) || 7);
        setMembers(ms.map(m => ({
          value: m.id, label: m.name, subLabel: `${m.member_code}${m.phone ? ' · ' + m.phone : ''}`,
          badge: m.status, badgeColor: m.status === 'Active' ? 'emerald' : 'slate',
        })));
        setCategories(cats.map(c => c.name));
      } catch (e: any) {
        showToast(e.message, 'error');
      } finally {
        if (alive) setLookupsLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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
    if (def.scope === 'range' && !rangeValid) { setData(null); setError(L('reports.invalid_range', 'Start date must be on or before end date.', 'শুরুর তারিখ শেষের তারিখের আগে হতে হবে।')); return; }
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

  const toggleCol = (key: string) => {
    if (!data) return;
    setVisible(prev => {
      const s = new Set(prev[reportId] || defaultCols(data.columns));
      if (s.has(key)) { if (s.size > 1) s.delete(key); } else s.add(key);
      return { ...prev, [reportId]: s };
    });
  };

  const fmt: Formatters = { bn, formatCurrency, formatDate, formatMonth, toBanglaDigits };
  const title = bn ? def.bn : def.title;
  const fileBase = data ? `BondhuFund_${def.file}_${data.fileTag}`.replace(/[\\/:*?"<>|\s]+/g, '_') : '';

  // ---- Export ---------------------------------------------------------------
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
        [orgName || 'Bondhu Fund'],
        [def.title],
        ['Period', data.fileTag],
        ['Generated', generatedAt],
        ...data.summary.map(s => [s.label, s.value]),
      ]).replace(/^\r\n/, '');
      const parts = [meta, csvSection(shownColumns, data.rows)];
      for (const x of data.extra || []) if (x.rows.length) parts.push(toCsv([x.title], []).trim() + '\r\n' + csvSection(x.columns, x.rows));
      const res = await saveTextFile(`${fileBase}.csv`, parts.join('\r\n\r\n'), [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
      if (!res.canceled) showToast(L('reports.csv_saved', 'CSV saved', 'CSV সংরক্ষিত হয়েছে') + (res.filePath ? `: ${res.filePath}` : ''), 'success');
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
      if (!res.canceled) showToast(L('reports.pdf_saved', 'PDF saved', 'PDF সংরক্ষিত হয়েছে') + (res.filePath ? `: ${res.filePath}` : ''), 'success');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setExporting(null);
    }
  };

  // ---- Filter controls --------------------------------------------------------
  const selectCls = 'form-select !w-auto !py-2';
  const perReportFilters = () => {
    switch (reportId) {
      case 'cashbook':
        return (
          <select className={selectCls} value={filters.ledgerType || 'All'} onChange={e => setFilter('ledgerType', e.target.value)}>
            <option value="All">{L('reports.all_types', 'All transactions', 'সকল লেনদেন')}</option>
            <option value="collection">{L('reports.collections_only', 'Collections only', 'শুধু সংগ্রহ')}</option>
            <option value="expense">{L('reports.expenses_only', 'Expenses only', 'শুধু খরচ')}</option>
            <option value="investment">{L('reports.investments_only', 'Investments only', 'শুধু বিনিয়োগ')}</option>
          </select>
        );
      case 'collections':
        return (
          <select className={selectCls} value={filters.status || 'All'} onChange={e => setFilter('status', e.target.value)}>
            <option value="All">{L('reports.all_status', 'All statuses', 'সকল অবস্থা')}</option>
            <option value="Paid">{bn ? 'পরিশোধিত' : 'Paid'}</option>
            <option value="Pending">{bn ? 'বাকি' : 'Pending'}</option>
            <option value="Overdue">{bn ? 'মেয়াদোত্তীর্ণ' : 'Overdue'}</option>
          </select>
        );
      case 'expenses':
        return (
          <>
            <select className={selectCls} value={filters.category || 'All'} onChange={e => setFilter('category', e.target.value)}>
              <option value="All">{L('reports.all_categories', 'All categories', 'সকল ক্যাটাগরি')}</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={selectCls} value={filters.status || 'All'} onChange={e => setFilter('status', e.target.value)}>
              <option value="All">{L('reports.all_status', 'All statuses', 'সকল অবস্থা')}</option>
              <option value="Verified">{bn ? 'যাচাইকৃত' : 'Verified'}</option>
              <option value="Needs receipt">{bn ? 'রসিদ প্রয়োজন' : 'Needs receipt'}</option>
            </select>
          </>
        );
      case 'investments':
        return (
          <select className={selectCls} value={filters.status || 'All'} onChange={e => setFilter('status', e.target.value)}>
            <option value="All">{L('reports.all_status', 'All statuses', 'সকল অবস্থা')}</option>
            <option value="Growing">{bn ? 'বর্ধনশীল' : 'Growing'}</option>
            <option value="Review">{bn ? 'পর্যালোচনা' : 'Review'}</option>
            <option value="Sold">{bn ? 'বিক্রিত' : 'Sold'}</option>
          </select>
        );
      case 'audit':
        return (
          <input className="form-input !w-56 !py-2" placeholder={L('reports.search_audit', 'Search user, action, details…', 'ব্যবহারকারী, কার্যক্রম খুঁজুন…')}
            value={filters.search || ''} onChange={e => setFilter('search', e.target.value)} />
        );
      default:
        return null;
    }
  };

  const changeReport = (id: ReportId) => {
    if (id === reportId) return;
    setReportId(id);
    setFilters({});
    setData(null);
    setChooserOpen(false);
  };

  const toneCls = (tone?: string) =>
    tone === 'good' ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
        : tone === 'brand' ? 'text-[#0f4a3c] dark:text-emerald-300'
          : 'text-slate-900 dark:text-white';

  const hasRows = !!data && (data.rows.length > 0 || (data.extra || []).some(x => x.rows.length > 0));

  return (
    <div className="report-page p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet size={24} className="text-[#0f4a3c] dark:text-emerald-400" />
            <span>{t('nav.reports', 'Reports & Export')}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {L('reports.subtitle', 'Preview any report, choose columns, then export to Excel (CSV) or PDF.', 'যেকোনো রিপোর্ট দেখুন, কলাম বাছাই করুন, তারপর এক্সেল (CSV) বা PDF-এ রপ্তানি করুন।')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={!data || !data.rows.length || !!exporting || loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#142026] border border-slate-300 dark:border-[#283d47] text-slate-800 dark:text-slate-100 hover:border-[#0f4a3c] rounded-xl text-xs font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {exporting === 'csv' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} className="text-emerald-600" />}
            <span>{L('reports.export_csv', 'Export CSV', 'CSV রপ্তানি')}</span>
          </button>
          <button onClick={exportPdf} disabled={!data || !!exporting || loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
            {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            <span>{L('reports.save_pdf', 'Save PDF', 'PDF সংরক্ষণ')}</span>
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
                <div className={`text-xs font-bold ${active ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{bn ? r.bn : r.title}</div>
                <div className={`text-[11px] leading-snug mt-0.5 ${active ? 'text-emerald-100' : 'text-slate-500 dark:text-slate-400'}`}>{bn ? r.descBn : r.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="no-print card-base p-4 flex flex-wrap items-end gap-3">
        {def.scope === 'range' && (
          <>
            <div>
              <label className="form-label">{L('reports.period', 'Period', 'সময়কাল')}</label>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map(p => (
                  <button key={p.id} onClick={() => applyPreset(p.id)}
                    className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border ${preset === p.id
                      ? 'bg-[#0f4a3c] text-white border-[#0f4a3c] dark:bg-emerald-700 dark:border-emerald-700'
                      : 'bg-white dark:bg-[#101b21] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#283d47] hover:border-[#0f4a3c]'}`}>
                    {bn ? p.bn : p.en}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">{L('reports.from', 'From', 'হতে')}</label>
              <input type="date" className="form-input !w-40 !py-2" value={start} max={end || undefined}
                onChange={e => { setPreset('custom'); setStart(e.target.value); }} />
            </div>
            <div>
              <label className="form-label">{L('reports.to', 'To', 'পর্যন্ত')}</label>
              <input type="date" className="form-input !w-40 !py-2" value={end} min={start || undefined}
                onChange={e => { setPreset('custom'); setEnd(e.target.value); }} />
            </div>
          </>
        )}
        {def.scope === 'month' && (
          <div>
            <label className="form-label">{reportId === 'fiscal' ? L('reports.fy_containing', 'Fiscal year containing', 'যে মাসের অর্থবছর') : L('reports.month', 'Month', 'মাস')}</label>
            <MonthPicker value={month} onChange={setMonth} align="left" />
          </div>
        )}
        {def.scope === 'member' && (
          <div className="w-80 max-w-full">
            <label className="form-label">{L('reports.member', 'Member', 'সদস্য')}</label>
            <SearchableSelect options={members} value={memberId ?? ''} onChange={v => setMemberId(v ? Number(v) : null)}
              isLoading={lookupsLoading}
              placeholder={L('reports.select_member', 'Select a member…', 'সদস্য নির্বাচন করুন…')}
              searchPlaceholder={L('reports.search_member', 'Search name, ID or phone…', 'নাম, আইডি বা ফোন খুঁজুন…')} />
          </div>
        )}
        {perReportFilters() && (
          <div>
            <label className="form-label">{L('reports.filter', 'Filter', 'ফিল্টার')}</label>
            <div className="flex flex-wrap gap-2">{perReportFilters()}</div>
          </div>
        )}

        <div className="ml-auto flex items-end gap-2">
          {data && (
            <div className="relative" ref={chooserRef}>
              <button onClick={() => setChooserOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-[#283d47] bg-white dark:bg-[#101b21] text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-[#0f4a3c]">
                <Columns3 size={14} />
                <span>{L('reports.columns', 'Columns', 'কলাম')} ({bn ? toBanglaDigits(shownColumns.length) : shownColumns.length}/{bn ? toBanglaDigits(data.columns.length) : data.columns.length})</span>
                <ChevronDown size={13} />
              </button>
              {chooserOpen && (
                <div className="absolute right-0 mt-2 w-60 z-30 card-base p-2 shadow-xl max-h-80 overflow-y-auto">
                  {data.columns.map(c => {
                    const on = shownColumns.some(s => s.key === c.key);
                    return (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-[#1a2b34] cursor-pointer text-xs text-slate-700 dark:text-slate-200">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-[#0f4a3c] border-[#0f4a3c] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                          {on && <Check size={11} />}
                        </span>
                        <input type="checkbox" className="hidden" checked={on} onChange={() => toggleCol(c.key)} />
                        <span>{bn ? c.bn : c.label}</span>
                      </label>
                    );
                  })}
                  <button onClick={() => setVisible(prev => ({ ...prev, [reportId]: defaultCols(data.columns) }))}
                    className="w-full mt-1 px-2 py-1.5 text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400 hover:underline text-left">
                    {L('reports.reset_columns', 'Reset to default', 'ডিফল্টে ফেরত')}
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
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#0f4a3c] dark:text-emerald-400">{orgName || 'Bondhu Fund'}</div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {L('reports.period', 'Period', 'সময়কাল')}: <span className="font-semibold text-slate-700 dark:text-slate-200">
                {data?.periodLabel || (def.scope === 'member' ? '—' : def.scope === 'month' ? formatMonth(monthKey) : `${formatDate(start)} – ${formatDate(end)}`)}
              </span>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
            <div>{L('reports.generated', 'Generated', 'প্রস্তুতের তারিখ')}: <span className="font-semibold">{formatDate(generatedAt)}</span></div>
            {data && <div>{L('reports.records', 'Records', 'রেকর্ড')}: <span className="font-semibold">{bn ? toBanglaDigits(data.rows.length) : data.rows.length}</span></div>}
            {loading && <div className="no-print flex items-center justify-end gap-1 mt-1 text-[#0f4a3c] dark:text-emerald-400"><RefreshCw size={11} className="animate-spin" /> {L('reports.updating', 'Updating…', 'হালনাগাদ হচ্ছে…')}</div>}
          </div>
        </div>

        {loading && !data ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
            <Loader2 size={24} className="animate-spin text-[#0f4a3c] dark:text-emerald-400" />
            {L('reports.loading', 'Preparing report…', 'রিপোর্ট প্রস্তুত হচ্ছে…')}
          </div>
        ) : def.scope === 'member' && !memberId ? (
          <EmptyState icon={Users} text={L('reports.pick_member', 'Select a member above to view their statement.', 'বিবরণী দেখতে উপরে একজন সদস্য নির্বাচন করুন।')} />
        ) : error ? (
          <EmptyState icon={AlertTriangle} text={error} tone="bad" />
        ) : data ? (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 report-summary">
              {data.summary.map((s, i) => (
                <div key={i} className="rounded-xl border border-slate-200 dark:border-[#22353f] bg-slate-50/60 dark:bg-[#101b21] px-3.5 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{bn ? s.bn : s.label}</div>
                  <div className={`text-sm font-black mt-0.5 tabular-nums ${toneCls(s.tone)}`}>
                    {s.kind ? formatCell(s.value, s.kind, fmt) : String(s.value)}
                  </div>
                </div>
              ))}
            </div>

            {hasRows ? (
              <>
                {data.rows.length > 0 ? (
                  <ReportTableView columns={shownColumns} rows={data.rows} f={fmt} totalLabel={L('reports.total', 'Total', 'মোট')} />
                ) : (
                  <EmptyState icon={Inbox} text={L('reports.no_rows', 'No records for this period.', 'এই সময়ের কোনো রেকর্ড নেই।')} />
                )}
                {(data.extra || []).filter(x => x.rows.length).map(x => (
                  <div key={x.title} className="space-y-2 report-section">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{bn ? x.bn : x.title}</h3>
                    <ReportTableView columns={x.columns} rows={x.rows} f={fmt} totalLabel={L('reports.total', 'Total', 'মোট')} />
                  </div>
                ))}
              </>
            ) : (
              <EmptyState icon={Inbox}
                text={L('reports.no_data', 'No records found for the selected filters. Try a wider period, or add data from the Entry Center.', 'নির্বাচিত ফিল্টারে কোনো রেকর্ড পাওয়া যায়নি। সময়কাল বাড়ান অথবা এন্ট্রি সেন্টার থেকে তথ্য যোগ করুন।')} />
            )}

            <div className="print-only text-[10px] text-slate-500 pt-2 border-t border-slate-200">
              {orgName || 'Bondhu Fund'} · {title} · {formatDate(generatedAt)}
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
