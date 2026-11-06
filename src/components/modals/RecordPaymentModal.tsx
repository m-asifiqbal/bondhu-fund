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
      size="lg"
      icon={<Receipt size={20} />}
      title={t('members.pay_title', 'Record member payment')}
      subtitle={t('members.pay_subtitle', 'Record a monthly contribution for a member')}
      footer={
        <>
          <div className="mr-auto flex items-baseline gap-3" aria-live="polite">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t('members.pay_total', 'Total amount to record')}</span>
            <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(total)}</span>
          </div>
          <button type="button" onClick={handleClose} disabled={isSubmitting} className="btn btn-cancel min-w-[7.5rem]">
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="submit" form="record-payment-form" disabled={isSubmitting || loading} className="btn btn-primary min-w-[10.5rem]">
            <Check size={16} strokeWidth={2.6} />
            <span>{isSubmitting ? t('common.saving', 'Saving...') : t('members.pay_confirm', 'Confirm & save')}</span>
          </button>
        </>
      }
    >
      {/* Eight fields in two equal columns: same label row, same 44px control height, same width. */}
      <form id="record-payment-form" onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 items-start" noValidate>
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
        <div>
          <label className="form-label">{t('members.pay_month', 'Payment month')} <span className="text-rose-500">*</span></label>
          <MonthPicker variant="field" value={paymentMonth} onChange={setPaymentMonth} className="w-full" align="left" />
        </div>

        <DatePicker
          label={t('members.pay_date', 'Payment date')}
          required
          clearable={false}
          value={paymentDate}
          max={todayISO()}
          onChange={setPaymentDate}
        />
        <SearchableSelect
          label={t('members.pay_method', 'Payment method')}
          required
          isLoading={loading}
          options={paymentMethodOptions}
          value={paymentMethod}
          onChange={val => setPaymentMethod(String(val ?? ''))}
          placeholder={t('members.pay_method_ph', 'Select method…')}
        />

        <div>
          <label className="form-label">{t('members.pay_contribution', 'Contribution')} <span className="text-rose-500">*</span></label>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
            className="form-input font-bold tabular-nums"
            required
          />
        </div>
        <div>
          <label className="form-label flex items-baseline justify-between gap-2">
            <span>{t('members.late_fee', 'Late fee')}</span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{t('members.pay_late_fee_hint', 'Suggested from settings; you can change it.')}</span>
          </label>
          <input
            type="number"
            min={0}
            value={lateFee}
            onChange={e => setLateFee(e.target.value === '' ? '' : Number(e.target.value))}
            className="form-input font-semibold tabular-nums"
          />
        </div>

        <div>
          <label className="form-label">{t('members.trx', 'Transaction / Ref ID')}</label>
          <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)} className="form-input font-mono" />
        </div>
        <div>
          <label className="form-label">{t('members.note', 'Note')}</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} className="form-input" />
        </div>

      </form>
    </Modal>
  );
};
