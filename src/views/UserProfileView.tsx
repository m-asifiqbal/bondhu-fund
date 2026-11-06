import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AtSign, BadgeCheck, Banknote, Briefcase, Calendar, Camera, Clock, FileText, Loader2, Mail, MapPin,
  Pencil, Phone, Receipt, Repeat2, ShieldCheck, KeyRound, Lock, Trash2, UserPlus, UserRound, Users, BarChart3, ListChecks, History,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getUserProfile, updateUser } from '../services/db';
import { imageFileToDataUrl } from '../utils/image';
import { addMonths, currentMonthKey, MONTH_SHORT, BN_MONTHS } from '../utils/date';
import { AppUser, UserProfile, UserRole, UserStatus } from '../types';
import { Modal } from '../components/common/Modal';
import { ChangePasswordPrompt } from './LoginScreen';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { UserAvatar } from '../components/layout/Sidebar';

export const USER_ROLES: UserRole[] = ['Admin', 'Treasurer', 'Auditor', 'Manager'];

export const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
};

export const ROLE_BADGE: Record<string, string> = {
  Admin: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  Treasurer: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  Auditor: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  Manager: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

/** Translated labels for audit-log action / entity codes. */
export function useAuditLabels() {
  const { t } = useApp();
  return useMemo(() => ({
    action: (a: string) => t(`admin.act_${a}`, cap(a)),
    entity: (e: string) => t(`admin.ent_${e}`, cap(e)),
  }), [t]);
}

/** '2026-11-05 14:22:10' -> date + HH:MM (language aware). */
export function useStamp() {
  const { formatDate, language, toBanglaDigits } = useApp();
  return useCallback((s?: string | null) => {
    if (!s) return '—';
    const time = s.length > 10 ? s.slice(11, 16) : '';
    const tt = time && language === 'bn' ? toBanglaDigits(time) : time;
    return `${formatDate(s.slice(0, 10))}${tt ? ` · ${tt}` : ''}`;
  }, [formatDate, language, toBanglaDigits]);
}

const ACTION_STYLE: Record<string, string> = {
  create: 'bg-emerald-500', payment: 'bg-teal-500', update: 'bg-blue-500', delete: 'bg-rose-500', void: 'bg-rose-500',
  import: 'bg-violet-500', backup: 'bg-amber-500', reset: 'bg-rose-600', demo: 'bg-slate-400',
};

interface EditForm { full_name: string; email: string; phone: string; designation: string; address: string; bio: string }

export const UserProfileView: React.FC = () => {
  const {
    t, tv, language, formatCurrency, toBanglaDigits, formatDate, currentUser, isAdmin, profileUserId,
    refreshKey, triggerRefresh, showToast, setActiveTab,
  } = useApp();
  const labels = useAuditLabels();
  const stamp = useStamp();
  const num = useCallback((n: number) => (language === 'bn' ? toBanglaDigits(n.toLocaleString()) : n.toLocaleString()), [language, toBanglaDigits]);

  const userId = profileUserId ?? currentUser?.id ?? null;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [form, setForm] = useState<EditForm>({ full_name: '', email: '', phone: '', designation: '', address: '', bio: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (userId == null) { setLoading(false); setProfile(null); return; }
    let alive = true;
    setLoading(true);
    getUserProfile(userId)
      .then(p => { if (alive) { setProfile(p); setError(null); } })
      .catch(e => { if (alive) { setError(e.message); setProfile(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, refreshKey]);

  const user = profile?.user;
  const isSelf = !!user && user.id === currentUser?.id;
  const isSystem = !!user?.is_system;
  // own profile, or an Admin editing a normal (non-system) user
  const canEdit = isSelf || (isAdmin && !isSystem);
  const [pwOpen, setPwOpen] = useState(false);

  const roleOptions = useMemo(() => USER_ROLES.map(r => ({ value: r, label: tv(r) })), [tv]);
  const statusOptions = useMemo(() => (['Active', 'Inactive'] as UserStatus[]).map(s => ({ value: s, label: tv(s) })), [tv]);

  const months = useMemo(() => {
    const map = new Map((profile?.monthly || []).map(m => [m.month, Number(m.count) || 0]));
    const now = currentMonthKey();
    const list = Array.from({ length: 12 }, (_, i) => {
      const key = addMonths(now, i - 11);
      const mi = Number(key.slice(5, 7)) - 1;
      return { key, count: map.get(key) || 0, short: language === 'bn' ? BN_MONTHS[mi] : MONTH_SHORT[mi], year: key.slice(0, 4) };
    });
    const max = Math.max(1, ...list.map(m => m.count));
    return { list, max, total: list.reduce((s, m) => s + m.count, 0) };
  }, [profile?.monthly, language]);

  const byActionMax = useMemo(() => Math.max(1, ...(profile?.byAction || []).map(a => Number(a.count) || 0)), [profile?.byAction]);

  const save = async (patch: Partial<AppUser>, okMsg: string) => {
    if (!user) return false;
    try {
      await updateUser(user.id, patch);
      showToast(okMsg);
      triggerRefresh();
      return true;
    } catch (e: any) {
      showToast(e.message, 'error');
      return false;
    }
  };

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setPhotoBusy(true);
    try {
      const avatar = await imageFileToDataUrl(file, { maxSize: 320, square: true });
      await save({ avatar }, t('admin.photo_updated', 'Profile photo updated.'));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    await save({ avatar: '' }, t('admin.photo_removed', 'Profile photo removed.'));
    setPhotoBusy(false);
    setConfirmRemove(false);
  };

  const openEdit = () => {
    if (!user) return;
    setForm({
      full_name: user.full_name || '', email: user.email || '', phone: user.phone || '',
      designation: user.designation || '', address: user.address || '', bio: user.bio || '',
    });
    setEditOpen(true);
  };

  const submitEdit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!form.full_name.trim()) { showToast(t('admin.name_required', 'Full name is required.'), 'error'); return; }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { showToast(t('admin.email_invalid', 'Enter a valid email address.'), 'error'); return; }
    setSaving(true);
    const ok = await save({
      full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim(),
      designation: form.designation.trim(), address: form.address.trim(), bio: form.bio.trim(),
      avatar_initials: initialsOf(form.full_name),
    }, t('admin.profile_saved', 'Profile saved.'));
    setSaving(false);
    if (ok) setEditOpen(false);
  };

  const changeRole = async (role: UserRole) => {
    if (!user || role === user.role) return;
    setAdminBusy(true);
    await save({ role }, `${t('admin.role_changed', 'Role changed')}: ${user.full_name} → ${tv(role)}`);
    setAdminBusy(false);
  };

  const changeStatus = async (status: UserStatus) => {
    if (!user || status === user.status) return;
    if (isSelf && status === 'Inactive') {
      showToast(t('admin.cant_deactivate_self', 'You cannot deactivate the profile you are using. Switch to another profile first.'), 'error');
      return;
    }
    setAdminBusy(true);
    await save({ status }, `${t('admin.status_changed', 'Status changed')}: ${user.full_name} → ${tv(status)}`);
    setAdminBusy(false);
  };


  // ---------------------------------------------------------------- states
  if (loading && !profile) {
    return (
      <div className="p-6 lg:p-8 max-w-[1680px] mx-auto space-y-6 animate-pulse">
        <div className="card-base h-56" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{[0, 1, 2, 3, 4].map(i => <div key={i} className="card-base h-24" />)}</div>
        <div className="card-base h-64" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 flex justify-center">
        <div className="card-base max-w-md w-full p-8 text-center text-xs">
          <UserRound size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h2 className="text-base font-black text-slate-900 dark:text-white">{t('admin.profile_not_found', 'Profile not available')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{error || t('admin.profile_not_found_desc', 'This user could not be found. It may have been deleted.')}</p>
          <button onClick={() => setActiveTab('users')} className="btn btn-outline mt-4">
            {t('admin.go_users', 'Go to Users & Roles')}
          </button>
        </div>
      </div>
    );
  }

  const stats = profile!.stats;
  const tiles = [
    { icon: Activity, label: t('admin.stat_total_actions', 'Total actions'), value: num(stats.totalActions), tone: 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800' },
    { icon: Banknote, label: t('admin.stat_payments', 'Payments recorded'), value: num(stats.paymentsRecorded), tone: 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/50' },
    { icon: BadgeCheck, label: t('admin.stat_collected', 'Amount collected'), value: formatCurrency(stats.amountCollected || 0), tone: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50' },
    { icon: Receipt, label: t('admin.stat_expenses', 'Expenses entered'), value: num(stats.expensesEntered), tone: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50' },
    { icon: UserPlus, label: t('admin.stat_members', 'Members added'), value: num(stats.membersAdded), tone: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50' },
  ];

  const details: Array<{ icon: any; label: string; value?: string | null; mono?: boolean; multiline?: boolean }> = [
    { icon: AtSign, label: t('admin.username', 'Username'), value: user.username, mono: true },
    { icon: Mail, label: t('admin.email', 'Email'), value: user.email },
    { icon: Phone, label: t('admin.phone', 'Phone'), value: user.phone },
    { icon: Briefcase, label: t('admin.designation', 'Designation'), value: user.designation },
    { icon: MapPin, label: t('admin.address', 'Address'), value: user.address, multiline: true },
    { icon: FileText, label: t('admin.bio', 'About'), value: user.bio, multiline: true },
  ];

  const btnSoft = 'btn btn-outline';
  const btnPrimary = 'btn btn-primary';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto text-xs">
      {/* Hero */}
      <div className="card-base overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-emerald-700 via-teal-700 to-slate-800 dark:from-emerald-900 dark:via-teal-900 dark:to-slate-900 relative">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_20%,white_0,transparent_45%)]" />
        </div>
        <div className="px-6 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4 -mt-14">
            <div className="relative shrink-0 self-start">
              <UserAvatar user={user} className="w-28 h-28 rounded-3xl ring-4 ring-white dark:ring-[#142026] shadow-lg" textClass="text-3xl" />
              {photoBusy && (
                <div className="absolute inset-0 rounded-3xl bg-black/40 flex items-center justify-center">
                  <Loader2 size={24} className="text-white animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                title={t('admin.change_photo', 'Change photo')}
                aria-label={t('admin.change_photo', 'Change photo')}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow flex items-center justify-center text-brand dark:text-emerald-400 hover:scale-105 transition-transform"
              >
                <Camera size={16} />
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" onChange={onPickPhoto} />
            </div>

            <div className="flex flex-wrap gap-2 pb-1">
              {user.avatar && (
                <button type="button" onClick={() => setConfirmRemove(true)} disabled={photoBusy} className="btn btn-danger-outline">
                  <Trash2 size={14} /> {t('admin.remove_photo', 'Remove photo')}
                </button>
              )}
              {isSelf && !isSystem && (
                <button type="button" onClick={() => setPwOpen(true)} className={btnSoft}>
                  <KeyRound size={14} /> {t('shell.change_password', 'Change password')}
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className={btnSoft}>
                  <Camera size={14} /> {t('admin.change_photo', 'Change photo')}
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={openEdit} className="btn btn-primary">
                  <Pencil size={14} /> {t('admin.edit_profile', 'Edit profile')}
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight break-words">{user.full_name}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${ROLE_BADGE[user.role] || ROLE_BADGE.Manager}`}>{tv(user.role)}</span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${user.status === 'Active'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${user.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {tv(user.status)}
              </span>
              {isSelf && <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-600 text-white">{t('admin.you', 'You')}</span>}
            </div>
            {user.designation && <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mt-1">{user.designation}</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2.5 text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-mono"><AtSign size={13} />{user.username}</span>
              <span className="flex items-center gap-1.5"><Calendar size={13} />{t('admin.member_since', 'Member since')} {formatDate(user.created_at)}</span>
              <span className="flex items-center gap-1.5"><Clock size={13} />{t('admin.last_activity', 'Last activity')}: {stats.lastActivity ? stamp(stats.lastActivity) : t('admin.never', 'No activity yet')}</span>
            </div>
          </div>

        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {tiles.map((tile, ti) => (
          <div key={tile.label} className={`card-base p-4 flex items-start gap-3 accent-${["purple","green","rose","blue","amber","teal"][ti % 6]}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tile.tone}`}><tile.icon size={18} /></div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 leading-tight">{tile.label}</div>
              <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5 break-words">{tile.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: details + admin */}
        <div className="space-y-6">
          <div className="card-base p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserRound size={16} className="text-brand dark:text-emerald-400" />{t('admin.contact_details', 'Contact & details')}
              </h3>
              <button type="button" onClick={openEdit} className="btn btn-outline"
                title={t('common.edit', 'Edit')} aria-label={t('common.edit', 'Edit')}>
                <Pencil size={14} />
              </button>
            </div>
            <dl className="space-y-3.5">
              {details.map(d => (
                <div key={d.label} className="flex items-start gap-3">
                  <d.icon size={15} className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <dt className="text-[10px] uppercase tracking-wide font-bold text-slate-400 dark:text-slate-500">{d.label}</dt>
                    <dd className={`mt-0.5 text-slate-800 dark:text-slate-200 break-words ${d.mono ? 'font-mono' : 'font-medium'} ${d.multiline ? 'whitespace-pre-line leading-relaxed' : ''}`}>
                      {d.value ? d.value : <span className="italic text-slate-400 dark:text-slate-500 font-normal">{t('admin.not_set', 'Not set')}</span>}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>

          {isSystem && (
            <div className="card-base p-5 border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20">
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2"><Lock size={15} />{t('admin.system_title', 'Protected system account')}</h3>
              <p className="mt-1.5 text-amber-800/80 dark:text-amber-200/80">{t('admin.system_desc', 'Fixed password. Cannot be deleted, deactivated or edited by other users. This is the only account that can upload data (Excel / bulk member import).')}</p>
            </div>
          )}

          {!isSelf && isAdmin && !isSystem && (
            <div className="card-base p-5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
                <ShieldCheck size={16} className="text-brand dark:text-emerald-400" />{t('admin.access', 'Access & role')}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mb-4">{t('admin.access_desc', 'Changes are saved immediately and recorded in the activity log.')}</p>
              <div className="space-y-4">
                <div>
                  <label className="form-label">{t('admin.role', 'Role')}</label>
                  <SearchableSelect options={roleOptions} value={user.role} onChange={v => changeRole(v as UserRole)} disabled={adminBusy} />
                </div>
                <div>
                  <label className="form-label">{t('admin.status', 'Status')}</label>
                  <SearchableSelect options={statusOptions} value={user.status} onChange={v => changeStatus(v as UserStatus)} disabled={adminBusy} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: chart, breakdown, timeline */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card-base p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart3 size={16} className="text-brand dark:text-emerald-400" />{t('admin.activity_12m', 'Activity — last 12 months')}
              </h3>
              <span className="text-slate-500 dark:text-slate-400">{num(months.total)} {t('admin.actions_word', 'actions')}</span>
            </div>
            {months.total === 0 ? (
              <div className="h-40 flex items-center justify-center text-slate-400 dark:text-slate-500">{t('admin.no_activity_period', 'No activity in the last 12 months.')}</div>
            ) : (
              <div className="flex items-end gap-1.5 sm:gap-2 h-44" role="img" aria-label={t('admin.activity_12m', 'Activity — last 12 months')}>
                {months.list.map(m => {
                  const pct = (m.count / months.max) * 100;
                  return (
                    <div key={m.key} className="flex-1 min-w-0 flex flex-col items-center gap-1.5 h-full group" title={`${m.short} ${language === 'bn' ? toBanglaDigits(m.year) : m.year}: ${num(m.count)}`}>
                      <div className="flex-1 w-full flex flex-col justify-end items-center">
                        {m.count > 0 && <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{num(m.count)}</span>}
                        <div
                          className={`w-full max-w-[34px] rounded-t-md transition-all ${m.count ? 'bg-gradient-to-t from-emerald-600 to-teal-400 dark:from-emerald-700 dark:to-teal-500 group-hover:from-emerald-500' : 'bg-slate-100 dark:bg-slate-800'}`}
                          style={{ height: `${m.count ? Math.max(pct, 4) : 3}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate w-full text-center">{m.short}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="card-base p-5 xl:col-span-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <ListChecks size={16} className="text-brand dark:text-emerald-400" />{t('admin.by_action', 'Work breakdown')}
              </h3>
              {profile!.byAction.length === 0 ? (
                <p className="text-slate-400 dark:text-slate-500 py-6 text-center">{t('admin.no_activity', 'No activity recorded yet.')}</p>
              ) : (
                <ul className="space-y-3">
                  {profile!.byAction.slice(0, 10).map(a => (
                    <li key={`${a.action}-${a.entity}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="flex items-center gap-2 min-w-0 font-semibold text-slate-700 dark:text-slate-200">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ACTION_STYLE[a.action] || 'bg-slate-400'}`} />
                          <span className="truncate">{labels.action(a.action)} · {labels.entity(a.entity)}</span>
                        </span>
                        <span className="font-black text-slate-900 dark:text-white">{num(Number(a.count) || 0)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full rounded-full ${ACTION_STYLE[a.action] || 'bg-slate-400'}`} style={{ width: `${((Number(a.count) || 0) / byActionMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card-base p-5 xl:col-span-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                <History size={16} className="text-brand dark:text-emerald-400" />{t('admin.recent_activity', 'Recent activity')}
              </h3>
              {profile!.recent.length === 0 ? (
                <div className="py-8 text-center text-slate-400 dark:text-slate-500">
                  <Users size={28} className="mx-auto mb-2 opacity-60" />
                  {t('admin.no_activity', 'No activity recorded yet.')}
                </div>
              ) : (
                <ol className="relative max-h-[420px] overflow-y-auto pr-1">
                  {profile!.recent.map((a, i) => (
                    <li key={a.id} className="relative pl-6 pb-4">
                      {i < profile!.recent.length - 1 && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />}
                      <span className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-2 ring-white dark:ring-[#142026] ${ACTION_STYLE[a.action] || 'bg-slate-400'}`} />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {labels.action(a.action)} · <span className="font-semibold text-slate-600 dark:text-slate-300">{labels.entity(a.entity)}</span>
                          {a.entity_id != null && <span className="text-slate-400 font-normal"> #{language === 'bn' ? toBanglaDigits(a.entity_id) : a.entity_id}</span>}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{stamp(a.at)}</span>
                      </div>
                      {a.details && <p className="text-slate-500 dark:text-slate-400 mt-0.5 break-words">{a.details}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        locked={saving}
        size="lg"
        icon={<Pencil size={18} />}
        title={t('admin.edit_profile', 'Edit profile')}
        subtitle={user.full_name}
        footer={
          <>
            <button type="button" onClick={() => setEditOpen(false)} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="submit" form="profile-edit-form" disabled={saving || !form.full_name.trim()} className="btn btn-primary">
              {saving ? t('common.saving', 'Saving…') : t('common.save_changes', 'Save changes')}
            </button>
          </>
        }
      >
        <form id="profile-edit-form" onSubmit={submitEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="form-label">{t('admin.full_name', 'Full name')} *</label>
            <input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.designation', 'Designation')}</label>
            <input className="form-input" value={form.designation} placeholder={t('admin.designation_ph', 'e.g. Cashier, Committee member')}
              onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.email', 'Email')}</label>
            <input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.phone', 'Phone')}</label>
            <input type="tel" className="form-input" value={form.phone} placeholder="01XXXXXXXXX" onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">{t('admin.address', 'Address')}</label>
            <textarea rows={2} className="form-input min-h-[64px] py-2.5" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">{t('admin.bio', 'About')}</label>
            <textarea rows={3} maxLength={500} className="form-input min-h-[84px] py-2.5" value={form.bio} placeholder={t('admin.bio_ph', 'A short note about this person and their responsibilities')}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
          </div>
        </form>
      </Modal>

      {/* Remove photo confirm */}
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        locked={photoBusy}
        size="sm" tone="danger"
        icon={<Trash2 size={18} />}
        title={t('admin.remove_photo', 'Remove photo')}
        footer={
          <>
            <button type="button" onClick={() => setConfirmRemove(false)} disabled={photoBusy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" onClick={removePhoto} disabled={photoBusy}
              className="btn btn-danger">
              {t('common.remove', 'Remove')}
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-300">{t('admin.remove_photo_confirm', 'The profile photo will be removed and initials shown instead.')}</p>
      </Modal>
      <ChangePasswordPrompt open={pwOpen} onDone={() => setPwOpen(false)} />
    </div>
  );
};

export default UserProfileView;
