import React, { useState, useEffect } from 'react';
import {
  Building,
  Save,
  Database,
  ArrowRight,
  Shield,
  Coins,
  HardDriveDownload,
  Palette,
  Sun,
  Moon,
  Globe,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getAppSettings, saveAppSettings } from '../services/db';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface FormState {
  organization_name: string;
  currency_symbol: string;
  default_monthly_due: string;
  monthly_due_day: string;
  late_fee_amount: string;
  fiscal_year_start_month: number;
  auto_backup_enabled: boolean;
  auto_backup_keep: string;
}

const EMPTY: FormState = {
  organization_name: '',
  currency_symbol: '',
  default_monthly_due: '',
  monthly_due_day: '',
  late_fee_amount: '',
  fiscal_year_start_month: 7,
  auto_backup_enabled: true,
  auto_backup_keep: '14',
};

export const SettingsView: React.FC = () => {
  const { setActiveTab, showToast, triggerRefresh, refreshKey, t, isDarkMode, toggleDarkMode, language, toggleLanguage } = useApp();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    let alive = true;
    getAppSettings()
      .then(s => {
        if (!alive) return;
        setForm({
          organization_name: s.organization_name ?? '',
          currency_symbol: s.currency_symbol ?? '',
          default_monthly_due: String(s.default_monthly_due ?? ''),
          monthly_due_day: String(s.monthly_due_day ?? ''),
          late_fee_amount: String(s.late_fee_amount ?? ''),
          fiscal_year_start_month: Number(s.fiscal_year_start_month) || 7,
          auto_backup_enabled: s.auto_backup_enabled !== false,
          auto_backup_keep: String(s.auto_backup_keep ?? 14),
        });
        setLoaded(true);
        setLoadError(null);
      })
      .catch(e => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, [refreshKey]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    const isNum = (v: string) => v.trim() !== '' && !isNaN(Number(v));
    if (!form.organization_name.trim()) e.organization_name = t('settings.err_required', 'Required');
    if (!form.currency_symbol.trim()) e.currency_symbol = t('settings.err_required', 'Required');
    if (!isNum(form.default_monthly_due) || Number(form.default_monthly_due) < 0) e.default_monthly_due = t('settings.err_amount', 'Enter an amount of 0 or more');
    if (!isNum(form.late_fee_amount) || Number(form.late_fee_amount) < 0) e.late_fee_amount = t('settings.err_amount', 'Enter an amount of 0 or more');
    const day = Number(form.monthly_due_day);
    if (!isNum(form.monthly_due_day) || !Number.isInteger(day) || day < 1 || day > 28) e.monthly_due_day = t('settings.err_day', 'Must be a whole number from 1 to 28');
    const keep = Number(form.auto_backup_keep);
    if (!isNum(form.auto_backup_keep) || !Number.isInteger(keep) || keep < 1 || keep > 365) e.auto_backup_keep = t('settings.err_keep', 'Must be a whole number from 1 to 365');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      showToast(t('settings.fix_errors', 'Please fix the highlighted fields.'), 'error');
      return;
    }
    setSaving(true);
    try {
      await saveAppSettings({
        organization_name: form.organization_name.trim(),
        currency_symbol: form.currency_symbol.trim(),
        default_monthly_due: Number(form.default_monthly_due),
        monthly_due_day: Number(form.monthly_due_day),
        late_fee_amount: Number(form.late_fee_amount),
        fiscal_year_start_month: form.fiscal_year_start_month,
        auto_backup_enabled: form.auto_backup_enabled,
        auto_backup_keep: Number(form.auto_backup_keep),
      });
      showToast(t('settings.saved', 'Settings saved.'));
      triggerRefresh();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldErr = (k: keyof FormState) =>
    errors[k] ? <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{errors[k]}</p> : null;
  const inputCls = (k: keyof FormState, extra = '') =>
    `form-input ${extra} ${errors[k] ? 'border-rose-500 focus:border-rose-500' : ''}`;

  const sectionTitle = (icon: React.ReactNode, title: string, desc: string) => (
    <>
      <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">{icon}<span>{title}</span></h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{desc}</p>
    </>
  );

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('settings.title', 'Settings')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('settings.subtitle', 'Organization profile, dues rules, automatic backups and appearance.')}
        </p>
      </div>

      {loadError && (
        <div className="card-base p-4 text-xs text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900">
          {t('settings.load_error', 'Could not load settings')}: {loadError}
        </div>
      )}

      <div className="card-base p-6">
        <form onSubmit={handleSave} noValidate className="space-y-6 text-xs">
          <fieldset disabled={!loaded || saving} className="space-y-6">
            <div>
              {sectionTitle(<Building size={16} className="text-brand dark:text-emerald-400" />, t('settings.org_profile', 'Organization profile'), t('settings.org_desc', 'Shown in the top bar, receipts and reports.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">{t('settings.org_name', 'Organization name')}</label>
                  <input type="text" value={form.organization_name} onChange={e => set('organization_name', e.target.value)} className={inputCls('organization_name')} />
                  {fieldErr('organization_name')}
                </div>
                <div>
                  <label className="form-label">{t('settings.currency', 'Currency symbol')}</label>
                  <input type="text" maxLength={8} value={form.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} className={inputCls('currency_symbol', 'font-bold')} />
                  {fieldErr('currency_symbol')}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {sectionTitle(<Coins size={16} className="text-brand dark:text-emerald-400" />, t('settings.dues_rules', 'Dues & fiscal year'), t('settings.dues_desc', 'Defaults for new members and the late-fee rule.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">{t('settings.default_due', 'Default monthly due')}</label>
                  <input type="number" min={0} value={form.default_monthly_due} onChange={e => set('default_monthly_due', e.target.value)} className={inputCls('default_monthly_due', 'font-bold')} />
                  {fieldErr('default_monthly_due')}
                </div>
                <div>
                  <label className="form-label">{t('settings.due_day', 'Due day of month (1–28)')}</label>
                  <input type="number" min={1} max={28} step={1} value={form.monthly_due_day} onChange={e => set('monthly_due_day', e.target.value)} className={inputCls('monthly_due_day', 'font-bold')} />
                  {fieldErr('monthly_due_day')}
                </div>
                <div>
                  <label className="form-label">{t('settings.late_fee', 'Late fee amount')}</label>
                  <input type="number" min={0} value={form.late_fee_amount} onChange={e => set('late_fee_amount', e.target.value)} className={inputCls('late_fee_amount', 'font-bold')} />
                  {fieldErr('late_fee_amount')}
                </div>
                <div>
                  <label className="form-label">{t('settings.fy_start', 'Fiscal year starts in')}</label>
                  <select value={form.fiscal_year_start_month} onChange={e => set('fiscal_year_start_month', Number(e.target.value))} className="form-select font-semibold">
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{t(`month.${m.toLowerCase()}`, m)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {sectionTitle(<HardDriveDownload size={16} className="text-brand dark:text-emerald-400" />, t('settings.auto_backup', 'Automatic backups'), t('settings.auto_backup_desc', 'A snapshot is saved once a day in the local backups folder.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 cursor-pointer">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.auto_backup_enabled', 'Daily automatic snapshot')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.auto_backup_enabled}
                    onClick={() => set('auto_backup_enabled', !form.auto_backup_enabled)}
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${form.auto_backup_enabled ? 'bg-brand dark:bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.auto_backup_enabled ? 'translate-x-4' : ''}`} />
                  </button>
                </label>
                <div>
                  <label className="form-label">{t('settings.auto_backup_keep', 'Number of daily snapshots to keep')}</label>
                  <input type="number" min={1} max={365} step={1} value={form.auto_backup_keep} onChange={e => set('auto_backup_keep', e.target.value)} className={inputCls('auto_backup_keep', 'font-bold')} />
                  {fieldErr('auto_backup_keep')}
                </div>
              </div>
            </div>
          </fieldset>

          <div className="flex items-center justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={!loaded || saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={15} />
              <span>{saving ? t('common.saving', 'Saving...') : t('settings.save', 'Save changes')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Appearance */}
      <div className="card-base p-6 text-xs">
        {sectionTitle(<Palette size={16} className="text-brand dark:text-emerald-400" />, t('settings.appearance', 'Appearance'), t('settings.appearance_desc', 'Stored on this computer only.'))}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={toggleDarkMode}
            className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
              {isDarkMode ? <Moon size={15} /> : <Sun size={15} />}
              {t('settings.theme', 'Theme')}
            </span>
            <span className="font-bold text-brand dark:text-emerald-400">{isDarkMode ? t('settings.dark', 'Dark') : t('settings.light', 'Light')}</span>
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
              <Globe size={15} />
              {t('settings.language', 'Language')}
            </span>
            <span className="font-bold text-brand dark:text-emerald-400">{language === 'bn' ? 'বাংলা' : 'English'}</span>
          </button>
        </div>
      </div>

      {/* Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onClick={() => setActiveTab('backup')}
          className="card-base p-5 hover:border-brand dark:hover:border-emerald-500 cursor-pointer transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-light dark:bg-emerald-950 text-brand dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
              <Database size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t('nav.backup', 'Backup & Restore')}</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.backup_link_desc', 'Back up, restore, snapshots and data reset')}</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-all" />
        </div>
        <div
          onClick={() => setActiveTab('master')}
          className="card-base p-5 hover:border-amber-500 cursor-pointer transition-all flex items-center justify-between group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800">
              <Shield size={20} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t('nav.master', 'Master Data')}</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.master_link_desc', 'Expense categories, investment sectors, payment methods')}</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
};
