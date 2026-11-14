import React from 'react';
import { Check, Eye, Ban, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MODULE_GROUPS, type ModuleKey, type AccessLevel } from '../../utils/access';

interface Props {
  value: Record<ModuleKey, AccessLevel>;
  /** the role's default for each module: shown as a hint, and changed rows are marked */
  defaults: Record<ModuleKey, AccessLevel>;
  onChange: (module: ModuleKey, level: AccessLevel) => void;
  /** an Auditor can never edit */
  role?: string;
  readOnly?: boolean;
}

const LEVELS: AccessLevel[] = ['none', 'view', 'edit'];

/** One row per module with None / View / Edit. Used when creating a user and in the access editor. */
export const AccessMatrix: React.FC<Props> = ({ value, defaults, onChange, role, readOnly }) => {
  const { t, language } = useApp();
  const levelText = (l: AccessLevel) => l === 'none' ? t('access.l_none', 'No access') : l === 'view' ? t('access.l_view', 'View') : t('access.l_edit', 'Edit');
  const icon = (l: AccessLevel) => l === 'none' ? <Ban size={12} /> : l === 'view' ? <Eye size={12} /> : <Pencil size={12} />;
  const tone = (l: AccessLevel) => l === 'none'
    ? 'bg-slate-600 text-white border-slate-600'
    : l === 'view' ? 'bg-sky-600 text-white border-sky-600' : 'bg-[#0f4a3c] text-white border-[#0f4a3c] dark:bg-emerald-600 dark:border-emerald-600';

  return (
    <div className="space-y-4">
      {MODULE_GROUPS.map(g => (
        <div key={g.key} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {language === 'bn' ? g.title[1] : g.title[0]}
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {g.modules.map(m => {
              const cur = value[m] || 'none';
              const changed = cur !== defaults[m];
              return (
                <div key={m} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      {t(`access.m_${m}`, m)}
                      {changed && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-black">{t('access.changed', 'changed')}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{t(`access.d_${m}`, '')} · {t('access.role_default', 'role default')}: {levelText(defaults[m])}</div>
                  </div>
                  <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden" role="radiogroup" aria-label={t(`access.m_${m}`, m)}>
                    {LEVELS.map(l => {
                      const disabled = readOnly || (l === 'edit' && role === 'Auditor');
                      const on = cur === l;
                      return (
                        <button key={l} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(m, l)}
                          title={disabled && !readOnly ? t('access.auditor_cap', 'An Auditor can never edit') : undefined}
                          className={`px-3 py-1.5 text-[11px] font-bold flex items-center gap-1 border-r last:border-r-0 border-slate-200 dark:border-slate-700 transition-colors ${on ? tone(l) : 'bg-white dark:bg-[#142026] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1a2b34]'} ${disabled && !on ? 'opacity-40 cursor-not-allowed' : ''}`}>
                          {on ? <Check size={12} /> : icon(l)}{levelText(l)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
