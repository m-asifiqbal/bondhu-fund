import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export type DownloadFormat = 'pdf' | 'xlsx';

interface Props {
  onPick: (format: DownloadFormat) => void | Promise<void>;
  /** Text next to the icon; omit for a compact icon-only button (table rows). */
  label?: string;
  title: string;
  busy?: boolean;
  className?: string;
}

/** Button that opens a small PDF / Excel chooser. The list is portalled so table scrolling never clips it. */
export const DownloadMenu: React.FC<Props> = ({ onPick, label, title, busy, className }) => {
  const { t } = useApp();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('[data-download-menu]') && !btn.current?.contains(el)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const pick = (f: DownloadFormat) => (e: React.MouseEvent) => { e.stopPropagation(); setPos(null); void onPick(f); };

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} disabled={busy} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={!!pos}
        className={className ?? (label ? 'btn btn-outline' : 'btn btn-green-outline btn-sm btn-icon')}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {label && <span>{label}</span>}
      </button>
      {pos && createPortal(
        <div data-download-menu role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-[1000] min-w-[11.5rem] rounded-2xl border border-slate-200 dark:border-[#283d47] bg-white dark:bg-[#132027] shadow-[0_12px_40px_rgba(15,23,42,0.18)] p-1.5 animate-pop">
          <button type="button" role="menuitem" onClick={pick('pdf')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-[#0f6b50] dark:hover:text-emerald-300 transition-colors">
            <FileText size={16} className="text-rose-500" /><span>{t('dl.pdf', 'PDF document')}</span>
          </button>
          <button type="button" role="menuitem" onClick={pick('xlsx')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-[#0f6b50] dark:hover:text-emerald-300 transition-colors">
            <FileSpreadsheet size={16} className="text-emerald-600" /><span>{t('dl.xlsx', 'Excel workbook')}</span>
          </button>
        </div>, document.body)}
    </>
  );
};
