import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Bell,
  Plus,
  CheckCircle,
  Database,
  CheckCheck,
  ArrowRight,
  RotateCw,
  Sun,
  Moon,
  Globe,
  X,
  Maximize2,
  Minimize2,
  AlertTriangle,
  Receipt,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getAppSettings } from '../../services/db';
import type { AppNotification } from '../../types';

export const TopBar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    setOpenRecordModal,
    showToast,
    triggerRefresh,
    notifications,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    setMemberFilterStatus,
    isDarkMode,
    toggleDarkMode,
    language,
    toggleLanguage,
    t,
    refreshKey,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'warning' | 'info'>('all');
  const [isNotifExpanded, setIsNotifExpanded] = useState(false);

  const notificationRef = useRef<HTMLDivElement>(null);
  const [orgName, setOrgName] = useState('');

  // Organization name comes from settings (no hardcoded name); reload whenever data changes.
  useEffect(() => {
    let alive = true;
    getAppSettings()
      .then(s => { if (alive) setOrgName(s.organization_name || ''); })
      .catch(() => { if (alive) setOrgName(''); });
    return () => { alive = false; };
  }, [refreshKey]);

  // Close notification popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(e.target as Node)
      ) {
        setShowNotificationMenu(false);
      }
    };

    if (showNotificationMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotificationMenu]);

  const getBreadcrumbTitle = () => {
    switch (activeTab) {
      case 'overview': return t('nav.overview');
      case 'members': return t('nav.members');
      case 'collections': return t('nav.collections');
      case 'investments': return t('nav.investments');
      case 'expenses': return t('nav.expenses');
      case 'entry': return t('nav.entry');
      case 'master': return t('nav.master');
      case 'users': return t('nav.users');
      case 'backup': return t('nav.backup');
      case 'reports': return t('nav.reports');
      case 'settings': return t('nav.settings');
      default: return t('nav.overview');
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      setActiveTab('members');
      showToast(
        language === 'bn'
          ? `সদস্য অনুসন্ধান: "${searchTerm}"`
          : `Searching for member: "${searchTerm}"`
      );
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    triggerRefresh();
    showToast(t('topbar.refreshed', language === 'bn' ? 'ডাটা রিফ্রেশ সম্পন্ন' : 'Data refreshed'), 'info');
    setTimeout(() => setIsRefreshing(false), 700);
  };

  const handleNotificationClick = (n: AppNotification) => {
    markNotificationRead(n.id);
    if (n.targetFilter) {
      setMemberFilterStatus(n.targetFilter);
    }
    setActiveTab(n.targetTab);
    setShowNotificationMenu(false);
  };

  const filteredNotifs = (notifications || []).filter((n) => {
    if (notifFilter === 'warning') return n.type === 'warning';
    if (notifFilter === 'info') return n.type === 'info' || n.type === 'success';
    return true;
  });

  return (
    <header className="no-print h-16 bg-white dark:bg-[#111e24] border-b border-slate-200 dark:border-[#223640] px-4 lg:px-6 xl:px-8 gap-3 flex items-center justify-between shrink-0 select-none shadow-sm transition-colors z-40 relative">
      {/* Breadcrumb with i18n */}
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-0">
        <span
          onClick={() => setActiveTab('overview')}
          title={orgName || t('nav.workspace')}
          className="hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors truncate max-w-[220px]"
        >
          {orgName || t('nav.workspace')}
        </span>
        <span className="text-slate-300 dark:text-slate-600 shrink-0">&rsaquo;</span>
        <span className="text-slate-900 dark:text-white font-bold truncate">{getBreadcrumbTitle()}</span>
      </div>

      {/* Right Navigation Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Global Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative hidden xl:block">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder={t('topbar.search_placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-52 2xl:w-64 pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#16252d] rounded-xl border border-slate-300 dark:border-[#2d424e] text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]/20 focus:border-[#0f4a3c] dark:focus:border-emerald-500 shadow-sm"
          />
        </form>

        {/* Bangla / English Language Switcher Toggle */}
        <button
          type="button"
          onClick={toggleLanguage}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#2d424e] rounded-xl text-xs font-black shadow-sm transition-all"
          title="Toggle Language (English / বাংলা)"
        >
          <Globe size={14} className="text-[#0f4a3c] dark:text-emerald-400" />
          <span className="text-[11px] uppercase tracking-wider font-extrabold">
            {language === 'en' ? 'বাংলা' : 'ENG'}
          </span>
        </button>

        {/* Live Refresh Button */}
        <button
          onClick={handleManualRefresh}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#2d424e] rounded-xl text-xs font-bold shadow-sm transition-all"
          title={t('topbar.refresh_title', language === 'bn' ? 'ডাটা রিফ্রেশ করুন' : 'Reload data')}
        >
          <RotateCw size={14} className={`text-[#0f4a3c] dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden 2xl:inline">{t('topbar.refresh')}</span>
        </button>

        {/* Night Mode Toggle */}
        <button
          onClick={toggleDarkMode}
          className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] border border-slate-300 dark:border-[#2d424e] flex items-center justify-center text-slate-700 dark:text-amber-400 shadow-sm transition-all"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Night Mode'}
        >
          {isDarkMode ? <Sun size={15} /> : <Moon size={15} className="text-slate-600" />}
        </button>

        {/* Expandable Notification Center with Outside-Click Close */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotificationMenu(!showNotificationMenu)}
            className={`w-9 h-9 rounded-xl border flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-sm relative transition-all ${
              showNotificationMenu
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                : 'bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] border-slate-300 dark:border-[#2d424e]'
            }`}
            title={t('topbar.notifications')}
          >
            <Bell size={16} />
            {unreadNotificationCount > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold absolute -top-1 -right-1 flex items-center justify-center ring-2 ring-white dark:ring-[#111e24]">
                {unreadNotificationCount}
              </span>
            )}
          </button>

          {/* Expanded Notification Popover Menu */}
          {showNotificationMenu && (
            <div
              className={`absolute right-0 top-12 ${
                isNotifExpanded ? 'w-[480px] sm:w-[540px]' : 'w-[360px] sm:w-[410px]'
              } bg-white dark:bg-[#15232b] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-4 z-50 text-xs animate-in fade-in zoom-in-95 duration-150`}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">{t('topbar.notifications')}</span>
                  {unreadNotificationCount > 0 && (
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                      {unreadNotificationCount} {language === 'bn' ? 'টি নতুন' : 'New'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsNotifExpanded(!isNotifExpanded)}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                    title={isNotifExpanded ? 'Compact Window' : 'Expand Window'}
                  >
                    {isNotifExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>

                  {unreadNotificationCount > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-[11px] text-[#0f4a3c] dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                      title={t('topbar.mark_all_read')}
                    >
                      <CheckCheck size={13} />
                      <span className="hidden sm:inline">{t('topbar.mark_all_read')}</span>
                    </button>
                  )}

                  <button
                    onClick={() => setShowNotificationMenu(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    title="Close"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 pt-2.5 pb-2 text-[11px]">
                <button
                  onClick={() => setNotifFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                    notifFilter === 'all'
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {language === 'bn' ? 'সকল' : 'All'} ({(notifications || []).length})
                </button>
                <button
                  onClick={() => setNotifFilter('warning')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                    notifFilter === 'warning'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {language === 'bn' ? 'বকেয়া ও ভাউচার' : 'Attention'}
                </button>
                <button
                  onClick={() => setNotifFilter('info')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                    notifFilter === 'info'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {language === 'bn' ? 'আপডেট' : 'Updates'}
                </button>
              </div>

              {/* Notifications List (Expanded Height) */}
              <div
                className={`space-y-2.5 mt-1 overflow-y-auto pr-1 ${
                  isNotifExpanded ? 'max-h-[460px]' : 'max-h-[340px]'
                }`}
              >
                {filteredNotifs.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md ${
                      n.isRead
                        ? 'bg-slate-50/70 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800 opacity-60'
                        : n.type === 'warning'
                        ? 'bg-[#fffbeb] dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/50 shadow-sm'
                        : n.type === 'info'
                        ? 'bg-[#eef4ff] dark:bg-blue-950/20 border-blue-300 dark:border-blue-800/50 shadow-sm'
                        : 'bg-[#e6f3ee] dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800/50 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100">
                        {n.type === 'warning' ? (
                          <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                        ) : (
                          <CheckCircle size={13} className="text-emerald-600 shrink-0" />
                        )}
                        <span>{n.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                        {n.createdAt}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mb-2">
                      {n.message}
                    </p>

                    <div className="flex items-center justify-between text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400">
                      <span className="flex items-center gap-1 hover:underline">
                        <span>{n.actionLabel}</span>
                        <ArrowRight size={12} />
                      </span>
                      {!n.isRead && (
                        <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.2 rounded-md font-bold">
                          {language === 'bn' ? 'নতুন' : 'Unread'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {filteredNotifs.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    {t('topbar.no_notifications')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Database Backup Quick Access */}
        <button
          onClick={() => setActiveTab('backup')}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#2d424e] rounded-xl text-xs font-semibold shadow-sm transition-all"
          title="Open Database Backup & Restore Center"
        >
          <Database size={14} className="text-[#0f4a3c] dark:text-emerald-400" />
          <span className="hidden 2xl:inline">{t('topbar.backup')}</span>
        </button>

        {/* Global Record Payment Action Button */}
        <button
          onClick={() => setOpenRecordModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus size={15} strokeWidth={2.5} />
          <span>{t('topbar.record_payment')}</span>
        </button>
      </div>
    </header>
  );
};
