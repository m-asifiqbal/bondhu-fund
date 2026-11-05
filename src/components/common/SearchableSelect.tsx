import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export interface SelectOption {
  value: string | number;
  label: string;
  subLabel?: string;
  badge?: string;
  badgeColor?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string | number | null | undefined;
  onChange: (val: any) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  required?: boolean;
  isLoading?: boolean;
  /** 'md' for forms (default), 'sm' for toolbars/filter bars */
  size?: 'sm' | 'md';
  /** Show a clear (x) button when a value is selected */
  clearable?: boolean;
  /** Hide the search box (auto-hidden when there are 6 options or fewer unless forced) */
  searchable?: boolean | 'auto';
  id?: string;
  /** Optional icon rendered at the left of the trigger */
  icon?: React.ReactNode;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKC');

/**
 * Accessible searchable dropdown used for EVERY select in the app.
 * The menu is portalled to <body> so it is never clipped by tables, cards or modals.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options, value, onChange, placeholder, searchPlaceholder, disabled = false, className = '', label, required = false,
  isLoading = false, size = 'md', clearable = false, searchable = 'auto', id, icon,
}) => {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => options.find(o => String(o.value) === String(value ?? '')), [options, value]);
  const showSearch = searchable !== false; // every dropdown is searchable unless explicitly disabled
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter(o => norm(`${o.label} ${o.subLabel || ''} ${o.badge || ''} ${o.value}`).includes(q));
  }, [options, query]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 260 && above > below;
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 220), maxH: Math.min(360, up ? above : below), up });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (!menuRef.current?.contains(tgt) && !triggerRef.current?.contains(tgt)) setOpen(false);
    };
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    const idx = filtered.findIndex(o => String(o.value) === String(value ?? ''));
    setActive(idx >= 0 ? idx : 0);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (o: SelectOption) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[active]; if (o) choose(o); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const h = size === 'sm' ? 'min-h-[38px] py-2 text-xs' : 'min-h-[44px] py-2.5 text-[13px]';

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label htmlFor={id} className="form-label">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3.5 ${h} text-left bg-white dark:bg-[#101b21] border rounded-xl font-semibold shadow-sm
          ${open ? 'border-brand dark:border-emerald-500 ring-2 ring-brand/15 dark:ring-emerald-500/20' : 'border-slate-300 dark:border-[#283d47] hover:border-slate-400 dark:hover:border-[#36505d]'}
          ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} text-slate-900 dark:text-slate-100`}
      >
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <span className="flex-1 min-w-0 truncate">
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate">{selected.label}</span>
              {selected.subLabel && <span className="truncate text-[11px] font-medium text-slate-400">{selected.subLabel}</span>}
            </span>
          ) : (
            <span className="font-medium text-slate-400 dark:text-slate-500">{placeholder ?? t('common.select', 'Select…')}</span>
          )}
        </span>
        {isLoading && <Loader2 size={14} className="animate-spin text-slate-400 shrink-0" />}
        {clearable && selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={t('common.clear', 'Clear')}
            onClick={e => { e.stopPropagation(); onChange(''); }}
            className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          onKeyDown={onKey}
          className="fixed z-[1000] rounded-2xl border border-slate-200 dark:border-[#283d47] bg-white dark:bg-[#132027] shadow-[0_12px_40px_rgba(15,23,42,0.16)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col animate-pop"
          style={{ left: Math.min(pos.left, window.innerWidth - pos.width - 8), width: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
        >
          {showSearch && (
            <div className="p-2.5 border-b border-slate-100 dark:border-[#22353f]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={searchPlaceholder ?? t('common.search_options', 'Search…')}
                  className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0f1a20] border border-slate-200 dark:border-[#22353f] text-[13px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand dark:focus:border-emerald-500"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
          <ul ref={listRef} role="listbox" className="overflow-y-auto p-1.5 flex-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">{t('common.no_matches', 'No matches found')}</li>
            ) : filtered.map((o, i) => {
              const isSel = String(o.value) === String(value ?? '');
              return (
                <li
                  key={`${o.value}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[13px] ${o.disabled ? 'opacity-40 cursor-not-allowed' : ''}
                    ${i === active ? 'bg-slate-100 dark:bg-[#1b2c34]' : ''} ${isSel ? 'text-brand dark:text-emerald-400 font-bold' : 'text-slate-700 dark:text-slate-200 font-medium'}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.subLabel && <span className="block truncate text-[11px] font-medium text-slate-400 mt-0.5">{o.subLabel}</span>}
                  </span>
                  {o.badge && <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${o.badgeColor || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{o.badge}</span>}
                  {isSel && <Check size={14} className="shrink-0" />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
};

/** Preferred name for new code. */
export const Select = SearchableSelect;
export default SearchableSelect;
