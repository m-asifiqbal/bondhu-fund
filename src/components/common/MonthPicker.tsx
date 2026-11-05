import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface MonthPickerProps {
  value: string; // e.g. "June 2024" or "November 2026"
  onChange: (monthStr: string) => void;
  className?: string;
  align?: 'left' | 'right';
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const BANGLA_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

export const MonthPicker: React.FC<MonthPickerProps> = ({
  value,
  onChange,
  className = '',
  align = 'right',
}) => {
  const { language, toBanglaDigits, t } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse incoming value like "June 2024"
  const parseMonthYear = (val: string) => {
    const parts = (val || '').trim().split(' ');
    if (parts.length >= 2) {
      const mIdx = MONTH_NAMES.findIndex(
        (m) => m.toLowerCase() === parts[0].toLowerCase()
      );
      const yr = parseInt(parts[1], 10) || new Date().getFullYear();
      return { monthIndex: mIdx >= 0 ? mIdx : new Date().getMonth(), year: yr };
    }
    return { monthIndex: new Date().getMonth(), year: new Date().getFullYear() };
  };

  const initial = parseMonthYear(value);
  const [viewYear, setViewYear] = useState<number>(initial.year);

  // Update viewYear if incoming value year changes
  useEffect(() => {
    const parsed = parseMonthYear(value);
    setViewYear(parsed.year);
  }, [value]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const currentParsed = parseMonthYear(value);

  const handleSelectMonth = (idx: number) => {
    const selectedMonthName = MONTH_NAMES[idx];
    const newMonthStr = `${selectedMonthName} ${viewYear}`;
    onChange(newMonthStr);
    setIsOpen(false);
  };

  const handleJumpToCurrent = () => {
    const now = new Date();
    const currentMonthName = MONTH_NAMES[now.getMonth()];
    const currentYear = now.getFullYear();
    setViewYear(currentYear);
    onChange(`${currentMonthName} ${currentYear}`);
    setIsOpen(false);
  };

  // Label representation
  const displayLabel = () => {
    const p = parseMonthYear(value);
    if (language === 'bn') {
      const bnMonth = BANGLA_MONTHS[p.monthIndex];
      return `${bnMonth} ${toBanglaDigits(p.year)}`;
    }
    return value || `${MONTH_NAMES[p.monthIndex]} ${p.year}`;
  };

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Trigger Pill Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-[#16252d] border rounded-xl text-xs font-bold transition-all shadow-sm ${
          isOpen
            ? 'border-emerald-600 dark:border-emerald-500 ring-2 ring-emerald-500/10 text-slate-900 dark:text-white'
            : 'border-slate-300 dark:border-[#283e4a] text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600'
        }`}
        title={t('monthpicker.select', 'Select month')}
        aria-label={t('monthpicker.select', 'Select month')}
        aria-expanded={isOpen}
      >
        <Calendar size={14} className="text-[#0f4a3c] dark:text-emerald-400 shrink-0" />
        <span className="font-bold">{displayLabel()}</span>
        <span className="text-[10px] text-slate-400" aria-hidden>▾</span>
      </button>

      {/* Month Picker Calendar Grid Popover */}
      {isOpen && (
        <div
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-full mt-2 w-72 bg-white dark:bg-[#14232b] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-100 select-none`}
        >
          {/* Popover Header: Year Navigator */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              title={t('monthpicker.prev_year', 'Previous year')}
              aria-label={t('monthpicker.prev_year', 'Previous year')}
            >
              <ChevronLeft size={16} />
            </button>

            <span className="text-sm font-black text-slate-900 dark:text-white tracking-wide">
              {language === 'bn' ? toBanglaDigits(viewYear) : viewYear}
            </span>

            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
              title={t('monthpicker.next_year', 'Next year')}
              aria-label={t('monthpicker.next_year', 'Next year')}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* 12-Month Interactive Grid (4 rows x 3 cols) */}
          <div className="grid grid-cols-3 gap-2 py-3">
            {MONTH_NAMES.map((name, idx) => {
              const isSelected =
                currentParsed.monthIndex === idx && currentParsed.year === viewYear;
              const isCurrentMonthNow =
                new Date().getMonth() === idx &&
                new Date().getFullYear() === viewYear;

              const label =
                language === 'bn'
                  ? BANGLA_MONTHS[idx]
                  : name.slice(0, 3);

              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSelectMonth(idx)}
                  className={`py-2 px-1 text-xs leading-snug rounded-xl font-bold transition-all relative text-center ${
                    isSelected
                      ? 'bg-slate-900 dark:bg-emerald-600 text-white shadow-md'
                      : isCurrentMonthNow
                      ? 'border border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-extrabold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span>{label}</span>
                  {isSelected && (
                    <span className="absolute bottom-1 right-1">
                      <Check size={10} strokeWidth={3} className="text-emerald-400 dark:text-white" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick jump to current month */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400">
              {t('monthpicker.jump', 'Jump to current')}
            </span>
            <button
              type="button"
              onClick={handleJumpToCurrent}
              className="px-2.5 py-1 text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
            >
              {t('monthpicker.this_month', 'This month')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

