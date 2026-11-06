import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MoneyInput } from '../components/common/MoneyInput';
import {
  ImagePlus,
  Trash2,
  Loader2,
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
import { saveAppSettings } from '../services/db';
import { imageFileToDataUrl } from '../utils/image';
import { MONTH_NAMES, BN_MONTHS } from '../utils/date';
import { SearchableSelect } from '../components/common/SearchableSelect';

interface FormState {
  organization_name: string;
  organization_name_bn: string;
  org_logo: string;
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
  organization_name_bn: '',
  org_logo: '',
  currency_symbol: '',
  default_monthly_due: '',
  monthly_due_day: '',
  late_fee_amount: '',
  fiscal_year_start_month: 7,
  auto_backup_enabled: true,
  auto_backup_keep: '14',
};

export const SettingsView: React.FC = () => {
  const { setActiveTab, showToast, triggerRefresh, t, isDarkMode, toggleDarkMode, language, toggleLanguage, settings } = useApp();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const logoRef = useRef<HTMLInputElement>(null);
  const loaded = !!settings;

  const monthOptions = useMemo(
    () => MONTH_NAMES.map((m, i) => ({ value: i + 1, label: language === 'bn' ? BN_MONTHS[i] : m })),
    [language],
  );

  // Settings come from the app context (loaded once, refreshed on triggerRefresh) — no extra fetch here.
  useEffect(() => {
    const s = settings;
    if (!s) return;
    setForm({
          organization_name: s.organization_name ?? '',
          organization_name_bn: s.organization_name_bn ?? '',
          org_logo: s.org_logo ?? '',
          currency_symbol: s.currency_symbol ?? '',
          default_monthly_due: String(s.default_monthly_due ?? ''),
          monthly_due_day: String(s.monthly_due_day ?? ''),
          late_fee_amount: String(s.late_fee_amount ?? ''),
          fiscal_year_start_month: Number(s.fiscal_year_start_month) || 7,
          auto_backup_enabled: s.auto_backup_enabled !== false,
          auto_backup_keep: String(s.auto_backup_keep ?? 14),
    });
    setErrors({});
  }, [settings]);

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    try {
      set('org_logo', await imageFileToDataUrl(file, { maxSize: 256, keepTransparency: true }));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLogoBusy(false);
    }
  };
  const logoDirty = (settings?.org_logo || '') !== form.org_logo;
  const initials = (form.organization_name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || 'BF').toUpperCase();
  const previewName = (language === 'bn' && form.organization_name_bn.trim()) || form.organization_name.trim() || t('admin.org_name_placeholder', 'Your organization');

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    const isNum = (v: string) => v.trim() !== '' && !isNaN(Number(v));
    if (!form.organization_name.trim()) e.organization_name = t('admin.settings_err_required', 'Required');
    if (!form.currency_symbol.trim()) e.currency_symbol = t('admin.settings_err_required', 'Required');
    if (!isNum(form.default_monthly_due) || Number(form.default_monthly_due) < 0) e.default_monthly_due = t('admin.settings_err_amount', 'Enter an amount of 0 or more');
    if (!isNum(form.late_fee_amount) || Number(form.late_fee_amount) < 0) e.late_fee_amount = t('admin.settings_err_amount', 'Enter an amount of 0 or more');
    const day = Number(form.monthly_due_day);
    if (!isNum(form.monthly_due_day) || !Number.isInteger(day) || day < 1 || day > 28) e.monthly_due_day = t('admin.settings_err_day', 'Must be a whole number from 1 to 28');
    const keep = Number(form.auto_backup_keep);
    if (!isNum(form.auto_backup_keep) || !Number.isInteger(keep) || keep < 1 || keep > 365) e.auto_backup_keep = t('admin.settings_err_keep', 'Must be a whole number from 1 to 365');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      showToast(t('admin.settings_fix_errors', 'Please fix the highlighted fields.'), 'error');
      return;
    }
    setSaving(true);
    try {
      await saveAppSettings({
        organization_name: form.organization_name.trim(),
        organization_name_bn: form.organization_name_bn.trim(),
        org_logo: form.org_logo || '',
        currency_symbol: form.currency_symbol.trim(),
        default_monthly_due: Number(form.default_monthly_due),
        monthly_due_day: Number(form.monthly_due_day),
        late_fee_amount: Number(form.late_fee_amount),
        fiscal_year_start_month: form.fiscal_year_start_month,
        auto_backup_enabled: form.auto_backup_enabled,
        auto_backup_keep: Number(form.auto_backup_keep),
      });
      showToast(t('admin.settings_saved', 'Settings saved.'));
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
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('admin.settings_title', 'Settings')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('admin.settings_subtitle', 'Organization profile, dues rules, automatic backups and appearance.')}
        </p>
      </div>

      {!loaded && (
        <div className="card-base p-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> {t('common.loading', 'Loading…')}
        </div>
      )}

      <div className="card-base p-6">
        <form onSubmit={handleSave} noValidate className="space-y-6 text-xs">
          <fieldset disabled={!loaded || saving} className="space-y-6">
            <div>
              {sectionTitle(<Building size={16} className="text-brand dark:text-emerald-400" />, t('admin.settings_branding', 'Organization branding'), t('admin.settings_branding_desc', 'Logo and name shown in the sidebar, top bar, receipts and reports.'))}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                {/* Logo upload + previews */}
                <div className="lg:col-span-2 space-y-3">
                  <label className="form-label">{t('admin.settings_logo', 'Logo')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: 'light', label: t('admin.settings_preview_light', 'Light'), cls: 'bg-white border-slate-200 text-slate-900' },
                      { key: 'dark', label: t('admin.settings_preview_dark', 'Dark'), cls: 'bg-[#101b21] border-[#22353f] text-white' },
                    ].map(tile => (
                      <div key={tile.key} className={`rounded-2xl border p-3 flex flex-col items-center gap-2 ${tile.cls}`}>
                        <div className="w-16 h-16 flex items-center justify-center">
                          {form.org_logo ? (
                            <img src={form.org_logo} alt={t('admin.settings_logo', 'Logo')} className="max-w-full max-h-full object-contain" draggable={false} />
                          ) : (
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-sm ${tile.key === 'dark' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>{initials}</div>
                          )}
                        </div>
                        <span className="text-[11px] font-bold text-center leading-tight line-clamp-2 break-words w-full">{previewName}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-50">{tile.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => logoRef.current?.click()}
                      disabled={logoBusy}
                      className="btn btn-outline"
                    >
                      {logoBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                      {form.org_logo ? t('admin.settings_change_logo', 'Change logo') : t('admin.settings_upload_logo', 'Upload logo')}
                    </button>
                    {form.org_logo && (
                      <button
                        type="button"
                        onClick={() => set('org_logo', '')}
                        className="btn btn-danger-outline"
                      >
                        <Trash2 size={14} /> {t('admin.settings_remove_logo', 'Remove logo')}
                      </button>
                    )}
                    <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp" className="hidden" onChange={onPickLogo} />
                  </div>
                  <p className="form-hint text-[11px] text-slate-400 dark:text-slate-500">
                    {logoDirty
                      ? <span className="text-amber-600 dark:text-amber-400 font-semibold">{t('admin.settings_logo_unsaved', 'Logo changed — click “Save changes” to apply.')}</span>
                      : t('admin.settings_logo_hint', 'PNG with a transparent background or SVG works best. Resized to 256 px.')}
                  </p>
                </div>

                {/* Names */}
                <div className="lg:col-span-3 space-y-4">
                  <div>
                    <label className="form-label">{t('admin.settings_org_name_en', 'Organization name (English)')} *</label>
                    <input type="text" value={form.organization_name} onChange={e => set('organization_name', e.target.value)} className={inputCls('organization_name')} />
                    {fieldErr('organization_name')}
                  </div>
                  <div>
                    <label className="form-label">{t('admin.settings_org_name_bn', 'Organization name (Bangla)')}</label>
                    <input type="text" lang="bn" value={form.organization_name_bn} onChange={e => set('organization_name_bn', e.target.value)}
                      placeholder={t('admin.settings_org_name_bn_ph', 'Shown when the app language is Bangla')} className={inputCls('organization_name_bn')} />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {sectionTitle(<Coins size={16} className="text-brand dark:text-emerald-400" />, t('admin.settings_currency_section', 'Currency'), t('admin.settings_currency_desc', 'Symbol used on receipts and exported reports.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">{t('admin.settings_currency', 'Currency symbol')}</label>
                  <input type="text" maxLength={8} value={form.currency_symbol} onChange={e => set('currency_symbol', e.target.value)} className={inputCls('currency_symbol', 'font-bold')} />
                  {fieldErr('currency_symbol')}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {sectionTitle(<Coins size={16} className="text-brand dark:text-emerald-400" />, t('admin.settings_dues_rules', 'Dues & fiscal year'), t('admin.settings_dues_desc', 'Defaults for new members and the late-fee rule.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">{t('admin.settings_default_due', 'Default monthly due')}</label>
                  <MoneyInput min={0} value={form.default_monthly_due} onChange={e => set('default_monthly_due', e.target.value)} className={inputCls('default_monthly_due', 'font-bold')} />
                  {fieldErr('default_monthly_due')}
                </div>
                <div>
                  <label className="form-label">{t('admin.settings_due_day', 'Due day of month (1–28)')}</label>
                  <input type="number" min={1} max={28} step={1} value={form.monthly_due_day} onChange={e => set('monthly_due_day', e.target.value)} className={inputCls('monthly_due_day', 'font-bold')} />
                  {fieldErr('monthly_due_day')}
                </div>
                <div>
                  <label className="form-label">{t('admin.settings_late_fee', 'Late fee amount')}</label>
                  <MoneyInput min={0} value={form.late_fee_amount} onChange={e => set('late_fee_amount', e.target.value)} className={inputCls('late_fee_amount', 'font-bold')} />
                  {fieldErr('late_fee_amount')}
                </div>
                <div>
                  <label className="form-label">{t('admin.settings_fy_start', 'Fiscal year starts in')}</label>
                  <SearchableSelect
                    options={monthOptions}
                    value={form.fiscal_year_start_month}
                    onChange={v => set('fiscal_year_start_month', Number(v))}
                    disabled={!loaded || saving}
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {sectionTitle(<HardDriveDownload size={16} className="text-brand dark:text-emerald-400" />, t('admin.settings_auto_backup', 'Automatic backups'), t('admin.settings_auto_backup_desc', 'A snapshot is saved once a day in the local backups folder.'))}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 cursor-pointer">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t('admin.settings_auto_backup_enabled', 'Daily automatic snapshot')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.auto_backup_enabled} aria-label={t('admin.settings_auto_backup', 'Automatic daily backup')}
                    onClick={() => set('auto_backup_enabled', !form.auto_backup_enabled)}
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${form.auto_backup_enabled ? 'bg-brand dark:bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.auto_backup_enabled ? 'translate-x-4' : ''}`} />
                  </button>
                </label>
                <div>
                  <label className="form-label">{t('admin.settings_auto_backup_keep', 'Number of daily snapshots to keep')}</label>
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
              className="btn btn-primary btn-lg"
            >
              <Save size={15} />
              <span>{saving ? t('common.saving', 'Saving...') : t('admin.settings_save', 'Save changes')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Appearance */}
      <div className="card-base p-6 text-xs">
        {sectionTitle(<Palette size={16} className="text-brand dark:text-emerald-400" />, t('admin.settings_appearance', 'Appearance'), t('admin.settings_appearance_desc', 'Stored on this computer only.'))}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={toggleDarkMode}
            className="btn btn-outline !h-12 !justify-between !px-4 w-full"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
              {isDarkMode ? <Moon size={15} /> : <Sun size={15} />}
              {t('admin.settings_theme', 'Theme')}
            </span>
            <span className="font-bold text-brand dark:text-emerald-400">{isDarkMode ? t('admin.settings_dark', 'Dark') : t('admin.settings_light', 'Light')}</span>
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="btn btn-outline !h-12 !justify-between !px-4 w-full"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
              <Globe size={15} />
              {t('admin.settings_language', 'Language')}
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
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('admin.settings_backup_link_desc', 'Back up, restore, snapshots and data reset')}</p>
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
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('admin.settings_master_link_desc', 'Expense categories, investment sectors, payment methods')}</p>
            </div>
          </div>
          <ArrowRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </div>
  );
};
