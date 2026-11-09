import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';
import { SegmentedTabs } from '../common/SegmentedTabs';
import { saveAppSettings } from '../../services/db';
import type { LoanMethod } from '../../types';
import { useMethodText } from './loanUi';

/** Admin: the fund's loan policy. These only pre-fill the loan form and set the approval limit; every loan keeps its own terms. */
export const LoanPolicyModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t, settings, showToast, triggerRefresh } = useApp();
  const mt = useMethodText();
  const [rate, setRate] = useState('12');
  const [method, setMethod] = useState<LoanMethod>('reducing');
  const [mult, setMult] = useState('0');
  const [fee, setFee] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRate(String(settings?.loan_default_rate ?? 12));
    setMethod((settings?.loan_default_method as LoanMethod) || 'reducing');
    setMult(String(settings?.loan_max_multiple ?? 0));
    setFee(String(settings?.loan_late_fee ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveAppSettings({ loan_default_rate: Number(rate) || 0, loan_default_method: method, loan_max_multiple: Number(mult) || 0, loan_late_fee: Number(fee) || 0 });
      showToast(t('loan.policy_saved', 'Loan policy saved.'));
      triggerRefresh();
      onClose();
    } catch (err: any) { showToast(err.message, 'error'); } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open} onClose={() => !saving && onClose()} locked={saving} size="md" icon={<SlidersHorizontal size={18} />}
      title={t('loan.policy_title', 'Loan policy')}
      subtitle={t('loan.policy_sub', 'Defaults for new loans and the approval limit. Existing loans are not changed.')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="loan-policy-form" disabled={saving} className="btn btn-primary">{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</button>
        </div>
      }
    >
      <form id="loan-policy-form" onSubmit={save} className="space-y-4 text-xs">
        <div>
          <label className="form-label">{t('loan.policy_method', 'Default interest method')}</label>
          <SegmentedTabs<LoanMethod> size="sm" value={method} onChange={setMethod}
            items={[{ key: 'reducing', label: mt.label('reducing') }, { key: 'flat', label: mt.label('flat') }, { key: 'free', label: mt.label('free') }]} />
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{mt.hint(method)}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">{t('loan.policy_rate', 'Default interest rate (% a year)')}</label>
            <input type="number" min={0} max={100} step="any" value={rate} onChange={e => setRate(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" />
          </div>
          <div>
            <label className="form-label">{t('loan.policy_limit', 'Loan limit (× member\'s savings)')}</label>
            <input type="number" min={0} max={100} step="any" value={mult} onChange={e => setMult(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" />
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{t('loan.policy_limit_hint', '0 = no limit. Above the limit a written approval reason is required.')}</p>
          </div>
        </div>
        <div>
          <label className="form-label">{t('loan.policy_late', 'Suggested penalty per late installment')}</label>
          <MoneyInput min="0" step="any" value={fee} onChange={e => setFee(e.target.value)} className="form-input font-bold tabular-nums" />
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{t('loan.policy_late_hint', 'Pre-fills the penalty when a payment is late. 0 = none. It can always be changed when recording the payment.')}</p>
        </div>
      </form>
    </Modal>
  );
};
