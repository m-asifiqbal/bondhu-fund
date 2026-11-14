/** Module access (shared by the sidebar, the pages and the permission editor). Enforcement is in the main process; this is only for showing and hiding. */
export type ModuleKey = 'overview' | 'collections' | 'members' | 'expenses' | 'entry' | 'investments' | 'returns' | 'loans' | 'reports' | 'master' | 'users' | 'backup' | 'settings' | 'google_sync' | 'drive_backup';
export type AccessLevel = 'none' | 'view' | 'edit';

/** Modules in the order and grouping shown in the permission editor. */
export const MODULE_GROUPS: Array<{ key: string; title: [string, string]; modules: ModuleKey[] }> = [
  { key: 'ops', title: ['Everyday work', 'দৈনন্দিন কাজ'], modules: ['overview', 'collections', 'members', 'expenses', 'entry'] },
  { key: 'portfolio', title: ['Portfolio', 'পোর্টফোলিও'], modules: ['investments', 'returns', 'loans', 'reports'] },
  { key: 'admin', title: ['Administration', 'প্রশাসন'], modules: ['master', 'users', 'backup', 'settings'] },
  { key: 'cloud', title: ['Google', 'গুগল'], modules: ['google_sync', 'drive_backup'] },
];
export const ALL_MODULES: ModuleKey[] = MODULE_GROUPS.flatMap(g => g.modules);

/** Sidebar / page → the module that opens it (null = always available). */
export const TAB_MODULE: Record<string, ModuleKey[] | null> = {
  overview: ['overview'], collections: ['collections'], fines: ['collections'], members: ['members'], expenses: ['expenses'], entry: ['entry'], investments: ['investments'], returns: ['returns'],
  loans: ['loans'], reports: ['reports'], master: ['master'], users: ['users'], backup: ['backup', 'google_sync', 'drive_backup'], settings: ['settings'], profile: null,
};

export const levelRank = (l: AccessLevel | undefined) => (l === 'edit' ? 2 : l === 'view' ? 1 : 0);
