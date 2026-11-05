import React, { useState, useEffect } from 'react';
import {
  Building,
  Save,
  Database,
  ArrowRight,
  Shield,
  HardDriveDownload,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getAppSettings, saveAppSettings, performBackup, performRestore } from '../services/db';

export const SettingsView: React.FC = () => {
  const { setActiveTab, showToast, triggerRefresh, refreshKey } = useApp();
  const [orgName, setOrgName] = useState('Bondhu Fund (Union Finance Desk)');
  const [currency, setCurrency] = useState('TK');
  const [monthlyDue, setMonthlyDue] = useState(2000);
  const [dueDay, setDueDay] = useState(5);
  const [lateFee, setLateFee] = useState(300);

  useEffect(() => {
    getAppSettings().then(s => {
      setOrgName(s.organization_name);
      setCurrency(s.currency_symbol);
      setMonthlyDue(s.default_monthly_due);
      setDueDay(s.monthly_due_day);
      setLateFee(s.late_fee_amount);
    });
  }, [refreshKey]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveAppSettings({
        organization_name: orgName,
        currency_symbol: currency,
        default_monthly_due: Number(monthlyDue),
        monthly_due_day: Number(dueDay),
        late_fee_amount: Number(lateFee),
      });
      showToast('Organization settings updated successfully in SQLite!');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">System Settings</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure financial rules, organization identity, and local storage parameters.
        </p>
      </div>

      {/* Main Settings Card */}
      <div className="card-base p-6">
        <form onSubmit={handleSave} className="space-y-6 text-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Building size={16} className="text-[#0f4a3c] dark:text-emerald-400" />
              <span>Organization Profile</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Name and currency used in all receipts and reports.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Union / Fund Name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div>
                <label className="form-label">Currency Code / Symbol</label>
                <input
                  type="text"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="form-input font-bold"
                  required
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Financial Rules & Dues</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Monthly collection policies and penalty rates.</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="form-label">Default Monthly Due (TK)</label>
                <input
                  type="number"
                  value={monthlyDue}
                  onChange={e => setMonthlyDue(Number(e.target.value))}
                  className="form-input font-bold"
                  required
                />
              </div>

              <div>
                <label className="form-label">Due Day of Month</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={dueDay}
                  onChange={e => setDueDay(Number(e.target.value))}
                  className="form-input font-bold"
                  required
                />
              </div>

              <div>
                <label className="form-label">Late Fine Amount (TK)</label>
                <input
                  type="number"
                  value={lateFee}
                  onChange={e => setLateFee(Number(e.target.value))}
                  className="form-input font-bold"
                  required
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
            >
              <Save size={15} />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>

      {/* Data Backup & Restore Dedicated Card */}
      <div className="card-base p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Database size={16} className="text-[#0f4a3c] dark:text-emerald-400" />
              <span>Offline SQLite Data Backup & Restore</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Protect your data locally. Take a full snapshot to USB/documents or restore from backup.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('backup')}
            className="text-xs text-[#0f4a3c] dark:text-emerald-400 hover:underline font-bold flex items-center gap-1"
          >
            <span>Open Full Backup Center</span>
            <ArrowRight size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <button
            onClick={async () => {
              showToast('Opening native save dialog to backup database...');
              const res = await performBackup();
              if (res.success) {
                showToast(`Backup saved successfully: ${res.filePath || 'Saved'}`);
                triggerRefresh();
              } else if (!res.canceled) {
                showToast(`Backup error: ${res.error}`, 'error');
              }
            }}
            className="flex items-center justify-center gap-2 py-3 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-[0.99]"
          >
            <HardDriveDownload size={15} />
            <span>Take Database Backup Now (.db)</span>
          </button>

          <button
            onClick={async () => {
              const confirmed = window.confirm(
                'Are you sure you want to restore the database from a backup file?\nA safety rollback snapshot will be automatically created before restoring.'
              );
              if (!confirmed) return;
              showToast('Opening native file picker to select backup .db file...');
              const res = await performRestore();
              if (res.success) {
                showToast(`Database restored from "${res.fileName}"! Live state updated.`);
                triggerRefresh();
              } else if (!res.canceled) {
                showToast(`Restore error: ${res.error}`, 'error');
              }
            }}
            className="flex items-center justify-center gap-2 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-[0.99]"
          >
            <Upload size={15} />
            <span>Select & Restore Backup File</span>
          </button>
        </div>
      </div>

      {/* Quick Links Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onClick={() => setActiveTab('backup')}
          className="card-base p-5 hover:border-[#0f4a3c] dark:hover:border-emerald-500 cursor-pointer shadow-sm transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <Database size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-[#0f4a3c] dark:group-hover:text-emerald-400">
                Database Backup Center
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Export and restore SQLite database files</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-400 group-hover:text-[#0f4a3c] dark:group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
        </div>

        <div
          onClick={() => setActiveTab('master')}
          className="card-base p-5 hover:border-amber-500 cursor-pointer shadow-sm transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800">
              <Shield size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-amber-800 dark:group-hover:text-amber-400">
                Master Data Configuration
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Expense categories, investment sectors, payment methods</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-400 group-hover:text-amber-800 dark:group-hover:text-amber-400 group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
};
