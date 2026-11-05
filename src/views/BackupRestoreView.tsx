import React, { useState, useEffect } from 'react';
import {
  HardDriveDownload,
  Upload,
  ShieldCheck,
  Database,
  CheckCircle,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  performBackup,
  performRestore,
  resetDatabase,
  getBackupLogs,
} from '../services/db';
import { BackupRecord } from '../types';

export const BackupRestoreView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey } = useApp();
  const [dbInfo, setDbInfo] = useState<{ path: string; sizeKb: string; lastModified: string; exists: boolean }>({
    path: 'Loading...',
    sizeKb: '0',
    lastModified: 'Loading...',
    exists: true,
  });
  const [backupLogs, setBackupLogs] = useState<BackupRecord[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.getDatabaseInfo) {
      window.electronAPI.getDatabaseInfo().then(setDbInfo);
    } else {
      setDbInfo({
        path: 'LocalStorage / WebAssembly In-Memory SQLite',
        sizeKb: '248.50',
        lastModified: new Date().toLocaleString(),
        exists: true,
      });
    }
    getBackupLogs().then(setBackupLogs);
  }, [refreshKey]);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      const res = await performBackup();
      if (res.canceled) {
        showToast('Backup canceled by user', 'info');
      } else if (res.success) {
        showToast(`Backup created successfully: ${res.filePath || 'Saved'}`);
        triggerRefresh();
      } else {
        showToast(`Backup failed: ${res.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreNow = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to restore the database from a backup file?\n\nA safety rollback snapshot will be automatically created before restoring.'
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const res = await performRestore();
      if (res.canceled) {
        showToast('Restore canceled by user', 'info');
      } else if (res.success) {
        showToast(`Database restored successfully from "${res.fileName}"! Live state updated.`);
        triggerRefresh();
      } else {
        showToast(`Restore failed: ${res.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleWebFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        const res = await performRestore(bytes);
        if (res.success) {
          showToast(`Database restored from "${file.name}"!`);
          triggerRefresh();
        } else {
          showToast(`Restore failed: ${res.error}`, 'error');
        }
      } catch (err: any) {
        showToast(`Error: ${err.message}`, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleResetToDemo = async () => {
    const confirmed = window.confirm(
      'Reset all data back to initial mockups demo dataset (48 members, June 2024 ledger, 4 investments)?'
    );
    if (!confirmed) return;

    try {
      await resetDatabase();
      showToast('Database reset to initial demo dataset successfully!');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Database Backup & Restore Center</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          100% offline local SQLite database protection with automated rollback safety snapshots.
        </p>
      </div>

      {/* Database Status Card */}
      <div className="card-base p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
              <Database size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Active SQLite Database File</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <CheckCircle size={10} />
                  <span>Online & Healthy</span>
                </span>
              </div>
              <p className="text-xs font-mono text-slate-600 dark:text-slate-400 mt-1 break-all">{dbInfo.path}</p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold">File Size</span>
              <span className="font-black text-slate-900 dark:text-white text-sm">{dbInfo.sizeKb} KB</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold">Last Synced</span>
              <span className="font-bold text-slate-900 dark:text-white">{dbInfo.lastModified}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Cards: Backup vs Restore */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backup Card */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center mb-3 border border-emerald-200 dark:border-emerald-800">
              <HardDriveDownload size={20} />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Create Database Backup</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Opens the native Windows Save File Dialog. Export a full, uncompressed SQLite binary copy of your entire ledger, members, investments, and settings to any destination (USB thumb drive, documents, or external backup drive).
            </p>
          </div>

          <button
            onClick={handleBackupNow}
            disabled={isBackingUp}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.99]"
          >
            <HardDriveDownload size={16} />
            <span>{isBackingUp ? 'Creating Backup...' : 'Take Database Backup Now (.db)'}</span>
          </button>
        </div>

        {/* Restore Card */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center mb-3 border border-amber-200 dark:border-amber-800">
              <Upload size={20} />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Restore Database from Backup</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Select a previous <span className="font-mono font-bold">.db</span> backup file to restore. The system automatically creates a safety snapshot of the current active database before restoring, ensuring 100% rollback capability.
            </p>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleRestoreNow}
              disabled={isRestoring}
              className="w-full flex items-center justify-center gap-2 py-3 bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.99]"
            >
              <Upload size={16} />
              <span>{isRestoring ? 'Restoring Database...' : 'Select & Restore Backup File'}</span>
            </button>

            {/* Browser Fallback File Input */}
            <div className="text-center">
              <label className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer underline font-bold">
                Or browse file directly
                <input
                  type="file"
                  accept=".db,.sqlite"
                  onChange={handleWebFileRestore}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Snapshots & Reset Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Safety Rollback Snapshots (2 cols) */}
        <div className="lg:col-span-2 card-base p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={18} className="text-[#0f4a3c] dark:text-emerald-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Backup Activity & Audit Trail</h3>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {backupLogs.map(log => (
              <div key={log.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white font-mono">{log.file_name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {log.backup_type}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 block truncate max-w-md">
                    {log.file_path}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-800 dark:text-slate-200 font-bold block">{(log.file_size / 1024).toFixed(1)} KB</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{log.created_at}</span>
                </div>
              </div>
            ))}
            {backupLogs.length === 0 && (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500">
                No backup records logged yet. Click &quot;Take Database Backup Now&quot; above to create your first backup.
              </div>
            )}
          </div>
        </div>

        {/* Maintenance / Demo Reset Card (1 col) */}
        <div className="card-base p-6 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center mb-3">
              <RotateCcw size={18} />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Reset Demo Database</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Restore the original demo data matching all 5 UX/UI reference screenshots (48 members, June 2024 collections, TK 1,284,600 fund balance, and 4 active investments).
            </p>
          </div>

          <button
            onClick={handleResetToDemo}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors mt-6 border border-slate-200 dark:border-slate-700"
          >
            <RotateCcw size={14} />
            <span>Reset Demo Data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
