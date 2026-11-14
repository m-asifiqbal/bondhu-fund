import React, { useState, useEffect, useCallback } from 'react';
import { serial } from '../utils/i18n';
import {
  HardDriveDownload,
  Upload,
  ShieldCheck,
  Database,
  FolderOpen,
  Camera,
  RotateCcw,
  Trash2,
  Sparkles,
  AlertTriangle,
  History,
} from 'lucide-react';
import { Modal } from '../components/common/Modal';
import { HealthCheckCard } from '../components/HealthCheckCard';
import { PinDialog } from '../components/modals/PinDialog';
import { MasterRecoveryCard } from '../components/MasterRecoveryCard';
import { ExcelDataCard } from '../components/ExcelDataCard';
import { GoogleSyncCard } from '../components/GoogleSyncCard';
import { DriveBackupCard } from '../components/DriveBackupCard';
import { useApp } from '../context/AppContext';
import {
  performBackup,
  performRestore,
  resetDatabase,
  loadDemoData,
  restoreWithPin,
  restoreWithMaster,
  cancelPendingRestore,
  getBackupLogs,
  getAppInfo,
  listSnapshots,
  restoreSnapshot,
  snapshotNow,
  openBackupsFolder,
} from '../services/db';
import { AppInfo, BackupRecord, SnapshotFile } from '../types';

const baseName = (p?: string) => (p ? String(p).split(/[\\/]/).pop() || p : '');

interface ConfirmState {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** If set, the user must type this word before confirming. */
  typeWord?: string;
  onConfirm: () => Promise<void>;
}

const ConfirmDialog: React.FC<{ state: ConfirmState; onClose: () => void }> = ({ state, onClose }) => {
  const { t } = useApp();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const canConfirm = !busy && (!state.typeWord || typed.trim() === state.typeWord);

  const run = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await state.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      locked={busy}
      size="sm" tone={state.danger ? 'danger' : 'warning'}
      icon={<AlertTriangle size={20} />}
      title={state.title}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="btn btn-cancel"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={run}
            disabled={!canConfirm}
            className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {busy ? t('finance.working', 'Working…') : state.confirmLabel}
          </button>
        </div>
      }
    >
      <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-2">{state.body}</div>
      {state.typeWord && (
        <form className="mt-4" onSubmit={e => { e.preventDefault(); run(); }}>
          <label className="form-label">
            {t('finance.backup_type_to_confirm', 'Type {word} to confirm')
              .split('{word}')
              .map((part, i, arr) => (
                <React.Fragment key={i}>
                  {part}
                  {i < arr.length - 1 && <span className="font-mono font-black">{state.typeWord}</span>}
                </React.Fragment>
              ))}
          </label>
          <input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            className="form-input font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('finance.backup_type_aria', 'Confirmation word')}
          />
        </form>
      )}
    </Modal>
  );
};

