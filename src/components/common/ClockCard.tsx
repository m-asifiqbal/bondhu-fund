import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, MoonStar, Wheat } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { bnDigits, todayLines } from '../../utils/calendars';

/** Re-renders on every wall-clock second boundary (self-correcting, so it never drifts). */
function useNow(stepMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs) + 8);
    };
    timer = window.setTimeout(tick, stepMs - (Date.now() % stepMs) + 8);
    return () => window.clearTimeout(timer);
  }, [stepMs]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Digital clock: HH:MM:SS AM/PM in the computer's local time, updating every second. */
export const ClockCard: React.FC = () => {
  const { language } = useApp();
  const now = useNow(1000);
  const bn = language === 'bn';
  const d = (s: string) => (bn ? bnDigits(s) : s);
  const hours = now.getHours();
  const h12 = hours % 12 || 12;
  const tz = useMemo(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = -now.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '−';
    const abs = Math.abs(off);
    return `${zone} · GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + pad(abs % 60) : ''}`;
  }, [now.getTimezoneOffset()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="clock-card" role="timer" aria-label={`${pad(h12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${hours < 12 ? 'AM' : 'PM'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Clock3 size={12} className="text-[#0f6b50] dark:text-emerald-400" />
        <span>{bn ? 'এখন সময়' : 'Local time'}</span>
      </div>
      <div className="flex items-baseline gap-1 tabular-nums leading-none mt-1.5">
        <span className="clock-digits">{d(pad(h12))}</span>
        <span className="clock-colon">:</span>
        <span className="clock-digits">{d(pad(now.getMinutes()))}</span>
        <span className="clock-colon">:</span>
        <span className="clock-digits clock-sec">{d(pad(now.getSeconds()))}</span>
        <span className="clock-ampm">{hours < 12 ? 'AM' : 'PM'}</span>
      </div>
      <div className="mt-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 truncate" title={tz}>{tz}</div>
    </div>
  );
};

/** Today's date in the English, Hijri (Arabic) and Bangla calendars. Refreshes when the day changes. */
export const TodayDates: React.FC = () => {
  const { language } = useApp();
  const now = useNow(30_000);
  const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const lines = useMemo(() => todayLines(now, language as any), [day, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [
    { icon: <CalendarDays size={13} />, text: lines.english, title: language === 'bn' ? 'ইংরেজি ক্যালেন্ডার' : 'English (Gregorian) calendar' },
    { icon: <MoonStar size={13} />, text: lines.hijri, title: `${language === 'bn' ? 'হিজরি (আরবি) ক্যালেন্ডার' : 'Hijri (Arabic) calendar'} · ${lines.hijriArabic}` },
    { icon: <Wheat size={13} />, text: lines.bangla, title: language === 'bn' ? 'বাংলা ক্যালেন্ডার' : 'Bangla calendar' },
  ];
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((r, i) => (
        <li key={i} title={r.title} className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
          <span className="text-[#0f6b50] dark:text-emerald-400 shrink-0">{r.icon}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
};
