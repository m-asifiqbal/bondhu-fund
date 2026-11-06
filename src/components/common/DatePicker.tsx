import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MONTH_NAMES, BN_MONTHS, todayISO } from '../../utils/date';
import { toBanglaDigits } from '../../utils/i18n';

interface DatePickerProps {
  /** ISO 'YYYY-MM-DD' or '' */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  label?: string;
  required?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEK_EN = ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];
const WEEK_BN = ['শনি', 'রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র'];

/**
 * Click-anywhere date field with a calendar popover. Displays dd/mm/yyyy (Bangla digits in bn),
 * stores ISO. Week starts Saturday (Bangladesh convention). Popover is portalled so it is never clipped.
 */
export const DatePicker: React.FC<DatePickerProps> = ({
  value, onChange, placeholder, min, max, disabled = false, clearable = true, className = '', label, required, size = 'md', id,
}) => {
  const { language, t } = useApp();
  const bn = language === 'bn';
  const dig = (s: string | number) => (bn ? toBanglaDigits(s) : String(s));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const sel = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
  const base = sel || todayISO();
  const [view, setView] = useState({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 });
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const up = window.innerHeight - r.bottom < 360 && r.top > 360;
    setPos({ left: Math.min(r.left, window.innerWidth - 312), top: up ? r.top - 6 : r.bottom + 6, up });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const b = sel || todayISO();
    setView({ y: +b.slice(0, 4), m: +b.slice(5, 7) - 1 });
    setMode('days');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  const out = (d: string) => (min && d < min) || (max && d > max);
  const pick = (d: string) => { if (out(d)) return; onChange(d); setOpen(false); triggerRef.current?.focus(); };

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay(); // 0=Sun
    const offset = (first + 1) % 7; // Saturday-first grid
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const arr: Array<number | null> = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    while (arr.length % 7) arr.push(null);
    return arr;
  }, [view]);

  const display = sel ? dig(`${sel.slice(8, 10)}/${sel.slice(5, 7)}/${sel.slice(0, 4)}`) : '';
  const months = bn ? BN_MONTHS : MONTH_NAMES;
  const today = todayISO();
  const shift = (n: number) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const yearStart = Math.floor(view.y / 12) * 12;
  const h = size === 'sm' ? 'h-[38px] text-xs' : 'h-11 text-[13px]';

  return (
    <div className={`relative ${className}`}>
      {label && <label htmlFor={id} className="form-label">{label} {required && <span className="text-rose-500">*</span>}</label>}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-3.5 ${h} text-left bg-white dark:bg-[#101b21] border-[1.5px] rounded-xl font-semibold shadow-sm transition-[border-color,box-shadow] duration-150 tabular-nums
          ${open ? 'border-[#0f6b50] dark:border-emerald-500 ring-[3px] ring-[#0f6b50]/15 dark:ring-emerald-500/20' : 'border-[#a9b7c3] dark:border-[#3a5463] hover:border-[#7f93a3] dark:hover:border-[#52717f]'}
          ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} text-slate-900 dark:text-slate-100`}
      >
        <CalendarDays size={15} className="shrink-0 text-slate-400" />
        <span className={`flex-1 truncate ${display ? '' : 'font-medium text-slate-400 dark:text-slate-500'}`}>
          {display || placeholder || (bn ? 'দিন/মাস/বছর' : 'dd/mm/yyyy')}
        </span>
        {clearable && sel && !disabled && (
          <span role="button" tabIndex={-1} aria-label={t('common.clear', 'Clear')}
            onClick={e => { e.stopPropagation(); onChange(''); }}
            className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={13} />
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          className="fixed z-[1000] w-[300px] p-3 rounded-2xl border border-slate-200 dark:border-[#283d47] bg-white dark:bg-[#132027] shadow-[0_12px_40px_rgba(15,23,42,0.16)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] animate-pop select-none"
          style={{ left: pos.left, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => mode === 'years' ? setView(v => ({ ...v, y: v.y - 12 })) : mode === 'months' ? setView(v => ({ ...v, y: v.y - 1 })) : shift(-1)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" aria-label="Previous"><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => setMode(m => (m === 'days' ? 'months' : m === 'months' ? 'years' : 'days'))}
              className="px-3 py-1.5 rounded-lg text-sm font-extrabold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
              {mode === 'days' ? `${months[view.m]} ${dig(view.y)}` : mode === 'months' ? dig(view.y) : `${dig(yearStart)} – ${dig(yearStart + 11)}`}
            </button>
            <button type="button" onClick={() => mode === 'years' ? setView(v => ({ ...v, y: v.y + 12 })) : mode === 'months' ? setView(v => ({ ...v, y: v.y + 1 })) : shift(1)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" aria-label="Next"><ChevronRight size={16} /></button>
          </div>

          {mode === 'days' && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {(bn ? WEEK_BN : WEEK_EN).map(w => <div key={w} className="text-center text-[10px] font-bold text-slate-400 py-1">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const v = iso(view.y, view.m, d);
                  const isSel = v === sel, isToday = v === today, dis = out(v);
                  return (
                    <button key={i} type="button" disabled={!!dis} onClick={() => pick(v)}
                      className={`h-9 rounded-lg text-[13px] tabular-nums font-semibold transition-colors
                        ${isSel ? 'bg-brand text-white dark:bg-emerald-600' : isToday ? 'ring-1 ring-brand/50 dark:ring-emerald-500/60 text-brand dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}
                        ${dis ? 'opacity-30 cursor-not-allowed' : ''}`}>
                      {dig(d)}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {mode === 'months' && (
            <div className="grid grid-cols-3 gap-1.5">
              {months.map((mn, i) => (
                <button key={mn} type="button" onClick={() => { setView(v => ({ ...v, m: i })); setMode('days'); }}
                  className={`py-2.5 rounded-xl text-xs font-bold ${i === view.m ? 'bg-brand text-white dark:bg-emerald-600' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                  {bn ? mn : mn.slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          {mode === 'years' && (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => yearStart + i).map(y => (
                <button key={y} type="button" onClick={() => { setView(v => ({ ...v, y })); setMode('months'); }}
                  className={`py-2.5 rounded-xl text-xs font-bold tabular-nums ${y === view.y ? 'bg-brand text-white dark:bg-emerald-600' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                  {dig(y)}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-[#22353f]">
            <button type="button" disabled={!!out(today)} onClick={() => pick(today)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand dark:text-emerald-400 hover:bg-brand-light dark:hover:bg-emerald-950/40 disabled:opacity-40">
              {t('common.today', bn ? 'আজ' : 'Today')}
            </button>
            {clearable && sel && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                {t('common.clear', bn ? 'মুছুন' : 'Clear')}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default DatePicker;
