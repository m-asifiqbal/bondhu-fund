import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, RefreshCw, PauseCircle, PlayCircle, Banknote, Pencil, History, Trash2, Copy, Users, ShieldCheck, AlertTriangle, Ban, LogOut, Database, Wallet, Clock3, Info, Laptop } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/common/Modal';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { PasswordInput } from '../components/common/PasswordInput';
import {
  licenseAdminRemoveDevice, licenseAdminRemoveUser, licenseAdminAddUser, licenseAdminState, licenseAdminSignIn, licenseAdminSignOut, licenseAdminList, licenseAdminPayments, licenseAdminCreate, licenseAdminUpdate,
  licenseAdminResetDevice, licenseAdminExtend, licenseAdminRemove,
} from '../services/db';
import type { LicenseAdminState, LicenseRecord, LicensePayment, LicenseDevice, LicenseUser } from '../types';

const DAY = 86_400_000;
type Key = 'revoked' | 'suspended' | 'expired' | 'pending' | 'expiring' | 'active';
const stateOf = (r: LicenseRecord, now: number): { key: Key; days: number | null } => {
  const days = r.paid_until ? Math.ceil((Date.parse(r.paid_until) - now) / DAY) : null;
  if (r.status === 'revoked') return { key: 'revoked', days };
  if (r.status === 'suspended') return { key: 'suspended', days };
  if (days !== null && days <= 0) return { key: 'expired', days };
  if (r.devices.length === 0) return { key: 'pending', days };
  if (days !== null && days <= 7) return { key: 'expiring', days };
  return { key: 'active', days };
};
const BADGE: Record<Key, string> = {
  active: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  expiring: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  pending: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
  expired: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  suspended: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  revoked: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};
const lastSeenOf = (r: LicenseRecord) => r.devices.reduce<string | null>((m, d) => (!m || Date.parse(d.last_seen) > Date.parse(m) ? d.last_seen : m), null);
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addPeriod = (from: number, months: number, days: number) => { const d = new Date(from); d.setMonth(d.getMonth() + months); d.setDate(d.getDate() + days); return d.toISOString(); };

