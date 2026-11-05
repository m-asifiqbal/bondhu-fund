import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getAllMembersLite, recordPayment, getMasterData, suggestLateFee } from '../../services/db';
import { Member, MasterCategory } from '../../types';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { MonthPicker } from '../common/MonthPicker';
import { todayISO } from '../../utils/date';

type LiteMember = Pick<Member, 'id' | 'member_code' | 'name' | 'phone' | 'monthly_due' | 'status' | 'avatar_initials'>;

export const RecordPaymentModal: React.FC = () => {
  const {
    openRecordModal,
    setOpenRecordModal,
    triggerRefresh,
    showToast,
    selectedMemberIdForPayment,
    setSelectedMemberIdForPayment,
    selectedMonth,
    formatCurrency,
    t,
  } = useApp();

  const [members, setMembers] = useState<LiteMember[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MasterCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | ''>('');
  const [paymentMonth, setPaymentMonth] = useState(selectedMonth);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amount, setAmount] = useState<number | ''>('');
  const [lateFee, setLateFee] = useState<number | ''>(0);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [trxId, setTrxId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load members + payment methods and reset the form whenever the modal opens.
  useEffect(() => {
    if (!openRecordModal) return;
    let alive = true;
    setPaymentMonth(selectedMonth);
    setPaymentDate(todayISO());
    setTrxId('');
    setNote('');
    setLoading(true);
    Promise.all([getAllMembersLite(), getMasterData('payment_method', true)])
      .then(([list, methods]) => {
        if (!alive) return;
        const usable = list.filter(m => m.status === 'Active' || m.id === selectedMemberIdForPayment);
        setMembers(usable);
        setPaymentMethods(methods);
        setPaymentMethod(prev => (methods.some(m => m.name === prev) ? prev : methods[0]?.name || ''));
        const initial = usable.find(m => m.id === selectedMemberIdForPayment) || null;
        setSelectedMemberId(initial ? initial.id : '');
        setAmount(initial ? initial.monthly_due : '');
      })
      .catch((e: any) => showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [openRecordModal, selectedMemberIdForPayment, selectedMonth]);

  // Suggest a late fee whenever the month or payment date changes (user can override).
  useEffect(() => {
    if (!openRecordModal || !paymentMonth || !paymentDate) return;
    let alive = true;
    suggestLateFee(paymentMonth, paymentDate)
      .then(fee => alive && setLateFee(fee))
      .catch(() => undefined);
    return () => { alive = false; };
  }, [openRecordModal, paymentMonth, paymentDate]);

  if (!openRecordModal) return null;

  const handleMemberChange = (id: number) => {
    setSelectedMemberId(id);
    const m = members.find(x => x.id === id);
    if (m) setAmount(m.monthly_due);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setSelectedMemberIdForPayment(null);
    setOpenRecordModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedMemberId) { showToast(t('payment.err_member', 'Please select a member.'), 'error'); return; }
    if (!paymentDate) { showToast(t('payment.err_date', 'Please choose a payment date.'), 'error'); return; }
    if (!paymentMethod) { showToast(t('payment.err_method', 'Please choose a payment method.'), 'error'); return; }
    if (amount === '' || Number(amount) < 0) { showToast(t('payment.err_amount', 'Enter a valid contribution amount.'), 'error'); return; }
    setIsSubmitting(true);
    try {
      await recordPayment({
        member_id: Number(selectedMemberId),
        payment_month: paymentMonth,
        payment_date: paymentDate,
        contribution_amount: Number(amount),
        late_fee: Number(lateFee) || 0,
        payment_method: paymentMethod,
        trx_id: trxId.trim(),
        note: note.trim(),
      });
      showToast(t('payment.saved', 'Payment recorded.'));
      triggerRefresh();
      setSelectedMemberIdForPayment(null);
      setOpenRecordModal(false);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const memberOptions: SelectOption[] = members.map(m => ({
    value: m.id,
    label: m.name,
    subLabel: m.phone,
    badge: m.member_code,
    badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300',
  }));

  const paymentMethodOptions: SelectOption[] = paymentMethods.map(pm => ({ value: pm.name, label: pm.name }));
  const total = (Number(amount) || 0) + (Number(lateFee) || 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card-base w-full max-w-lg max-h-[95vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 shadow-2xl">
        <div className="px-6 py-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t('payment.title', 'Record Member Payment')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('payment.subtitle', 'Record a monthly contribution for a member')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <SearchableSelect
                label={t('payment.member', 'Select Member')}
                required
                isLoading={loading}
                options={memberOptions}
                value={selectedMemberId}
                onChange={val => handleMemberChange(Number(val))}
                placeholder={t('payment.member_ph', 'Search by name or code...')}
                searchPlaceholder={t('payment.member_search', 'Type member name or code...')}
              />
            </div>
            <div>
              <label className="form-label mb-1.5 block">{t('payment.month', 'Payment Month')} *</label>
              <MonthPicker value={paymentMonth} onChange={setPaymentMonth} className="w-full" align="left" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('payment.date', 'Payment Date')} *</label>
              <input
                type="date"
                value={paymentDate}
                max={todayISO()}
                onChange={e => setPaymentDate(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div>
              <SearchableSelect
                label={t('payment.method', 'Payment Method')}
                required
                isLoading={loading}
                options={paymentMethodOptions}
                value={paymentMethod}
                onChange={val => setPaymentMethod(String(val))}
                placeholder={t('payment.method_ph', 'Select method...')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('payment.contribution', 'Contribution')} *</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="form-input font-bold"
                required
              />
            </div>
            <div>
              <label className="form-label">{t('payment.late_fee', 'Late Fee')}</label>
              <input
                type="number"
                min={0}
                value={lateFee}
                onChange={e => setLateFee(e.target.value === '' ? '' : Number(e.target.value))}
                className="form-input font-semibold"
              />
              <p className="text-[10px] text-slate-400 mt-1">{t('payment.late_fee_hint', 'Suggested from settings; you can change it.')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('payment.trx', 'Transaction / Ref ID')}</label>
              <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)} className="form-input font-mono" />
            </div>
            <div>
              <label className="form-label">{t('payment.note', 'Note')}</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} className="form-input" />
            </div>
          </div>

          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between">
            <span className="text-slate-700 dark:text-slate-300 font-bold text-xs">{t('payment.total', 'Total Amount to Record:')}</span>
            <span className="text-base font-black text-emerald-800 dark:text-emerald-300">{formatCurrency(total)}</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs disabled:opacity-50"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || loading}
              className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
            >
              <Check size={16} strokeWidth={2.5} />
              <span>{isSubmitting ? t('common.saving', 'Saving...') : t('payment.confirm', 'Confirm & Save')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
