import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Copy, Check, AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AppUser, AppNotification, NavTab } from '../types';
export type { NavTab };
import { getUsers, getDynamicNotifications } from '../services/db';
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
  entryCenterInitialTab: 'money' | 'expense' | 'investment';
  setEntryCenterInitialTab: (tab: 'money' | 'expense' | 'investment') => void;
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedMonth, setSelectedMonth] = useState('June 2024');
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [openRecordModal, setOpenRecordModal] = useState(false);
  const [entryCenterInitialTab, setEntryCenterInitialTab] = useState<'money' | 'expense' | 'investment'>('money');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(new Set());
  const [memberFilterStatus, setMemberFilterStatus] = useState<string>('All');
  const [selectedMemberIdForPayment, setSelectedMemberIdForPayment] = useState<number | null>(null);
  const [copiedToastId, setCopiedToastId] = useState<number | null>(null);

  // Night Mode state & persistence
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('bondhu_dark_mode') === 'true';
  });

  // Language state & persistence (Bangla support)
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    return (localStorage.getItem('bondhu_language') as AppLanguage) || 'en';
  });

  const setLanguage = (lang: AppLanguage) => {
    setLanguageState(lang);
    localStorage.setItem('bondhu_language', lang);
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'bn' : 'en');
  };

  const t = useCallback((key: string, fallback?: string): string => {
    if (translations[key]) {
      return translations[key][language] || translations[key].en;
    }
    return fallback || key;
  }, [language]);

  const formatCurrency = useCallback((amount: number): string => {
    return formatCurrencyUtil(amount, language);
  }, [language]);

  const toBanglaDigits = useCallback((val: string | number): string => {
    return toBanglaDigitsUtil(val);
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('bondhu_dark_mode', String(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  const triggerRefresh = () => setRefreshKey(k => k + 1);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    // Keep error visible longer (12 seconds) so user has time to read and copy
    const duration = type === 'error' ? 12000 : 4000;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  const handleCopyToast = (id: number, text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedToastId(id);
    setTimeout(() => setCopiedToastId(null), 2500);
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    getUsers().then(list => {
      setUsers(list);
      if (list.length > 0 && !currentUser) {
        const nusrat = list.find(u => u.username === 'nusrat.jahan') || list[0];
        setCurrentUser(nusrat);
      }
    });

    getDynamicNotifications().then(notifs => {
      setNotifications(notifs);
    });
  }, [refreshKey]);

  const markNotificationRead = (id: string) => {
    setReadNotifIds(prev => new Set(prev).add(id));
  };

  const markAllNotificationsRead = () => {
    setReadNotifIds(new Set(notifications.map(n => n.id)));
  };

  const unreadNotificationCount = notifications.filter(n => !readNotifIds.has(n.id)).length;

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        selectedMonth,
        setSelectedMonth,
        currentUser,
        setCurrentUser,
        users,
        refreshKey,
        triggerRefresh,
        showToast,
        openRecordModal,
        setOpenRecordModal,
        entryCenterInitialTab,
        setEntryCenterInitialTab,
        notifications: notifications.map(n => ({ ...n, isRead: readNotifIds.has(n.id) })),
        unreadNotificationCount,
        markNotificationRead,
        markAllNotificationsRead,
        memberFilterStatus,
        setMemberFilterStatus,
        selectedMemberIdForPayment,
        setSelectedMemberIdForPayment,
        isDarkMode,
        toggleDarkMode,
        language,
        setLanguage,
        toggleLanguage,
        t,
        formatCurrency,
        toBanglaDigits,
      }}
    >
      {children}

      {/* Global Toast & Error Shower Container with Copy Support */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md pointer-events-none">
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