export const LicenseControlView: React.FC = () => {
  const { t, formatCurrency, formatDate, showToast, language, toBanglaDigits } = useApp();
  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const [st, setSt] = useState<LicenseAdminState | null>(null);
  const [rows, setRows] = useState<LicenseRecord[] | null>(null);
  const [pays, setPays] = useState<LicensePayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [signing, setSigning] = useState(false);
  const [search, setSearch] = useState('');
  const [dlg, setDlg] = useState<null | { kind: 'new' } | { kind: 'pay' | 'edit' | 'pin' | 'history' | 'devices' | 'suspend' | 'resume' | 'delete' | 'reset'; row: LicenseRecord } | { kind: 'reveal'; row: LicenseRecord; fresh: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState('');
  const now = Date.now();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await licenseAdminState();
      setSt(s);
      if (s.account) { const [l, p] = await Promise.all([licenseAdminList(), licenseAdminPayments()]); setRows(l); setPays(p); }
      else { setRows(null); setPays([]); }
    } catch (e: any) {
      setError(e.message);
      if (/Sign in/i.test(e.message)) { try { setSt(await licenseAdminState()); } catch { /* keep */ } setRows(null); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => { if (st?.account) void load(); }, 60_000); return () => clearInterval(id); }, [st?.account, load]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault(); setSigning(true); setError(null);
    try { await licenseAdminSignIn(email, pw); setPw(''); await load(); }
    catch (err: any) { setError(err.message); } finally { setSigning(false); }
  };
  const signOut = async () => { try { await licenseAdminSignOut(); } finally { setRows(null); void load(); } };

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setDlgErr('');
    try { await fn(); if (done) showToast(done); await load(); return true; }
    catch (e: any) { setDlgErr(e.message); return false; } finally { setBusy(false); }
  };

  const view = useMemo(() => (rows || []).map(r => ({ r, s: stateOf(r, now) })).filter(({ r }) => !search.trim() || `${r.customer} ${r.username || ''} ${r.contact || ''} ${r.devices.map(d => `${d.device_name} ${d.last_user}`).join(' ')} ${r.users.map(u => u.username).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())), [rows, search, now]);
  const summary = useMemo(() => {
    const all = (rows || []).map(r => stateOf(r, now));
    const mk = new Date().toISOString().slice(0, 7);
    return {
      total: all.length, active: all.filter(x => x.key === 'active' || x.key === 'expiring').length, expiring: all.filter(x => x.key === 'expiring').length,
      locked: all.filter(x => ['suspended', 'expired', 'revoked'].includes(x.key)).length, pending: all.filter(x => x.key === 'pending').length,
      monthly: (rows || []).reduce((s, r, i) => s + (['active', 'expiring', 'pending'].includes(all[i].key) ? Number(r.monthly_fee) || 0 : 0), 0),
      collected: pays.filter(p => String(p.paid_on).slice(0, 7) === mk).reduce((s, p) => s + Number(p.amount), 0),
    };
  }, [rows, pays, now]);

  const seen = (iso: string | null) => {
    if (!iso) return { text: t('license.never_seen', 'Never'), online: false };
    const mins = Math.round((now - Date.parse(iso)) / 60000);
    if (mins < 15) return { text: t('license.online', 'Online now'), online: true };
    if (mins < 60) return { text: t('license.min_ago', '{n} min ago').replace('{n}', n(mins)), online: false };
    if (mins < 2880) return { text: t('license.hr_ago', '{n} h ago').replace('{n}', n(Math.round(mins / 60))), online: false };
    return { text: t('license.day_ago', '{n} days ago').replace('{n}', n(Math.round(mins / 1440))), online: false };
  };
  const label: Record<Key, string> = {
    active: t('license.s_active', 'Active'), expiring: t('license.s_expiring', 'Ends soon'), pending: t('license.s_pending', 'PIN not used yet'),
    expired: t('license.s_expired', 'Expired'), suspended: t('license.s_suspended', 'Suspended'), revoked: t('license.s_revoked', 'Revoked'),
  };
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => showToast(t('license.copied', 'Copied.')), () => undefined); };

  const card = (icon: React.ReactNode, title: string, value: React.ReactNode, sub?: string, tone = 'text-slate-900 dark:text-white') => (
    <div className="card-base p-4 min-w-0">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{icon}<span className="truncate">{title}</span></div>
      <div className={`mt-2 text-xl font-black tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
  const close = () => { if (!busy) { setDlg(null); setDlgErr(''); } };
  const errBox = dlgErr ? <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{dlgErr}</p> : null;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('license.title', 'License Control')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('license.subtitle', 'Customers, monthly payments, activation PINs and the remote lock. Only iqbal_labs can see this page.')}</p>
        </div>
        {st?.account && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} className="btn btn-outline"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{t('google.refresh', 'Refresh')}</button>
            <button type="button" onClick={() => { setDlgErr(''); setDlg({ kind: 'new' }); }} className="btn btn-primary"><Plus size={16} />{t('license.new_customer', 'New customer')}</button>
          </div>
        )}
      </div>

      {st && !st.configured && (
        <div className="card-base p-6 border-amber-200 dark:border-amber-900">
          <div className="flex items-start gap-3"><Info size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              <div className="font-black text-sm text-slate-900 dark:text-white">{t('license.not_cfg_title', 'This build has no Supabase project')}</div>
              {t('license.not_cfg_body', 'Copy config/supabase.example.json to config/supabase.json, fill in the project URL and the publishable key, and build again.')}
            </div></div>
        </div>
      )}

      {st?.configured && !st.account && (
        <form onSubmit={signIn} className="card-base p-6 max-w-xl space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center shrink-0"><Database size={22} /></div>
            <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('license.signin_title', 'Sign in to your Supabase project')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{t('license.signin_body', 'Use the admin user you created in Supabase (Authentication → Users). One-time setup steps are in docs/supabase/license.sql.')}</p>
              <p className="text-[11px] font-mono text-slate-400 mt-1 break-all">{st.url}</p></div>
          </div>
          <div><label className="form-label">{t('license.email', 'Email')}</label><input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></div>
          <div><label className="form-label">{t('license.password', 'Password')}</label><PasswordInput value={pw} onChange={e => setPw(e.target.value)} autoComplete="off" /></div>
          {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
          <button type="submit" disabled={signing || !email.trim() || !pw} className="btn btn-primary"><ShieldCheck size={15} />{signing ? t('license.signing', 'Signing in…') : t('license.signin', 'Sign in')}</button>
        </form>
      )}

      {st?.account && (
        <>
          {!st.enforced && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span><b>{t('license.enforce_off_title', 'Locking is switched off in this build.')}</b> {t('license.enforce_off_body', 'Customers are recorded here, but no copy asks for a PIN or gets locked. Set "LICENSE_ENFORCE": true in config/supabase.json and build again when you are ready.')}</span>
            </div>
          )}
          {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 kpi-zoom">
            {card(<Users size={13} />, t('license.k_customers', 'Customers'), n(summary.total), summary.pending ? t('license.k_pending', '{n} waiting for activation').replace('{n}', n(summary.pending)) : undefined)}
            {card(<ShieldCheck size={13} />, t('license.k_active', 'Active'), n(summary.active), undefined, 'text-emerald-700 dark:text-emerald-400')}
            {card(<Clock3 size={13} />, t('license.k_expiring', 'Ending in 7 days'), n(summary.expiring), undefined, summary.expiring ? 'text-amber-600 dark:text-amber-400' : undefined)}
            {card(<Ban size={13} />, t('license.k_locked', 'Locked'), n(summary.locked), t('license.k_locked_sub', 'suspended, expired or revoked'), summary.locked ? 'text-rose-600 dark:text-rose-400' : undefined)}
            {card(<Wallet size={13} />, t('license.k_monthly', 'Monthly fees'), formatCurrency(summary.monthly), t('license.k_monthly_sub', 'of active customers'))}
            {card(<Banknote size={13} />, t('license.k_collected', 'Collected this month'), formatCurrency(summary.collected))}
          </div>

          <div className="card-base overflow-hidden">
            <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
              <input className="form-input max-w-xs" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('license.search', 'Search customer or computer…')} />
              <button type="button" onClick={signOut} className="btn btn-outline btn-sm"><LogOut size={13} />{t('license.signout', 'Sign out of Supabase')} <span className="text-slate-400 font-mono text-[10px] ml-1">{st.account}</span></button>
            </div>
            {rows && view.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-400">{rows.length === 0 ? t('license.empty', 'No customers yet. Press "New customer" to create one and get an activation PIN.') : t('license.no_match', 'No customer matches the search.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-bold">{t('license.c_customer', 'Customer')}</th>
                      <th className="py-2.5 px-4 font-bold">{t('license.c_status', 'Status')}</th>
                      <th className="py-2.5 px-4 font-bold">{t('license.c_paid_until', 'Paid until')}</th>
                      <th className="py-2.5 px-4 font-bold text-right">{t('license.c_fee', 'Monthly fee')}</th>
                      <th className="py-2.5 px-4 font-bold">{t('license.c_computers', 'Computers & users')}</th>
                      <th className="py-2.5 px-4 font-bold">{t('license.c_seen', 'Last seen')}</th>
                      <th className="py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                    {view.map(({ r, s }) => { const sn = seen(lastSeenOf(r)); const locked = r.status !== 'active'; return (
                      <tr key={r.id} className="align-middle">
                        <td className="py-3 px-4"><div className="font-bold text-slate-900 dark:text-white">{r.customer}</div>{r.contact && <div className="text-[11px] text-slate-500">{r.contact}</div>}
                          <div className={`text-[10px] font-bold mt-0.5 ${r.username ? 'text-sky-700 dark:text-sky-300' : 'text-slate-400'}`}>{r.username ? t('license.applies_user', 'For user: {u}').replace('{u}', r.username) : t('license.applies_all', 'All users on the computer')}</div></td>
                        <td className="py-3 px-4"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full border text-[10px] font-bold ${BADGE[s.key]}`}>{label[s.key]}</span></td>
                        <td className="py-3 px-4 whitespace-nowrap">{r.paid_until ? <>{formatDate(r.paid_until)}<div className={`text-[10px] ${s.days !== null && s.days <= 7 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500'}`}>{s.days === null ? '' : s.days > 0 ? t('license.days_left', '{n} day(s) left').replace('{n}', n(s.days)) : t('license.days_over', 'ended {n} day(s) ago').replace('{n}', n(-s.days))}</div></> : <span className="text-slate-400">{t('license.no_expiry', 'No expiry')}</span>}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{formatCurrency(Number(r.monthly_fee) || 0)}</td>
                        <td className="py-3 px-4 whitespace-nowrap"><div>{t('license.n_computers', '{n} of {max} computers').replace('{n}', n(r.devices.length)).replace('{max}', n(r.max_devices))}</div>
                          <div className="text-[10px] text-slate-500">{r.username ? t('license.one_user', '1 user') : r.restrict_users ? t('license.n_users_list', '{n} listed users only').replace('{n}', n(r.users.length)) + (r.max_users == null ? '' : ` / ${n(r.max_users)}`) : r.max_users == null ? t('license.n_users_any', '{n} users (any number)').replace('{n}', n(r.users.length)) : t('license.n_users', '{n} of {max} users').replace('{n}', n(r.users.length)).replace('{max}', n(r.max_users))}</div></td>
                        <td className="py-3 px-4 whitespace-nowrap"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${sn.online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />{sn.text}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button type="button" className="btn btn-green-outline btn-sm" onClick={() => { setDlgErr(''); setDlg({ kind: 'pay', row: r }); }}><Banknote size={13} />{t('license.payment', 'Payment')}</button>
                          <button type="button" className={`btn btn-sm ml-1 ${locked ? 'btn-green-outline' : 'btn-danger-outline'}`} onClick={() => { setDlgErr(''); setDlg({ kind: locked ? 'resume' : 'suspend', row: r }); }}>
                            {locked ? <><PlayCircle size={13} />{t('license.resume', 'Resume')}</> : <><PauseCircle size={13} />{t('license.suspend', 'Suspend')}</>}</button>
                          <button type="button" className="btn btn-outline btn-sm btn-icon ml-1" title={t('license.devices', 'Computers and users')} aria-label={t('license.devices', 'Computers and users')} onClick={() => { setDlgErr(''); setDlg({ kind: 'devices', row: r }); }}><Laptop size={13} /></button>
                          <button type="button" className="btn btn-outline btn-sm btn-icon ml-1" title={t('license.pin', 'Activation PIN')} aria-label={t('license.pin', 'Activation PIN')} onClick={() => { setDlgErr(''); setDlg({ kind: 'pin', row: r }); }}><KeyRound size={13} /></button>
                          <button type="button" className="btn btn-outline btn-sm btn-icon ml-1" title={t('license.history', 'Payment history')} aria-label={t('license.history', 'Payment history')} onClick={() => { setDlgErr(''); setDlg({ kind: 'history', row: r }); }}><History size={13} /></button>
                          <button type="button" className="btn btn-outline btn-sm btn-icon ml-1" title={t('license.edit', 'Edit')} aria-label={t('license.edit', 'Edit')} onClick={() => { setDlgErr(''); setDlg({ kind: 'edit', row: r }); }}><Pencil size={13} /></button>
                        </td>
                      </tr>); })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---- dialogs ---- */}
      {dlg?.kind === 'new' && <NewDialog t={t} busy={busy} err={errBox} onClose={close} onSubmit={async v => { setBusy(true); setDlgErr(''); try { const row = await licenseAdminCreate(v); await load(); setDlg({ kind: 'reveal', row, fresh: true }); } catch (e: any) { setDlgErr(e.message); } finally { setBusy(false); } }} />}
      {dlg?.kind === 'pay' && <PayDialog t={t} row={dlg.row} busy={busy} err={errBox} formatCurrency={formatCurrency} formatDate={formatDate} onClose={close}
        onSubmit={async v => { if (await act(() => licenseAdminExtend(dlg.row.id, v), t('license.pay_saved', 'Payment recorded.'))) setDlg(null); }} />}
      {dlg?.kind === 'edit' && <EditDialog t={t} row={dlg.row} busy={busy} err={errBox} onClose={close}
        onDelete={() => { setDlgErr(''); setDlg({ kind: 'delete', row: dlg.row }); }}
        onSubmit={async v => { if (await act(() => licenseAdminUpdate(dlg.row.id, v), t('license.saved', 'Saved.'))) setDlg(null); }} />}
      {(dlg?.kind === 'suspend' || dlg?.kind === 'resume') && (
        <Modal open onClose={close} size="sm" tone={dlg.kind === 'suspend' ? 'danger' : 'brand'} icon={dlg.kind === 'suspend' ? <PauseCircle size={18} /> : <PlayCircle size={18} />}
          title={dlg.kind === 'suspend' ? t('license.suspend_title', 'Lock {name} now?').replace('{name}', dlg.row.customer) : t('license.resume_title', 'Open {name} again?').replace('{name}', dlg.row.customer)}
          footer={<div className="flex flex-col gap-2">{errBox}<div className="flex justify-end gap-2"><button type="button" onClick={close} className="btn btn-cancel" disabled={busy}>{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy} className={`btn ${dlg.kind === 'suspend' ? 'btn-danger' : 'btn-primary'}`}
              onClick={async () => { if (await act(() => licenseAdminUpdate(dlg.row.id, { status: dlg.kind === 'suspend' ? 'suspended' : 'active' }), dlg.kind === 'suspend' ? t('license.suspended_done', 'Suspended. The copy locks at its next check.') : t('license.resumed_done', 'Resumed. The copy opens at its next check.'))) setDlg(null); }}>
              {dlg.kind === 'suspend' ? t('license.suspend', 'Suspend') : t('license.resume', 'Resume')}</button></div></div>}>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{dlg.kind === 'suspend'
            ? t('license.suspend_body', 'Their copy shows the lock screen at its next check (within about 10 minutes while it is online and open). Nothing is deleted: their data stays on their computer and comes back the moment you resume.')
            : t('license.resume_body', 'Their copy opens at its next check (within about 10 minutes), or at once when they press "Check again".')}</p>
        </Modal>
      )}
      {dlg?.kind === 'delete' && (
        <Modal open onClose={close} size="sm" tone="danger" icon={<Trash2 size={18} />} title={t('license.delete_title', 'Delete {name}?').replace('{name}', dlg.row.customer)}
          footer={<div className="flex flex-col gap-2">{errBox}<div className="flex justify-end gap-2"><button type="button" onClick={close} className="btn btn-cancel" disabled={busy}>{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy} className="btn btn-danger" onClick={async () => { if (await act(() => licenseAdminRemove(dlg.row.id), t('license.deleted', 'Customer deleted.'))) setDlg(null); }}>{t('common.delete', 'Delete')}</button></div></div>}>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('license.delete_body', 'The customer and their payment history are removed from Supabase, and their copy locks at its next check. This cannot be undone. To pause someone, use Suspend instead.')}</p>
        </Modal>
      )}
      {dlg?.kind === 'pin' && (
        <Modal open onClose={close} size="sm" icon={<KeyRound size={18} />} title={t('license.pin_title', 'Activation PIN')} subtitle={dlg.row.customer}
          footer={<div className="flex flex-col gap-2">{errBox}<div className="flex items-center justify-between gap-2">
            <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { setDlgErr(''); setDlg({ kind: 'reset', row: dlg.row }); }}>{t('license.new_pin', 'Issue a new PIN…')}</button>
            <button type="button" onClick={close} className="btn btn-cancel">{t('common.close', 'Close')}</button></div></div>}>
          <PinBox pin={dlg.row.pin_display} onCopy={copy} t={t} />
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{dlg.row.devices.length > 0
            ? t('license.pin_in_use', 'This PIN is in use on {n} of {max} computers.').replace('{n}', n(dlg.row.devices.length)).replace('{max}', n(dlg.row.max_devices))
            : dlg.row.username ? t('license.pin_unused_user', 'Not used yet. Give it to the customer for the user "{u}": when that user signs in on a new computer, the app asks for this PIN once.').replace('{u}', dlg.row.username)
            : t('license.pin_unused', 'Not used yet. Give it to the customer; they enter it once when they first open the app.')}</p>
        </Modal>
      )}
      {dlg?.kind === 'reset' && (
        <Modal open onClose={close} size="sm" tone="danger" icon={<KeyRound size={18} />} title={t('license.reset_title', 'Issue a new PIN for {name}?').replace('{name}', dlg.row.customer)}
          footer={<div className="flex flex-col gap-2">{errBox}<div className="flex justify-end gap-2"><button type="button" onClick={close} className="btn btn-cancel" disabled={busy}>{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy} className="btn btn-danger" onClick={async () => { setBusy(true); setDlgErr(''); try { const row = await licenseAdminResetDevice(dlg.row.id); await load(); setDlg({ kind: 'reveal', row, fresh: false }); } catch (e: any) { setDlgErr(e.message); } finally { setBusy(false); } }}>{t('license.issue', 'Issue new PIN')}</button></div></div>}>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('license.reset_body', 'Use this when the customer lost or replaced their computer. The old PIN stops working and the old computer locks at its next check. The new PIN can be used on one new computer.')}</p>
        </Modal>
      )}
      {dlg?.kind === 'reveal' && (
        <Modal open onClose={close} size="sm" tone="brand" icon={<ShieldCheck size={18} />} title={dlg.fresh ? t('license.created_title', 'Customer created') : t('license.reissued_title', 'New PIN issued')} subtitle={dlg.row.customer}
          footer={<div className="flex justify-end"><button type="button" onClick={close} className="btn btn-primary">{t('common.done', 'Done')}</button></div>}>
          <PinBox pin={dlg.row.pin_display} onCopy={copy} t={t} />
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('license.reveal_body', 'Give this PIN to the customer. They enter it once, on the first screen of the app. You can show it again any time from the key button in the list.')}</p>
        </Modal>
      )}
      {dlg?.kind === 'devices' && <DevicesDialog t={t} row={rows?.find(x => x.id === dlg.row.id) || dlg.row} busy={busy} err={errBox} formatDate={formatDate} n={n} seen={seen} onClose={close}
        onRemoveDevice={id => act(() => licenseAdminRemoveDevice(id), t('license.device_removed', 'Computer removed. It is locked at its next check.'))}
        onRemoveUser={id => act(() => licenseAdminRemoveUser(id), t('license.user_removed', 'User removed from this licence.'))}
        onAddUser={(name, note) => act(() => licenseAdminAddUser(dlg.row.id, name, note), t('license.user_added', 'User added to the list.'))} />}
      {dlg?.kind === 'history' && <HistoryDialog row={dlg.row} onClose={close} t={t} formatCurrency={formatCurrency} formatDate={formatDate} n={n} />}
    </div>
  );
};

