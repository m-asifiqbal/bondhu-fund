import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard,
  Receipt,
  Banknote,
  PlusCircle,
  Users,
  TrendingUp,
  FileSpreadsheet,
  Database,
  UserCheck,
  HardDriveDownload,
  Settings,
  ChevronsUpDown,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NavTab } from '../../types';

interface NavSection {
  titleEn: string;
  titleBn: string;
  items: { id: NavTab; labelKey: string; defaultEn: string; defaultBn: string; icon: any }[];
}

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, currentUser, users, setCurrentUser, showToast, language, t } = useApp();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user switcher dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  const navSections: NavSection[] = [
    {
      titleEn: 'PLATFORM',
      titleBn: 'মূল প্ল্যাটফর্ম',
      items: [
        { id: 'overview', labelKey: 'nav.overview', defaultEn: 'Dashboard', defaultBn: 'ড্যাশবোর্ড', icon: LayoutDashboard },
        { id: 'collections', labelKey: 'nav.collections', defaultEn: 'Collections', defaultBn: 'মাসিক চাঁদা', icon: Banknote },
        { id: 'members', labelKey: 'nav.members', defaultEn: 'Members', defaultBn: 'সদস্যবৃন্দ', icon: Users },
        { id: 'expenses', labelKey: 'nav.expenses', defaultEn: 'Operating Expenses', defaultBn: 'পরিচালনা ব্যয়', icon: Receipt },
        { id: 'entry', labelKey: 'nav.entry', defaultEn: 'Entry Center', defaultBn: 'তথ্য এন্ট্রি', icon: PlusCircle },
      ],
    },
    {
      titleEn: 'PORTFOLIO',
      titleBn: 'পোর্টফোলিও',
      items: [
        { id: 'investments', labelKey: 'nav.investments', defaultEn: 'Investments', defaultBn: 'বিনিয়োগ পোর্টফোলিও', icon: TrendingUp },
        { id: 'reports', labelKey: 'nav.reports', defaultEn: 'Reports & Export', defaultBn: 'রিপোর্ট ও রপ্তানি', icon: FileSpreadsheet },
      ],
    },
    {
      titleEn: 'ADMINISTRATION',
      titleBn: 'প্রশাসন ও সিস্টেম',
      items: [
        { id: 'master', labelKey: 'nav.master', defaultEn: 'Master Data', defaultBn: 'মাস্টার ডাটা', icon: Database },
        { id: 'users', labelKey: 'nav.users', defaultEn: 'User Creation', defaultBn: 'ব্যবহারকারী তৈরি', icon: UserCheck },
        { id: 'backup', labelKey: 'nav.backup', defaultEn: 'Backup & Restore', defaultBn: 'ব্যাকআপ ও রিস্টোর', icon: HardDriveDownload },
        { id: 'settings', labelKey: 'nav.settings', defaultEn: 'Settings', defaultBn: 'সেটিংস', icon: Settings },
      ],
    },
  ];

  return (
    <aside
      className={`${
        isCollapsed ? 'w-20' : 'w-64'
      } bg-white dark:bg-[#101b21] text-slate-700 dark:text-slate-300 flex flex-col justify-between shrink-0 h-screen select-none border-r border-slate-200/90 dark:border-[#22353f] transition-all duration-200`}
    >
      {/* Top Branding & Collapse */}
      <div>
        <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center font-black text-xs tracking-wide shadow-sm shrink-0">
              BF
            </div>
            {!isCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight truncate">
                  {language === 'bn' ? 'বন্ধু ফান্ড' : 'Bondhu Fund'}
                </span>
                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {language === 'bn' ? 'ইউনিয়ন ফাইন্যান্স ডেস্ক' : 'Union Finance Desk'}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Categorized Nav Sections */}
        <nav className="p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
          {navSections.map(section => (
            <div key={section.titleEn} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase">
                  {language === 'bn' ? section.titleBn : section.titleEn}
                </div>
              )}
              {section.items.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const label = language === 'bn' ? item.defaultBn : item.defaultEn;

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    title={isCollapsed ? label : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center px-2' : 'gap-3 px-3'
                    } py-2 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon
                      size={16}
                      strokeWidth={isActive ? 2.3 : 1.9}
                      className={isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 shrink-0'}
                    />
                    {!isCollapsed && <span className="truncate">{label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom User Profile */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800 relative" ref={userMenuRef}>
        <div
          onClick={() => setShowUserMenu(!showUserMenu)}
          className={`flex items-center ${
            isCollapsed ? 'justify-center p-2' : 'justify-between p-2'
          } rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700`}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {currentUser?.avatar_initials || 'NJ'}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col text-left truncate">
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {currentUser?.full_name || 'Nusrat Jahan'}
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">
                  {currentUser?.role || 'Treasurer'}
                </span>
              </div>
            )}
          </div>
          {!isCollapsed && (
            <ChevronsUpDown size={15} className="text-slate-400 shrink-0" />
          )}
        </div>

        {/* User Switcher Dropdown */}
        {showUserMenu && (
          <div className="absolute bottom-16 left-3 right-3 bg-white dark:bg-[#16252d] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2 py-1.5 font-bold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 mb-1 text-[10px] uppercase tracking-wider">
              {language === 'bn' ? 'ব্যবহারকারী পরিবর্তন' : 'Switch Active User'}
            </div>
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => {
                  setCurrentUser(u);
                  setShowUserMenu(false);
                  showToast(
                    language === 'bn'
                      ? `সক্রিয় ব্যবহারকারী হিসেবে ${u.full_name} (${u.role}) নির্বাচিত!`
                      : `Switched active user to ${u.full_name} (${u.role})`
                  );
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left text-slate-800 dark:text-slate-200 transition-colors font-medium"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">
                    {u.avatar_initials}
                  </span>
                  <span>{u.full_name}</span>
                  <span className="text-[10px] text-slate-400 font-mono">({u.role})</span>
                </div>
                {currentUser?.id === u.id && <Check size={14} className="text-emerald-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
