import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getUsers, addUser, deleteUser } from '../services/db';
import { AppUser, UserRole } from '../types';

export const UserManagementView: React.FC = () => {
  const { currentUser, setCurrentUser, showToast, refreshKey, triggerRefresh } = useApp();
  const [users, setUsers] = useState<AppUser[]>([]);

  // Form State
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('Treasurer');

  useEffect(() => {
    getUsers().then(setUsers);
  }, [refreshKey]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !username.trim()) return;

    const parts = fullName.trim().split(' ');
    const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();

    try {
      await addUser({
        username: username.trim().toLowerCase(),
        full_name: fullName.trim(),
        email: email.trim() || `${username.trim().toLowerCase()}@bondhufund.org`,
        role,
        avatar_initials: initials,
        status: 'Active',
      });

      showToast(`User ${fullName} (${role}) created successfully in SQLite!`);
      setFullName('');
      setUsername('');
      setEmail('');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (u: AppUser) => {
    if (u.id === currentUser?.id) {
      showToast('Cannot delete currently active user session.', 'error');
      return;
    }
    const confirm = window.confirm(`Delete user account "${u.full_name}"?`);
    if (!confirm) return;

    try {
      await deleteUser(u.id);
      showToast(`User "${u.full_name}" removed.`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'Treasurer':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Treasurer
          </span>
        );
      case 'Admin':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Admin
          </span>
        );
      case 'Auditor':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Auditor
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            Manager
          </span>
        );
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">System User Creation & Roles</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Manage authorized treasurers, auditors, and administrators saved locally in SQLite.
        </p>
      </div>

      {/* 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Create User Form */}
        <div className="card-base p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={18} className="text-[#0f4a3c] dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create New User</h3>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
            <div>
              <label className="form-label">Full Name *</label>
              <input
                type="text"
                placeholder="e.g. Tariqul Islam"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="form-input"
                required
              />
            </div>

            <div>
              <label className="form-label">Username / ID *</label>
              <input
                type="text"
                placeholder="e.g. tariqul.islam"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="form-input font-mono"
                required
              />
            </div>

            <div>
              <label className="form-label">Official Email</label>
              <input
                type="email"
                placeholder="tariqul@bondhufund.org"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="form-input"
              />
            </div>

            <div>
              <label className="form-label">Assigned Role *</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as UserRole)}
                className="form-select font-semibold"
              >
                <option value="Treasurer">Treasurer (Full financial entry & collections)</option>
                <option value="Admin">Admin (Full system and database privileges)</option>
                <option value="Auditor">Auditor (Read-only verification & receipt audit)</option>
                <option value="Manager">Manager (Member & investment supervisor)</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
            >
              <UserPlus size={15} />
              <span>Create User Account</span>
            </button>
          </form>
        </div>

        {/* Right Column: User Directory */}
        <div className="lg:col-span-2 card-base overflow-hidden">
          <div className="p-6 pb-2 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Registered System Users</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Stored locally in SQLite database</p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {users.map(u => {
              const isCurrent = currentUser?.id === u.id;
              return (
                <div key={u.id} className="p-4 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 font-bold text-sm flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
                      {u.avatar_initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">{u.full_name}</span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Active Session
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-slate-400 dark:text-slate-500 text-[11px] mt-0.5">
                        <span className="font-mono">{u.username}</span>
                        <span>&bull;</span>
                        <span>{u.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {getRoleBadge(u.role)}
                    {!isCurrent && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setCurrentUser(u);
                            showToast(`Logged in as ${u.full_name} (${u.role})`);
                          }}
                          className="px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[#0f4a3c] dark:text-emerald-400 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700"
                        >
                          Switch
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="Delete User"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
