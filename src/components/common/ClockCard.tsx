import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, MoonStar, Wheat } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { todayLines } from '../../utils/calendars';

/** Re-renders on every wall-clock boundary (self-correcting, so it never drifts). */
function useNow(stepMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => { timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs) + 8); };
    const tick = () => { setNow(new Date()); schedule(); };
    schedule();
    return () => window.clearTimeout(timer);
  }, [stepMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Plain digital clock: hh:mm:ss AM/PM, English digits, 12-hour, local time. */
export const ClockCard: React.FC = () => {
  const now = useNow(1000);
  const h = now.getHours();
  const time = `${pad(h % 12 || 12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const meridiem = h < 12 ? 'AM' : 'PM';
  return (
    <div className="inline-flex items-center gap-2.5 text-slate-900 dark:text-white select-none" role="timer" aria-label={`${time} ${meridiem}`}>
      <Clock3 size={20} className="text-[#0f6b50] dark:text-emerald-400" />
      <span className="text-[1.75rem] leading-none font-extrabold tabular-nums tracking-tight" lang="en" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>{time}</span>
      <span className="text-sm font-bold text-slate-500 dark:text-slate-400 self-end pb-0.5" lang="en">{meridiem}</span>
    </div>
  );
};

/** Today's date in the English, Hijri (Arabic) and Bangla calendars, on one line. Refreshes when the day changes. */
export const TodayDates: React.FC = () => {
  const { language } = useApp();
  const now = useNow(30_000);
  const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const lines = useMemo(() => todayLines(now, language as any), [day, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const bn = language === 'bn';
  const rows = [
    { icon: <CalendarDays size={14} />, text: lines.english, title: bn ? 'ইংরেজি ক্যালেন্ডার' : 'English (Gregorian) calendar' },
    { icon: <MoonStar size={14} />, text: lines.hijri, title: `${bn ? 'হিজরি (আরবি) ক্যালেন্ডার' : 'Hijri (Arabic) calendar'} · ${lines.hijriArabic}` },
    { icon: <Wheat size={14} />, text: lines.bangla, title: bn ? 'বাংলা ক্যালেন্ডার' : 'Bangla calendar' },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {rows.map((r, i) => (
        <li key={i} title={r.title} className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          <span className="text-[#0f6b50] dark:text-emerald-400 shrink-0">{r.icon}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
};
