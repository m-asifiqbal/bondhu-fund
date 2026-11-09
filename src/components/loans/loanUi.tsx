import React from 'react';
import { useApp } from '../../context/AppContext';
import type { LoanMethod, LoanStatus } from '../../types';

/** Digits in the chosen language (Bangla digits in bn). */
export const useNum = () => {
  const { language, toBanglaDigits } = useApp();
  return (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
};

/** Money for loan screens: whole taka stay clean (TK 10,662), anything with paisa always shows two decimals (TK 4,234.80). */
export const useMoney = () => {
  const { language, toBanglaDigits } = useApp();
  return (v: number) => {
    const x = Math.round((Number(v) || 0) * 100) / 100;
    const whole = Math.abs(x - Math.round(x)) < 0.005;
    const s = x.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    return language === 'bn' ? `৳ ${toBanglaDigits(s)}` : `TK ${s}`;
  };
};

/** Plain-language names for the three interest methods. */
export const useMethodText = () => {
  const { t } = useApp();
  return {
    label: (m: LoanMethod) =>
      m === 'reducing' ? t('loan.m_reducing', 'Reducing balance')
        : m === 'flat' ? t('loan.m_flat', 'Flat rate')
          : t('loan.m_free', 'Interest-free'),
    hint: (m: LoanMethod) =>
      m === 'reducing' ? t('loan.m_reducing_hint', 'Interest is charged only on what is still owed, so it falls every month. Fair and the usual bank method.')
        : m === 'flat' ? t('loan.m_flat_hint', 'Interest is calculated once on the full amount and spread evenly. Simple, but costs more than the same rate on a reducing balance.')
          : t('loan.m_free_hint', 'No interest (Qard-e-Hasan). The member repays only the amount borrowed, in equal installments.'),
  };
};

const STATUS_CLS: Record<LoanStatus, string> = {
  Running: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  Overdue: 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  Closed: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  'Written off': 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
};

export const LoanStatusBadge: React.FC<{ status: LoanStatus }> = ({ status }) => {
  const { t } = useApp();
  const label =
    status === 'Running' ? t('loan.s_running', 'Running')
      : status === 'Overdue' ? t('loan.s_overdue', 'Overdue')
        : status === 'Closed' ? t('loan.s_closed', 'Repaid')
          : t('loan.s_written_off', 'Written off');
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${STATUS_CLS[status]}`}>{label}</span>;
};

const INST_CLS: Record<string, string> = {
  Paid: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  Partial: 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  Due: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  Overdue: 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  Waived: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  'Written off': 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
};

export const InstallmentBadge: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useApp();
  const label: Record<string, string> = {
    Paid: t('loan.i_paid', 'Paid'), Partial: t('loan.i_partial', 'Part paid'), Due: t('loan.i_due', 'Upcoming'),
    Overdue: t('loan.i_overdue', 'Overdue'), Waived: t('loan.i_waived', 'Waived'), 'Written off': t('loan.s_written_off', 'Written off'),
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${INST_CLS[status] || INST_CLS.Due}`}>{label[status] || status}</span>;
};

/** Thin progress bar (percent 0–100). */
export const ProgressBar: React.FC<{ pct: number; tone?: 'green' | 'rose' | 'amber' | 'slate'; className?: string }> = ({ pct, tone = 'green', className = '' }) => {
  const bar = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'slate' ? 'bg-slate-400' : 'bg-emerald-600';
  return (
    <div className={`h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
};

/** "12% a year" / "Interest-free" — the rate line used in tables and headers. */
export const useRateText = () => {
  const { t } = useApp();
  const n = useNum();
  const m = useMethodText();
  return (method: LoanMethod, rate: number) =>
    method === 'free' ? m.label('free') : `${n(+rate.toFixed(2))}% ${t('loan.per_year', 'a year')} · ${m.label(method)}`;
};
