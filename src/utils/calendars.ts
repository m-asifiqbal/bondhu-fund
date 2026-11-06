/**
 * Alternative calendars for display: Hijri (Arabic) and Bangla (Bangladesh revised calendar), always on Dhaka time (GMT+6).
 *  - Hijri: fetched online (Aladhan, Umm al-Qura) and shifted by an optional moon-sighting adjustment (default 0 days, editable in Settings). With no internet, the same Umm al-Qura calendar from the browser's Intl is used with the same adjustment.
 *  - Bangla: computed here from the Bangladesh revised calendar (no online source is needed; it is fixed by rule).
 */
import type { AppLanguage } from './i18n';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnDigits = (v: string | number) => String(v).replace(/\d/g, d => BN_DIGITS[+d]);

// ---------------------------------------------------------------------------
// Bangla calendar (Bangladesh revised, 1987): new year on 14 April.
// Each entry: [Gregorian month (0-based), day] on which the Bangla month starts.
// ---------------------------------------------------------------------------
export const BANGLA_MONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
// Bangladesh revised calendar: the first six months have 31 days, the next five 30, Falgun 29 (30 in a leap year).
const BANGLA_STARTS: Array<[number, number]> = [[3, 14], [4, 15], [5, 15], [6, 16], [7, 16], [8, 16], [9, 17], [10, 16], [11, 16], [0, 15], [1, 14], [2, 15]];
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / 864e5);

/** Calendar date and clock in Dhaka (Asia/Dhaka, GMT+6), whatever the computer's own time zone is. */
export function dhakaParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const n = (t: string) => Number(p.find(x => x.type === t)?.value);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find(x => x.type === 'weekday')?.value || 'Sun');
  return { y: n('year'), m: n('month') - 1, d: n('day'), hh: n('hour'), mm: n('minute'), ss: n('second'), wd };
}
export const dhakaISO = (date = new Date()) => { const p = dhakaParts(date); return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
/** ISO date (Dhaka) shifted by a number of days — the day the Hijri lookup is asked for. */
export const shiftISO = (iso: string, days: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days)).toISOString().slice(0, 10);

/** Bangla ordinal day: ১লা, ২রা, ৩রা, ৪ঠা, ৫ই … ১৮ই, ১৯শে … ৩১শে. */
export const banglaDayOrdinal = (d: number) => bnDigits(d) + (d === 1 ? 'লা' : d === 2 || d === 3 ? 'রা' : d === 4 ? 'ঠা' : d <= 18 ? 'ই' : 'শে');

export function banglaDate(date = new Date()) {
  const { y, m, d } = dhakaParts(date);
  const today = dayNumber(y, m, d);
  let best = { index: 0, start: -Infinity };
  for (let i = 0; i < 12; i++) {
    for (const yr of [y - 1, y]) {
      const s = dayNumber(yr, BANGLA_STARTS[i][0], BANGLA_STARTS[i][1]);
      if (s <= today && s > best.start) best = { index: i, start: s };
    }
  }
  const newYearThisCycle = today >= dayNumber(y, 3, 14) ? y : y - 1;
  return { day: today - best.start + 1, month: best.index, monthName: BANGLA_MONTHS[best.index], year: newYearThisCycle - 593 };
}

// ---------------------------------------------------------------------------
// Hijri
// ---------------------------------------------------------------------------
const HIJRI_EN = ['Muharram', 'Safar', "Rabiʻ I", "Rabiʻ II", 'Jumada I', 'Jumada II', 'Rajab', "Shaʻban", 'Ramadan', 'Shawwal', "Dhu al-Qiʻdah", 'Dhu al-Hijjah'];
const HIJRI_BN = ['মুহাররম', 'সফর', 'রবিউল আউয়াল', 'রবিউস সানি', 'জমাদিউল আউয়াল', 'জমাদিউস সানি', 'রজব', 'শা’বান', 'রমজান', 'শাওয়াল', 'জিলকদ', 'জিলহজ'];
export const HIJRI_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

export interface HijriParts { day: number; month: number; year: number }   // month 0-11
/** Offline Hijri (Umm al-Qura via Intl) for the Dhaka date, shifted by the Bangladesh adjustment (days). */
export function hijriLocal(date = new Date(), adjust = 0): HijriParts {
  const { y, m, d } = dhakaParts(date);
  const shifted = new Date(Date.UTC(y, m, d + adjust, 12));
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(shifted);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { day: get('day'), month: get('month') - 1, year: get('year') };
}
export const hijriNames = (month: number) => ({ en: HIJRI_EN[month], bn: HIJRI_BN[month], ar: HIJRI_AR[month] });

// ---------------------------------------------------------------------------
// Ready-to-show strings
// ---------------------------------------------------------------------------
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

export function todayLines(date: Date, lang: AppLanguage, hijri?: HijriParts | null, adjust = 0) {
  const bn = lang === 'bn';
  const hp = hijri || hijriLocal(date, adjust);
  const h = { ...hp, ...hijriNames(hp.month) };
  const b = banglaDate(date);
  const g = dhakaParts(date);
  return {
    english: bn
      ? `${WEEKDAY_BN[g.wd]}, ${bnDigits(g.d)} ${MONTH_BN[g.m]} ${bnDigits(g.y)}`
      : `${WEEKDAY_EN[g.wd]}, ${g.d} ${MONTH_EN[g.m]} ${g.y}`,
    hijri: bn ? `${bnDigits(h.day)} ${h.bn} ${bnDigits(h.year)} হিজরি` : `${h.day} ${h.en} ${h.year} AH`,
    hijriArabic: `${h.day.toLocaleString('ar-EG', { useGrouping: false })} ${h.ar} ${h.year.toLocaleString('ar-EG', { useGrouping: false })} هـ`,
    // The Bangla calendar is always shown in Bangla script.
    bangla: `${banglaDayOrdinal(b.day)} ${b.monthName} ${bnDigits(b.year)}`,
  };
}
