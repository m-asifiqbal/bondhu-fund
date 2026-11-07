// Bangla/English strings for: Sidebar, TopBar, App shell, Overview, notifications.
// Keys are namespaced (e.g. 'shell.some_label'). Plain data only — no imports.
const dict: Record<string, { en: string; bn: string }> = {
  // Navigation labels (overrides of the base nav.* keys — shorter, clearer Bangla for the sidebar & breadcrumb)
  'nav.overview': { en: 'Overview', bn: 'সারসংক্ষেপ' },
  'nav.collections': { en: 'Collections', bn: 'মাসিক চাঁদা' },
  'nav.members': { en: 'Members', bn: 'সদস্যবৃন্দ' },
  'nav.expenses': { en: 'Operating Expenses', bn: 'পরিচালনা ব্যয়' },
  'nav.entry': { en: 'Entry Center', bn: 'তথ্য এন্ট্রি' },
  'nav.investments': { en: 'Investments', bn: 'বিনিয়োগ' },
  'nav.reports': { en: 'Reports & Export', bn: 'রিপোর্ট ও রপ্তানি' },
  'nav.master': { en: 'Master Data', bn: 'মাস্টার ডাটা' },
  'nav.users': { en: 'Users & Roles', bn: 'ব্যবহারকারী ও ভূমিকা' },
  'nav.backup': { en: 'Backup & Restore', bn: 'ব্যাকআপ ও রিস্টোর' },
  'nav.settings': { en: 'Settings', bn: 'সেটিংস' },
  'nav.profile': { en: 'My profile', bn: 'আমার প্রোফাইল' },

  'shell.section_platform': { en: 'Platform', bn: 'মূল কার্যক্রম' },
  'shell.section_portfolio': { en: 'Portfolio', bn: 'পোর্টফোলিও' },
  'shell.section_admin': { en: 'Administration', bn: 'প্রশাসন' },
  'shell.tagline': { en: 'Savings fund manager', bn: 'সঞ্চয় তহবিল ব্যবস্থাপনা' },
  'shell.expand': { en: 'Expand sidebar', bn: 'সাইডবার বড় করুন' },
  'shell.collapse': { en: 'Collapse sidebar', bn: 'সাইডবার ছোট করুন' },

  // Profile menu
  'shell.profile_menu': { en: 'Profile & switch user', bn: 'প্রোফাইল ও ব্যবহারকারী পরিবর্তন' },
  'shell.manage_users': { en: 'Manage users', bn: 'ব্যবহারকারী ব্যবস্থাপনা' },
  'shell.switch_profile': { en: 'Switch profile', bn: 'প্রোফাইল পরিবর্তন' },
  'shell.switched_to': { en: 'Active profile', bn: 'সক্রিয় প্রোফাইল' },
  'shell.no_active_users': { en: 'No active profiles.', bn: 'কোনো সক্রিয় প্রোফাইল নেই।' },
  'shell.user_profile': { en: 'User profile', bn: 'ব্যবহারকারীর প্রোফাইল' },

  // Top bar
  'topbar.search_placeholder': { en: 'Search members, payments…', bn: 'সদস্য বা পেমেন্ট খুঁজুন...' },
  'topbar.refresh': { en: 'Refresh', bn: 'রিফ্রেশ' },
  'topbar.backup': { en: 'Backup', bn: 'ব্যাকআপ' },
  'topbar.record_payment': { en: 'Record payment', bn: 'পেমেন্ট গ্রহণ' },
  'topbar.notifications': { en: 'Notifications', bn: 'বিজ্ঞপ্তি' },
  'topbar.mark_all_read': { en: 'Mark all read', bn: 'সব পঠিত করুন' },
  'shell.searching_member': { en: 'Searching for member', bn: 'সদস্য খোঁজা হচ্ছে' },
  'shell.refreshed': { en: 'Data refreshed', bn: 'ডাটা রিফ্রেশ সম্পন্ন' },
  'shell.refresh_title': { en: 'Reload data', bn: 'ডাটা পুনরায় লোড করুন' },
  'shell.toggle_language': { en: 'Switch language (English / বাংলা)', bn: 'ভাষা পরিবর্তন (English / বাংলা)' },
  'shell.light_mode': { en: 'Switch to light mode', bn: 'লাইট মোডে যান' },
  'shell.dark_mode': { en: 'Switch to night mode', bn: 'নাইট মোডে যান' },
  'shell.new': { en: 'New', bn: 'টি নতুন' },
  'shell.compact': { en: 'Compact window', bn: 'ছোট করুন' },
  'shell.expand_window': { en: 'Expand window', bn: 'বড় করুন' },
  'shell.attention': { en: 'Attention', bn: 'বকেয়া ও ভাউচার' },
  'shell.updates': { en: 'Updates', bn: 'আপডেট' },
  'shell.unread': { en: 'Unread', bn: 'নতুন' },
  'shell.backup_title': { en: 'Open Backup & Restore', bn: 'ব্যাকআপ ও রিস্টোর খুলুন' },

  // App shell / error boundary
  'shell.crash_title': { en: 'This screen ran into a problem', bn: 'এই স্ক্রিনে একটি সমস্যা হয়েছে' },
  'shell.crash_body': {
    en: 'Your data is safe. You can switch to another screen from the sidebar, or reload the app.',
    bn: 'আপনার ডাটা নিরাপদ আছে। সাইডবার থেকে অন্য স্ক্রিনে যেতে পারেন, অথবা অ্যাপটি পুনরায় লোড করুন।',
  },
  'shell.copy': { en: 'Copy', bn: 'কপি' },
  'shell.copied': { en: 'Copied!', bn: 'কপি হয়েছে!' },
  'shell.reload': { en: 'Reload', bn: 'পুনরায় লোড' },
};

export default dict;
