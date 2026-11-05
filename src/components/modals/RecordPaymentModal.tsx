import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getMembers, recordPayment, getMasterData } from '../../services/db';
import { Member, MasterCategory } from '../../types';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { MonthPicker } from '../common/MonthPicker';

export const RecordPaymentModal: React.FC = () => {
  const {
    openRecordModal,
    setOpenRecordModal,
    triggerRefresh,
    showToast,
    selectedMemberIdForPayment,
    setSelectedMemberIdForPayment,
    selectedMonth,
    language,
    formatCurrency,
    t,
  } = useApp();

  const [members, setMembers] = useState<Member[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MasterCategory[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<number>(1);
  const [paymentMonth, setPaymentMonth] = useState('June 2024');
  const [paymentDate, setPaymentDate] = useState('28 Jun 2024');
  const [amount, setAmount] = useState(2000);
  const [lateFee, setLateFee] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer');
  const [trxId, setTrxId] = useState(`TRX-${Date.now().toString().slice(-6)}`);
  const [note, setNote] = useState('Monthly contribution');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (openRecordModal) {
      setPaymentMonth(selectedMonth);
      getMembers('', 'All', 1, 200, selectedMonth).then(res => {
        setMembers(res.members);
        if (selectedMemberIdForPayment) {
          setSelectedMemberId(selectedMemberIdForPayment);
        } else if (res.members.length > 0) {
          setSelectedMemberId(res.members[0].id);
        }
      });
      getMasterData('payment_method').then(res => {
        if (res.length > 0) setPaymentMethods(res);
      });
    }
  }, [openRecordModal, selectedMemberIdForPayment, selectedMonth]);

  if (!openRecordModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await recordPayment({
        member_id: Number(selectedMemberId),
        payment_month: paymentMonth,
        payment_date: paymentDate,
        contribution_amount: Number(amount),
        late_fee: Number(lateFee),
        payment_method: paymentMethod,
        trx_id: trxId,
        note,
      });
      showToast(
        language === 'bn'
          ? 'পেমেন্ট সফলভাবে SQLite ডাটাবেজে সংরক্ষণ করা হয়েছে!'
          : 'Payment recorded successfully to local SQLite ledger!'
      );
      triggerRefresh();
      setSelectedMemberIdForPayment(null);
      setOpenRecordModal(false);
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedMemberIdForPayment(null);
    setOpenRecordModal(false);
  };

  // Convert members to SearchableSelect options
  const memberOptions: SelectOption[] = members.map(m => ({
    value: m.id,
    label: m.name,
    subLabel: m.phone,
    badge: m.member_code,
    badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300',
  }));

  const paymentMethodOptions: SelectOption[] = (
    paymentMethods.length > 0
      ? paymentMethods.map(pm => ({ value: pm.name, label: pm.name }))
      : [
          { value: 'Bank transfer', label: 'Bank transfer' },
          { value: 'bKash', label: 'bKash' },
          { value: 'Nagad', label: 'Nagad' },
          { value: 'Cash', label: 'Cash' },
        ]
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card-base w-full max-w-lg overflow-visible animate-in fade-in zoom-in-95 duration-150 shadow-2xl">
        <div className="px-6 py-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'সদস্য পেমেন্ট রেকর্ড করুন' : 'Record Member Payment'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {language === 'bn'
                ? 'সরাসরি SQLite লেজারে নতুন চাঁদা সংরক্ষণ'
                : 'Add a collection entry directly to SQLite'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Searchable Member Select Spinner */}
            <div>
              <SearchableSelect
                label={language === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Select Member'}
                required
                options={memberOptions}
                value={selectedMemberId}
                onChange={val => setSelectedMemberId(Number(val))}
                placeholder={language === 'bn' ? 'নাম বা আইডি দিয়ে খুঁজুন...' : 'Search by name or code...'}
                searchPlaceholder={language === 'bn' ? 'সদস্যের নাম টাইপ করুন...' : 'Type member name or code...'}
              />
            </div>

            {/* Visual Month Picker Component */}
            <div>
              <label className="form-label mb-1.5 block">
                {language === 'bn' ? 'পেমেন্টের মাস' : 'Payment Month'} *
              </label>
              <MonthPicker
                value={paymentMonth}
                onChange={setPaymentMonth}
                className="w-full"
                align="left"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{language === 'bn' ? 'পেমেন্টের তারিখ' : 'Payment Date'} *</label>
              <input
                type="text"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className="form-input"
                required
              />
            </div>

            {/* Searchable Payment Method Select */}
            <div>
              <SearchableSelect
                label={language === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}
                required
                options={paymentMethodOptions}
                value={paymentMethod}
                onChange={val => setPaymentMethod(String(val))}
                placeholder="Select method..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">
                {language === 'bn' ? 'চাঁদার পরিমাণ' : 'Contribution'} (TK) *
              </label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(Number(e.target.value))}
                className="form-input font-bold"
                required
              />
            </div>

            <div>
              <label className="form-label">
                {language === 'bn' ? 'বিলম্ব জরিমানা' : 'Late Fee'} (TK)
              </label>
              <select
                value={lateFee}
                onChange={e => setLateFee(Number(e.target.value))}
                className="form-select font-semibold"
              >
                <option value={0}>TK 0 ({language === 'bn' ? 'জরিমানা নেই' : 'No late fee'})</option>
                <option value={300}>TK 300 ({language === 'bn' ? 'স্ট্যান্ডার্ড বিলম্ব ফি' : 'Standard fine'})</option>
                <option value={500}>TK 500 ({language === 'bn' ? 'বিশেষ জরিমানা' : 'Custom fine'})</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">
                {language === 'bn' ? 'লেনদেন / TRX আইডি' : 'Transaction / Ref ID'}
              </label>
              <input
                type="text"
                value={trxId}
                onChange={e => setTrxId(e.target.value)}
                className="form-input font-mono font-bold"
              />
            </div>

            <div>
              <label className="form-label">
                {language === 'bn' ? 'মন্তব্য / নোট' : 'Note / Description'}
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          {/* Quick Summary Pill with Bangla Currency */}
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between">
            <span className="text-slate-700 dark:text-slate-300 font-bold text-xs">
              {language === 'bn' ? 'রেকর্ডকৃত সর্বমোট পরিমাণ:' : 'Total Amount to Record:'}
            </span>
            <span className="text-base font-black text-emerald-800 dark:text-emerald-300">
              {formatCurrency(amount + lateFee)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50"
            >
              <Check size={16} strokeWidth={2.5} />
              <span>
                {isSubmitting
                  ? (language === 'bn' ? 'সংরক্ষণ হচ্ছে...' : 'Recording...')
                  : (language === 'bn' ? 'নিশ্চিত ও সংরক্ষণ করুন' : 'Confirm & Save')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