type T = (k: string, d?: string) => string;
const PinBox: React.FC<{ pin: string; onCopy: (s: string) => void; t: T }> = ({ pin, onCopy, t }) => (
  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-5 flex items-center justify-between gap-3">
    <span className="font-mono text-2xl font-black tracking-[0.2em] text-emerald-900 dark:text-emerald-200 select-all">{pin}</span>
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onCopy(pin)}><Copy size={13} />{t('license.copy', 'Copy')}</button>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div><label className="form-label">{label}</label>{children}{hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}</div>
);

type Scope = 'all' | 'list' | 'one';
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-3">
    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-800">{title}</div>
    {children}
  </div>
);
const digits = (s: string) => s.replace(/\D/g, '').slice(0, 3);

/** Who may sign in under this licence: everybody on the computer, only a list kept here, or one tagged user. */
const ScopeFields: React.FC<{ t: T; scope: Scope; setScope: (s: Scope) => void; user: string; setUser: (s: string) => void; names: string; setNames: (s: string) => void; editing?: boolean; used?: boolean }> =
  ({ t, scope, setScope, user, setUser, names, setNames, editing, used }) => (
    <Section title={t('license.sec_who', 'Who may sign in')}>
      <SegmentedTabs<Scope> size="sm" ariaLabel={t('license.sec_who', 'Who may sign in')} value={scope} onChange={setScope} items={[
        { key: 'all', label: t('license.scope_all', 'Anyone on the computer') },
        { key: 'list', label: t('license.scope_list', 'Listed users only') },
        { key: 'one', label: t('license.scope_one', 'One user') },
      ]} />
      <p className="form-hint !mt-2">{scope === 'all' ? t('license.scope_all_hint', 'Every user of the customer\'s app can sign in, up to "Users allowed". The first sign-in of each user is counted.')
        : scope === 'list' ? t('license.scope_list_hint', 'Only the usernames you list can sign in. They are kept here in your Supabase; anyone else is refused, even if the customer creates that account.')
        : t('license.scope_one_hint', 'The PIN is for one username. Only that user is asked for it and only that user is locked when it ends.')}</p>
      {scope === 'one' && (
        <Field label={t('license.f_user_edit', 'Username')} hint={used ? t('license.f_user_used', 'This PIN is already in use. Changing the tag affects only new activations. To move it to another user, issue a new PIN.') : t('license.f_user_hint', 'Type the username exactly as it is in the customer\'s app (for example test_user).')}>
          <input className="form-input" value={user} onChange={e => setUser(e.target.value)} autoComplete="off" spellCheck={false} placeholder="test_user" /></Field>
      )}
      {scope === 'list' && !editing && (
        <Field label={t('license.f_names', 'Usernames')} hint={t('license.f_names_hint', 'Type the usernames the customer will create in their app, separated by commas (for example cashier1, manager). You can add or remove names later.')}>
          <textarea className="form-input" rows={2} value={names} onChange={e => setNames(e.target.value)} placeholder="cashier1, manager" spellCheck={false} /></Field>
      )}
      {scope === 'list' && editing && <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('license.f_only_edit', 'The list of users is managed under "Computers and users".')}</p>}
    </Section>
  );

