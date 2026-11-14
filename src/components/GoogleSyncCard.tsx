import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudUpload, CloudDownload, RefreshCw, LogOut, LogIn, ShieldCheck, Lock, KeyRound, AlertTriangle, CheckCircle2, Info, Settings2, Laptop } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal } from './common/Modal';
import { PasswordInput } from './common/PasswordInput';
import { PinDialog } from './modals/PinDialog';
import { googleStatus, googleSaveConfig, googleClearConfig, googleConnect, googleDisconnect, googleCheck, googleSync, googleSetAuto, googleSetEncryption } from '../services/db';
import type { GoogleStatus, RemoteCheck, SyncResult, SyncCounts } from '../types';

const when = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(); };

/**
 * Google account sync: sign in with Google, then keep this computer's data and Google Drive in step both ways.
 * A new computer (or one after a lost PC) signs in with the same account and presses "Sync now" to bring everything back.
 */
export const GoogleSyncCard: React.FC = () => {
  const { t, can, showToast, toBanglaDigits, language } = useApp();
  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const canEdit = can('google_sync', 'edit');
  const [st, setSt] = useState<GoogleStatus | null>(null);
  const [remote, setRemote] = useState<RemoteCheck | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'check' | 'disconnect'>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [conflict, setConflict] = useState<SyncResult | null>(null);
  const [pinFor, setPinFor] = useState<null | { resolve?: 'local' | 'remote' }>(null);
  const [encDlg, setEncDlg] = useState<null | 'on' | 'off'>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgId, setCfgId] = useState('');
  const [cfgSecret, setCfgSecret] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await googleStatus();
      setSt(s);
      if (s.account) { try { setRemote(await googleCheck()); } catch { setRemote(null); } } else setRemote(null);
    } catch (e: any) { setMsg({ tone: 'err', text: e.message }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = (c: SyncCounts) => `${n(c.members ?? 0)} ${t('google.c_members', 'members')} · ${n(c.collections ?? 0)} ${t('google.c_payments', 'payments')} · ${n(c.loans ?? 0)} ${t('google.c_loans', 'loans')}`;

  const handle = (r: SyncResult) => {
    if (r.status === 'conflict') { setConflict(r); setMsg(r.conflict ? null : { tone: 'warn', text: r.message }); return; }
    if (r.status === 'needs-pin') { setPinFor({}); return; }
    setMsg({ tone: r.status === 'wrong-pin' ? 'err' : 'ok', text: r.message });
    if (r.replaced) {
      showToast(t('google.data_replaced', 'Data from Google Drive is now on this computer. The app will reload.'));
      setTimeout(() => window.location.reload(), 1600);
    }
  };

  const doSync = async (opts?: { resolve?: 'local' | 'remote'; pin?: string }) => {
    setBusy('sync'); setMsg(null);
    try { const r = await googleSync(opts); handle(r); return r; }
    catch (e: any) { setMsg({ tone: 'err', text: e.message }); return null; }
    finally { setBusy(null); void load(); }
  };

  const connect = async () => {
    setBusy('connect'); setMsg({ tone: 'ok', text: t('google.browser_opened', 'Your browser opened Google\'s sign-in page. Finish there, then come back here…') });
    try { const a = await googleConnect(); showToast(t('google.connected_as', 'Connected as {email}').replace('{email}', a.email)); setMsg(null); }
    catch (e: any) { setMsg({ tone: 'err', text: e.message }); }
    finally { setBusy(null); void load(); }
  };
  const disconnect = async () => {
    setBusy('disconnect');
    try { await googleDisconnect(); showToast(t('google.disconnected', 'Google account disconnected from this computer. Your data stays here and in Drive.')); setMsg(null); }
    catch (e: any) { setMsg({ tone: 'err', text: e.message }); }
    finally { setBusy(null); void load(); }
  };
  const saveCfg = async (e?: React.FormEvent) => {
    e?.preventDefault(); setCfgBusy(true);
    try { await googleSaveConfig(cfgId, cfgSecret); showToast(t('google.cfg_saved', 'Google credentials saved on this computer.')); setCfgOpen(false); setCfgId(''); setCfgSecret(''); void load(); }
    catch (err: any) { showToast(err.message, 'error'); } finally { setCfgBusy(false); }
  };

  const toggleAuto = async (on: boolean) => { try { await googleSetAuto(on); void load(); } catch (e: any) { showToast(e.message, 'error'); } };

  const connected = !!st?.account;
  const tone = (k: 'ok' | 'warn' | 'err') => k === 'ok' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
    : k === 'warn' ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200' : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300';

  const fact = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className="text-[13px] font-black text-slate-900 dark:text-white mt-1 break-words">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="card-base p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 border border-sky-200 dark:border-sky-900"><Cloud size={24} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('google.title', 'Google account sync')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {t('google.desc', 'Sign in with your Google account to keep all data safe in your own Google Drive and the same on every computer. On a new computer, sign in with the same account and press Sync now: everything comes back.')}
          </p>

          {!st ? (
            <p className="mt-4 text-xs text-slate-400">{t('common.loading', 'Loading…')}</p>
          ) : !st.configured ? (
            <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <div className="font-black flex items-center gap-1.5 mb-1"><Info size={14} />{t('google.not_set_title', 'Google is not set up on this computer yet')}</div>
              {t('google.not_set_body', 'Google needs a one-time "Desktop app" credential from the same Google Cloud project as FocusFlow. Steps are in docs/google_setup.md.')}
              <div className="mt-3">
                {st.canConfigure
                  ? <button type="button" onClick={() => setCfgOpen(true)} className="btn btn-primary btn-sm"><Settings2 size={13} />{t('google.set_up', 'Set up Google')}</button>
                  : <span className="font-semibold">{t('google.ask_super', 'Ask the Super User (iqbal_labs) to set it up.')}</span>}
              </div>
            </div>
          ) : !connected ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={connect} disabled={!canEdit || busy === 'connect'} className="btn btn-primary" title={canEdit ? undefined : t('google.no_edit', 'You have view-only access to Google sync.')}>
                <LogIn size={15} />{busy === 'connect' ? t('google.waiting', 'Waiting for Google…') : t('google.connect', 'Sign in with Google')}
              </button>
              {st.canConfigure && <button type="button" onClick={() => setCfgOpen(true)} className="btn btn-outline btn-sm"><Settings2 size={13} />{t('google.change_cfg', 'Google credentials')}</button>}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><Lock size={12} />{t('google.privacy', 'Only a private app folder in your Drive is used; nothing else in your Drive is read.')}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {st.account!.picture ? <img src={st.account!.picture} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full" />
                    : <div className="w-9 h-9 rounded-full bg-sky-600 text-white font-bold flex items-center justify-center">{st.account!.name.slice(0, 1).toUpperCase()}</div>}
                  <div className="min-w-0"><div className="text-xs font-black text-slate-900 dark:text-white truncate">{st.account!.name}</div><div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{st.account!.email}</div></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => doSync()} disabled={!canEdit || !!busy} className="btn btn-primary">
                    <RefreshCw size={15} className={busy === 'sync' ? 'animate-spin' : ''} />{busy === 'sync' ? t('google.syncing', 'Syncing…') : t('google.sync_now', 'Sync now')}
                  </button>
                  <button type="button" onClick={disconnect} disabled={!canEdit || !!busy} className="btn btn-outline btn-sm"><LogOut size={13} />{t('google.disconnect', 'Disconnect')}</button>
                </div>
              </div>

              {remote?.remoteNewer && !remote.localDirty && (
                <div className="flex items-start gap-2 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 p-3 text-xs text-sky-900 dark:text-sky-200 font-semibold">
                  <CloudDownload size={15} className="shrink-0 mt-0.5" />{t('google.newer_waiting', 'Newer data from {dev} is waiting in Google Drive. Press Sync now to bring it here.').replace('{dev}', remote.remote?.deviceName || '')}
                </div>
              )}
              {remote?.remoteNewer && remote.localDirty && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 font-semibold">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />{t('google.both_changed', 'Both this computer and Google Drive have new changes. Press Sync now to choose which to keep.')}
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {fact(t('google.last_sync', 'Last sync'), st.sync.lastSyncAt ? when(st.sync.lastSyncAt) : t('google.never', 'Never'))}
                {fact(t('google.unsynced', 'Changes not yet uploaded'), st.sync.dirty ? <span className="text-amber-700 dark:text-amber-400">{t('google.yes', 'Yes')}</span> : <span className="text-emerald-700 dark:text-emerald-400">{t('google.no', 'No')}</span>)}
                {fact(t('google.cloud_copy', 'Copy in Google Drive'), remote?.remote ? `${t('google.revision', 'Revision')} ${n(remote.remote.revision)}` : t('google.none_yet', 'None yet'),
                  remote?.remote ? `${remote.remote.deviceName} · ${when(remote.remote.at)}` : undefined)}
                {fact(t('google.this_pc', 'This computer'), <span className="flex items-center gap-1.5"><Laptop size={13} />{st.device}</span>)}
              </div>
              {remote?.remote && <p className="text-[11px] text-slate-500 dark:text-slate-400">{counts(remote.remote.counts)}</p>}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input type="checkbox" checked={st.sync.auto} disabled={!canEdit} onChange={e => toggleAuto(e.target.checked)} className="w-4 h-4 accent-[#0f4a3c]" />
                  {t('google.auto', 'Upload my changes automatically in the background (and sync when the app starts)')}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input type="checkbox" checked={st.sync.encrypt} disabled={!canEdit} onChange={e => setEncDlg(e.target.checked ? 'on' : 'off')} className="w-4 h-4 accent-[#0f4a3c]" />
                  <ShieldCheck size={14} className="text-emerald-700 dark:text-emerald-400" />{t('google.pin_protect', 'Protect the cloud copy with a sync PIN')}
                </label>
              </div>
            </div>
          )}

          {msg && <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs font-semibold ${tone(msg.tone)}`}>{msg.tone === 'ok' ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}<span>{msg.text}</span></div>}
          {st && !st.secureStorage && <p className="mt-3 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">{t('google.no_secure', 'This computer cannot protect the Google sign-in with Windows secure storage, so Google sync is unavailable here.')}</p>}
        </div>
      </div>

      {/* conflict: both sides changed */}
      <Modal open={!!conflict?.conflict} onClose={() => setConflict(null)} size="md" tone="warning" icon={<AlertTriangle size={18} />} title={t('google.conflict_title', 'Both sides have changes')}
        footer={<div className="flex justify-end"><button type="button" onClick={() => setConflict(null)} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button></div>}>
        {conflict?.conflict && (
          <div className="space-y-4 text-xs">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{t('google.conflict_body', 'This computer and Google Drive each have changes the other does not. Nothing has been overwritten. Choose the data to keep. The other side is saved first, so it can still be recovered.')}</p>
            <button type="button" onClick={() => { const r = 'local' as const; setConflict(null); void doSync({ resolve: r }); }} className="w-full text-left rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 p-4 transition-colors">
              <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white"><CloudUpload size={16} className="text-emerald-700 dark:text-emerald-400" />{t('google.keep_local', 'Keep this computer\'s data')}</div>
              <div className="mt-1 text-slate-500 dark:text-slate-400">{counts(conflict.conflict.local.counts)}{conflict.conflict.local.dirtyAt ? ` · ${t('google.changed_at', 'changed {d}').replace('{d}', when(conflict.conflict.local.dirtyAt))}` : ''}</div>
              <div className="mt-1 text-slate-600 dark:text-slate-300">{t('google.keep_local_note', 'Uploads it to Google Drive. The older Google Drive copy stays available as an earlier version.')}</div>
            </button>
            <button type="button" onClick={() => { setConflict(null); void doSync({ resolve: 'remote' }); }} className="w-full text-left rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-sky-500 p-4 transition-colors">
              <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white"><CloudDownload size={16} className="text-sky-600 dark:text-sky-400" />{t('google.keep_remote', 'Use the Google Drive data')}</div>
              <div className="mt-1 text-slate-500 dark:text-slate-400">{counts(conflict.conflict.remote.counts)} · {conflict.conflict.remote.deviceName} · {when(conflict.conflict.remote.at)}</div>
              <div className="mt-1 text-slate-600 dark:text-slate-300">{t('google.keep_remote_note', 'Replaces the data on this computer. A copy of what is here now is saved in the local snapshots first.')}</div>
            </button>
          </div>
        )}
      </Modal>

      {/* the cloud copy is PIN protected */}
      <PinDialog open={!!pinFor} mode="enter" fileName={t('google.pin_file', 'Google Drive copy')} onClose={() => setPinFor(null)}
        onSubmit={async pin => { try { const r = await googleSync({ pin, resolve: pinFor?.resolve }); if (r.status === 'wrong-pin') return r.message; setPinFor(null); handle(r); void load(); return null; } catch (e: any) { return e.message; } }} />
      {/* choose a PIN to protect the cloud copy */}
      <PinDialog open={encDlg === 'on'} mode="set" onClose={() => setEncDlg(null)}
        onSubmit={async pin => { try { await googleSetEncryption(true, pin); setEncDlg(null); showToast(t('google.pin_on', 'Sync PIN set. The cloud copy is now encrypted. Remember this PIN: a new computer asks for it.')); void load(); void doSync(); return null; } catch (e: any) { return e.message; } }} />
      <Modal open={encDlg === 'off'} onClose={() => setEncDlg(null)} size="sm" icon={<KeyRound size={18} />} title={t('google.pin_off_title', 'Remove the sync PIN?')}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setEncDlg(null)} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={async () => { try { await googleSetEncryption(false); setEncDlg(null); void load(); void doSync(); } catch (e: any) { showToast(e.message, 'error'); } }}>{t('common.confirm', 'Confirm')}</button></div>}>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('google.pin_off_body', 'The next sync stores the cloud copy without a PIN (it is still private to your Google account). New computers will no longer ask for a PIN.')}</p>
      </Modal>

      {/* Super User: the Google Cloud credentials */}
      <Modal open={cfgOpen} onClose={() => !cfgBusy && setCfgOpen(false)} locked={cfgBusy} size="md" icon={<Settings2 size={18} />} title={t('google.cfg_title', 'Google credentials')}
        subtitle={t('google.cfg_sub', 'A "Desktop app" OAuth client from the same Google Cloud project as FocusFlow.')}
        footer={<div className="flex items-center justify-between gap-2">
          <div>{st?.clientSource === 'app' && <button type="button" className="btn btn-danger-outline btn-sm" onClick={async () => { try { await googleClearConfig(); setCfgOpen(false); void load(); } catch (e: any) { showToast(e.message, 'error'); } }}>{t('google.cfg_clear', 'Remove saved credentials')}</button>}</div>
          <div className="flex gap-2"><button type="button" onClick={() => setCfgOpen(false)} disabled={cfgBusy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="submit" form="google-cfg-form" disabled={cfgBusy || !cfgId.trim() || !cfgSecret.trim()} className="btn btn-primary">{cfgBusy ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</button></div></div>}>
        <form id="google-cfg-form" onSubmit={saveCfg} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{t('google.cfg_help', 'In Google Cloud console: APIs & Services → Credentials → Create credentials → OAuth client ID → Application type "Desktop app". Paste the two values here. They are stored encrypted by Windows on this computer only. Full steps: docs/google_setup.md.')}</p>
          <div><label className="form-label">{t('google.cfg_id', 'Client ID')}</label><input className="form-input font-mono text-[11px]" value={cfgId} onChange={e => setCfgId(e.target.value)} placeholder="123456789012-abc….apps.googleusercontent.com" autoComplete="off" /></div>
          <div><label className="form-label">{t('google.cfg_secret', 'Client secret')}</label><PasswordInput value={cfgSecret} onChange={e => setCfgSecret(e.target.value)} autoComplete="off" /></div>
        </form>
      </Modal>
    </div>
  );
};
