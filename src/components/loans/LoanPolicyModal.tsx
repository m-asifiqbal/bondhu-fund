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
  const [maxActive, setMaxActive] = useState('1');
  const [blockOverdue, setBlockOverdue] = useState(true);
  const [blockWO, setBlockWO] = useState(true);
  const [minMonths, setMinMonths] = useState('0');
  const [maxArrears, setMaxArrears] = useState('0');
  const [maxPct, setMaxPct] = useState('0');
  const [reserve, setReserve] = useState('0');
  const [gMax, setGMax] = useState('2');
  const [consent, setConsent] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRate(String(settings?.loan_default_rate ?? 12));
    setMethod((settings?.loan_default_method as LoanMethod) || 'reducing');
    setMult(String(settings?.loan_max_multiple ?? 0));
    setFee(String(settings?.loan_late_fee ?? 0));
    setMaxActive(String(settings?.loan_max_active ?? 1)); setBlockOverdue(settings?.loan_block_overdue !== false); setBlockWO(settings?.loan_block_written_off !== false);
    setMinMonths(String(settings?.loan_min_member_months ?? 0)); setMaxArrears(String(settings?.loan_max_arrears_months ?? 0)); setMaxPct(String(settings?.loan_max_pct_of_fund ?? 0));
    setReserve(String(settings?.loan_cash_reserve ?? 0)); setGMax(String(settings?.loan_guarantor_max ?? 2));
    setConsent(settings?.loan_consent_required !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveAppSettings({ loan_default_rate: Number(rate) || 0, loan_default_method: method, loan_max_multiple: Number(mult) || 0, loan_late_fee: Number(fee) || 0, loan_consent_required: consent,
        loan_max_active: Number(maxActive) || 0, loan_block_overdue: blockOverdue, loan_block_written_off: blockWO, loan_min_member_months: Number(minMonths) || 0, loan_max_arrears_months: Number(maxArrears) || 0,
        loan_max_pct_of_fund: Number(maxPct) || 0, loan_cash_reserve: Number(reserve) || 0, loan_guarantor_max: Number(gMax) || 0 });
      showToast(t('loan.policy_saved', 'Loan policy saved.'));
      triggerRefresh();
      onClose();
    } catch (err: any) { showToast(err.message, 'error'); } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open} onClose={() => !saving && onClose()} locked={saving} size="md" icon={<SlidersHorizontal size={18} />}
      title={t('loan.policy_title', 'Loan policy')}
      subtitle={t('loan.policy_sub', 'Defaults for new loans and the lending rules. Existing loans are not changed.')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="loan-policy-form" disabled={saving} className="btn btn-primary">{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</button>
        </div>
      }
    >
      <form id="loan-policy-form" onSubmit={save} className="space-y-4 text-xs">
        <label className={`flex items-start gap-3 rounded-2xl border p-4 cursor-pointer select-none ${consent ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#0f4a3c]" />
          <span>
            <span className="block text-[13px] font-black text-slate-900 dark:text-white">{t('loan.policy_consent', 'Require a signed consent paper before a loan is disbursed')}</span>
            <span className="block mt-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{consent
              ? t('loan.policy_consent_on', 'A new loan is saved as a draft. The consent paper is generated, signed by the borrower and guarantor, and uploaded; only then is the loan disbursed.')
              : t('loan.policy_consent_off', 'Loans are disbursed as soon as they are saved. The consent paper can still be generated and printed, but no upload is required. Drafts already waiting can be disbursed.')}</span>
          </span>
        </label>
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div>
            <div className="text-[13px] font-black text-slate-900 dark:text-white">{t('loan.pol_title', 'Who may borrow, and how much the fund may lend')}</div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('loan.pol_hint', 'These rules are checked every time a loan is saved. Only an Admin can approve an exception, and must write the reason; it is kept on the loan. 0 means "not checked".')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="form-label">{t('loan.pol_max_active', 'Open loans per member')}</label><input type="number" min={0} step={1} value={maxActive} onChange={e => setMaxActive(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" /></div>
            <div><label className="form-label">{t('loan.pol_guarantor_max', 'Open loans one member may guarantee')}</label><input type="number" min={0} step={1} value={gMax} onChange={e => setGMax(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" /></div>
            <div><label className="form-label">{t('loan.pol_min_months', 'Minimum months of membership')}</label><input type="number" min={0} step={1} value={minMonths} onChange={e => setMinMonths(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" /></div>
            <div><label className="form-label">{t('loan.pol_max_arrears', 'Most unpaid contribution months allowed')}</label><input type="number" min={0} step={1} value={maxArrears} onChange={e => setMaxArrears(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" /></div>
            <div><label className="form-label">{t('loan.pol_max_pct', 'One loan may not exceed (% of the fund)')}</label><input type="number" min={0} max={100} step="any" value={maxPct} onChange={e => setMaxPct(e.target.value)} data-no-clear className="form-input font-bold tabular-nums" /></div>
            <div><label className="form-label">{t('loan.pol_reserve', 'Cash that must stay in hand after a loan')}</label><MoneyInput min="0" step="any" value={reserve} onChange={e => setReserve(e.target.value)} className="form-input font-bold tabular-nums" /></div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none"><input type="checkbox" checked={blockOverdue} onChange={e => setBlockOverdue(e.target.checked)} className="w-4 h-4 accent-[#0f4a3c]" />{t('loan.pol_block_overdue', 'No new loan while the member has an overdue loan')}</label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none"><input type="checkbox" checked={blockWO} onChange={e => setBlockWO(e.target.checked)} className="w-4 h-4 accent-[#0f4a3c]" />{t('loan.pol_block_wo', 'No new loan for a member who has had a loan written off')}</label>
        </div>
      </form>
    </Modal>
  );
};