const MoreOptions: React.FC<{ t: T; message: string; notes: string; onMessage: (s: string) => void; onNotes: (s: string) => void }> = ({ t, message, notes, onMessage, onNotes }) => (
  <details className="group rounded-xl border border-slate-200 dark:border-slate-800" open={!!(message || notes)}>
    <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">{t('license.more', 'More options')}<span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden>▾</span></summary>
    <div className="px-3.5 pb-3.5 pt-1 space-y-4">
      <Field label={t('license.f_message', 'Message on their lock screen (optional)')}><textarea className="form-input" rows={2} value={message} onChange={e => onMessage(e.target.value)} placeholder={t('license.f_message_ph', 'For example: Call 01XXXXXXXXX to renew.')} /></Field>
      <Field label={t('license.f_notes', 'Private notes (optional)')}><textarea className="form-input" rows={2} value={notes} onChange={e => onNotes(e.target.value)} /></Field>
    </div>
  </details>
);

const NewDialog: React.FC<{ t: T; busy: boolean; err: React.ReactNode; onClose: () => void; onSubmit: (v: { customer: string; username: string; contact: string; monthly_fee: number; months: number; days: number; message: string; notes: string; max_devices: number; max_users: number | null; restrict_users: boolean; users: string[] }) => void }> = ({ t, busy, err, onClose, onSubmit }) => {
  const [v, setV] = useState({ customer: '', contact: '', fee: '', months: '1', days: '0', devs: '1', users: '', message: '', notes: '' });
  const [scope, setScope] = useState<Scope>('all');
  const [user, setUser] = useState('');
  const [names, setNames] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<any>) => setV(x => ({ ...x, [k]: e.target.value }));
  const list = scope === 'list' ? names.split(/[\s,;]+/).filter(Boolean) : [];
  const ready = !!v.customer.trim() && (scope !== 'one' || !!user.trim());
  return (
    <Modal open onClose={onClose} locked={busy} size="md" icon={<Plus size={18} />} title={t('license.new_customer', 'New customer')} subtitle={t('license.new_sub', 'Creates the licence and its activation PIN.')}
      footer={<div className="flex flex-col gap-2">{err}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
        <button type="submit" form="lic-new" disabled={busy || !ready} className="btn btn-primary">{busy ? t('common.saving', 'Saving…') : t('license.create', 'Create & get PIN')}</button></div></div>}>
      <form id="lic-new" className="space-y-6 text-xs" onSubmit={e => { e.preventDefault(); onSubmit({ customer: v.customer, username: scope === 'one' ? user : '', contact: v.contact, monthly_fee: Number(v.fee) || 0, months: Number(v.months) || 0, days: Number(v.days) || 0, message: v.message, notes: v.notes,
        max_devices: Number(v.devs) || 1, max_users: scope === 'one' || !v.users.trim() ? null : Number(v.users) || null, restrict_users: scope === 'list' && list.length > 0, users: list }); }}>
        <Section title={t('license.sec_customer', 'Customer')}>
          <Field label={t('license.f_name', 'Customer / fund name')}><input className="form-input" value={v.customer} onChange={set('customer')} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('license.f_contact', 'Phone or email')}><input className="form-input" value={v.contact} onChange={set('contact')} /></Field>
            <Field label={t('license.f_fee', 'Monthly fee')}><input className="form-input" inputMode="decimal" value={v.fee} onChange={set('fee')} placeholder="0" /></Field>
          </div>
        </Section>
        <Section title={t('license.sec_licence', 'Licence')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">{t('license.quick', 'Quick pick')}</span>
            {([['7', 0, 7], ['15', 0, 15], ['1m', 1, 0], ['3m', 3, 0], ['6m', 6, 0], ['12m', 12, 0]] as [string, number, number][]).map(([label, m, d]) => (
              <button key={label} type="button" onClick={() => setV(x => ({ ...x, months: String(m), days: String(d) }))} className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${Number(v.months) === m && Number(v.days) === d ? 'bg-[#0f4a3c] text-white border-[#0f4a3c]' : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-500'}`}>{d ? t('license.q_days', '{n} days').replace('{n}', String(d)) : t('license.q_months', '{n} mo').replace('{n}', String(m))}</button>))}
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Field label={t('license.f_months_n', 'Months')}><input className="form-input" inputMode="numeric" value={v.months} onChange={e => setV(x => ({ ...x, months: digits(e.target.value) }))} /></Field>
            <Field label={t('license.f_days', 'Extra days')}><input className="form-input" inputMode="numeric" value={v.days} onChange={e => setV(x => ({ ...x, days: digits(e.target.value) }))} /></Field>
            <Field label={t('license.f_devs', 'Computers allowed')}><input className="form-input" inputMode="numeric" value={v.devs} onChange={e => setV(x => ({ ...x, devs: digits(e.target.value) }))} /></Field>
            <Field label={t('license.f_users', 'Users allowed')}><input className="form-input" inputMode="numeric" disabled={scope === 'one'} value={scope === 'one' ? '1' : v.users} onChange={e => setV(x => ({ ...x, users: digits(e.target.value) }))} placeholder={t('license.any', 'any')} /></Field>
          </div>
          <p className="form-hint !mt-2">{t('license.f_first_hint', 'The licence runs for these months plus days from today. Both 0 = no expiry (trial or your own copy).')}</p>
        </Section>
        <ScopeFields t={t} scope={scope} setScope={setScope} user={user} setUser={setUser} names={names} setNames={setNames} />
        <MoreOptions t={t} message={v.message} notes={v.notes} onMessage={x => setV(p => ({ ...p, message: x }))} onNotes={x => setV(p => ({ ...p, notes: x }))} />
      </form>
    </Modal>
  );
};

const PayDialog: React.FC<{ t: T; row: LicenseRecord; busy: boolean; err: React.ReactNode; formatCurrency: (n: number) => string; formatDate: (s?: string | null) => string; onClose: () => void; onSubmit: (v: { months: number; days: number; amount: number; method: string; note: string; paidOn: string }) => void }> = ({ t, row, busy, err, formatCurrency, formatDate, onClose, onSubmit }) => {
  const [months, setMonths] = useState('1');
  const [days, setDays] = useState('0');
  const [amount, setAmount] = useState(String(row.monthly_fee || ''));
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const m = Math.max(0, Math.min(120, Math.floor(Number(months) || 0)));
  const base = Math.max(row.paid_until ? Date.parse(row.paid_until) : Date.now(), Date.now());
  const d = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)));
  const to = m === 0 && d === 0 ? row.paid_until : addPeriod(base, m, d);
  // suggested amount: the monthly fee for the months, and a 30th of it for each extra day (editable)
  useEffect(() => { if (!touched && row.monthly_fee) setAmount(String(Math.round((Number(row.monthly_fee) || 0) * (m + d / 30)))); }, [m, d, touched, row.monthly_fee]);
  return (
    <Modal open onClose={onClose} locked={busy} size="sm" icon={<Banknote size={18} />} title={t('license.payment', 'Payment')} subtitle={row.customer}
      footer={<div className="flex flex-col gap-2">{err}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
        <button type="submit" form="lic-pay" disabled={busy || (m === 0 && d === 0 && !Number(amount))} className="btn btn-primary">{busy ? t('common.saving', 'Saving…') : t('license.record', 'Record payment')}</button></div></div>}>
      <form id="lic-pay" className="space-y-4 text-xs" onSubmit={e => { e.preventDefault(); onSubmit({ months: m, days: d, amount: Number(amount) || 0, method: 'Cash', note, paidOn }); }}>
        <div className="grid grid-cols-3 gap-4">
          <Field label={t('license.f_months_n', 'Months')}><input className="form-input" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value.replace(/\D/g, '').slice(0, 3))} autoFocus /></Field>
          <Field label={t('license.f_days', 'Extra days')}><input className="form-input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
          <Field label={t('license.f_amount', 'Amount received')}><input className="form-input" inputMode="decimal" value={amount} onChange={e => { setTouched(true); setAmount(e.target.value); }} /></Field>
        </div>
        <Field label={t('license.f_date', 'Received on')}><input type="date" className="form-input" value={paidOn} onChange={e => setPaidOn(e.target.value)} /></Field>
        <Field label={t('license.f_note', 'Note (optional)')}><input className="form-input" value={note} onChange={e => setNote(e.target.value)} /></Field>
        <div className="rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800 p-3 leading-relaxed">
          {t('license.runs_until', 'Licence will run until')}: <b>{to ? formatDate(to) : t('license.no_expiry', 'No expiry')}</b>
          {row.paid_until && Date.parse(row.paid_until) < Date.now() && <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">{t('license.lapsed_note', 'The licence had already ended, so the period counts from today.')}</div>}
          {Number(amount) > 0 && <div className="text-[10px] text-slate-500 mt-1">{formatCurrency(Number(amount))}</div>}
        </div>
      </form>
    </Modal>
  );
};

