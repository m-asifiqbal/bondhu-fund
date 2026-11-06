import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { LogoMark } from '../common/LogoMark';
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
  UserCircle2,
  UsersRound,
  Lock,
  KeyRound,
  Coins,
  LogOut,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { ChangePasswordPrompt } from '../../views/LoginScreen';
import { useApp } from '../../context/AppContext';
import { AppUser, NavTab } from '../../types';

const COLLAPSE_KEY = 'bondhu_sidebar_collapsed';
const NARROW_QUERY = '(max-width: 1279px)';

/** User photo, or initials on a brand gradient. Size/shape via className. */
export const UserAvatar: React.FC<{
  user?: Pick<AppUser, 'avatar' | 'avatar_initials' | 'full_name'> | null;
  className?: string;
  textClass?: string;
}> = ({ user, className = 'w-8 h-8 rounded-lg', textClass = 'text-xs' }) =>
  user?.avatar ? (
    <img src={user.avatar} alt={user.full_name} draggable={false} className={`${className} object-cover shrink-0 bg-slate-100 dark:bg-slate-800`} />
  ) : (
    <div className={`${className} ${textClass} shrink-0 bg-gradient-to-br from-emerald-600 to-teal-800 text-white font-bold flex items-center justify-center select-none`}>
      {user?.avatar_initials || '?'}
    </div>
  );

