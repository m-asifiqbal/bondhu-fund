import React, { useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle, XCircle, ChevronDown, Loader2, Stethoscope } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { checkAccountingHealth } from '../services/db';
import type { HealthReport, HealthStatus } from '../types';

const ICON: Record<HealthStatus, React.ReactNode> = {
  pass: <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />,
  warn: <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />,
  fail: <XCircle size={15} className="text-rose-600 dark:text-rose-400" />,
};
const BANNER: Record<HealthStatus, string> = {
  pass: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-200',
  warn: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-200',
  fail: 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900/60 dark:text-rose-200',
};

/** Runs the read-only accounting health check (integrity, entries, reconciliation) and shows the result. */
export const HealthCheckCard: React.FC = () => {
  const { t, formatCurrency, toBanglaDigits, language, showToast } = useApp();
  const n = (v: number) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    try { setReport(await checkAccountingHealth()); } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const headline = report && ({
    pass: t('health.all_good', 'All checks passed — the books are healthy.'),
    warn: t('health.warnings', '{w} item(s) need review. No accounting errors found.').replace('{w}', n(report.warns)),
    fail: t('health.problems', '{f} check(s) failed. Review the details below.').replace('{f}', n(report.fails)),
  }[report.status]);

  return (
    <div className="card-base p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center"><Stethoscope size={18} /></span>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('health.title', 'Accounting health check')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl">
              {t('health.desc', 'Verifies every saved entry (payments, members, expenses, investments), the database file, and that the cash book reconciles with cash in hand. Read-only.')}
            </p>
          </div>
        </div>
        <button type="button" onClick={run} disabled={busy} className="btn-primary-modal">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}{report ? t('health.run_again', 'Run again') : t('health.run', 'Run check')}
        </button>
      </div>

      {report && (
        <div className="mt-5 space-y-4">
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${BANNER[report.status]}`}>
            {ICON[report.status]}{headline}
            <span className="ml-auto text-[11px] font-semibold opacity-80">
              {n(report.passes)} ✓ · {n(report.warns)} ⚠ · {n(report.fails)} ✕
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2.5">
            {([
              ['health.members', 'Members', n(report.totals.members)],
              ['health.payments', 'Payments', n(report.totals.payments)],
              ['health.opening', 'Opening balances', formatCurrency(report.totals.openingBalances)],
              ['health.collected', 'Collected', formatCurrency(report.totals.collected)],
              ['health.spent', 'Expenses', formatCurrency(report.totals.spent)],
              ['health.invested', 'Invested', formatCurrency(report.totals.invested)],
              ['health.fund', 'Fund balance', formatCurrency(report.totals.fundBalance)],
              ['health.cash', 'Cash in hand', formatCurrency(report.totals.cashInHand)],
            ] as const).map(([k, en, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 dark:border-[#22353f] p-3 min-w-0">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">{t(k, en)}</div>
                <div className="text-sm font-black text-slate-900 dark:text-white tabular-nums truncate">{v}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-[#1b2c34] rounded-xl border border-slate-200 dark:border-[#22353f]">
            {report.checks.map(c => (
              <li key={c.id}>
                <button type="button" disabled={!c.details.length} onClick={() => setOpen(o => (o === c.id ? null : c.id))}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs disabled:cursor-default">
                  {ICON[c.status]}
                  <span className="flex-1 font-semibold text-slate-800 dark:text-slate-100">{t(`health.c_${c.id}`, c.title)}</span>
                  {c.count > 0 && <span className="text-[11px] font-bold text-slate-500">{n(c.count)}</span>}
                  {c.details.length > 0 && <ChevronDown size={14} className={`text-slate-400 transition-transform ${open === c.id ? 'rotate-180' : ''}`} />}
                </button>
                {open === c.id && (
                  <ul className="px-11 pb-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                    {c.details.map((d, i) => <li key={i} className="font-mono">• {d}</li>)}
                    {c.count > c.details.length && <li className="text-slate-400">… {n(c.count - c.details.length)} {t('health.more', 'more')}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default HealthCheckCard;
