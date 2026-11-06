import React, { useEffect, useState } from 'react';
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';

export const MIN_PIN = 6;

interface Props {
  open: boolean;
  /** set = choose a new PIN for a backup (typed twice); enter = unlock an encrypted backup */
  mode: 'set' | 'enter';
  fileName?: string;
  /** Return an error message to keep the dialog open, or null when done. */
  onSubmit: (pin: string) => Promise<string | null>;
  /** Offered only to the Super User, when the picked backup carries a recovery block. */
  onMasterSubmit?: (password: string, masterPin: string) => Promise<string | null>;
  onClose: () => void;
}

/** PIN prompt for encrypted backups. The PIN only lives in this dialog's state while it is open. */
export const PinDialog: React.FC<Props> = ({ open, mode, fileName, onSubmit, onMasterSubmit, onClose }) => {
  const { t } = useApp();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [master, setMaster] = useState(false);          // Super User recovery view
  const [pw, setPw] = useState('');

  useEffect(() => { if (open) { setPin(''); setAgain(''); setShow(false); setError(null); setBusy(false); setMaster(false); setPw(''); } }, [open, mode]);

  const tooShort = pin.length > 0 && pin.length < MIN_PIN;
  const mismatch = mode === 'set' && again.length > 0 && pin !== again;
  const ready = master ? pw.length > 0 && pin.length > 0 : mode === 'set' ? pin.length >= MIN_PIN && pin === again : pin.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const err = master && onMasterSubmit ? await onMasterSubmit(pw, pin) : await onSubmit(pin);
      if (err) { setError(err); setPin(''); setAgain(''); setPw(''); }
    } finally { setBusy(false); }
  };

  const type = show ? 'text' : 'password';
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      locked={busy}
      size="sm"
      icon={mode === 'set' ? <Lock size={18} /> : <KeyRound size={18} />}
      title={master ? t('pin.master_title', 'Super User recovery') : mode === 'set' ? t('pin.set_title', 'Protect this backup with a PIN') : t('pin.enter_title', 'Enter the backup PIN')}
      subtitle={mode === 'enter' && fileName ? fileName : undefined}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel min-w-[7rem]">{t('common.cancel', 'Cancel')}</button>
        <button type="submit" form="pin-form" disabled={!ready || busy} className="btn btn-primary min-w-[10rem]">
          <ShieldCheck size={16} />
          <span>{busy ? t('pin.working', 'Working…') : mode === 'set' ? t('pin.encrypt', 'Encrypt & save') : t('pin.unlock', 'Unlock & restore')}</span>
        </button>
      </>}
    >
      <form id="pin-form" onSubmit={submit} noValidate className="space-y-3.5">
        {mode === 'set' && (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {t('pin.set_info', 'The backup file is encrypted. It can only be opened by Bondhu Fund with this exact PIN. If you forget the PIN, the backup cannot be recovered by anyone.')}
          </p>
        )}
        {master && (
          <>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t('pin.master_info', 'You are signed in as the Super User. Confirm your account password and enter the master PIN to open this backup without its owner\'s PIN.')}</p>
            <div>
              <label className="form-label">{t('pin.account_password', 'Your account password')} <span className="text-rose-500">*</span></label>
              <input type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="off" spellCheck={false} className="form-input" />
            </div>
          </>
        )}
        <div>
          <label className="form-label">{master ? t('pin.master_pin', 'Master PIN') : mode === 'set' ? t('pin.new', 'New PIN') : t('pin.pin', 'PIN')} <span className="text-rose-500">*</span></label>
          <div className="relative">
            <input type={type} value={pin} onChange={e => setPin(e.target.value)} autoFocus={!master} autoComplete="off" spellCheck={false}
              className="form-input font-mono tracking-widest pr-11" placeholder={mode === 'set' ? t('pin.placeholder', 'At least 6 digits or characters') : ''} />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? t('pin.hide', 'Hide PIN') : t('pin.show', 'Show PIN')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {tooShort && mode === 'set' && !master && <p className="text-[11px] text-rose-600 mt-1">{t('pin.too_short', 'Use at least 6 characters.')}</p>}
        </div>
        {mode === 'set' && !master && (
          <div>
            <label className="form-label">{t('pin.confirm', 'Confirm PIN')} <span className="text-rose-500">*</span></label>
            <input type={type} value={again} onChange={e => setAgain(e.target.value)} autoComplete="off" spellCheck={false} className="form-input font-mono tracking-widest" />
            {mismatch && <p className="text-[11px] text-rose-600 mt-1">{t('pin.mismatch', 'The two PINs do not match.')}</p>}
          </div>
        )}
        {mode === 'enter' && onMasterSubmit && !master && (
          <button type="button" onClick={() => { setMaster(true); setPin(''); setError(null); }} className="text-xs font-bold text-[#0f6b50] dark:text-emerald-400 hover:underline">
            {t('pin.forgot', 'Forgot the PIN? Recover as Super User')}
          </button>
        )}
        {master && (
          <button type="button" onClick={() => { setMaster(false); setPin(''); setPw(''); setError(null); }} className="text-xs font-bold text-slate-500 hover:underline">
            {t('pin.back', '← Back to PIN')}
          </button>
        )}
        {error && <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
      </form>
    </Modal>
  );
};
