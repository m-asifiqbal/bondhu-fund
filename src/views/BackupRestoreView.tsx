import React, { useState, useEffect, useCallback } from 'react';
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
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  performBackup,
  performRestore,
  resetDatabase,
  loadDemoData,
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
    setBusy(true);
    try {
      await state.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div
        className="w-full max-w-md bg-white dark:bg-[#15232b] border border-slate-200 dark:border-[#283e4a] rounded-2xl shadow-2xl p-6 text-xs"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className={state.danger ? 'text-rose-600' : 'text-amber-600'} />
            <h3 className="text-sm font-black text-slate-900 dark:text-white">{state.title}</h3>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg">
            <X size={15} />
          </button>
        </div>
        <div className="text-slate-600 dark:text-slate-300 leading-relaxed space-y-2">{state.body}</div>
        {state.typeWord && (
          <div className="mt-4">
            <label className="form-label">
              {t('backup.type_to_confirm', 'Type')} <span className="font-mono font-black">{state.typeWord}</span> {t('backup.to_confirm', 'to confirm')}
            </label>
            <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} className="form-input font-mono" />
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={run}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-xl font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              state.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600'
            }`}
          >
            {busy ? t('common.working', 'Working...') : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const BackupRestoreView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey, t, formatDate } = useApp();
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
    return `${formatDate(datePart)}${timePart ? ` ${timePart}` : ''}`;
  }, [formatDate]);

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

  const handleBackupNow = async () => {
    setBusy('backup');
    try {
      const res = await performBackup();
      if (res.canceled) showToast(t('backup.canceled', 'Backup canceled.'), 'info');
      else if (res.success) {
        setLastSavedPath(res.filePath || null);
        showToast(`${t('backup.saved_to', 'Backup saved to')} ${res.filePath || ''}`);
        afterChange();
      } else showToast(res.error || 'Backup failed', 'error');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const askRestoreFromFile = () => setConfirm({
    title: t('backup.restore_confirm_title', 'Restore from a backup file?'),
    confirmLabel: t('backup.choose_file', 'Choose file & restore'),
    body: (
      <>
        <p>{t('backup.restore_confirm_1', 'All current data (members, collections, expenses, investments, settings and users) will be replaced by the contents of the backup file you choose.')}</p>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t('backup.restore_confirm_2', 'Your current data is saved first as a PreRestore_ snapshot, so you can undo this from the Local snapshots list.')}
        </p>
        <p>{t('backup.restore_confirm_3', 'Older backups are checked and upgraded automatically. Invalid files are rejected without changing anything.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        const res = await performRestore();
        if (res.canceled) showToast(t('backup.restore_canceled', 'Restore canceled.'), 'info');
        else if (res.success) {
          showToast(`${t('backup.restored_from', 'Restored from')} "${res.fileName}". ${t('backup.safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
          afterChange();
        } else showToast(res.error || 'Restore failed', 'error');
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const askRestoreSnapshot = (s: SnapshotFile) => setConfirm({
    title: t('backup.restore_snapshot_title', 'Restore this snapshot?'),
    confirmLabel: t('backup.restore', 'Restore'),
    body: (
      <>
        <p>
          {t('backup.restore_snapshot_1', 'Current data will be replaced with')} <span className="font-mono font-bold">{s.fileName}</span> ({formatStamp(s.createdAt)}).
        </p>
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          {t('backup.restore_confirm_2', 'Your current data is saved first as a PreRestore_ snapshot, so you can undo this from the Local snapshots list.')}
        </p>
      </>
    ),
    onConfirm: async () => {
      const res = await restoreSnapshot(s.fileName);
      if (res.success) {
        showToast(`${t('backup.restored_from', 'Restored from')} "${res.fileName}". ${t('backup.safety_snapshot', 'Safety snapshot')}: ${baseName(res.safetySnapshot)}`);
        afterChange();
      } else showToast(res.error || 'Restore failed', 'error');
    },
  });

  const handleSnapshotNow = async () => {
    setBusy('snapshot');
    try {
      const name = await snapshotNow();
      showToast(`${t('backup.snapshot_created', 'Snapshot created')}: ${name}`);
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
    title: t('backup.clear_title', 'Clear all business data?'),
    confirmLabel: t('backup.clear_confirm', 'Clear all data'),
    danger: true,
    typeWord: 'DELETE',
    body: (
      <>
        <p>{t('backup.clear_body_1', 'This permanently removes all members, collections, expenses and investments.')}</p>
        <p>{t('backup.clear_body_2', 'Users, settings and master data are kept. Take a backup first if you may need this data again.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        await resetDatabase(true);
        showToast(t('backup.cleared', 'All business data cleared.'));
        afterChange();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const askLoadDemo = () => setConfirm({
    title: t('backup.demo_title', 'Load demo data?'),
    confirmLabel: t('backup.demo_confirm', 'Load demo data'),
    danger: true,
    body: (
      <>
        <p>{t('backup.demo_body_1', 'Demo data REPLACES all current business data (members, collections, expenses, investments) with sample records for exploring the app.')}</p>
        <p>{t('backup.demo_body_2', 'Take a backup first if you have real data.')}</p>
      </>
    ),
    onConfirm: async () => {
      try {
        await loadDemoData();
        showToast(t('backup.demo_loaded', 'Demo data loaded.'));
        afterChange();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
    },
  });

  const snapshotKind = (f: string) =>
    f.startsWith('Auto_') ? { label: t('backup.kind_auto', 'Automatic'), cls: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300' }
    : f.startsWith('PreRestore_') ? { label: t('backup.kind_prerestore', 'Before restore'), cls: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300' }
    : f.startsWith('Manual_') ? { label: t('backup.kind_manual', 'Manual'), cls: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300' }
    : { label: t('backup.kind_other', 'Other'), cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };

  const stats: Array<[string, React.ReactNode]> = info ? [
    [t('backup.size', 'File size'), `${info.sizeKb} KB`],
    [t('backup.schema', 'Schema version'), `v${info.schemaVersion}`],
    [t('backup.app_version', 'App version'), info.version],
    [t('backup.last_modified', 'Last modified'), formatStamp(info.lastModified)],
    [t('nav.members', 'Members'), info.members],
    [t('nav.collections', 'Collections'), info.collections],
    [t('nav.investments', 'Investments'), info.investments],
    [t('nav.expenses', 'Expenses'), info.expenses],
    [t('backup.users', 'Users'), info.users],
    [t('backup.master_items', 'Master items'), info.masterData],
    [t('backup.audit_entries', 'Audit entries'), info.auditEntries],
  ] : [];

  const btnPrimary = 'flex items-center justify-center gap-2 py-2.5 px-4 bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const btnSecondary = 'flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('backup.title', 'Backup & Restore')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('backup.subtitle', 'Your data is stored only on this computer. Back up regularly to a USB drive or cloud folder.')}
        </p>
      </div>

      {/* Status */}
      <div className="card-base p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-light dark:bg-emerald-950 text-brand dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
            <Database size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('backup.db_file', 'Database file')}</h3>
            {infoError ? (
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{infoError}</p>
            ) : (
              <p className="text-xs font-mono text-slate-600 dark:text-slate-400 mt-1 break-all select-text">{info?.dbPath || t('common.loading', 'Loading...')}</p>
            )}
            {info && (
              <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5 break-all select-text">
                {t('backup.backups_dir', 'Backups folder')}: {info.backupsDir}
              </p>
            )}
          </div>
        </div>
        {info && (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3 mt-5 text-xs">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 px-3 py-2">
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
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('backup.backup_title', 'Back up')}</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {t('backup.backup_desc', 'Save a complete copy of all data (.db file) to any location you choose.')}
            </p>
            {lastSavedPath && (
              <p className="text-[11px] mt-2 text-emerald-700 dark:text-emerald-400 font-mono break-all select-text">
                {t('backup.saved_to', 'Backup saved to')}: {lastSavedPath}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleBackupNow} disabled={!!busy} className={`${btnPrimary} flex-1`}>
              <HardDriveDownload size={15} />
              <span>{busy === 'backup' ? t('common.working', 'Working...') : t('backup.backup_now', 'Back up now')}</span>
            </button>
            <button onClick={handleOpenFolder} className={btnSecondary}>
              <FolderOpen size={15} />
              <span>{t('backup.open_folder', 'Open backups folder')}</span>
            </button>
          </div>
        </div>

        <div className="card-base p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Upload size={18} className="text-amber-600 dark:text-amber-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t('backup.restore_title', 'Restore')}</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {t('backup.restore_desc', 'Replace current data with a backup file. Your current data is snapshotted first, so a restore can always be undone.')}
            </p>
          </div>
          <button
            onClick={askRestoreFromFile}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
          >
            <Upload size={15} />
            <span>{t('backup.restore_from_file', 'Restore from file')}</span>
          </button>
        </div>
      </div>

      {/* Snapshots */}
      <div className="card-base overflow-hidden">
        <div className="p-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('backup.snapshots', 'Local snapshots')}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('backup.snapshots_desc', 'Automatic daily copies, copies taken before each restore, and manual snapshots.')}
              </p>
            </div>
          </div>
          <button onClick={handleSnapshotNow} disabled={!!busy} className={btnSecondary}>
            <Camera size={14} />
            <span>{busy === 'snapshot' ? t('common.working', 'Working...') : t('backup.snapshot_now', 'Create snapshot now')}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-5 py-2 font-bold">{t('backup.file', 'File')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('backup.type', 'Type')}</th>
                <th className="text-left px-3 py-2 font-bold">{t('backup.created', 'Created')}</th>
                <th className="text-right px-3 py-2 font-bold">{t('backup.size', 'File size')}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {snapshots.map(s => {
                const k = snapshotKind(s.fileName);
                return (
                  <tr key={s.fileName} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34]">
                    <td className="px-5 py-2.5 font-mono font-semibold text-slate-900 dark:text-white break-all">{s.fileName}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${k.cls}`}>{k.label}</span></td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatStamp(s.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">{s.sizeKb} KB</td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        onClick={() => askRestoreSnapshot(s)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-amber-200 dark:border-amber-800 disabled:opacity-50"
                      >
                        <RotateCcw size={12} />
                        {t('backup.restore', 'Restore')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400 dark:text-slate-500">
                    {t('backup.no_snapshots', 'No snapshots yet. Automatic snapshots are created daily when enabled in Settings.')}
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
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('backup.history', 'Backup history')}</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-[360px] overflow-y-auto">
            {backupLogs.map(log => (
              <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white font-mono truncate">{log.file_name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                      {log.backup_type}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 block truncate" title={log.file_path}>
                    {log.file_path}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-slate-800 dark:text-slate-200 font-bold block">{(log.file_size / 1024).toFixed(1)} KB</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatStamp(log.created_at)}</span>
                </div>
              </div>
            ))}
            {backupLogs.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                {t('backup.no_history', 'No backups yet. Click "Back up now" to create your first backup.')}
              </div>
            )}
          </div>
        </div>

        {/* Danger zone */}
        <div className="card-base p-6 border-rose-200 dark:border-rose-900/60 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600" />
            <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400">{t('backup.danger_zone', 'Danger zone')}</h3>
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('backup.clear_desc', 'Remove all members, collections, expenses and investments. Users, settings and master data are kept.')}
            </p>
            <button
              onClick={askClearAll}
              disabled={!!busy}
              className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              <Trash2 size={14} />
              <span>{t('backup.clear_all', 'Clear all business data')}</span>
            </button>
          </div>
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('backup.demo_desc', 'Replace business data with sample records to try the app.')}
            </p>
            <button onClick={askLoadDemo} disabled={!!busy} className={`${btnSecondary} mt-2 w-full`}>
              <Sparkles size={14} />
              <span>{t('backup.load_demo', 'Load demo data')}</span>
            </button>
          </div>
        </div>
      </div>

      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
};
