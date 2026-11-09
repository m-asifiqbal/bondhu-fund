import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Copy, Check, AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AppUser, AppNotification, NavTab, AppSettings, MasterCategory, SessionInfo } from '../types';
export type { NavTab };
import { getUsers, getDynamicNotifications, getAppSettings, getMasterData, login as apiLogin, logout as apiLogout, getSession } from '../services/db';
import { formatDate as formatDateUtil, formatMonth as formatMonthUtil, monthKeyToName, currentMonthKey } from '../utils/date';
import { AppLanguage, translations, formatCurrency as formatCurrencyUtil, toBanglaDigits as toBanglaDigitsUtil } from '../utils/i18n';

interface ToastInfo {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppContextType {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  currentUser: AppUser | null;
  setCurrentUser: (user: AppUser) => void;
  users: AppUser[];
  refreshKey: number;
  triggerRefresh: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  openRecordModal: boolean;
  setOpenRecordModal: (open: boolean) => void;
  entryCenterInitialTab: 'money' | 'expense' | 'investment' | 'return';
  setEntryCenterInitialTab: (tab: 'money' | 'expense' | 'investment' | 'return') => void;
  notifications: AppNotification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  memberFilterStatus: string;
  setMemberFilterStatus: (status: string) => void;
  selectedMemberIdForPayment: number | null;
  setSelectedMemberIdForPayment: (id: number | null) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  toggleLanguage: () => void;
  t: (key: string, fallback?: string) => string;
  formatCurrency: (amount: number) => string;
  toBanglaDigits: (val: string | number) => string;
  /** '2024-06-05' -> '05 Jun 2024' (language aware) */
  formatDate: (iso?: string | null) => string;
  /** '2024-06' or 'June 2024' -> 'Jun 2024' (language aware) */
  formatMonth: (month?: string | null) => string;
  /** Translate a DATA value for display: master data names (name_bn), statuses, roles, etc. */
  tv: (value?: string | null) => string;
  /** Pick the Bangla variant of a record name when language is bn (e.g. member.name_bn). */
  bnName: (en?: string | null, bn?: string | null) => string;
  /** Cached settings (incl. org_logo); refreshed on triggerRefresh(). */
  settings: AppSettings | null;
  /** Organization name in the current language. */
  orgName: string;
  /** Cached active+inactive master data. */
  masterData: MasterCategory[];
  /** Open the profile page for a user (own profile when id omitted). */
  openProfile: (userId?: number) => void;
  profileUserId: number | null;
  /** Signed-in session (null = show sign-in screen). */
  session: SessionInfo | null;
  sessionChecked: boolean;
  /** Only the protected iqbal_labs account may upload data (Excel/bulk import). */
  canUpload: boolean;
  isAdmin: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/** Fixed data values that appear in records (statuses, roles, types) → translation keys. */
const VALUE_KEYS: Record<string, string> = {
  Paid: 'status.paid', Pending: 'status.pending', Overdue: 'status.overdue', Active: 'status.active', Inactive: 'status.inactive',
  Verified: 'status.verified', 'Needs receipt': 'status.needs_receipt', Growing: 'status.growing', Review: 'status.review', Sold: 'status.sold',
  Admin: 'role.admin', Treasurer: 'role.treasurer', Auditor: 'role.auditor', Manager: 'role.manager', Member: 'role.member',
  Manual: 'backup.manual', Automatic: 'backup.automatic', 'Pre-Restore': 'backup.pre_restore', Restored: 'backup.restored',
  collection: 'ledger.collection', expense: 'ledger.expense', investment: 'ledger.investment', sale: 'ledger.sale',
  return: 'ledger.return', settlement: 'ledger.settlement', loan: 'ledger.loan', loan_repayment: 'ledger.loan_repayment',
  Running: 'loan.s_running', Closed: 'loan.s_closed', 'Written off': 'loan.s_written_off',
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyToName(currentMonthKey()));
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const currentUser: AppUser | null = session?.user ?? null;
  const [users, setUsers] = useState<AppUser[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [openRecordModal, setOpenRecordModal] = useState(false);
  const [entryCenterInitialTab, setEntryCenterInitialTab] = useState<'money' | 'expense' | 'investment' | 'return'>('money');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('bondhu_read_notifs') || '[]')); } catch { return new Set(); }
  });
  const [memberFilterStatus, setMemberFilterStatus] = useState<string>('All');
  const [selectedMemberIdForPayment, setSelectedMemberIdForPayment] = useState<number | null>(null);
  const [copiedToastId, setCopiedToastId] = useState<number | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [masterData, setMasterData] = useState<MasterCategory[]>([]);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('bondhu_dark_mode') === 'true'; } catch { return false; }
  });
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    try { return (localStorage.getItem('bondhu_language') as AppLanguage) || 'en'; } catch { return 'en'; }
  });

  const setLanguage = useCallback((lang: AppLanguage) => {
    setLanguageState(lang);
    try { localStorage.setItem('bondhu_language', lang); } catch { /* ignore */ }
  }, []);
  const toggleLanguage = useCallback(() => setLanguage(language === 'en' ? 'bn' : 'en'), [language, setLanguage]);

  // Bangla font/line-height tweaks hook off this attribute (see index.css).
  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const t = useCallback((key: string, fallback?: string): string => {
    const tr = translations[key];
    if (tr) return tr[language] || tr.en;
    return fallback || key;
  }, [language]);

  const formatCurrency = useCallback((amount: number) => formatCurrencyUtil(amount, language), [language]);
  const toBanglaDigits = useCallback((val: string | number) => toBanglaDigitsUtil(val), []);
  const formatDate = useCallback((iso?: string | null) => formatDateUtil(iso, language), [language]);
  const formatMonth = useCallback((month?: string | null) => formatMonthUtil(month, language), [language]);

  const masterBn = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of masterData) if (x.name_bn) m.set(x.name, x.name_bn);
    return m;
  }, [masterData]);

  const tv = useCallback((value?: string | null): string => {
    if (value === null || value === undefined || value === '') return '';
    if (language !== 'bn') return value;
    const mb = masterBn.get(value);
    if (mb) return mb;
    const key = VALUE_KEYS[value];
    return key ? t(key, value) : value;
  }, [language, masterBn, t]);

  const bnName = useCallback((en?: string | null, bn?: string | null) => (language === 'bn' && bn ? bn : en || ''), [language]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    try { localStorage.setItem('bondhu_dark_mode', String(isDarkMode)); } catch { /* ignore */ }
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => setIsDarkMode(prev => !prev), []);
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const toastSeq = useRef(0);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now() * 100 + (toastSeq.current++ % 100);
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), type === 'error' ? 12000 : 4000);
  }, []);

  const handleCopyToast = (id: number, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedToastId(id);
    setTimeout(() => setCopiedToastId(null), 2500);
  };
  const dismissToast = (id: number) => setToasts(prev => prev.filter(x => x.id !== id));

  // Profiles can no longer be switched without signing in; this only refreshes the signed-in user's own details.
  const setCurrentUser = useCallback((u: AppUser) => {
    setSession(s => (s && s.user.id === u.id ? { ...s, user: { ...s.user, ...u } } : s));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const s = await apiLogin(username, password);
    setSession(s);
    setActiveTab('overview');
    setRefreshKey(k => k + 1);
  }, []);

  const signOut = useCallback(async () => {
    try { await apiLogout(); } finally {
      setSession(null); setUsers([]); setNotifications([]); setProfileUserId(null); setActiveTab('overview');
    }
  }, []);

  const openProfile = useCallback((userId?: number) => {
    setProfileUserId(userId ?? null);
    setActiveTab('profile' as NavTab);
  }, []);

  // Settings are public (sign-in screen shows the logo/name); everything else needs a session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, sess] = await Promise.all([getAppSettings(), getSession()]);
        if (cancelled) return;
        setSettings(s);
        setSession(sess);
        if (sess) {
          const [list, md] = await Promise.all([getUsers(), getMasterData()]);
          if (cancelled) return;
          setUsers(list);
          setMasterData(md);
          getDynamicNotifications().then(n => { if (!cancelled) setNotifications(n); }).catch(() => setNotifications([]));
        }
      } catch (e: any) {
        showToast(`Could not load app data: ${e.message}`, 'error');
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey, showToast]);

  // Surface unexpected async errors instead of failing silently.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => showToast(e.reason?.message || String(e.reason), 'error');
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [showToast]);

  const persistRead = (s: Set<string>) => {
    try { localStorage.setItem('bondhu_read_notifs', JSON.stringify([...s].slice(-200))); } catch { /* ignore */ }
    return s;
  };
  const markNotificationRead = useCallback((id: string) => setReadNotifIds(prev => persistRead(new Set(prev).add(id))), []);
  const markAllNotificationsRead = useCallback(
    () => setReadNotifIds(prev => persistRead(new Set([...prev, ...notifications.map(n => n.id)]))), [notifications]);

  const notificationsWithRead = useMemo(() => notifications.map(n => ({ ...n, isRead: readNotifIds.has(n.id) })), [notifications, readNotifIds]);
  const unreadNotificationCount = useMemo(() => notifications.filter(n => !readNotifIds.has(n.id)).length, [notifications, readNotifIds]);
  const orgName = (language === 'bn' && settings?.organization_name_bn) || settings?.organization_name || 'Bondhu Fund';

  // Memoized so consumers only re-render when something they could use actually changed (toasts excluded).
  const value = useMemo<AppContextType>(() => ({
    activeTab, setActiveTab, selectedMonth, setSelectedMonth, currentUser, setCurrentUser, users, refreshKey, triggerRefresh,
    showToast, openRecordModal, setOpenRecordModal, entryCenterInitialTab, setEntryCenterInitialTab,
    notifications: notificationsWithRead, unreadNotificationCount, markNotificationRead, markAllNotificationsRead,
    memberFilterStatus, setMemberFilterStatus, selectedMemberIdForPayment, setSelectedMemberIdForPayment,
    isDarkMode, toggleDarkMode, language, setLanguage, toggleLanguage, t, formatCurrency, toBanglaDigits, formatDate, formatMonth,
    tv, bnName, settings, orgName, masterData, openProfile, profileUserId,
    session, sessionChecked, canUpload: !!session?.canUpload, isAdmin: !!session?.isAdmin, signIn, signOut,
  }), [session, sessionChecked, signIn, signOut, activeTab, selectedMonth, currentUser, setCurrentUser, users, refreshKey, triggerRefresh, showToast, openRecordModal,
    entryCenterInitialTab, notificationsWithRead, unreadNotificationCount, markNotificationRead, markAllNotificationsRead,
    memberFilterStatus, selectedMemberIdForPayment, isDarkMode, toggleDarkMode, language, setLanguage, toggleLanguage, t,
    formatCurrency, toBanglaDigits, formatDate, formatMonth, tv, bnName, settings, orgName, masterData, openProfile, profileUserId]);

  return (
    <AppContext.Provider value={value}>
      {children}

      {/* Global Toast & Error Shower Container with Copy Support */}
      <div className="fixed bottom-5 right-5 z-[1100] flex flex-col gap-2 max-w-md pointer-events-none">
        {toasts.map(toast => {
          const isError = toast.type === 'error';
          const isCopied = copiedToastId === toast.id;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-3.5 rounded-xl shadow-2xl border text-xs transition-all transform animate-in slide-in-from-bottom-2 ${
                toast.type === 'success'
                  ? 'bg-[#0f4a3c] text-white border-[#156754]'
                  : isError
                  ? 'bg-rose-900 text-white border-rose-700 shadow-rose-950/40 ring-1 ring-rose-500'
                  : 'bg-slate-900 text-white border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {toast.type === 'success' ? (
                      <CheckCircle2 size={16} className="text-emerald-300" />
                    ) : isError ? (
                      <AlertCircle size={16} className="text-rose-300" />
                    ) : (
                      <Info size={16} className="text-blue-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isError && (
                      <span className="font-bold uppercase tracking-wider text-[10px] text-rose-300 block mb-0.5">
                        System Notice / Error
                      </span>
                    )}
                    <p className="font-medium leading-relaxed select-text break-words">
                      {toast.message}
                    </p>
                  </div>
                </div>

                {/* Copy Button & Dismiss Button */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleCopyToast(toast.id, toast.message)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm ${
                      isCopied
                        ? 'bg-emerald-500 text-white'
                        : isError
                        ? 'bg-rose-800 hover:bg-rose-700 text-rose-100 border border-rose-600'
                        : 'bg-white/20 hover:bg-white/30 text-white'
                    }`}
                    title="Copy to clipboard"
                  >
                    {isCopied ? (
                      <>
                        <Check size={12} strokeWidth={3} />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => dismissToast(toast.id)}
                    className="p-1 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};