import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getMasterStatus, setupMasterRecovery } from '../services/db';
import { Modal } from './common/Modal';

/** Super User only: create the recovery key that lets the Super User open backups whose owner forgot the PIN. */
export const MasterRecoveryCard: React.FC = () => {
  const { t, showToast } = useApp();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { getMasterStatus().then(s => setEnabled(s.enabled)).catch(() => setEnabled(null)); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (open) { setPassword(''); setPin(''); setAgain(''); setError(null); } }, [open]);

  const ready = password.length > 0 && pin.length >= 4 && pin === again;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await setupMasterRecovery(password, pin);
      showToast(t('master.saved', 'Master recovery is active.'));
      setOpen(false); setEnabled(true);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card-base accent-teal p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center"><KeyRound size={18} /></span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('master.title', 'Backup master recovery')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{enabled ? t('master.on', 'Active — new backups can be opened by you if their owner forgets the PIN.') : t('master.off', 'Not set up — backups can only be opened with their own PIN.')}</p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn btn-outline">
          <ShieldCheck size={15} /><span>{enabled ? t('master.change', 'Change master PIN') : t('master.setup', 'Set up recovery')}</span>
        </button>
      </div>
      <Modal open={open} onClose={() => !busy && setOpen(false)} locked={busy} size="sm" icon={<KeyRound size={18} />} title={t('master.title', 'Backup master recovery')}
        footer={<>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-cancel min-w-[7rem]">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="master-form" disabled={!ready || busy} className="btn btn-primary min-w-[10rem]">{busy ? t('pin.working', 'Working…') : t('master.save', 'Save recovery key')}</button>
        </>}>
        <form id="master-form" onSubmit={submit} noValidate className="space-y-3.5">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t('master.info', 'Choose the master PIN.')}</p>
          <div><label className="form-label">{t('pin.account_password', 'Your account password')} <span className="text-rose-500">*</span></label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="off" className="form-input" /></div>
          <div><label className="form-label">{t('pin.master_pin', 'Master PIN')} <span className="text-rose-500">*</span></label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} autoComplete="off" className="form-input font-mono tracking-widest" /></div>
          <div><label className="form-label">{t('pin.confirm', 'Confirm PIN')} <span className="text-rose-500">*</span></label>
            <input type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="off" className="form-input font-mono tracking-widest" />
            {again.length > 0 && pin !== again && <p className="text-[11px] text-rose-600 mt-1">{t('master.mismatch', 'The two master PINs do not match.')}</p>}</div>
          {error && <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </Modal>
    </>
  );
};
