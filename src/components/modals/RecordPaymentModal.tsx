import React, { useState, useEffect, useMemo } from 'react';
import { Check, Receipt } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getAllMembersLite, recordPayment, suggestLateFee } from '../../services/db';
import { Member } from '../../types';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { MonthPicker } from '../common/MonthPicker';
import { DatePicker } from '../common/DatePicker';
import { Modal } from '../common/Modal';
import { todayISO } from '../../utils/date';

type LiteMember = Pick<Member, 'id' | 'member_code' | 'name' | 'phone' | 'monthly_due' | 'status' | 'avatar_initials'> & { name_bn?: string | null };

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
    masterData,
    language,
    bnName,
    tv,
    t,
  } = useApp();

  const [members, setMembers] = useState<LiteMember[]>([]);
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

  // Active payment methods come from the cached master data (no extra fetch).
  const paymentMethods = useMemo(
    () => masterData.filter(m => m.type === 'payment_method' && Number(m.is_active) === 1),
    [masterData],
  );

  // Load members and reset the form whenever the modal opens.
  useEffect(() => {
    if (!openRecordModal) return;
    let alive = true;
    setPaymentMonth(selectedMonth);
    setPaymentDate(todayISO());
    setTrxId('');
    setNote('');
    setLoading(true);
    getAllMembersLite()
      .then(raw => {
        if (!alive) return;
        const list = raw as LiteMember[];
        const usable = list.filter(m => m.status === 'Active' || m.id === selectedMemberIdForPayment);
        setMembers(usable);
        const initial = usable.find(m => m.id === selectedMemberIdForPayment) || null;
        setSelectedMemberId(initial ? initial.id : '');
        setAmount(initial ? initial.monthly_due : '');
      })
      .catch((e: any) => showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [openRecordModal, selectedMemberIdForPayment, selectedMonth]);

  // Keep the chosen method valid (default to the first active one).
  useEffect(() => {
    if (!openRecordModal) return;
    setPaymentMethod(prev => (paymentMethods.some(m => m.name === prev) ? prev : paymentMethods[0]?.name || ''));
  }, [openRecordModal, paymentMethods]);

  // Suggest a late fee whenever the month or payment date changes (user can override).
  useEffect(() => {
    if (!openRecordModal || !paymentMonth || !paymentDate) return;
    let alive = true;
    suggestLateFee(paymentMonth, paymentDate)
      .then(fee => alive && setLateFee(fee))
      .catch(() => undefined);
    return () => { alive = false; };
  }, [openRecordModal, paymentMonth, paymentDate]);

  const memberOptions = useMemo<SelectOption[]>(() => members.map(m => {
    const other = language === 'bn' ? (m.name_bn ? m.name : '') : m.name_bn || '';
    return {
      value: m.id,
      label: bnName(m.name, m.name_bn),
      subLabel: [other, m.phone].filter(Boolean).join(' · '),
      badge: m.member_code,
      badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300',
    };
  }), [members, language, bnName]);

  const paymentMethodOptions = useMemo<SelectOption[]>(
    () => paymentMethods.map(pm => ({ value: pm.name, label: tv(pm.name) })),
    [paymentMethods, tv],
  );

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
    if (!selectedMemberId) { showToast(t('members.pay_err_member', 'Please select a member.'), 'error'); return; }
    if (!paymentDate) { showToast(t('members.pay_err_date', 'Please choose a payment date.'), 'error'); return; }
    if (!paymentMethod) { showToast(t('members.pay_err_method', 'Please choose a payment method.'), 'error'); return; }
    if (amount === '' || Number(amount) < 0) { showToast(t('members.pay_err_amount', 'Enter a valid contribution amount.'), 'error'); return; }
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
      showToast(t('members.pay_saved', 'Payment recorded.'));
      triggerRefresh();
      setSelectedMemberIdForPayment(null);
      setOpenRecordModal(false);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const total = (Number(amount) || 0) + (Number(lateFee) || 0);

  return (
    <Modal
      open={openRecordModal}
      onClose={handleClose}
      locked={isSubmitting}
      size="md"
      icon={<Receipt size={18} />}
      title={t('members.pay_title', 'Record member payment')}
      subtitle={t('members.pay_subtitle', 'Record a monthly contribution for a member')}
      footer={
        <>
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
            form="record-payment-form"
            disabled={isSubmitting || loading}
            className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
          >
            <Check size={16} strokeWidth={2.5} />
            <span>{isSubmitting ? t('common.saving', 'Saving...') : t('members.pay_confirm', 'Confirm & save')}</span>
          </button>
        </>
      }
    >
      <form id="record-payment-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SearchableSelect
              label={t('members.pay_member', 'Select member')}
              required
              isLoading={loading}
              options={memberOptions}
              value={selectedMemberId}
              onChange={val => handleMemberChange(Number(val))}
              placeholder={t('members.pay_member_ph', 'Search by name or code…')}
              searchPlaceholder={t('members.pay_member_search', 'Type member name or code…')}
            />
          </div>
          <div>
            <label className="form-label mb-1.5 block">{t('members.pay_month', 'Payment month')} <span className="text-rose-500">*</span></label>
            <MonthPicker value={paymentMonth} onChange={setPaymentMonth} className="w-full" align="left" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <DatePicker
              label={t('members.pay_date', 'Payment date')}
              required
              clearable={false}
              value={paymentDate}
              max={todayISO()}
              onChange={setPaymentDate}
            />
          </div>
          <div>
            <SearchableSelect
              label={t('members.pay_method', 'Payment method')}
              required
              isLoading={loading}
              options={paymentMethodOptions}
              value={paymentMethod}
              onChange={val => setPaymentMethod(String(val ?? ''))}
              placeholder={t('members.pay_method_ph', 'Select method…')}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">{t('members.pay_contribution', 'Contribution')} <span className="text-rose-500">*</span></label>
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
            <label className="form-label">{t('members.late_fee', 'Late fee')}</label>
            <input
              type="number"
              min={0}
              value={lateFee}
              onChange={e => setLateFee(e.target.value === '' ? '' : Number(e.target.value))}
              className="form-input font-semibold"
            />
            <p className="text-[10px] text-slate-400 mt-1">{t('members.pay_late_fee_hint', 'Suggested from settings; you can change it.')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">{t('members.trx', 'Transaction / Ref ID')}</label>
            <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)} className="form-input font-mono" />
          </div>
          <div>
            <label className="form-label">{t('members.note', 'Note')}</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className="form-input" />
          </div>
        </div>

        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between gap-3">
          <span className="text-slate-700 dark:text-slate-300 font-bold text-xs">{t('members.pay_total', 'Total amount to record')}</span>
          <span className="text-base font-black text-emerald-800 dark:text-emerald-300">{formatCurrency(total)}</span>
        </div>
      </form>
    </Modal>
  );
};
