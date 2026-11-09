import React, { useState, useRef, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ChipTabs } from '../common/ChipTabs';
import { ProfileMenu, UserAvatar, useOutsideClose } from './Sidebar';
import type { AppNotification, NavTab } from '../../types';

const TAB_KEYS: Record<NavTab, [string, string]> = {
  overview: ['nav.overview', 'Overview'],
  members: ['nav.members', 'Members'],
  collections: ['nav.collections', 'Collections'],
  investments: ['nav.investments', 'Investments'],
  returns: ['nav.returns', 'Investment Returns'],
  loans: ['nav.loans', 'Personal Loans'],
  expenses: ['nav.expenses', 'Expenses'],
  entry: ['nav.entry', 'Entry Center'],
  master: ['nav.master', 'Master Data'],
  users: ['nav.users', 'Users & Roles'],
  backup: ['nav.backup', 'Backup & Restore'],
  reports: ['nav.reports', 'Reports & Export'],
  settings: ['nav.settings', 'Settings'],
  profile: ['nav.profile', 'My profile'],
};

const iconBtn = 'bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] border border-slate-300 dark:border-[#2d424e] text-slate-700 dark:text-slate-200 shadow-sm transition-all';

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
    tv,
    orgName,
    currentUser,
    profileUserId,
    toBanglaDigits,
    formatDate,
    bnName,
  } = useApp();

  const num = (n: number) => (language === 'bn' ? toBanglaDigits(n) : String(n));

  const [searchTerm, setSearchTerm] = useState('');
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'warning' | 'info'>('all');
  const [isNotifExpanded, setIsNotifExpanded] = useState(true);   // notification centre opens expanded

  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const closeNotif = useCallback(() => setShowNotificationMenu(false), []);
  const closeProfile = useCallback(() => setShowProfileMenu(false), []);
  useOutsideClose(notificationRef, showNotificationMenu, closeNotif);
  useOutsideClose(profileRef, showProfileMenu, closeProfile);

  const breadcrumbTitle = (() => {
    if (activeTab === 'profile' && profileUserId != null && profileUserId !== currentUser?.id) {
      return t('shell.user_profile', 'User profile');
    }
    const [key, en] = TAB_KEYS[activeTab] || TAB_KEYS.overview;
    return t(key, en);
  })();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      setActiveTab('members');
      showToast(`${t('shell.searching_member', 'Searching for member')}: "${searchTerm.trim()}"`, 'info');
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    triggerRefresh();
    showToast(t('shell.refreshed', 'Data refreshed'), 'info');
    setTimeout(() => setIsRefreshing(false), 700);
  };

  const handleNotificationClick = (n: AppNotification) => {
    markNotificationRead(n.id);
    if (n.targetFilter) setMemberFilterStatus(n.targetFilter);
    setActiveTab(n.targetTab);
    setShowNotificationMenu(false);
  };

  const filteredNotifs = useMemo(() => (notifications || []).filter(n => {
    if (notifFilter === 'warning') return n.type === 'warning';
    if (notifFilter === 'info') return n.type === 'info' || n.type === 'success';
    return true;
  }), [notifications, notifFilter]);

  return (
    <header className="no-print h-16 bg-white dark:bg-[#111e24] border-b border-slate-200 dark:border-[#223640] px-4 lg:px-6 xl:px-8 gap-3 flex items-center justify-between shrink-0 select-none shadow-sm transition-colors z-40 relative">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-0">
        <span
          onClick={() => setActiveTab('overview')}
          title={orgName}
          className="hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors truncate max-w-[220px]"
        >
          {orgName}
        </span>
        <span className="text-slate-300 dark:text-slate-600 shrink-0">&rsaquo;</span>
        <span className="text-slate-900 dark:text-white font-bold truncate">{breadcrumbTitle}</span>
      </div>

      {/* Right Navigation Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Global Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative hidden xl:block">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder={t('topbar.search_placeholder', 'Search members, payments…')}
            aria-label={t('topbar.search_placeholder', 'Search members, payments…')}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-60 2xl:w-72 h-9 pl-9 pr-4 bg-slate-50 dark:bg-[#16252d] rounded-xl border-[1.5px] border-[#a9b7c3] dark:border-[#3a5463] hover:border-[#7f93a3] text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]/20 focus:border-[#0f4a3c] dark:focus:border-emerald-500 shadow-sm"
          />
        </form>

        {/* Language */}
        <button
          type="button"
          onClick={toggleLanguage}
          className={`h-9 flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-black ${iconBtn}`}
          title={t('shell.toggle_language', 'Switch language (English / বাংলা)')}
        >
          <Globe size={14} className="text-[#0f4a3c] dark:text-emerald-400" />
          {language === 'en'
            ? <span lang="bn" className="text-[12px] font-bold leading-none" style={{ fontFamily: "'Noto Sans Bengali', sans-serif" }}>বাংলা</span>
            : <span className="text-[11px] uppercase tracking-wider font-extrabold">ENG</span>}
        </button>

        {/* Refresh */}
        <button
          onClick={handleManualRefresh}
          className={`h-9 flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-bold ${iconBtn}`}
          title={t('shell.refresh_title', 'Reload data')}
        >
          <RotateCw size={14} className={`text-[#0f4a3c] dark:text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden 2xl:inline">{t('topbar.refresh', 'Refresh')}</span>
        </button>

        {/* Theme */}
        <button
          onClick={toggleDarkMode}
          className={`w-9 h-9 rounded-xl flex items-center justify-center dark:text-amber-400 ${iconBtn}`}
          title={isDarkMode ? t('shell.light_mode', 'Switch to light mode') : t('shell.dark_mode', 'Switch to night mode')}
          aria-label={isDarkMode ? t('shell.light_mode', 'Switch to light mode') : t('shell.dark_mode', 'Switch to night mode')}
        >
          {isDarkMode ? <Sun size={15} /> : <Moon size={15} className="text-slate-600" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotificationMenu(v => !v)}
            className={`w-9 h-9 rounded-xl border flex items-center justify-center text-slate-700 dark:text-slate-200 shadow-sm relative transition-all ${
              showNotificationMenu
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                : 'bg-slate-50 hover:bg-slate-100 dark:bg-[#16252d] dark:hover:bg-[#1d303b] border-slate-300 dark:border-[#2d424e]'
            }`}
            title={t('topbar.notifications', 'System Notifications')}
            aria-label={t('topbar.notifications', 'System Notifications')}
          >
            <Bell size={16} />
            {unreadNotificationCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-none font-bold absolute -top-1.5 -right-1.5 flex items-center justify-center ring-2 ring-white dark:ring-[#111e24] tabular-nums">
                {unreadNotificationCount > 9 ? `${num(9)}+` : num(unreadNotificationCount)}
              </span>
            )}
          </button>

          {showNotificationMenu && (
            <div
              className={`absolute right-0 top-12 ${
                isNotifExpanded ? 'w-[480px] sm:w-[540px]' : 'w-[360px] sm:w-[410px]'
              } bg-white dark:bg-[#15232b] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-4 z-50 text-xs animate-pop`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">{t('topbar.notifications', 'System Notifications')}</span>
                  {unreadNotificationCount > 0 && (
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                      {num(unreadNotificationCount)} {t('shell.new', 'New')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsNotifExpanded(v => !v)}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                    title={isNotifExpanded ? t('shell.compact', 'Compact window') : t('shell.expand_window', 'Expand window')}
                  >
                    {isNotifExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>

                  {unreadNotificationCount > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-[11px] text-[#0f4a3c] dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                      title={t('topbar.mark_all_read', 'Mark all read')}
                    >
                      <CheckCheck size={13} />
                      <span className="hidden sm:inline">{t('topbar.mark_all_read', 'Mark all read')}</span>
                    </button>
                  )}

                  <button
                    onClick={closeNotif}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    title={t('common.close', 'Close')}
                    aria-label={t('common.close', 'Close')}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="pt-3 pb-2">
                <ChipTabs value={notifFilter} onChange={setNotifFilter} ariaLabel={t('topbar.notifications', 'System Notifications')}
                  items={[
                    { key: 'all' as const, label: t('common.all', 'All'), count: num((notifications || []).length) },
                    { key: 'warning' as const, label: t('shell.attention', 'Attention') },
                    { key: 'info' as const, label: t('shell.updates', 'Updates') },
                  ]} />
              </div>

              <div className={`space-y-2.5 mt-1 overflow-y-auto pr-1 ${isNotifExpanded ? 'max-h-[460px]' : 'max-h-[340px]'}`}>
                {filteredNotifs.map(n => (
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
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100 min-w-0">
                        {n.type === 'warning' ? (
                          <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                        ) : (
                          <CheckCircle size={13} className="text-emerald-600 shrink-0" />
                        )}
                        <span>{n.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{formatDate(n.createdAt)}</span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mb-2">{n.message}</p>

                    <div className="flex items-center justify-between text-[11px] font-bold text-[#0f4a3c] dark:text-emerald-400">
                      <span className="flex items-center gap-1 hover:underline">
                        <span>{n.actionLabel}</span>
                        <ArrowRight size={12} />
                      </span>
                      {!n.isRead && (
                        <span className="text-[10px] bg-emerald-600 text-white px-1.5 rounded-md font-bold">{t('shell.unread', 'Unread')}</span>
                      )}
                    </div>
                  </div>
                ))}

                {filteredNotifs.length === 0 && (
                  <div className="text-center py-8 text-slate-400">{t('topbar.no_notifications', 'No new notifications. Everything is in order.')}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Backup */}
        <button
          onClick={() => setActiveTab('backup')}
          className={`h-9 flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-semibold ${iconBtn}`}
          title={t('shell.backup_title', 'Open Backup & Restore')}
        >
          <Database size={14} className="text-[#0f4a3c] dark:text-emerald-400" />
          <span className="hidden 2xl:inline">{t('topbar.backup', 'Backup')}</span>
        </button>

        {/* Record payment */}
        <button
          onClick={() => setOpenRecordModal(true)}
          className="btn btn-primary !h-9 !px-4 !text-xs"
        >
          <Plus size={15} strokeWidth={2.5} />
          <span>{t('topbar.record_payment', 'Record payment')}</span>
        </button>

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setShowProfileMenu(v => !v)}
            title={currentUser ? `${bnName(currentUser.full_name, currentUser.full_name_bn)} · ${tv(currentUser.role)}` : t('nav.profile', 'My profile')}
            aria-label={t('shell.profile_menu', 'Account menu')}
            aria-haspopup="menu"
            aria-expanded={showProfileMenu}
            className={`rounded-xl p-0.5 transition-all ring-2 ${showProfileMenu ? 'ring-emerald-500' : 'ring-transparent hover:ring-slate-300 dark:hover:ring-slate-600'}`}
          >
            <UserAvatar user={currentUser} className="w-8 h-8 rounded-[6px]" />
          </button>
          {showProfileMenu && <ProfileMenu onClose={closeProfile} className="absolute right-0 top-12 w-64" />}
        </div>
      </div>
    </header>
  );
};
