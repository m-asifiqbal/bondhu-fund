import React, { useCallback, useEffect, useState } from 'react';
import { HardDriveUpload, Trash2, RotateCcw, RefreshCw, Lock, Cloud } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal } from './common/Modal';
import { PinDialog } from './modals/PinDialog';
import { googleStatus, driveBackups, driveBackupNow, driveRestore, driveDelete, restoreWithPin, cancelPendingRestore } from '../services/db';
import type { DriveBackupItem } from '../types';

const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Manual backups of the whole database in the user's Google Drive (PIN-encrypted, same file as a local backup). Local backups stay as they were. */
export const DriveBackupCard: React.FC = () => {
  const { t, can, isAdmin, showToast, triggerRefresh, language, toBanglaDigits } = useApp();
  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const canEdit = can('drive_backup', 'edit');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [list, setList] = useState<DriveBackupItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setPin, setSetPin] = useState(false);
  const [restorePin, setRestorePin] = useState<null | { name: string }>(null);
  const [confirmRestore, setConfirmRestore] = useState<DriveBackupItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DriveBackupItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await googleStatus();
      setConnected(!!s.account);
      setList(s.account ? await driveBackups() : null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const done = () => { showToast(t('google.restored', 'Backup restored. The app will reload.')); triggerRefresh(); setTimeout(() => window.location.reload(), 1400); };

  const restore = async (b: DriveBackupItem) => {
    setConfirmRestore(null); setBusy(true);
    try {
      const r = await driveRestore(b.id);
      if (r.needsPin) setRestorePin({ name: b.name }); else done();
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (b: DriveBackupItem) => {
    setConfirmDelete(null); setBusy(true);
    try { await driveDelete(b.id); showToast(t('google.backup_deleted', 'Backup deleted from Google Drive.')); void load(); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="card-base p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-900"><Cloud size={24} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('google.drive_title', 'Google Drive backup')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{t('google.drive_desc', 'Save a PIN-protected copy of the whole database in your Google Drive, and restore it from here on any computer. Backups on this computer (below) keep working as before.')}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={load} disabled={loading} className="btn btn-outline btn-sm"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('google.refresh', 'Refresh')}</button>
              <button type="button" onClick={() => setSetPin(true)} disabled={!canEdit || !connected || busy} className="btn btn-primary btn-sm"><HardDriveUpload size={13} />{t('google.backup_now', 'Back up to Google Drive')}</button>
            </div>
          </div>

          {error && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
          {connected === false && <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><Lock size={13} />{t('google.drive_need_connect', 'Sign in with Google in the "Google account sync" card first.')}</p>}

          {connected && list && (list.length === 0 ? (
            <p className="mt-4 text-xs text-slate-400">{t('google.drive_empty', 'No backups in Google Drive yet.')}</p>
          ) : (
            <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-[#111e24] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <tr><th className="py-2 px-3 font-bold">{t('common.date', 'Date')}</th><th className="py-2 px-3 font-bold">{t('google.from_pc', 'Saved from')}</th><th className="py-2 px-3 font-bold text-right">{t('google.size', 'Size')}</th><th className="py-2 px-3" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                  {list.map(b => (
                    <tr key={b.id}>
                      <td className="py-2 px-3 whitespace-nowrap">{new Date(b.at).toLocaleString()}{b.encrypted && <Lock size={11} className="inline ml-1.5 text-emerald-600" aria-label={t('google.encrypted', 'Encrypted')} />}</td>
                      <td className="py-2 px-3">{b.device || '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{n(kb(b.size))}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button type="button" disabled={!canEdit || !isAdmin || busy} onClick={() => setConfirmRestore(b)} title={isAdmin ? undefined : t('finance.backup_admin_only', 'Only an Admin can restore.')} className="btn btn-green-outline btn-sm"><RotateCcw size={12} />{t('google.restore', 'Restore')}</button>
                        <button type="button" disabled={!canEdit || busy} onClick={() => setConfirmDelete(b)} className="btn btn-danger-outline btn-sm btn-icon ml-1" aria-label={t('common.delete', 'Delete')}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <PinDialog open={setPin} mode="set" onClose={() => setSetPin(false)}
        onSubmit={async pin => { try { const r = await driveBackupNow(pin); setSetPin(false); showToast(t('google.backup_done', 'Backup saved in Google Drive: {name}').replace('{name}', r.name)); void load(); return null; } catch (e: any) { return e.message; } }} />
      <PinDialog open={!!restorePin} mode="enter" fileName={restorePin?.name} onClose={() => { setRestorePin(null); cancelPendingRestore(); }}
        onSubmit={async pin => { const r = await restoreWithPin(pin); if (!r.success) return r.error || t('google.wrong_pin', 'That PIN is not correct.'); setRestorePin(null); done(); return null; }} />

      <Modal open={!!confirmRestore} onClose={() => setConfirmRestore(null)} size="sm" tone="danger" icon={<RotateCcw size={18} />} title={t('google.restore_title', 'Restore this backup?')}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setConfirmRestore(null)} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={() => confirmRestore && restore(confirmRestore)} className="btn btn-danger">{t('google.restore', 'Restore')}</button></div>}>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('google.restore_body', 'All data on this computer is replaced by this backup. A snapshot of the current data is saved first, so it can be recovered.')}</p>
      </Modal>
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} size="sm" tone="danger" icon={<Trash2 size={18} />} title={t('google.delete_title', 'Delete this backup from Google Drive?')}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setConfirmDelete(null)} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={() => confirmDelete && remove(confirmDelete)} className="btn btn-danger">{t('common.delete', 'Delete')}</button></div>}>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('google.delete_body', 'This cannot be undone. Other backups and the synced copy are not affected.')}</p>
      </Modal>
    </div>
  );
};