const EditDialog: React.FC<{ t: T; row: LicenseRecord; busy: boolean; err: React.ReactNode; onClose: () => void; onDelete: () => void; onSubmit: (v: { customer: string; username: string; contact: string; notes: string; message: string; monthly_fee: number; max_devices: number; max_users: number | null; restrict_users: boolean }) => void }> = ({ t, row, busy, err, onClose, onDelete, onSubmit }) => {
  const [v, setV] = useState({ customer: row.customer, contact: row.contact || '', fee: String(row.monthly_fee || ''), devs: String(row.max_devices || 1), users: row.max_users == null ? '' : String(row.max_users), message: row.message || '', notes: row.notes || '' });
  const [scope, setScope] = useState<Scope>(row.username ? 'one' : row.restrict_users ? 'list' : 'all');
  const [user, setUser] = useState(row.username || '');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<any>) => setV(x => ({ ...x, [k]: e.target.value }));
  const ready = !!v.customer.trim() && (scope !== 'one' || !!user.trim());
  return (
    <Modal open onClose={onClose} locked={busy} size="md" icon={<Pencil size={18} />} title={t('license.edit', 'Edit')} subtitle={row.customer}
      footer={<div className="flex flex-col gap-2">{err}<div className="flex items-center justify-between gap-2"><button type="button" onClick={onDelete} disabled={busy} className="btn btn-danger-outline btn-sm"><Trash2 size={13} />{t('common.delete', 'Delete')}</button>
        <div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="lic-edit" disabled={busy || !ready} className="btn btn-primary">{busy ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</button></div></div></div>}>
      <form id="lic-edit" className="space-y-6 text-xs" onSubmit={e => { e.preventDefault(); onSubmit({ customer: v.customer, username: scope === 'one' ? user : '', contact: v.contact, notes: v.notes, message: v.message, monthly_fee: Number(v.fee) || 0,
        max_devices: Number(v.devs) || 1, max_users: scope === 'one' || !v.users.trim() ? null : Number(v.users) || null, restrict_users: scope === 'list' }); }}>
        <Section title={t('license.sec_customer', 'Customer')}>
          <Field label={t('license.f_name', 'Customer / fund name')}><input className="form-input" value={v.customer} onChange={set('customer')} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('license.f_contact', 'Phone or email')}><input className="form-input" value={v.contact} onChange={set('contact')} /></Field>
            <Field label={t('license.f_fee', 'Monthly fee')}><input className="form-input" inputMode="decimal" value={v.fee} onChange={set('fee')} /></Field>
          </div>
        </Section>
        <Section title={t('license.sec_licence', 'Licence')}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('license.f_devs', 'Computers allowed')}><input className="form-input" inputMode="numeric" value={v.devs} onChange={e => setV(x => ({ ...x, devs: digits(e.target.value) }))} /></Field>
            <Field label={t('license.f_users', 'Users allowed')}><input className="form-input" inputMode="numeric" disabled={scope === 'one'} value={scope === 'one' ? '1' : v.users} onChange={e => setV(x => ({ ...x, users: digits(e.target.value) }))} placeholder={t('license.any', 'any')} /></Field>
          </div>
        </Section>
        <ScopeFields t={t} scope={scope} setScope={setScope} user={user} setUser={setUser} names="" setNames={() => undefined} editing used={row.devices.length > 0} />
        <MoreOptions t={t} message={v.message} notes={v.notes} onMessage={x => setV(p => ({ ...p, message: x }))} onNotes={x => setV(p => ({ ...p, notes: x }))} />
      </form>
    </Modal>
  );
};

