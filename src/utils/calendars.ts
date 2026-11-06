/**
 * Alternative calendars for display: Hijri (Arabic) and Bangla (Bangladesh revised calendar).
 * Hijri comes from the browser's Intl (Umm al-Qura); Intl has no Bangla calendar, so it is computed here.
 */
import type { AppLanguage } from './i18n';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnDigits = (v: string | number) => String(v).replace(/\d/g, d => BN_DIGITS[+d]);

// ---------------------------------------------------------------------------
// Bangla calendar (Bangladesh revised, 1987): new year on 14 April.
// Each entry: [Gregorian month (0-based), day] on which the Bangla month starts.
// ---------------------------------------------------------------------------
export const BANGLA_MONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];
const BANGLA_STARTS: Array<[number, number]> = [[3, 14], [4, 15], [5, 15], [6, 16], [7, 16], [8, 16], [9, 16], [10, 15], [11, 15], [0, 14], [1, 13], [2, 15]];
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / 864e5);

export function banglaDate(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
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

export function hijriDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const month = get('month') - 1;
  return { day: get('day'), month, year: get('year'), en: HIJRI_EN[month], bn: HIJRI_BN[month], ar: HIJRI_AR[month] };
}

// ---------------------------------------------------------------------------
// Ready-to-show strings
// ---------------------------------------------------------------------------
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

export function todayLines(date: Date, lang: AppLanguage) {
  const bn = lang === 'bn';
  const h = hijriDate(date);
  const b = banglaDate(date);
  return {
    english: bn
      ? `${WEEKDAY_BN[date.getDay()]}, ${bnDigits(date.getDate())} ${MONTH_BN[date.getMonth()]} ${bnDigits(date.getFullYear())}`
      : `${WEEKDAY_EN[date.getDay()]}, ${date.getDate()} ${MONTH_EN[date.getMonth()]} ${date.getFullYear()}`,
    hijri: bn ? `${bnDigits(h.day)} ${h.bn} ${bnDigits(h.year)} হিজরি` : `${h.day} ${h.en} ${h.year} AH`,
    hijriArabic: `${h.day.toLocaleString('ar-EG', { useGrouping: false })} ${h.ar} ${h.year.toLocaleString('ar-EG', { useGrouping: false })} هـ`,
    // The Bangla calendar is always shown in Bangla script.
    bangla: `${bnDigits(b.day)} ${b.monthName} ${bnDigits(b.year)} বঙ্গাব্দ`,
  };
}
