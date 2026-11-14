import React, { useEffect, useState } from 'react';
import { ShieldCheck, RotateCcw, Eye, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { AccessMatrix } from './AccessMatrix';
import { getUserPermissions, setUserPermissions } from '../../services/db';
import { ALL_MODULES, type ModuleKey, type AccessLevel } from '../../utils/access';
import type { AppUser, UserAccess } from '../../types';

interface Props {
  user: AppUser | null;
  /** only the Super User (iqbal_labs) can change access; everyone else sees it read-only */
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** What one user may open and change, module by module. */
export const PermissionsModal: React.FC<Props> = ({ user, canEdit, onClose, onSaved }) => {
  const { t, showToast, bnName } = useApp();
  const [acc, setAcc] = useState<UserAccess | null>(null);
  const [levels, setLevels] = useState<Record<ModuleKey, AccessLevel> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setAcc(null); setLevels(null);
    getUserPermissions(user.id).then(a => { setAcc(a); setLevels({ ...a.effective }); }).catch((e: any) => showToast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const set = (m: ModuleKey, l: AccessLevel) => setLevels(v => (v ? { ...v, [m]: l } : v));
  const preset = (kind: 'default' | 'view' | 'full') => {
    if (!acc) return;
    setLevels(ALL_MODULES.reduce((o, m) => ({ ...o, [m]: kind === 'default' ? acc.defaults[m] : kind === 'view' ? (acc.defaults[m] === 'none' ? 'none' : 'view') : (acc.role === 'Auditor' ? 'view' : 'edit') }), {} as Record<ModuleKey, AccessLevel>));
  };

  const save = async () => {
    if (!user || !acc || !levels) return;
    setSaving(true);
    try {
      const custom: Partial<Record<ModuleKey, AccessLevel>> = {};
      for (const m of ALL_MODULES) if (levels[m] !== acc.defaults[m]) custom[m] = levels[m];
      await setUserPermissions(user.id, Object.keys(custom).length ? levels : null);
      showToast(t('access.saved', 'Access saved for {name}.').replace('{name}', user.full_name));
      onSaved(); onClose();
    } catch (e: any) { showToast(e.message, 'error'); } finally { setSaving(false); }
  };

  const changedCount = acc && levels ? ALL_MODULES.filter(m => levels[m] !== acc.defaults[m]).length : 0;

  return (
    <Modal
      open={!!user} onClose={() => !saving && onClose()} locked={saving} size="lg" icon={<ShieldCheck size={18} />}
      title={t('access.title', 'Module access')}
      subtitle={user ? `${bnName(user.full_name, user.full_name_bn)} · ${user.username}` : undefined}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {canEdit
              ? (changedCount ? t('access.n_changed', '{n} module(s) differ from the role default.').replace('{n}', String(changedCount)) : t('access.is_default', 'This user has the default access of their role.'))
              : t('access.read_only_note', 'Only the Super User (iqbal_labs) can change module access.')}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel">{canEdit ? t('common.cancel', 'Cancel') : t('common.close', 'Close')}</button>
            {canEdit && <button type="button" onClick={save} disabled={saving || !levels} className="btn btn-primary">{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</button>}
          </div>
        </div>
      }
    >
      {!acc || !levels ? (
        <div className="py-12 text-center text-xs text-slate-400">{t('common.loading', 'Loading…')}</div>
      ) : (
        <div className="space-y-4 text-xs">
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('access.intro', 'Choose, for each part of the app, whether this user can open it (View) and change things in it (Edit). "No access" hides it completely. The settings are enforced by the program itself, not only hidden on screen.')}
          </p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => preset('default')} className="btn btn-outline btn-sm"><RotateCcw size={12} />{t('access.preset_default', 'Role default')}</button>
              <button type="button" onClick={() => preset('view')} className="btn btn-outline btn-sm"><Eye size={12} />{t('access.preset_view', 'View only')}</button>
              <button type="button" onClick={() => preset('full')} className="btn btn-outline btn-sm"><Pencil size={12} />{t('access.preset_full', 'Full access')}</button>
            </div>
          )}
          <AccessMatrix value={levels} defaults={acc.defaults} onChange={set} role={acc.role} readOnly={!canEdit} />
        </div>
      )}
    </Modal>
  );
};