const HistoryDialog: React.FC<{ t: T; row: LicenseRecord; onClose: () => void; formatCurrency: (n: number) => string; formatDate: (s?: string | null) => string; n: (v: number | string) => string }> = ({ t, row, onClose, formatCurrency, formatDate, n }) => {
  const [list, setList] = useState<LicensePayment[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { licenseAdminPayments(row.id).then(setList, e => setErr(e.message)); }, [row.id]);
  const total = (list || []).reduce((s, p) => s + Number(p.amount), 0);
  return (
    <Modal open onClose={onClose} size="lg" icon={<History size={18} />} title={t('license.history', 'Payment history')} subtitle={row.customer}
      footer={<div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('license.total', 'Total received')}: {formatCurrency(total)}</span><button type="button" onClick={onClose} className="btn btn-cancel">{t('common.close', 'Close')}</button></div>}>
      {err ? <p className="text-xs text-rose-600">{err}</p> : !list ? <p className="text-xs text-slate-400">{t('common.loading', 'Loading…')}</p> : list.length === 0 ? <p className="text-xs text-slate-400">{t('license.no_payments', 'No payments recorded yet.')}</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="py-2 px-3 font-bold">{t('common.date', 'Date')}</th><th className="py-2 px-3 font-bold">{t('license.f_paid_for', 'Paid for')}</th><th className="py-2 px-3 font-bold">{t('license.period', 'Period')}</th><th className="py-2 px-3 font-bold text-right">{t('license.f_amount', 'Amount received')}</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">{list.map(p => (
            <tr key={p.id}><td className="py-2 px-3 whitespace-nowrap">{formatDate(p.paid_on)}{p.note ? <div className="text-[10px] text-slate-500">{p.note}</div> : null}</td><td className="py-2 px-3 whitespace-nowrap">{[p.months ? t('license.n_months', '{n} month(s)').replace('{n}', n(p.months)) : '', p.days ? t('license.n_days', '{n} day(s)').replace('{n}', n(p.days)) : ''].filter(Boolean).join(' + ') || '—'}</td>
              <td className="py-2 px-3 whitespace-nowrap text-slate-500">{p.period_to ? `→ ${formatDate(p.period_to)}` : '—'}</td><td className="py-2 px-3 text-right tabular-nums font-bold">{formatCurrency(Number(p.amount))}</td></tr>))}</tbody>
        </table></div>
      )}
    </Modal>
  );
};

