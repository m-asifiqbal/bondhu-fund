import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { serial } from '../utils/i18n';
import { UserPlus, Trash2, Pencil, History, Users, KeyRound, Lock, Camera, X, ChevronRight, Search, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getUsers, addUser, updateUser, deleteUser, getAuditLog, setUserPassword } from '../services/db';
import { AppUser, AuditEntry, UserRole, UserStatus } from '../types';
import { Modal } from '../components/common/Modal';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { UserAvatar } from '../components/layout/Sidebar';
import { imageFileToDataUrl } from '../utils/image';
import { USER_ROLES, ROLE_BADGE, initialsOf, useAuditLabels, useStamp } from './UserProfileView';

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

interface AddForm { full_name: string; full_name_bn: string; username: string; email: string; phone: string; designation: string; role: UserRole; password: string; avatar: string }
interface EditForm { full_name: string; full_name_bn: string; email: string; phone: string; designation: string; role: UserRole; status: UserStatus }

const EMPTY_ADD: AddForm = { full_name: '', full_name_bn: '', username: '', email: '', phone: '', designation: '', role: 'Treasurer', password: '', avatar: '' };

const btnSoft = 'btn btn-outline';
const btnPrimary = 'btn btn-primary';

export const UserManagementView: React.FC = () => {
  const { currentUser, isAdmin, showToast, refreshKey, triggerRefresh, t, tv, openProfile, language, toBanglaDigits, bnName } = useApp();
  const labels = useAuditLabels();
  const stamp = useStamp();
  const num = (n: number) => (language === 'bn' ? toBanglaDigits(n) : String(n));

  const [users, setUsers] = useState<AppUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState<AddForm>(EMPTY_ADD);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [edit, setEdit] = useState<EditForm>({ full_name: '', full_name_bn: '', email: '', phone: '', designation: '', role: 'Treasurer', status: 'Active' });
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const roleOptions = useMemo(() => USER_ROLES.map(r => ({ value: r, label: tv(r) })), [tv]);
  const statusOptions = useMemo(() => (['Active', 'Inactive'] as UserStatus[]).map(s => ({ value: s, label: tv(s) })), [tv]);

  const load = useCallback(() => {
    getUsers().then(u => { setUsers(u); setLoadError(null); }).catch(e => setLoadError(e.message));
    getAuditLog(100).then(setAudit).catch(() => setAudit([]));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => [u.full_name, u.full_name_bn, u.username, u.email, u.phone, u.designation, u.role].some(v => (v || '').toLowerCase().includes(q)));
  }, [users, query]);

  const done = (msg: string) => {
    showToast(msg);
    triggerRefresh();
  };

  const uname = add.username.trim().toLowerCase();
  const usernameRule = t('admin.username_rule', '3–32 characters: lowercase letters, digits, dot, underscore or hyphen');
  const usernameError = add.username && !USERNAME_RE.test(uname);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const avatar = await imageFileToDataUrl(file, { maxSize: 320, square: true });
      setAdd(a => ({ ...a, avatar }));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!add.full_name.trim()) { showToast(t('admin.name_required', 'Full name is required.'), 'error'); return; }
    if (!USERNAME_RE.test(uname)) { showToast(usernameRule, 'error'); return; }
    if (add.password.length < 6) { showToast(t('admin.pw_rule', 'Password must be at least 6 characters.'), 'error'); return; }
    setBusy(true);
    try {
      const newId = await addUser({
        username: uname,
        full_name: add.full_name.trim(),
        full_name_bn: add.full_name_bn.trim() || undefined,
        email: add.email.trim(),
        phone: add.phone.trim(),
        designation: add.designation.trim(),
        role: add.role,
        avatar: add.avatar || undefined,
        avatar_initials: initialsOf(add.full_name),
        status: 'Active',
      });
      await setUserPassword(newId, add.password);
      done(`${t('admin.user_created', 'User created')}: ${add.full_name.trim()} (${tv(add.role)})`);
      setAdd(EMPTY_ADD);
      setAddOpen(false);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (u: AppUser) => {
    setEditUser(u);
    setEdit({ full_name: u.full_name, full_name_bn: u.full_name_bn || '', email: u.email || '', phone: u.phone || '', designation: u.designation || '', role: u.role, status: u.status });
  };

  const saveEdit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const u = editUser;
    if (!u) return;
    if (!edit.full_name.trim()) { showToast(t('admin.name_required', 'Full name is required.'), 'error'); return; }
    if (u.id === currentUser?.id && edit.status === 'Inactive') {
      showToast(t('admin.cant_deactivate_self', 'You cannot deactivate the profile you are using. Switch to another profile first.'), 'error');
      return;
    }
    setBusy(true);
    try {
      await updateUser(u.id, {
        full_name: edit.full_name.trim(),
        full_name_bn: edit.full_name_bn.trim(),
        email: edit.email.trim(),
        phone: edit.phone.trim(),
        designation: edit.designation.trim(),
        role: edit.role,
        status: edit.status,
        avatar_initials: initialsOf(edit.full_name),
      });
      setEditUser(null);
      done(`${t('admin.user_updated', 'User updated')}: ${edit.full_name.trim()}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    const u = deleteTarget;
    if (!u) return;
    setBusy(true);
    try {
      await deleteUser(u.id);
      setDeleteTarget(null);
      done(`${t('admin.user_deleted', 'User deleted')}: ${u.full_name}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ---- admin: set another user's password ----
  const [pwTarget, setPwTarget] = useState<AppUser | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const savePassword = async () => {
    if (!pwTarget) return;
    if (pw1 !== pw2) { showToast(t('auth.mismatch', 'The new passwords do not match.'), 'error'); return; }
    setPwBusy(true);
    try {
      await setUserPassword(pwTarget.id, pw1);
      showToast(`${t('admin.password_set', 'Password set for')} ${pwTarget.full_name}`);
      setPwTarget(null); triggerRefresh();
    } catch (err: any) { showToast(err.message, 'error'); } finally { setPwBusy(false); }
  };

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto text-xs">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('admin.users_title', 'Users & Roles')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('admin.users_subtitle', 'Profiles who use this computer. Every change is recorded in the activity log under the active profile.')}
          </p>
        </div>
        <button type="button" onClick={() => { setAdd(EMPTY_ADD); setAddOpen(true); }} className={btnPrimary}>
          <UserPlus size={15} /> {t('admin.add_user', 'Add user')}
        </button>
      </div>

      {/* Directory */}
      <div className="card-base overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-brand dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('admin.directory', 'Users')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{num(users.length)} {t('admin.profiles_count', 'profiles')} · {t('admin.click_to_open', 'Click a user to open their profile')}</p>
            </div>
          </div>
          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('admin.search_users', 'Search users…')}
              aria-label={t('admin.search_users', 'Search users…')}
              className="form-input pl-9 h-[38px]"
            />
          </div>
        </div>
        {loadError && <div className="p-4 text-xs text-rose-600 dark:text-rose-400">{loadError}</div>}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map(u => {
            const isCurrent = currentUser?.id === u.id;
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => openProfile(u.id)}
                onKeyDown={e => { if (e.key === 'Enter') openProfile(u.id); }}
                title={t('admin.open_profile', 'Open profile')}
                className="px-5 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors group focus:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-[#1a2b34]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar user={u} className={`w-11 h-11 rounded-xl ${u.status !== 'Active' ? 'opacity-50 grayscale' : ''}`} textClass="text-sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white text-sm truncate">{bnName(u.full_name, u.full_name_bn)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ROLE_BADGE[u.role] || ROLE_BADGE.Manager}`}>{tv(u.role)}</span>
                      {u.status !== 'Active' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{tv(u.status)}</span>
                      )}
                      {isCurrent && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">{t('admin.you', 'You')}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 text-slate-400 dark:text-slate-500 text-[11px] mt-0.5">
                      <span className="font-mono">{u.username}</span>
                      {u.designation && <span>{u.designation}</span>}
                      {u.email && <span>{u.email}</span>}
                      {u.phone && <span>{u.phone}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {u.is_system ? (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-[11px]" title={t('admin.protected_hint', 'Protected system account: fixed password, data upload enabled')}>
                      <Lock size={12} />{t('admin.protected', 'Protected')}
                    </span>
                  ) : isAdmin && (
                    <>
                      {!u.has_password && <span className="hidden md:inline text-[10px] font-semibold text-amber-600 dark:text-amber-400 mr-1">{t('admin.no_password', 'No password — cannot sign in')}</span>}
                      <button type="button" onClick={stop(() => { setPwTarget(u); setPw1(''); setPw2(''); })}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-brand dark:text-emerald-400 rounded-lg font-bold border border-slate-200 dark:border-slate-700">
                        <KeyRound size={13} /> <span className="hidden sm:inline">{t('admin.set_password', 'Set password')}</span>
                      </button>
                      <button type="button" onClick={stop(() => startEdit(u))} title={t('common.edit', 'Edit')} aria-label={t('common.edit', 'Edit')}
                        className="btn btn-outline">
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                  {isAdmin && !u.is_system && !isCurrent && (
                  <button
                    type="button"
                    onClick={stop(() => setDeleteTarget(u))}
                    disabled={isCurrent}
                    title={isCurrent ? t('admin.cant_delete_self', 'You cannot delete the profile you are using.') : t('common.delete', 'Delete')}
                    aria-label={t('common.delete', 'Delete')}
                    className="btn btn-danger-outline"
                  >
                    <Trash2 size={15} />
                  </button>
                  )}
                  <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && !loadError && (
            <div className="text-center py-10 text-slate-400 dark:text-slate-500">
              {users.length === 0 ? t('admin.no_users', 'No users yet.') : t('common.no_matches', 'No matches found')}
            </div>
          )}
        </div>
      </div>

      {/* Activity log */}
      <div className="card-base overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <History size={18} className="text-brand dark:text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('admin.activity_log', 'Activity log')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('admin.activity_desc', 'Latest 100 changes made in the app.')}</p>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
<th className="text-left px-5 py-2.5 font-bold whitespace-nowrap w-12 text-center">{t('common.no', 'No.')}</th>
                <th className="text-left px-5 py-2.5 font-bold whitespace-nowrap">{t('admin.when', 'When')}</th>
                <th className="text-left px-3 py-2.5 font-bold">{t('admin.user', 'User')}</th>
                <th className="text-left px-3 py-2.5 font-bold">{t('admin.action', 'Action')}</th>
                <th className="text-left px-3 py-2.5 font-bold">{t('admin.record', 'Record')}</th>
                <th className="text-left px-5 py-2.5 font-bold">{t('admin.details', 'Details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {audit.map((a, __i) => (
                <tr key={a.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] align-top">
<td className="py-3 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(0 + __i + 1)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{stamp(a.at)}</td>
                  <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-200">{a.user_name || '—'}</td>
                  <td className="px-3 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">{labels.action(a.action)}</td>
                  <td className="px-3 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {labels.entity(a.entity)}{a.entity_id != null ? ` #${num(a.entity_id)}` : ''}
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300 break-words max-w-md">{a.details}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400 dark:text-slate-500">{t('admin.no_activity', 'No activity recorded yet.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add user */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        locked={busy}
        size="lg"
        icon={<UserPlus size={18} />}
        title={t('admin.add_user', 'Add user')}
        subtitle={t('admin.add_user_desc', 'Create a profile for someone who uses this computer.')}
        footer={
          <>
            <button type="button" onClick={() => setAddOpen(false)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="submit" form="add-user-form" disabled={busy || photoBusy || !add.full_name.trim() || !USERNAME_RE.test(uname)} className="btn btn-primary">
              <UserPlus size={14} /> {busy ? t('common.saving', 'Saving…') : t('admin.add_user', 'Add user')}
            </button>
          </>
        }
      >
        <form id="add-user-form" onSubmit={handleCreate} className="space-y-3 text-xs">
          <div className="flex items-center gap-4">
            <UserAvatar user={{ avatar: add.avatar, avatar_initials: add.full_name.trim() ? initialsOf(add.full_name) : '?', full_name: add.full_name }}
              className="w-16 h-16 rounded-2xl" textClass="text-lg" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className={btnSoft}>
                <Camera size={14} /> {add.avatar ? t('admin.change_photo', 'Change photo') : t('admin.add_photo', 'Add photo (optional)')}
              </button>
              {add.avatar && (
                <button type="button" onClick={() => setAdd(a => ({ ...a, avatar: '' }))} className="btn btn-danger-outline">
                  <X size={14} /> {t('common.remove', 'Remove')}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" className="hidden" onChange={onPickPhoto} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('admin.full_name', 'Full name')} *</label>
              <input className="form-input" value={add.full_name} onChange={e => setAdd(a => ({ ...a, full_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('admin.full_name_bn', 'Full name (Bangla)')}</label>
              <input className="form-input" lang="bn" value={add.full_name_bn} onChange={e => setAdd(a => ({ ...a, full_name_bn: e.target.value }))} placeholder="যেমন: মোঃ আসিফ ইকবাল" />
            </div>
            <div>
              <label className="form-label">{t('admin.username', 'Username')} *</label>
              <input
                className={`form-input font-mono ${usernameError ? 'border-rose-500' : ''}`}
                maxLength={32}
                value={add.username}
                onChange={e => setAdd(a => ({ ...a, username: e.target.value.toLowerCase() }))}
              />
              <p className={`text-[11px] mt-1 ${usernameError ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>{usernameRule}</p>
            </div>
            <div>
              <label className="form-label">{t('admin.initial_password', 'Password')} *</label>
              <input type="password" autoComplete="new-password" className="form-input" value={add.password} onChange={e => setAdd(a => ({ ...a, password: e.target.value }))} />
              <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">{t('admin.pw_hint', 'At least 6 characters. The user can change it later from their profile.')}</p>
            </div>
            <div>
              <label className="form-label">{t('admin.email', 'Email')}</label>
              <input type="email" className="form-input" value={add.email} onChange={e => setAdd(a => ({ ...a, email: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('admin.phone', 'Phone')}</label>
              <input type="tel" className="form-input" placeholder="01XXXXXXXXX" value={add.phone} onChange={e => setAdd(a => ({ ...a, phone: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('admin.designation', 'Designation')}</label>
              <input className="form-input" placeholder={t('admin.designation_ph', 'e.g. Cashier, Committee member')} value={add.designation}
                onChange={e => setAdd(a => ({ ...a, designation: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('admin.role', 'Role')} *</label>
              <SearchableSelect options={roleOptions} value={add.role} onChange={v => setAdd(a => ({ ...a, role: v as UserRole }))} />
            </div>
          </div>
        </form>
      </Modal>

      {/* Edit user */}
      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        locked={busy}
        size="lg"
        icon={<Pencil size={18} />}
        title={t('admin.edit_user', 'Edit user')}
        subtitle={editUser?.username}
        footer={
          <>
            <button type="button" onClick={() => setEditUser(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="submit" form="edit-user-form" disabled={busy || !edit.full_name.trim()} className="btn btn-primary">
              {busy ? t('common.saving', 'Saving…') : t('common.save_changes', 'Save changes')}
            </button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={saveEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="form-label">{t('admin.full_name', 'Full name')} *</label>
            <input className="form-input" value={edit.full_name} onChange={e => setEdit(s => ({ ...s, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.full_name_bn', 'Full name (Bangla)')}</label>
            <input className="form-input" lang="bn" value={edit.full_name_bn} onChange={e => setEdit(s => ({ ...s, full_name_bn: e.target.value }))} placeholder="যেমন: মোঃ আসিফ ইকবাল" />
          </div>
          <div>
            <label className="form-label">{t('admin.designation', 'Designation')}</label>
            <input className="form-input" value={edit.designation} onChange={e => setEdit(s => ({ ...s, designation: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.email', 'Email')}</label>
            <input type="email" className="form-input" value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.phone', 'Phone')}</label>
            <input type="tel" className="form-input" value={edit.phone} onChange={e => setEdit(s => ({ ...s, phone: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.role', 'Role')}</label>
            <SearchableSelect options={roleOptions} value={edit.role} onChange={v => setEdit(s => ({ ...s, role: v as UserRole }))} />
          </div>
          <div>
            <label className="form-label">{t('admin.status', 'Status')}</label>
            <SearchableSelect options={statusOptions} value={edit.status} onChange={v => setEdit(s => ({ ...s, status: v as UserStatus }))} />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        locked={busy}
        size="sm" tone="danger"
        icon={<Trash2 size={18} />}
        title={t('admin.delete_user', 'Delete user')}
        footer={
          <>
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" onClick={confirmDelete} disabled={busy}
              className="btn btn-danger">
              <Trash2 size={14} /> {t('common.delete', 'Delete')}
            </button>
          </>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t('admin.delete_user_confirm', 'This profile will be removed. Its past activity stays in the log.')}
        </p>
        {deleteTarget && (
          <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
            <UserAvatar user={deleteTarget} className="w-9 h-9 rounded-lg" />
            <div className="min-w-0">
              <div className="font-bold text-slate-900 dark:text-white truncate">{deleteTarget.full_name}</div>
              <div className="text-[11px] text-slate-500">{tv(deleteTarget.role)}</div>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} locked={pwBusy} size="sm" icon={<KeyRound size={18} />}
        title={t('admin.set_password', 'Set password')}
        subtitle={pwTarget ? `${pwTarget.full_name} (@${pwTarget.username}) — ${t('admin.pw_change_next', 'they will be asked to change it after signing in.')}` : undefined}
        footer={<>
          <button type="button" onClick={() => setPwTarget(null)} disabled={pwBusy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={savePassword} disabled={pwBusy || !pw1} className="btn btn-primary">{pwBusy && <Loader2 size={14} className="animate-spin" />}{t('admin.set_password', 'Set password')}</button>
        </>}>
        <div className="space-y-3.5">
          <div><label className="form-label">{t('auth.new', 'New password')}</label><input type="password" autoComplete="new-password" className="form-input" value={pw1} onChange={e => setPw1(e.target.value)} />
            <span className="form-hint">{t('auth.rules', 'At least 6 characters, different from the username.')}</span></div>
          <div><label className="form-label">{t('auth.repeat', 'Repeat new password')}</label><input type="password" autoComplete="new-password" className="form-input" value={pw2} onChange={e => setPw2(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') savePassword(); }} /></div>
        </div>
      </Modal>    </div>
  );
};
