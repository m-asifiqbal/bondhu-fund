import React from 'react';
import type { CellKind, ColumnDef } from './reportBuilders';

const STATUS_BN: Record<string, string> = {
  Paid: 'পরিশোধিত', Pending: 'বাকি', Overdue: 'মেয়াদোত্তীর্ণ', Verified: 'যাচাইকৃত', 'Needs receipt': 'রসিদ প্রয়োজন',
  Growing: 'বর্ধনশীল', Review: 'পর্যালোচনা', Sold: 'বিক্রিত', Active: 'সক্রিয়', Inactive: 'নিষ্ক্রিয়',
  collection: 'সংগ্রহ', expense: 'খরচ', investment: 'বিনিয়োগ', sale: 'বিক্রয়',
};
const STATUS_EN: Record<string, string> = { collection: 'Collection', expense: 'Expense', investment: 'Investment', sale: 'Sale' };

const STATUS_TONE: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  Verified: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  collection: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  sale: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
  Growing: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
  Active: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  Review: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  'Needs receipt': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  investment: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
  Overdue: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  expense: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
};

export interface Formatters {
  bn: boolean;
  formatCurrency: (n: number) => string;
  formatDate: (iso?: string | null) => string;
  formatMonth: (key?: string | null) => string;
  toBanglaDigits: (v: string | number) => string;
}

export function formatCell(v: any, kind: CellKind | undefined, f: Formatters): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300 dark:text-slate-600">—</span>;
  switch (kind) {
    case 'money': return f.formatCurrency(Number(v) || 0);
    case 'date': return f.formatDate(String(v));
    case 'month': return f.formatMonth(String(v));
    case 'datetime': {
      const s = String(v);
      const time = s.slice(11, 16);
      return `${f.formatDate(s.slice(0, 10))}${time ? ' ' + (f.bn ? f.toBanglaDigits(time) : time) : ''}`;
    }
    case 'number': return f.bn ? f.toBanglaDigits(Number(v).toLocaleString('en-IN')) : Number(v).toLocaleString('en-IN');
    case 'percent': return `${f.bn ? f.toBanglaDigits(String(v)) : v}%`;
    case 'status': {
      const s = String(v);
      return (
        <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold whitespace-nowrap ${STATUS_TONE[s] || 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
          {f.bn ? STATUS_BN[s] || s : STATUS_EN[s] || s}
        </span>
      );
    }
    default: return String(v);
  }
}

const isNumeric = (k?: CellKind) => k === 'money' || k === 'number' || k === 'percent';

export function totalsFor(columns: ColumnDef[], rows: Record<string, any>[]) {
  const out: Record<string, number> = {};
  for (const c of columns) if (c.total) out[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
  return out;
}

interface Props {
  columns: ColumnDef[];
  rows: Record<string, any>[];
  f: Formatters;
  totalLabel: string;
}

export const ReportTableView: React.FC<Props> = ({ columns, rows, f, totalLabel }) => {
  const totals = totalsFor(columns, rows);
  const hasTotals = columns.some(c => c.total) && rows.length > 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-[#22353f] report-table-wrap">
      <table className="w-full text-xs report-table">
        <thead>
          <tr className="bg-slate-50 dark:bg-[#101b21] text-slate-600 dark:text-slate-300">
            <th className="px-3 py-2.5 text-left font-bold w-10">#</th>
            {columns.map(c => (
              <th key={c.key} className={`px-3 py-2.5 font-bold whitespace-nowrap ${isNumeric(c.kind) ? 'text-right' : 'text-left'}`}>
                {f.bn ? c.bn : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-[#1d2e36]">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50/70 dark:hover:bg-[#1a2b34] text-slate-800 dark:text-slate-200">
              <td className="px-3 py-2 text-slate-400">{f.bn ? f.toBanglaDigits(i + 1) : i + 1}</td>
              {columns.map(c => (
                <td key={c.key}
                  className={`px-3 py-2 ${isNumeric(c.kind) ? 'text-right tabular-nums whitespace-nowrap' : c.kind === 'date' || c.kind === 'month' || c.kind === 'datetime' ? 'whitespace-nowrap' : ''} ${c.kind === 'money' && Number(r[c.key]) < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                  {formatCell(r[c.key], c.kind, f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="bg-emerald-50/70 dark:bg-emerald-950/30 font-black text-slate-900 dark:text-white border-t-2 border-[#0f4a3c]/30">
              <td className="px-3 py-2.5" />
              {columns.map((c, i) => (
                <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${isNumeric(c.kind) ? 'text-right tabular-nums' : ''}`}>
                  {c.total ? formatCell(totals[c.key], c.kind, f) : i === 0 ? totalLabel : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