const DevicesDialog: React.FC<{ t: T; row: LicenseRecord; busy: boolean; err: React.ReactNode; formatDate: (s?: string | null) => string; n: (v: number | string) => string; seen: (iso: string | null) => { text: string; online: boolean };
  onClose: () => void; onRemoveDevice: (id: string) => void; onRemoveUser: (id: string) => void; onAddUser: (name: string, note: string) => Promise<boolean> }> = ({ t, row, busy, err, formatDate, n, seen, onClose, onRemoveDevice, onRemoveUser, onAddUser }) => {
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [ask, setAsk] = useState<null | { kind: 'device' | 'user'; id: string; label: string }>(null);
  const tagged = !!row.username;
  const devices: LicenseDevice[] = [...row.devices].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
  const users: LicenseUser[] = [...row.users].sort((a, b) => a.username.localeCompare(b.username));
  const sub = (cond: boolean, text: string) => (cond ? <span className="text-rose-600 dark:text-rose-400 font-bold"> · {text}</span> : null);
  return (
    <Modal open onClose={onClose} size="lg" icon={<Laptop size={18} />} title={t('license.devices', 'Computers and users')} subtitle={row.customer}
      footer={<div className="flex flex-col gap-2">{err}<div className="flex justify-end"><button type="button" onClick={onClose} className="btn btn-cancel">{t('common.close', 'Close')}</button></div></div>}>
      <div className="space-y-6 text-xs">
        <section>
          <h4 className="font-black text-slate-900 dark:text-white text-sm mb-2">{t('license.h_computers', 'Computers')} <span className="font-semibold text-slate-500">{n(devices.length)} / {n(row.max_devices)}</span>{sub(devices.length >= row.max_devices, t('license.full', 'full'))}</h4>
          {devices.length === 0 ? <p className="text-slate-400">{t('license.no_devices', 'No computer has used this PIN yet.')}</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="py-2 px-3 font-bold">{t('license.d_computer', 'Computer')}</th><th className="py-2 px-3 font-bold">{t('license.d_last_user', 'Last user')}</th><th className="py-2 px-3 font-bold">{t('license.c_seen', 'Last seen')}</th><th className="py-2 px-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">{devices.map(d => { const sn = seen(d.last_seen); return (
                <tr key={d.id}><td className="py-2 px-3"><div className="font-bold text-slate-900 dark:text-white">{d.device_name || '—'}</div><div className="text-[10px] text-slate-500">v{d.app_version || '?'} · {t('license.since', 'since')} {formatDate(d.first_seen)}</div></td>
                  <td className="py-2 px-3">{d.last_user || '—'}</td>
                  <td className="py-2 px-3 whitespace-nowrap"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${sn.online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />{sn.text}</td>
                  <td className="py-2 px-3 text-right"><button type="button" disabled={busy} className="btn btn-danger-outline btn-sm" onClick={() => setAsk({ kind: 'device', id: d.id, label: d.device_name || '—' })}><Trash2 size={12} />{t('license.remove', 'Remove')}</button></td></tr>); })}</tbody>
            </table></div>
          )}
        </section>
        <section>
          <h4 className="font-black text-slate-900 dark:text-white text-sm mb-2">{t('license.h_users', 'Users')} <span className="font-semibold text-slate-500">{tagged ? t('license.one_user', '1 user') : row.restrict_users ? `${n(users.length)} (${t('license.listed', 'listed')})${row.max_users == null ? '' : ` / ${n(row.max_users)}`}` : row.max_users == null ? `${n(users.length)} (${t('license.any', 'any')})` : `${n(users.length)} / ${n(row.max_users)}`}</span>{sub(!tagged && row.max_users != null && users.length >= row.max_users, t('license.full', 'full'))}</h4>
          {row.restrict_users && <p className="mb-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{t('license.only_listed', 'Only the users in this list may sign in. Anyone else is refused.')}</p>}
          {!tagged && (
            <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (!newName.trim()) return; const ok = await onAddUser(newName, newNote); if (ok) { setNewName(''); setNewNote(''); } }}>
              <div className="flex-1 min-w-[10rem]"><label className="form-label">{t('license.add_user', 'Add a user')}</label><input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="cashier1" autoComplete="off" spellCheck={false} /></div>
              <div className="flex-1 min-w-[10rem]"><label className="form-label">{t('license.user_note', 'Note (optional)')}</label><input className="form-input" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder={t('license.user_note_ph', 'e.g. the cashier\'s name')} /></div>
              <button type="submit" disabled={busy || !newName.trim()} className="btn btn-primary"><Plus size={14} />{t('license.add', 'Add')}</button>
            </form>
          )}
          {users.length === 0 ? <p className="text-slate-400">{row.restrict_users ? t('license.no_users_list', 'The list is empty. Add the usernames that may sign in.') : t('license.no_users', 'No user has signed in under this licence yet.')}</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="py-2 px-3 font-bold">{t('license.d_user', 'Username')}</th><th className="py-2 px-3 font-bold">{t('license.c_seen', 'Last seen')}</th><th className="py-2 px-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">{users.map(u => (
                <tr key={u.id}><td className="py-2 px-3"><div className="font-bold text-slate-900 dark:text-white">{u.username}</div>{u.note && <div className="text-[10px] text-slate-500">{u.note}</div>}</td><td className="py-2 px-3 whitespace-nowrap">{u.last_seen ? seen(u.last_seen).text : <span className="text-slate-400">{t('license.not_signed_in', 'Not signed in yet')}</span>}</td>
                  <td className="py-2 px-3 text-right"><button type="button" disabled={busy} className="btn btn-danger-outline btn-sm" onClick={() => setAsk({ kind: 'user', id: u.id, label: u.username })}><Trash2 size={12} />{t('license.remove', 'Remove')}</button></td></tr>))}</tbody>
            </table></div>
          )}
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{t('license.users_note', 'A user is counted the first time they sign in. Removing a user frees a place; if they sign in again they are counted again.')}</p>
        </section>
      </div>
      {ask && (
        <Modal open onClose={() => setAsk(null)} size="sm" tone="danger" icon={<Trash2 size={18} />}
          title={ask.kind === 'device' ? t('license.rm_device_title', 'Remove computer {x}?').replace('{x}', ask.label) : t('license.rm_user_title', 'Remove user {x}?').replace('{x}', ask.label)}
          footer={<div className="flex justify-end gap-2"><button type="button" className="btn btn-cancel" onClick={() => setAsk(null)}>{t('common.cancel', 'Cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={() => { const a = ask; setAsk(null); if (a.kind === 'device') onRemoveDevice(a.id); else onRemoveUser(a.id); }}>{t('license.remove', 'Remove')}</button></div>}>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ask.kind === 'device'
            ? t('license.rm_device_body', 'The computer is locked at its next check and its place is free for another computer. Its data is not touched.')
            : t('license.rm_user_body', 'Their place under the user limit is freed. Nothing is deleted on their computer.')}</p>
        </Modal>
      )}
    </Modal>
  );
};