/** Shared popover for the signed-in user: my profile, change password, sign out (used by Sidebar and TopBar). */
export const ProfileMenu: React.FC<{ onClose: () => void; className?: string }> = ({ onClose, className = '' }) => {
  const { currentUser, openProfile, t, tv, bnName } = useApp();
  const item = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-800 dark:text-slate-200';

  return (
    <div className={`bg-white dark:bg-[#16252d] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-2 z-50 text-xs animate-pop ${className}`}>
      {currentUser && (
        <div className="flex items-center gap-3 px-2 py-2.5 mb-1 border-b border-slate-100 dark:border-slate-800">
          <UserAvatar user={currentUser} className="w-10 h-10 rounded-xl" textClass="text-sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-slate-900 dark:text-white truncate" title={bnName(currentUser.full_name, currentUser.full_name_bn)}>{bnName(currentUser.full_name, currentUser.full_name_bn)}</span>
              {!!currentUser.is_system && (
                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-bold uppercase">
                  <Lock size={9} />{t('shell.system_badge', 'System')}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{tv(currentUser.role)}{currentUser.designation ? ` · ${currentUser.designation}` : ''}</div>
          </div>
        </div>
      )}
      <button type="button" onClick={() => { openProfile(); onClose(); }} className={item}>
        <UserCircle2 size={15} className="text-brand dark:text-emerald-400" />
        {t('nav.profile', 'My profile')}
      </button>
      {currentUser && !currentUser.is_system && (
        <button type="button" onClick={() => { window.dispatchEvent(new Event(PW_EVENT)); onClose(); }} className={item}>
          <KeyRound size={15} className="text-brand dark:text-emerald-400" />
          {t('shell.change_password', 'Change password')}
        </button>
      )}
      <button type="button" onClick={() => { window.dispatchEvent(new Event(SIGNOUT_EVENT)); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 mt-1 border-t border-slate-100 dark:border-slate-800 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-left font-semibold text-rose-600 dark:text-rose-400">
        <LogOut size={15} />
        {t('shell.sign_out', 'Sign out')}
      </button>
    </div>
  );
};

const PW_EVENT = 'bondhu:change-password';
const SIGNOUT_EVENT = 'bondhu:sign-out';

/**
 * Dialogs opened from ProfileMenu. Mounted once (in Sidebar) so they survive the popover closing.
 */
const AccountDialogs: React.FC = () => {
  const { signOut, t } = useApp();
  const [pwOpen, setPwOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onPw = () => setPwOpen(true);
    const onOut = () => setConfirmOut(true);
    window.addEventListener(PW_EVENT, onPw);
    window.addEventListener(SIGNOUT_EVENT, onOut);
    return () => { window.removeEventListener(PW_EVENT, onPw); window.removeEventListener(SIGNOUT_EVENT, onOut); };
  }, []);
  const doSignOut = async () => {
    setBusy(true);
    try { await signOut(); } finally { setBusy(false); setConfirmOut(false); }
  };
  return (
    <>
      <ChangePasswordPrompt open={pwOpen} onDone={() => setPwOpen(false)} />
      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} locked={busy} size="sm" tone="warning" icon={<LogOut size={18} />}
        title={t('shell.sign_out_title', 'Sign out?')}
        subtitle={t('shell.sign_out_msg', 'You will need your username and password to sign in again.')}
        footer={<>
          <button type="button" onClick={() => setConfirmOut(false)} disabled={busy} className="btn-secondary-modal">{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={doSignOut} disabled={busy} className="btn-primary-modal">{t('shell.sign_out', 'Sign out')}</button>
        </>}>
        <span />
      </Modal>
    </>
  );
};

/** Close a popover when clicking outside the given element. */
export function useOutsideClose(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, ref, close]);
}

const orgInitials = (name?: string) => {
  const words = (name || '').trim().split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  if (!words.length) return 'BF';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
};

interface NavSection {
  key: string;
  title: string;
  items: { id: NavTab; label: string; icon: any }[];
}

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, currentUser, t, tv, settings, orgName, isAdmin, bnName } = useApp();
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Collapsible icon rail: below 1280px it auto-collapses; on wide screens the user's choice is remembered.
  const [isNarrow, setIsNarrow] = useState(() => !!window.matchMedia && window.matchMedia(NARROW_QUERY).matches);
  const [widePref, setWidePref] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === 'true'; } catch { return false; }
  });
  const [narrowOverride, setNarrowOverride] = useState<boolean | null>(null);
  const isCollapsed = isNarrow ? (narrowOverride ?? true) : widePref;

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => { setIsNarrow(mq.matches); setNarrowOverride(null); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleCollapsed = () => {
    const next = !isCollapsed;
    if (isNarrow) {
      setNarrowOverride(next);
    } else {
      setWidePref(next);
      try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* storage unavailable */ }
    }
  };

  const userMenuRef = useRef<HTMLDivElement>(null);
  const closeMenu = React.useCallback(() => setShowUserMenu(false), []);
  useOutsideClose(userMenuRef, showUserMenu, closeMenu);

  const navSections: NavSection[] = useMemo(() => [
    {
      key: 'platform',
      title: t('shell.section_platform', 'Platform'),
      items: [
        { id: 'overview', label: t('nav.overview', 'Overview'), icon: LayoutDashboard },
        { id: 'collections', label: t('nav.collections', 'Collections'), icon: Banknote },
        { id: 'members', label: t('nav.members', 'Members'), icon: Users },
        { id: 'expenses', label: t('nav.expenses', 'Operating Expenses'), icon: Receipt },
        { id: 'entry', label: t('nav.entry', 'Entry Center'), icon: PlusCircle },
      ],
    },
    {
      key: 'portfolio',
      title: t('shell.section_portfolio', 'Portfolio'),
      items: [
        { id: 'investments', label: t('nav.investments', 'Investments'), icon: TrendingUp },
        { id: 'returns', label: t('nav.returns', 'Investment Returns'), icon: Coins },
        { id: 'reports', label: t('nav.reports', 'Reports & Export'), icon: FileSpreadsheet },
      ],
    },
    {
      key: 'admin',
      title: t('shell.section_admin', 'Administration'),
      items: [
        // Master Data, Users and Settings are Admin-only (also enforced by the main process)
        ...(isAdmin ? [{ id: 'master', label: t('nav.master', 'Master Data'), icon: Database }, { id: 'users', label: t('nav.users', 'Users & Roles'), icon: UserCheck }] : []),
        { id: 'backup', label: t('nav.backup', 'Backup & Restore'), icon: HardDriveDownload },
        ...(isAdmin ? [{ id: 'settings', label: t('nav.settings', 'Settings'), icon: Settings }] : []),
      ],
    },
  ] as NavSection[], [t, isAdmin]);

  const logo = settings?.org_logo;

  // Sliding selection pill: measured from the active item, glides between tabs.
  // Large, readable label next to an icon when the sidebar is collapsed (native title tooltips are tiny).
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
  const showTip = (label: string | undefined) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (!isCollapsed || !label) return;
    const b = e.currentTarget.getBoundingClientRect();
    setTip({ label, x: b.right, y: b.top + b.height / 2 });
  };
  const hideTip = () => setTip(null);
  useEffect(() => { if (!isCollapsed) setTip(null); }, [isCollapsed]);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null);
  const [indReady, setIndReady] = useState(false);
  const activeRef = useRef(activeTab);
  activeRef.current = activeTab;
  const measureInd = () => {
    const b = itemRefs.current[activeRef.current];
    const y = b ? b.offsetTop : -1, h = b ? b.offsetHeight : 0;
    setInd(prev => (b ? (prev && prev.y === y && prev.h === h ? prev : { y, h }) : prev === null ? prev : null));
  };
  const measureIndRef = useRef(measureInd);
  measureIndRef.current = measureInd;
  useLayoutEffect(() => {
    measureInd();
    const id = requestAnimationFrame(() => setIndReady(true));
    return () => cancelAnimationFrame(id);
  }, [activeTab, isCollapsed, navSections]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const run = () => measureIndRef.current();
    const ro = new ResizeObserver(run);
    if (navRef.current) ro.observe(navRef.current);
    (document as any).fonts?.ready?.then(run);
    return () => ro.disconnect();
  }, []);

  return (
    <aside
      className={`${isCollapsed ? 'w-20' : 'w-64'
        } no-print bg-white dark:bg-[#101b21] text-slate-700 dark:text-slate-300 flex flex-col justify-between shrink-0 h-screen select-none border-r border-slate-200/90 dark:border-[#22353f] transition-all duration-200`}
    >
      {/* Top Branding & Collapse */}
      <div className="min-h-0 flex flex-col">
        <div className={`p-4 flex items-center ${isCollapsed ? 'flex-col gap-2' : 'justify-between gap-2'} border-b border-slate-100 dark:border-slate-800/80`}>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            title={orgName}
            className="flex items-center gap-3 min-w-0 text-left"
          >
            {logo ? (
              <LogoMark src={logo} alt={orgName} className="w-10 h-10" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center font-black text-xs tracking-wide shadow-sm shrink-0">
                {orgInitials(settings?.organization_name)}
              </div>
            )}
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-[15.1px] font-black text-slate-900 dark:text-white tracking-tight leading-tight line-clamp-2 break-words">
                  {orgName}
                </span>
                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider truncate">
                  {t('shell.tagline', 'Savings fund manager')}
                </span>
              </div>
            )}
          </button>
          <button
            onClick={toggleCollapsed}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            onMouseEnter={showTip(isCollapsed ? t('shell.expand', 'Expand sidebar') : undefined)}
            onMouseLeave={hideTip}
            title={isCollapsed ? undefined : t('shell.collapse', 'Collapse sidebar')}
            aria-label={isCollapsed ? t('shell.expand', 'Expand sidebar') : t('shell.collapse', 'Collapse sidebar')}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Categorized Nav Sections */}
        <nav ref={navRef} onMouseLeave={hideTip} className={`relative p-3 overflow-y-auto max-h-[calc(100vh-150px)] nav-scroll ${isCollapsed ? 'space-y-5' : 'space-y-7'}`}>
          <span aria-hidden className={`nav-ind ${isCollapsed ? 'nav-ind-collapsed' : ''} ${indReady ? 'nav-ind-anim' : ''}`}
            style={{ transform: `translateY(${ind?.y ?? 0}px)`, height: ind?.h ?? 0, opacity: ind ? 1 : 0 }} />
          {navSections.map((section, si) => (
            <div key={section.key} className={`space-y-1.5 ${si > 0 ? 'nav-section-sep pt-6' : ''}`}>
              {!isCollapsed && (
                <div className="px-3 pb-1 text-[10.8px] font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase">
                  {section.title}
                </div>
              )}
              {section.items.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    ref={el => { itemRefs.current[item.id] = el; }}
                    onClick={() => setActiveTab(item.id)}
                    aria-label={isCollapsed ? item.label : undefined}
                    onMouseEnter={showTip(item.label)}
                    onFocus={showTip(item.label)}
                    onBlur={hideTip}
                    aria-current={isActive ? 'page' : undefined}
                    className={`nav-item ${isCollapsed ? 'nav-item-collapsed' : ''} relative z-[1] flex items-center ${isCollapsed ? 'justify-center' : 'w-full gap-3 px-3'} py-2.5 rounded-xl text-[13px] font-semibold ${isActive ? 'nav-item-active font-bold' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    <Icon size={17} strokeWidth={isActive ? 2.4 : 1.9} className="nav-icon shrink-0" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom User Profile */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800 relative" ref={userMenuRef}>
        <button
          type="button"
          onClick={() => setShowUserMenu(v => !v)}
          title={isCollapsed ? undefined : t('shell.profile_menu', 'Profile & switch user')}
          aria-label={bnName(currentUser?.full_name, currentUser?.full_name_bn)}
          onMouseEnter={showTip(bnName(currentUser?.full_name, currentUser?.full_name_bn))}
          onMouseLeave={hideTip}
          aria-haspopup="menu"
          aria-expanded={showUserMenu}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} p-2 rounded-xl cursor-pointer transition-colors border ${
            showUserMenu || activeTab === 'profile'
              ? 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700'
              : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700'
          }`}
        >
          <span className="flex items-center gap-3 min-w-0">
            <UserAvatar user={currentUser} className="w-8 h-8 rounded-lg" />
            {!isCollapsed && (
              <span className="flex flex-col text-left min-w-0">
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{bnName(currentUser?.full_name, currentUser?.full_name_bn) || '—'}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{tv(currentUser?.role)}</span>
              </span>
            )}
          </span>
          {!isCollapsed && <ChevronsUpDown size={15} className="text-slate-400 shrink-0" />}
        </button>

        {showUserMenu && (
          <ProfileMenu
            onClose={closeMenu}
            className={`absolute ${isCollapsed ? 'bottom-3 left-full ml-2' : 'bottom-16 left-3'} w-64`}
          />
        )}
      </div>
      {isCollapsed && tip && (
        <div role="tooltip" className="nav-tip" style={{ left: tip.x + 14, top: tip.y }}>{tip.label}</div>
      )}
      <AccountDialogs />
    </aside>
  );
};
