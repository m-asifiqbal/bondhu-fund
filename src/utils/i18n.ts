export type AppLanguage = 'en' | 'bn';

const banglaDigits: { [key: string]: string } = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

export const toBanglaDigits = (val: string | number): string => {
  return String(val).replace(/[0-9]/g, (match) => banglaDigits[match] || match);
};

export const formatCurrency = (amount: number, lang: AppLanguage = 'en'): string => {
  const formattedEn = amount.toLocaleString();
  if (lang === 'bn') {
    return `৳ ${toBanglaDigits(formattedEn)}`;
  }
  return `TK ${formattedEn}`;
};

export const formatNumber = (num: number, lang: AppLanguage = 'en'): string => {
  const formattedEn = num.toLocaleString();
  if (lang === 'bn') {
    return toBanglaDigits(formattedEn);
  }
  return formattedEn;
};

// UI Translations dictionary
export const translations: Record<string, { en: string; bn: string }> = {
  // Navigation & Tabs
  'nav.workspace': { en: 'Workspace', bn: 'কর্মক্ষেত্র' },
  'nav.overview': { en: 'Overview', bn: 'সারসংক্ষেপ' },
  'nav.members': { en: 'Members', bn: 'সদস্যবৃন্দ' },
  'nav.collections': { en: 'Collections', bn: 'মাসিক চাঁদা' },
  'nav.investments': { en: 'Investments', bn: 'বিনিয়োগ পোর্টফোলিও' },
  'nav.expenses': { en: 'Expenses', bn: 'পরিচালনা ব্যয়' },
  'nav.entry': { en: 'Entry Center', bn: 'তথ্য এন্ট্রি কেন্দ্র' },
  'nav.reports': { en: 'Reports & Export', bn: 'রিপোর্ট ও রপ্তানি' },
  'nav.master': { en: 'Master Data', bn: 'মাস্টার ডাটা' },
  'nav.backup': { en: 'Backup & Restore', bn: 'ডাটা ব্যাকআপ ও পুনরুদ্ধার' },
  'nav.users': { en: 'User Creation', bn: 'ব্যবহারকারী তৈরি' },
  'nav.settings': { en: 'Settings', bn: 'সেটিংস' },

  // TopBar & Actions
  'topbar.search_placeholder': { en: 'Search members, payments…', bn: 'সদস্য বা পেমেন্ট অনুসন্ধান করুন...' },
  'topbar.refresh': { en: 'Refresh', bn: 'রিফ্রেশ' },
  'topbar.backup': { en: 'Backup', bn: 'ব্যাকআপ' },
  'topbar.record_payment': { en: 'Record payment', bn: 'পেমেন্ট গ্রহণ' },
  'topbar.notifications': { en: 'System Notifications', bn: 'সিস্টেম বিজ্ঞপ্তি' },
  'topbar.mark_all_read': { en: 'Mark all read', bn: 'সব পঠিত হিসেবে চিহ্নিত করুন' },
  'topbar.no_notifications': { en: 'No new notifications. Everything is in order.', bn: 'কোনো নতুন বিজ্ঞপ্তি নেই। সবকিছু ঠিকঠাক আছে।' },

  // Metrics
  'metric.total_fund': { en: 'Total fund balance', bn: 'মোট ফান্ড ব্যালেন্স' },
  'metric.collected_this_month': { en: 'This month collected', bn: 'চলতি মাসে সংগৃহীত' },
  'metric.active_members': { en: 'Active members', bn: 'সক্রিয় সদস্য' },
  'metric.invested_assets': { en: 'Invested assets', bn: 'বিনিয়োগকৃত সম্পদ' },
  'metric.total_spending': { en: 'Total Spending', bn: 'মোট ব্যয়' },
  'metric.pending_receipts': { en: 'Pending Receipts', bn: 'অপেক্ষমাণ ভাউচার' },
  'metric.net_balance': { en: 'Net Available Balance', bn: 'নিট তহবিল স্থিতি' },
  'metric.expected': { en: 'Expected this month', bn: 'চলতি মাসে সম্ভাব্য' },
  'metric.late_fees': { en: 'Late fees collected', bn: 'আদায়কৃত বিলম্ব ফি' },
  'metric.outstanding': { en: 'Outstanding dues', bn: 'বকেয়া পরিমাণ' },

  // Categories
  'cat.work': { en: 'Work & Software', bn: 'কাজ ও সফটওয়্যার' },
  'cat.household': { en: 'Household & Rent', bn: 'বাসা ও ভাড়া' },
  'cat.utilities': { en: 'Utilities & Bills', bn: 'ইউটিলিটি ও বিল' },
  'cat.food': { en: 'Food & Dining', bn: 'খাবার ও আপ্যায়ন' },
  'cat.health': { en: 'Health & Personal Care', bn: 'স্বাস্থ্য ও চিকিৎসা' },
  'cat.entertainment': { en: 'Entertainment', bn: 'বিনোদন ও ইভেন্ট' },
  'cat.other': { en: 'Other Operations', bn: 'অন্যান্য খরচ' },

  // Statuses
  'status.paid': { en: 'Paid', bn: 'পরিশোধিত' },
  'status.pending': { en: 'Pending', bn: 'অপেক্ষমাণ' },
  'status.overdue': { en: 'Overdue', bn: 'বকেয়া' },
  'status.verified': { en: 'Verified', bn: 'যাচাইকৃত' },
  'status.needs_receipt': { en: 'Needs receipt', bn: 'রশিদ প্রয়োজন' },
  'status.growing': { en: 'Growing', bn: 'বর্ধনশীল' },
  'status.review': { en: 'Review due', bn: 'পর্যালোচনা বাকি' },

  // Common UI Buttons & Labels
  'common.filter': { en: 'Filter', bn: 'ফিল্টার' },
  'common.search': { en: 'Search', bn: 'খুঁজুন' },
  'common.date': { en: 'Date', bn: 'তারিখ' },
  'common.amount': { en: 'Amount', bn: 'পরিমাণ' },
  'common.status': { en: 'Status', bn: 'অবস্থা' },
  'common.action': { en: 'Action', bn: 'পদক্ষেপ' },
  'common.actions': { en: 'Actions', bn: 'পদক্ষেপসমূহ' },
  'common.save': { en: 'Save', bn: 'সংরক্ষণ করুন' },
  'common.cancel': { en: 'Cancel', bn: 'বাতিল' },
  'common.view': { en: 'View', bn: 'দেখুন' },
  'common.edit': { en: 'Edit', bn: 'সম্পাদনা' },
  'common.delete': { en: 'Delete', bn: 'মুছে ফেলুন' },
  'common.export': { en: 'Export Report', bn: 'রিপোর্ট ডাউনলোড' },
  'common.previous': { en: 'Previous', bn: 'পূর্ববর্তী' },
  'common.next': { en: 'Next', bn: 'পরবর্তী' },
  'common.reset': { en: 'Reset', bn: 'রিসেট' },
  'common.all': { en: 'All', bn: 'সকল' },
  'common.member': { en: 'Member', bn: 'সদস্য' },
  'common.member_id': { en: 'Member ID', bn: 'সদস্য আইডি' },
  'common.phone': { en: 'Phone', bn: 'মোবাইল নম্বর' },
  'common.email': { en: 'Email', bn: 'ইমেইল' },
  'common.monthly_due': { en: 'Monthly Due', bn: 'মাসিক চাঁদা' },
  'common.last_payment': { en: 'Last Payment', bn: 'শেষ পেমেন্ট' },
  'common.total_contributed': { en: 'Total Contributed', bn: 'মোট অবদান' },
  'common.notes': { en: 'Notes / Comments', bn: 'মন্তব্য' },
  'common.today': { en: 'Today', bn: 'আজ' },
  'common.select_month': { en: 'Select Month', bn: 'মাস নির্বাচন করুন' },
  'common.this_month': { en: 'This Month', bn: 'চলতি মাস' },

  // Headings
  'heading.recent_activity': { en: 'Recent activity', bn: 'সাম্প্রতিক কার্যক্রম' },
  'heading.needs_attention': { en: 'Needs attention', bn: 'জরুরি সতর্কতা' },
  'heading.collection_status': { en: 'Collection status', bn: 'চাঁদা আদায়ের অবস্থা' },
  'heading.spending_category': { en: 'Spending by Category', bn: 'খাতভিত্তিক ব্যয়' },
  'heading.spending_breakdown': { en: 'Spending Breakdown', bn: 'ব্যয়ের পাই-চার্ট বিশ্লেষণ' },
  'heading.top_vendors': { en: 'Top Vendors & Subscriptions', bn: 'শীর্ষ ব্যয় ও সেবাসমূহ' },
  'heading.recent_expenses': { en: 'Recent Expenses', bn: 'সাম্প্রতিক খরচসমূহ' },
};

export const useTranslation = (lang: AppLanguage) => {
  const t = (key: string, fallback?: string): string => {
    if (translations[key]) {
      return translations[key][lang] || translations[key].en;
    }
    return fallback || key;
  };

  return {
    t,
    formatCurrency: (amount: number) => formatCurrency(amount, lang),
    formatNumber: (num: number) => formatNumber(num, lang),
    toBanglaDigits,
    lang,
  };
};


// ---------------------------------------------------------------------------
// Per-area dictionaries (src/locales/*) are merged in; later keys override earlier ones.
// ---------------------------------------------------------------------------
import commonDict from '../locales/common';
import shellDict from '../locales/shell';
import membersDict from '../locales/members';
import financeDict from '../locales/finance';
import reportsDict from '../locales/reports';
import adminDict from '../locales/admin';
import returnsDict from '../locales/returns';
Object.assign(translations, commonDict, shellDict, membersDict, financeDict, reportsDict, adminDict, returnsDict);
/** Serial number for table rows: Bangla digits when the interface language is Bangla. */
export const serial = (n: number): string =>
  (typeof document !== 'undefined' && document.documentElement.lang === 'bn') ? toBanglaDigits(n) : String(n);
