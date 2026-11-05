/** Date/month helpers. Storage format: 'YYYY-MM-DD' and 'YYYY-MM'. */
import { toBanglaDigits, type AppLanguage } from './i18n';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTH_NAMES.map(m => m.slice(0, 3));
export const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const pad = (n: number) => String(n).padStart(2, '0');

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const currentMonthKey = () => todayISO().slice(0, 7);

/** 'June 2024' | 'Jun 2024' | '2024-06' | '2024-06-15' -> '2024-06' */
export function toMonthKey(v?: string | null): string {
  if (!v) return currentMonthKey();
  const s = v.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}`;
  const m = s.match(/^([A-Za-z]+)[\s,-]+(\d{4})$/);
  if (m) {
    const i = MONTH_SHORT.findIndex(x => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return `${m[2]}-${pad(i + 1)}`;
  }
  return currentMonthKey();
}

/** '2024-06' -> 'June 2024' (the format MonthPicker uses). */
export function monthKeyToName(key: string): string {
  const [y, m] = toMonthKey(key).split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function addMonths(key: string, n: number): string {
  const [y, m] = toMonthKey(key).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Human month label, e.g. 'Jun 2024' / 'জুন ২০২৪'. */
export function formatMonth(key: string | null | undefined, lang: AppLanguage = 'en', short = true): string {
  if (!key) return '—';
  const [y, m] = toMonthKey(key).split('-').map(Number);
  if (lang === 'bn') return `${BN_MONTHS[m - 1]} ${toBanglaDigits(y)}`;
  return `${short ? MONTH_SHORT[m - 1] : MONTH_NAMES[m - 1]} ${y}`;
}

/** '2024-06-05' -> '05 Jun 2024' / '০৫ জুন ২০২৪'. Non-ISO strings are returned unchanged. */
export function formatDate(iso: string | null | undefined, lang: AppLanguage = 'en'): string {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  if (lang === 'bn') return `${toBanglaDigits(d)} ${BN_MONTHS[+mo - 1]} ${toBanglaDigits(y)}`;
  return `${d} ${MONTH_SHORT[+mo - 1]} ${y}`;
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 864e5);
}

/** Fiscal year (e.g. July–June in Bangladesh) containing the given month. */
export function fiscalYearRange(key: string, startMonth = 7): { start: string; end: string; label: string } {
  const [y, m] = toMonthKey(key).split('-').map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${pad(startMonth)}-01`;
  const endKey = addMonths(`${startYear}-${pad(startMonth)}`, 11);
  const [ey, em] = endKey.split('-').map(Number);
  const end = `${endKey}-${pad(new Date(ey, em, 0).getDate())}`;
  return { start, end, label: startMonth === 1 ? `${startYear}` : `FY ${startYear}-${String(startYear + 1).slice(2)}` };
}