export const BackupRestoreView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey, t, tv, formatDate, language, toBanglaDigits, isAdmin, canUpload, can } = useApp();
  const n = useCallback((v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v)), [language, toBanglaDigits]);
  const kb = (v: number | string) => `${n(v)} ${t('finance.backup_kb', 'KB')}`;
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotFile[]>([]);
  const [backupLogs, setBackupLogs] = useState<BackupRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  /** ISO (UTC) or 'YYYY-MM-DD HH:MM:SS' (local) -> localized date + HH:MM */
  const formatStamp = useCallback((s?: string | null) => {
    if (!s) return '—';
    let datePart = s.slice(0, 10);
    let timePart = s.slice(11, 16);
    if (s.includes('T')) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
    return `${formatDate(datePart)}${timePart ? ` ${n(timePart)}` : ''}`;
  }, [formatDate, n]);

  const load = useCallback(async () => {
    try {
      setInfo(await getAppInfo());
      setInfoError(null);
    } catch (e: any) {
      setInfoError(e.message);
    }
    listSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    getBackupLogs().then(setBackupLogs).catch(() => setBackupLogs([]));
  }, []);

  useEffect(() => { load(); }, [refreshKey, load]);

  const afterChange = () => { triggerRefresh(); load(); };

  // Backups are always encrypted: the PIN dialog opens first, the file is only written after a valid PIN.
  const [pinDlg, setPinDlg] = useState<null | { mode: 'set' } | { mode: 'enter'; fileName: string; master?: boolean }>(null);
  const handleBackupNow = () => setPinDlg({ mode: 'set' });

  const submitBackupPin = async (pin: string): Promise<string | null> => {
    setBusy('backup');
    try {
      const res = await performBackup(pin);
      if (res.canceled) { showToast(t('finance.backup_canceled', 'Backup canceled.'), 'info'); setPinDlg(null); return null; }
      if (res.success) {
        setLastSavedPath(res.filePath || null);
        showToast(`${t('finance.backup_saved_to', 'Encrypted backup saved to')} ${res.filePath || ''}`);
        setPinDlg(null); afterChange(); return null;
      }
      return res.error || t('finance.backup_failed', 'Backup failed.');
    } finally { setBusy(null); }
  };

  const submitMasterRestore = async (password: string, masterPin: string): Promise<string | null> => {
    const res = await restoreWithMaster(password, masterPin);
    if (res.success) {
      showToast(`${t('finance.backup_restored_from', 'Restored from')} "${res.fileName}". ${t('finance.backup_safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
      setPinDlg(null); afterChange(); return null;
    }
    return res.error || t('finance.backup_restore_failed', 'Restore failed.');
  };

  const submitRestorePin = async (pin: string): Promise<string | null> => {
    const res = await restoreWithPin(pin);
    if (res.success) {
      showToast(`${t('finance.backup_restored_from', 'Restored from')} "${res.fileName}". ${t('finance.backup_safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
      setPinDlg(null); afterChange(); return null;
    }
    return res.error || t('finance.backup_restore_failed', 'Restore failed.');
  };

  const askRestoreFromFile = () => setConfirm({
    title: t('finance.backup_restore_confirm_title', 'Restore from a backup file?'),
    confirmLabel: t('finance.backup_choose_file', 'Choose file & restore'),
    body: (
      <>
        <p>{t('finance.backup_restore_confirm_1', 'All current data (members, collections, expenses, investments, settings and users) will be replaced by the contents of the backup file you choose.')}</p>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t('finance.backup_restore_confirm_2', 'Your current data is saved first as a PreRestore_ snapshot, so you can undo this from the Local snapshots list.')}
        </p>
        <p>{t('finance.backup_restore_confirm_3', 'Older backups are checked and upgraded automatically. Invalid files are rejected without changing anything.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        const res = await performRestore();
        if (res.needsPin) { setPinDlg({ mode: 'enter', fileName: res.fileName || '', master: !!res.masterRecovery }); return; }
        if (res.canceled) showToast(t('finance.backup_restore_canceled', 'Restore canceled.'), 'info');
        else if (res.success) {
          showToast(`${t('finance.backup_restored_from', 'Restored from')} "${res.fileName}". ${t('finance.backup_safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
          afterChange();
        } else showToast(res.error || t('finance.backup_restore_failed', 'Restore failed.'), 'error');
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const askRestoreSnapshot = (s: SnapshotFile) => setConfirm({
    title: t('finance.backup_restore_snapshot_title', 'Restore this snapshot?'),
    confirmLabel: t('finance.backup_restore', 'Restore'),
    body: (
      <>
        <p>
          {t('finance.backup_restore_snapshot_1', 'Current data will be replaced with')} <span className="font-mono font-bold">{s.fileName}</span> ({formatStamp(s.createdAt)}).
        </p>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t('finance.backup_restore_confirm_2', 'Your current data is saved first as a PreRestore_ snapshot, so you can undo this from the Local snapshots list.')}
        </p>
      </>
    ),
    onConfirm: async () => {
      const res = await restoreSnapshot(s.fileName);
      if (res.success) {
        showToast(`${t('finance.backup_restored_from', 'Restored from')} "${res.fileName}". ${t('finance.backup_safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
        afterChange();
      } else showToast(res.error || t('finance.backup_restore_failed', 'Restore failed.'), 'error');
    },
  });

  const handleSnapshotNow = async () => {
    setBusy('snapshot');
    try {
      const name = await snapshotNow();
      showToast(`${t('finance.backup_snapshot_created', 'Snapshot created')}: ${name}`);
      afterChange();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const err = await openBackupsFolder();
      if (err) showToast(err, 'error'); // shell.openPath returns an error string on failure
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const askClearAll = () => setConfirm({
    title: t('finance.backup_clear_title', 'Clear all business data?'),
    confirmLabel: t('finance.backup_clear_confirm', 'Clear all data'),
    danger: true,
    typeWord: 'DELETE',
    body: (
      <>
        <p>{t('finance.backup_clear_body_1', 'This permanently removes all members, collections, expenses and investments.')}</p>
        <p>{t('finance.backup_clear_body_2', 'Users, settings and master data are kept. Take a backup first if you may need this data again.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        await resetDatabase(true);
        showToast(t('finance.backup_cleared', 'All business data cleared.'));
        afterChange();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const askLoadDemo = () => setConfirm({
    title: t('finance.backup_demo_title', 'Load demo data?'),
    confirmLabel: t('finance.backup_demo_confirm', 'Load demo data'),
    danger: true,
    body: (
      <>
        <p>{t('finance.backup_demo_body_1', 'Demo data REPLACES all current business data (members, collections, expenses, investments) with sample records for exploring the app.')}</p>
        <p>{t('finance.backup_demo_body_2', 'Take a backup first if you have real data.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        await loadDemoData();
        showToast(t('finance.backup_demo_loaded', 'Demo data loaded.'));
        afterChange();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const snapshotKind = (f: string) =>
    f.startsWith('Auto_') ? { label: t('finance.backup_kind_auto', 'Automatic'), cls: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300' }
    : f.startsWith('PreRestore_') ? { label: t('finance.backup_kind_prerestore', 'Before restore'), cls: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300' }
    : f.startsWith('Manual_') ? { label: t('finance.backup_kind_manual', 'Manual'), cls: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300' }
    : { label: t('finance.backup_kind_other', 'Other'), cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };

  const stats: Array<[string, React.ReactNode]> = info ? [
    [t('finance.backup_size', 'File size'), kb(info.sizeKb)],
    [t('finance.backup_schema', 'Schema version'), `v${n(info.schemaVersion)}`],
    [t('finance.backup_app_version', 'App version'), n(info.version)],
    [t('finance.backup_last_modified', 'Last modified'), formatStamp(info.lastModified)],
    [t('finance.backup_members', 'Members'), n(info.members)],
    [t('finance.backup_collections', 'Collections'), n(info.collections)],
    [t('finance.inv_list', 'Investments'), n(info.investments)],
    [t('finance.backup_expenses', 'Expenses'), n(info.expenses)],
    [t('finance.backup_users', 'Users'), n(info.users)],
    [t('finance.backup_master_items', 'Master items'), n(info.masterData)],
    [t('finance.backup_audit_entries', 'Audit entries'), n(info.auditEntries)],
  ] : [];

  const btnPrimary = 'btn btn-primary';
  const btnSecondary = 'btn btn-outline';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('finance.backup_title', 'Backup & Restore')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('finance.backup_subtitle', 'Your data is stored only on this computer. Back up regularly to a USB drive or cloud folder.')}
        </p>
      </div>

      {can('google_sync', 'view') && <GoogleSyncCard />}
      {can('drive_backup', 'view') && <DriveBackupCard />}

      {can('backup', 'view') && <ExcelDataCard />}

      {canUpload && can('backup', 'view') && <MasterRecoveryCard />}
      {canUpload && can('backup', 'view') && <HealthCheckCard />}

      {can('backup', 'view') && <>
      {/* Status */}
      <div className="card-base p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-light dark:bg-emerald-950 text-brand dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
            <Database size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('finance.backup_db_file', 'Database file')}</h3>
            {infoError ? (
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{infoError}</p>
            ) : (
              <p className="text-xs font-mono text-slate-600 dark:text-slate-400 mt-1 break-all select-text">{info?.dbPath || t('common.loading', 'Loading…')}</p>
            )}
            {info && (
              <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5 break-all select-text">
                {t('finance.backup_backups_dir', 'Backups folder')}: {info.backupsDir}
              </p>
            )}
          </div>
        </div>
        {info && (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3 mt-5 text-xs">
            {stats.map(([label, value], si) => (
              <div key={label} className={`rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 px-3 py-2 accent-${["purple","green","rose","blue","amber","teal"][si % 6]}`}>
                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold tracking-wide">{label}</span>
                <span className="font-black text-slate-900 dark:text-white">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card-base p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <HardDriveDownload size={18} className="text-brand dark:text-emerald-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('finance.backup_backup_title', 'Back up')}</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {t('finance.backup_backup_desc', 'Save a complete copy of all data (.db file) to any location you choose.')}
            </p>
            {lastSavedPath && (
              <p className="text-[11px] mt-2 text-emerald-700 dark:text-emerald-400 font-mono break-all select-text">
                {t('finance.backup_saved_to', 'Backup saved to')}: {lastSavedPath}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleBackupNow} disabled={!!busy} className={`${btnPrimary} flex-1`}>
              <HardDriveDownload size={15} />
              <span>{busy === 'backup' ? t('finance.working', 'Working…') : t('finance.backup_backup_now', 'Back up now')}</span>
            </button>
            <button onClick={handleOpenFolder} className="btn btn-outline">
              <FolderOpen size={15} />
              <span>{t('finance.backup_open_folder', 'Open backups folder')}</span>
            </button>
          </div>
        </div>

        <div className="card-base p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Upload size={18} className="text-amber-600 dark:text-amber-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('finance.backup_restore_title', 'Restore')}</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {t('finance.backup_restore_desc', 'Replace current data with a backup file. Your current data is snapshotted first, so a restore can always be undone.')}
            </p>
          </div>
          {!isAdmin && <p className="text-[11px] font-semibold text-slate-500">{t('finance.backup_admin_only', 'Only an Admin can restore or clear data.')}</p>}
          <button
            onClick={askRestoreFromFile}
            disabled={!!busy || !isAdmin}
            className="flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
          >
            <Upload size={15} />
            <span>{t('finance.backup_restore_from_file', 'Restore from file')}</span>
          </button>
        </div>
      </div>

      {/* Snapshots */}
      <div className="card-base overflow-hidden">
        <div className="p-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('finance.backup_snapshots', 'Local snapshots')}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('finance.backup_snapshots_desc', 'Automatic daily copies, copies taken before each restore, and manual snapshots.')}
              </p>
            </div>
          </div>
          <button onClick={handleSnapshotNow} disabled={!!busy} className={btnSecondary}>
            <Camera size={14} />
            <span>{busy === 'snapshot' ? t('finance.working', 'Working…') : t('finance.backup_snapshot_now', 'Create snapshot now')}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
<th className="text-left px-5 py-2 font-bold w-12 text-center">{t('common.no', 'No.')}</th>
                <th className="text-left px-5 py-2 font-bold">{t('finance.backup_file', 'File')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('finance.backup_type', 'Type')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('finance.backup_created', 'Created')}</th>
                <th className="text-right px-3 py-2 font-bold">{t('finance.backup_size', 'File size')}</th>
                <th className="px-5 py-2"><span className="sr-only">{t('common.actions', 'Actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {snapshots.map((s, __i) => {
                const k = snapshotKind(s.fileName);
                return (
                  <tr key={s.fileName} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34]">
<td className="py-3 px-3 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(0 + __i + 1)}</td>
                    <td className="px-5 py-2.5 font-mono font-semibold text-slate-900 dark:text-white break-all">{s.fileName}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${k.cls}`}>{k.label}</span></td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatStamp(s.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">{kb(s.sizeKb)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        onClick={() => askRestoreSnapshot(s)}
                        disabled={!!busy || !isAdmin}
                        className="btn btn-outline btn-sm"
                      >
                        <RotateCcw size={12} />
                        {t('finance.backup_restore', 'Restore')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400 dark:text-slate-500">
                    {t('finance.backup_no_snapshots', 'No snapshots yet. Automatic snapshots are created daily when enabled in Settings.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* History */}
        <div className="lg:col-span-2 card-base p-6">
          <div className="flex items-center gap-2 mb-3">
            <History size={18} className="text-brand dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('finance.backup_history', 'Backup history')}</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-[360px] overflow-y-auto">
            {backupLogs.map(log => (
              <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white font-mono truncate">{log.file_name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                      {tv(log.backup_type)}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 block truncate" title={log.file_path}>
                    {log.file_path}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-slate-800 dark:text-slate-200 font-bold block">{kb((log.file_size / 1024).toFixed(1))}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatStamp(log.created_at)}</span>
                </div>
              </div>
            ))}
            {backupLogs.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                {t('finance.backup_no_history', 'No backups yet. Click "Back up now" to create your first backup.')}
              </div>
            )}
          </div>
        </div>

        {/* Danger zone */}
        <div className={`card-base p-6 border-rose-200 dark:border-rose-900/60 space-y-4 ${isAdmin ? '' : 'hidden'}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600" />
            <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400">{t('finance.backup_danger_zone', 'Danger zone')}</h3>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('finance.backup_clear_desc', 'Remove all members, collections, expenses and investments. Users, settings and master data are kept.')}
            </p>
            <button
              onClick={askClearAll}
              disabled={!!busy}
              className="btn btn-danger-outline mt-2 w-full justify-center"
            >
              <Trash2 size={14} />
              <span>{t('finance.backup_clear_all', 'Clear all business data')}</span>
            </button>
          </div>
          {canUpload && <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('finance.backup_demo_desc', 'Replace business data with sample records to try the app.')}
            </p>
            <button onClick={askLoadDemo} disabled={!!busy} className={`${btnSecondary} mt-2 w-full`}>
              <Sparkles size={14} />
              <span>{t('finance.backup_load_demo', 'Load demo data')}</span>
            </button>
          </div>}
        </div>
      </div>
      </>}

      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
      <PinDialog open={!!pinDlg} mode={pinDlg?.mode || 'set'} fileName={pinDlg && pinDlg.mode === 'enter' ? pinDlg.fileName : undefined}
        onSubmit={pinDlg?.mode === 'enter' ? submitRestorePin : submitBackupPin}
        onMasterSubmit={pinDlg?.mode === 'enter' && pinDlg.master ? submitMasterRestore : undefined}
        onClose={() => { if (pinDlg?.mode === 'enter') cancelPendingRestore(); setPinDlg(null); }} />
    </div>
  );
};
