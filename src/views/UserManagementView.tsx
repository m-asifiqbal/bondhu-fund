import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, Pencil, Check, X, History, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getUsers, addUser, updateUser, deleteUser, getAuditLog } from '../services/db';
import { AppUser, AuditEntry, UserRole, UserStatus } from '../types';

const ROLES: UserRole[] = ['Admin', 'Treasurer', 'Auditor', 'Manager'];
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
};

const ROLE_BADGE: Record<UserRole, string> = {
  Admin: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  Treasurer: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  Auditor: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  Manager: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

export const UserManagementView: React.FC = () => {
  const { currentUser, setCurrentUser, showToast, refreshKey, triggerRefresh, t, formatDate } = useApp();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'add' | null>(null);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('Treasurer');

  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ full_name: string; email: string; role: UserRole; status: UserStatus }>({ full_name: '', email: '', role: 'Treasurer', status: 'Active' });

  const roleLabel = (r: UserRole) => t(`role.${r.toLowerCase()}`, r);

  const load = useCallback(() => {
    getUsers().then(u => { setUsers(u); setLoadError(null); }).catch(e => setLoadError(e.message));
    getAuditLog(100).then(setAudit).catch(() => setAudit([]));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const formatStamp = (s?: string | null) => {
    if (!s) return '—';
    const time = s.length > 10 ? s.slice(11, 16) : '';
    return `${formatDate(s.slice(0, 10))}${time ? ` ${time}` : ''}`;
  };

  const done = (msg: string) => {
    showToast(msg);
    triggerRefresh();
    load();
  };

  const uname = username.trim().toLowerCase();
  const usernameError = username && !USERNAME_RE.test(uname)
    ? t('users.username_rule', '3–32 characters: lowercase letters, digits, dot, underscore or hyphen')
    : null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { showToast(t('users.name_required', 'Full name is required.'), 'error'); return; }
    if (!USERNAME_RE.test(uname)) { showToast(t('users.username_rule', '3–32 characters: lowercase letters, digits, dot, underscore or hyphen'), 'error'); return; }
    setBusy('add');
    try {
      await addUser({
        username: uname,
        full_name: fullName.trim(),
        email: email.trim(),
        role,
        avatar_initials: initialsOf(fullName),
        status: 'Active',
      });
      setFullName(''); setUsername(''); setEmail('');
      done(`${t('users.created', 'User created')}: ${fullName.trim()} (${roleLabel(role)})`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (u: AppUser) => {
    setEditId(u.id);
    setEdit({ full_name: u.full_name, email: u.email || '', role: u.role, status: u.status });
  };

  const saveEdit = async (u: AppUser) => {
    if (!edit.full_name.trim()) { showToast(t('users.name_required', 'Full name is required.'), 'error'); return; }
    if (u.id === currentUser?.id && edit.status === 'Inactive') {
      showToast(t('users.cant_deactivate_self', 'You cannot deactivate the profile you are using. Switch to another profile first.'), 'error');
      return;
    }
    setBusy(u.id);
    try {
      await updateUser(u.id, {
        full_name: edit.full_name.trim(),
        email: edit.email.trim(),
        role: edit.role,
        status: edit.status,
        avatar_initials: initialsOf(edit.full_name),
      });
      setEditId(null);
      done(`${t('users.updated', 'User updated')}: ${edit.full_name.trim()}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (u: AppUser) => {
    if (u.id === currentUser?.id) {
      showToast(t('users.cant_delete_self', 'You cannot delete the profile you are using.'), 'error');
      return;
    }
    if (!window.confirm(`${t('users.confirm_delete', 'Delete user')} "${u.full_name}"?`)) return;
    setBusy(u.id);
    try {
      await deleteUser(u.id);
      done(`${t('users.deleted', 'User deleted')}: ${u.full_name}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleSwitch = (u: AppUser) => {
    if (u.status !== 'Active') {
      showToast(t('users.inactive_switch', 'Activate this user before switching to it.'), 'error');
      return;
    }
    setCurrentUser(u);
    showToast(`${t('users.switched', 'Active profile')}: ${u.full_name} (${roleLabel(u.role)})`);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('users.title', 'Users & Roles')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('users.subtitle', 'Profiles who use this computer. Every change is recorded in the activity log under the active profile.')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create */}
        <div className="card-base p-6 h-max">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={18} className="text-brand dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('users.create', 'Add user')}</h3>
          </div>
          <form onSubmit={handleCreate} className="space-y-4 text-xs">
            <div>
              <label className="form-label">{t('users.full_name', 'Full name')} *</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="form-input" required />
            </div>
            <div>
              <label className="form-label">{t('users.username', 'Username')} *</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
                className={`form-input font-mono ${usernameError ? 'border-rose-500' : ''}`}
                maxLength={32}
                required
              />
              <p className={`text-[11px] mt-1 ${usernameError ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {t('users.username_rule', '3–32 characters: lowercase letters, digits, dot, underscore or hyphen')}
              </p>
            </div>
            <div>
              <label className="form-label">{t('users.email', 'Email')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">{t('users.role', 'Role')} *</label>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="form-select font-semibold">
                {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy === 'add' || !fullName.trim() || !USERNAME_RE.test(uname)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlus size={15} />
              <span>{busy === 'add' ? t('common.saving', 'Saving...') : t('users.create', 'Add user')}</span>
            </button>
          </form>
        </div>

        {/* Directory */}
        <div className="lg:col-span-2 card-base overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Users size={18} className="text-brand dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('users.directory', 'Users')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{users.length} {t('users.count', 'profiles')}</p>
            </div>
          </div>
          {loadError && <div className="p-4 text-xs text-rose-600 dark:text-rose-400">{loadError}</div>}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {users.map(u => {
              const isCurrent = currentUser?.id === u.id;
              const editing = editId === u.id;
              const rowBusy = busy === u.id;
              return (
                <div key={u.id} className="p-4 hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center shrink-0 border ${
                        u.status === 'Active'
                          ? 'bg-brand-light dark:bg-emerald-950 text-brand dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {u.avatar_initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white text-sm truncate">{u.full_name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ROLE_BADGE[u.role] || ROLE_BADGE.Manager}`}>{roleLabel(u.role)}</span>
                          {u.status !== 'Active' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {t('users.inactive', 'Inactive')}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                              {t('users.current', 'You')}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 text-slate-400 dark:text-slate-500 text-[11px] mt-0.5">
                          <span className="font-mono">{u.username}</span>
                          {u.email && <span>{u.email}</span>}
                        </div>
                      </div>
                    </div>

                    {!editing && (
                      <div className="flex items-center gap-1 shrink-0">
                        {!isCurrent && (
                          <button
                            onClick={() => handleSwitch(u)}
                            disabled={u.status !== 'Active'}
                            className="px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-brand dark:text-emerald-400 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                          >
                            {t('users.switch', 'Switch')}
                          </button>
                        )}
                        <button onClick={() => startEdit(u)} disabled={rowBusy} title={t('common.edit', 'Edit')}
                          className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={rowBusy || isCurrent}
                          title={isCurrent ? t('users.cant_delete_self', 'You cannot delete the profile you are using.') : t('common.delete', 'Delete')}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  {editing && (
                    <form
                      onSubmit={e => { e.preventDefault(); saveEdit(u); }}
                      className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end"
                    >
                      <div>
                        <label className="form-label">{t('users.full_name', 'Full name')}</label>
                        <input autoFocus value={edit.full_name} onChange={e => setEdit(s => ({ ...s, full_name: e.target.value }))} className="form-input" />
                      </div>
                      <div>
                        <label className="form-label">{t('users.email', 'Email')}</label>
                        <input type="email" value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))} className="form-input" />
                      </div>
                      <div>
                        <label className="form-label">{t('users.role', 'Role')}</label>
                        <select value={edit.role} onChange={e => setEdit(s => ({ ...s, role: e.target.value as UserRole }))} className="form-select">
                          {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">{t('users.status', 'Status')}</label>
                        <select value={edit.status} onChange={e => setEdit(s => ({ ...s, status: e.target.value as UserStatus }))} className="form-select">
                          <option value="Active">{t('users.active', 'Active')}</option>
                          <option value="Inactive">{t('users.inactive', 'Inactive')}</option>
                        </select>
                      </div>
                      <div className="md:col-span-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setEditId(null)} disabled={rowBusy}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                          <X size={13} /> {t('common.cancel', 'Cancel')}
                        </button>
                        <button type="submit" disabled={rowBusy}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold bg-brand hover:bg-brand-hover dark:bg-emerald-700 text-white disabled:opacity-50">
                          <Check size={13} /> {rowBusy ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
            {users.length === 0 && !loadError && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500">{t('users.empty', 'No users yet.')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="card-base overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <History size={18} className="text-brand dark:text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('users.activity_log', 'Activity log')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('users.activity_desc', 'Latest 100 changes made in the app.')}</p>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-5 py-2 font-bold whitespace-nowrap">{t('users.when', 'When')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('users.user', 'User')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('users.action', 'Action')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('users.entity', 'Record')}</th>
                <th className="text-left px-5 py-2 font-bold">{t('users.details', 'Details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {audit.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] align-top">
                  <td className="px-5 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatStamp(a.at)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200">{a.user_name || '—'}</td>
                  <td className="px-3 py-2 font-bold text-slate-900 dark:text-white">{a.action}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {a.entity}{a.entity_id != null ? ` #${a.entity_id}` : ''}
                  </td>
                  <td className="px-5 py-2 text-slate-600 dark:text-slate-300 break-words max-w-md">{a.details}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400 dark:text-slate-500">{t('users.no_activity', 'No activity recorded yet.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
