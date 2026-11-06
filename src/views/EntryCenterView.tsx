import React, { useState, useEffect, useMemo } from 'react';
import { History, Check, RotateCcw, Coins, Receipt, TrendingUp, Info } from 'lucide-react';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { useApp } from '../context/AppContext';
import { getAllMembersLite, recordPayment, addExpense, addInvestment, suggestLateFee } from '../services/db';
import { Member, MasterCategory } from '../types';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { MonthPicker } from '../components/common/MonthPicker';
import { DatePicker } from '../components/common/DatePicker';
import { todayISO } from '../utils/date';

type LiteMember = Pick<Member, 'id' | 'member_code' | 'name' | 'phone' | 'monthly_due' | 'status' | 'avatar_initials'> & { name_bn?: string | null };
type EntryType = 'money' | 'expense' | 'investment';
type Num = number | '';

const toNum = (v: string): Num => (v === '' ? '' : Number(v));
const Req = () => <span className="text-rose-500">*</span>;

export const EntryCenterView: React.FC = () => {
  const {
    entryCenterInitialTab, showToast, triggerRefresh, setActiveTab, selectedMonth, refreshKey, t, tv, bnName, language, masterData, toBanglaDigits,
    formatCurrency, formatMonth, formatDate,
  } = useApp();
  const [entryType, setEntryType] = useState<EntryType>(entryCenterInitialTab);
  const [saving, setSaving] = useState(false);

  // Lists. Lookups come from cached master data (active items only), so no per-screen fetch.
  const [members, setMembers] = useState<LiteMember[]>([]);
  const { paymentMethods, expenseCategories, investmentSectors } = useMemo(() => {
    const activeOf = (type: MasterCategory['type']) => masterData.filter(x => x.type === type && Number(x.is_active) === 1);
    return {
      paymentMethods: activeOf('payment_method'),
      expenseCategories: activeOf('expense_category'),
      investmentSectors: activeOf('investment_sector'),
    };
  }, [masterData]);

  // Money received
  const [selectedMemberId, setSelectedMemberId] = useState<number | ''>('');
  const [paymentMonth, setPaymentMonth] = useState(selectedMonth);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [contributionAmount, setContributionAmount] = useState<Num>('');
  const [lateFee, setLateFee] = useState<Num>(0);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [trxId, setTrxId] = useState('');
  const [note, setNote] = useState('');

  // Expense
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<Num>('');
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [expensePayee, setExpensePayee] = useState('');
  const [expenseReceiptRef, setExpenseReceiptRef] = useState('');
  const [expenseNote, setExpenseNote] = useState('');

  // Investment
  const [invName, setInvName] = useState('');
  const [invSector, setInvSector] = useState('');
  const [invAmount, setInvAmount] = useState<Num>('');
  const [invEstVal, setInvEstVal] = useState<Num>('');
  const [invDate, setInvDate] = useState(todayISO());
  const [invReviewDate, setInvReviewDate] = useState('');
  const [invNote, setInvNote] = useState('');

  useEffect(() => { setEntryType(entryCenterInitialTab); }, [entryCenterInitialTab]);
  useEffect(() => { setPaymentMonth(selectedMonth); }, [selectedMonth]);

  useEffect(() => {
    let alive = true;
    getAllMembersLite()
      .then(list => { if (alive) setMembers((list as LiteMember[]).filter(m => m.status === 'Active')); })
      .catch((e: any) => showToast(e.message, 'error'));
    return () => { alive = false; };
  }, [refreshKey]);

  // Keep each selected lookup valid (default to the first active item).
  useEffect(() => {
    setPaymentMethod(p => (paymentMethods.some(x => x.name === p) ? p : paymentMethods[0]?.name || ''));
    setExpenseCategory(p => (expenseCategories.some(x => x.name === p) ? p : expenseCategories[0]?.name || ''));
    setInvSector(p => (investmentSectors.some(x => x.name === p) ? p : investmentSectors[0]?.name || ''));
  }, [paymentMethods, expenseCategories, investmentSectors]);

  // Suggested late fee follows month/date (user may override afterwards).
  useEffect(() => {
    if (!paymentMonth || !paymentDate) return;
    let alive = true;
    suggestLateFee(paymentMonth, paymentDate).then(fee => alive && setLateFee(fee)).catch(() => undefined);
    return () => { alive = false; };
  }, [paymentMonth, paymentDate]);

  const selectedMember = members.find(m => m.id === selectedMemberId);

  const handleMemberChange = (id: number) => {
    setSelectedMemberId(id);
    const m = members.find(x => x.id === id);
    if (m) setContributionAmount(m.monthly_due);
  };

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
  const methodOptions = useMemo<SelectOption[]>(() => paymentMethods.map(x => ({ value: x.name, label: tv(x.name) })), [paymentMethods, tv]);
  const categoryOptions = useMemo<SelectOption[]>(() => expenseCategories.map(x => ({ value: x.name, label: tv(x.name) })), [expenseCategories, tv]);
  const sectorOptions = useMemo<SelectOption[]>(() => investmentSectors.map(x => ({ value: x.name, label: tv(x.name) })), [investmentSectors, tv]);
  const selectedMemberName = selectedMember ? bnName(selectedMember.name, selectedMember.name_bn) : '';

  const resetForm = (type: EntryType) => {
    if (type === 'money') {
      setSelectedMemberId('');
      setContributionAmount('');
      setPaymentDate(todayISO());
      setTrxId('');
      setNote('');
    } else if (type === 'expense') {
      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseDate(todayISO());
      setExpensePayee('');
      setExpenseReceiptRef('');
      setExpenseNote('');
    } else {
      setInvName('');
      setInvAmount('');
      setInvEstVal('');
      setInvDate(todayISO());
      setInvReviewDate('');
      setInvNote('');
    }
  };

  /** Returns an error message, or null when the active form is valid. */
  const validate = (): string | null => {
    if (entryType === 'money') {
      if (!selectedMemberId) return t('members.entry_err_member', 'Please select a member.');
      if (!paymentMonth) return t('members.entry_err_month', 'Please choose the payment month.');
      if (!paymentDate) return t('members.entry_err_date', 'Please choose the payment date.');
      if (contributionAmount === '' || Number(contributionAmount) < 0) return t('members.entry_err_amount', 'Enter a valid contribution amount.');
      if (Number(lateFee) < 0) return t('members.entry_err_late', 'Late fee cannot be negative.');
      if (!paymentMethod) return t('members.entry_err_method', 'Please choose a payment method.');
    } else if (entryType === 'expense') {
      if (!expenseTitle.trim()) return t('members.entry_err_title', 'Expense title is required.');
      if (!expenseCategory) return t('members.entry_err_category', 'Please choose a category.');
      if (expenseAmount === '' || Number(expenseAmount) <= 0) return t('members.entry_err_exp_amount', 'Enter an expense amount greater than zero.');
      if (!expenseDate) return t('members.entry_err_exp_date', 'Please choose the expense date.');
      if (!expensePayee.trim()) return t('members.entry_err_payee', 'Payee is required.');
    } else {
      if (!invName.trim()) return t('members.entry_err_inv_name', 'Investment name is required.');
      if (!invSector) return t('members.entry_err_sector', 'Please choose a sector.');
      if (invAmount === '' || Number(invAmount) <= 0) return t('members.entry_err_inv_amount', 'Enter an invested amount greater than zero.');
      if (invEstVal !== '' && Number(invEstVal) < 0) return t('members.entry_err_inv_value', 'Estimated value cannot be negative.');
      if (!invDate) return t('members.entry_err_inv_date', 'Please choose the purchase date.');
      if (invReviewDate && invReviewDate < invDate) return t('members.entry_err_review', 'Review date cannot be before the purchase date.');
    }
    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const err = validate();
    if (err) { showToast(err, 'error'); return; }
    setSaving(true);
    try {
      if (entryType === 'money') {
        const total = Number(contributionAmount) + (Number(lateFee) || 0);
        await recordPayment({
          member_id: Number(selectedMemberId),
          payment_month: paymentMonth,
          payment_date: paymentDate,
          contribution_amount: Number(contributionAmount),
          late_fee: Number(lateFee) || 0,
          payment_method: paymentMethod,
          trx_id: trxId.trim(),
          note: note.trim(),
        });
        showToast(`${t('members.entry_money_saved', 'Payment saved')}: ${selectedMemberName} · ${formatCurrency(total)}`);
      } else if (entryType === 'expense') {
        await addExpense({
          title: expenseTitle.trim(),
          category: expenseCategory,
          amount: Number(expenseAmount),
          expense_date: expenseDate,
          payee: expensePayee.trim(),
          receipt_ref: expenseReceiptRef.trim(),
          notes: expenseNote.trim(),
        });
        showToast(`${t('members.entry_expense_saved', 'Expense saved')}: ${expenseTitle.trim()} · ${formatCurrency(Number(expenseAmount))}`);
      } else {
        await addInvestment({
          name: invName.trim(),
          sector: invSector,
          purchase_date: invDate,
          invested_amount: Number(invAmount),
          current_estimated_value: invEstVal === '' ? Number(invAmount) : Number(invEstVal),
          status: 'Growing',
          review_date: invReviewDate || undefined,
          notes: invNote.trim(),
        });
        showToast(`${t('members.entry_investment_saved', 'Investment saved')}: ${invName.trim()} · ${formatCurrency(Number(invAmount))}`);
      }
      resetForm(entryType);
      triggerRefresh();
    } catch (ex: any) {
      showToast(ex.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const totalMoneyReceived = (Number(contributionAmount) || 0) + (Number(lateFee) || 0);
  const effectiveEstVal = invEstVal === '' ? Number(invAmount) || 0 : Number(invEstVal);

  const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex justify-between items-center gap-3 text-slate-600 dark:text-slate-400">
      <span className="shrink-0">{label}</span>
      <span className="font-bold text-slate-900 dark:text-white text-right truncate">{value || '—'}</span>
    </div>
  );

  return (
    <div className="p-4 md:p-6 xl:p-8 space-y-6 max-w-[1680px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('members.entry_title', 'Add a fund entry')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('members.entry_subtitle', 'Record member money, operating expenses, or a new investment with a clear audit trail.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab(entryType === 'money' ? 'collections' : entryType === 'expense' ? 'expenses' : 'investments')}
          className="btn btn-outline"
        >
          <History size={14} className="text-slate-500 dark:text-slate-400" />
          <span>{t('members.entry_history', 'View entry history')}</span>
        </button>
      </div>

      <div className="card-base p-4 md:p-6">
        <div className="mb-6">
          <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
            {t('members.entry_type', 'Entry type')}
          </label>
          <SegmentedTabs ariaLabel={t('members.entry_type', 'Entry type')} value={entryType} onChange={setEntryType}
            items={[
              { key: 'money', label: t('members.entry_money', 'Money received'), icon: <Coins size={15} /> },
              { key: 'expense', label: t('members.entry_expense', 'Expense'), icon: <Receipt size={15} /> },
              { key: 'investment', label: t('members.entry_investment', 'Investment'), icon: <TrendingUp size={15} /> },
            ]} />
        </div>

        <form onSubmit={handleSave} noValidate>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:gap-8">
            <div className="xl:col-span-2 space-y-4 min-w-0">
              {entryType === 'money' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <SearchableSelect
                        label={t('members.entry_member', 'Member')}
                        required
                        options={memberOptions}
                        value={selectedMemberId}
                        onChange={val => handleMemberChange(Number(val))}
                        placeholder={t('members.entry_member_ph', 'Search member...')}
                      />
                      <p className="form-hint">{t('members.entry_member_hint', 'Only active members are listed.')}</p>
                    </div>
                    <div>
                      <label className="form-label mb-1.5 block">{t('members.entry_pay_month', 'Payment month')} <Req /></label>
                      <MonthPicker value={paymentMonth} onChange={setPaymentMonth} align="left" className="w-full" />
                      <p className="form-hint">{t('members.entry_pay_month_hint', 'The month this contribution is for.')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <DatePicker label={t('members.entry_pay_date', 'Payment date')} required clearable={false} value={paymentDate} max={todayISO()} onChange={setPaymentDate} />
                    </div>
                    <div>
                      <label className="form-label">{t('members.entry_contribution', 'Contribution amount')} <Req /></label>
                      <input type="number" min={0} value={contributionAmount} onChange={e => setContributionAmount(toNum(e.target.value))} className="form-input font-bold" required />
                      <p className="form-hint">{t('members.entry_contribution_hint', "Defaults to the member's monthly due.")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_late_fee', 'Late fee')}</label>
                      <input type="number" min={0} value={lateFee} onChange={e => setLateFee(toNum(e.target.value))} className="form-input font-semibold" />
                      <p className="form-hint">{t('members.entry_late_fee_hint', 'Suggested from the due day in Settings; you can change it.')}</p>
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('members.entry_method', 'Payment method')}
                        required
                        options={methodOptions}
                        value={paymentMethod}
                        onChange={val => setPaymentMethod(String(val))}
                        placeholder={t('members.entry_method_ph', 'Select method...')}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('members.entry_trx', 'Transaction / Reference ID')}</label>
                    <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)} className="form-input font-mono" />
                    <p className="form-hint">{t('members.entry_trx_hint', 'Bank voucher number or bKash TrxID for reconciliation.')}</p>
                  </div>

                  <div>
                    <label className="form-label">{t('members.entry_note', 'Note')}</label>
                    <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}

              {entryType === 'expense' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_exp_title', 'Expense title')} <Req /></label>
                      <input type="text" value={expenseTitle} onChange={e => setExpenseTitle(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('members.entry_category', 'Category')}
                        required
                        options={categoryOptions}
                        value={expenseCategory}
                        onChange={val => setExpenseCategory(String(val))}
                        placeholder={t('members.entry_category_ph', 'Select category...')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_amount', 'Amount')} <Req /></label>
                      <input type="number" min={0} value={expenseAmount} onChange={e => setExpenseAmount(toNum(e.target.value))} className="form-input font-bold" required />
                    </div>
                    <div>
                      <DatePicker label={t('members.entry_exp_date', 'Expense date')} required clearable={false} value={expenseDate} max={todayISO()} onChange={setExpenseDate} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_payee', 'Payee / Paid to')} <Req /></label>
                      <input type="text" value={expensePayee} onChange={e => setExpensePayee(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">{t('members.entry_receipt', 'Receipt / voucher number')}</label>
                      <input type="text" value={expenseReceiptRef} onChange={e => setExpenseReceiptRef(e.target.value)} className="form-input font-mono" />
                      <p className="form-hint">{t('members.entry_receipt_hint', 'Leave blank to mark the expense as "Needs receipt".')}</p>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('members.entry_exp_notes', 'Notes')}</label>
                    <textarea rows={2} value={expenseNote} onChange={e => setExpenseNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}

              {entryType === 'investment' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_inv_name', 'Investment name')} <Req /></label>
                      <input type="text" value={invName} onChange={e => setInvName(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('members.entry_sector', 'Sector')}
                        required
                        options={sectorOptions}
                        value={invSector}
                        onChange={val => setInvSector(String(val))}
                        placeholder={t('members.entry_sector_ph', 'Select sector...')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('members.entry_inv_amount', 'Invested amount')} <Req /></label>
                      <input type="number" min={0} value={invAmount} onChange={e => setInvAmount(toNum(e.target.value))} className="form-input font-bold" required />
                    </div>
                    <div>
                      <label className="form-label">{t('members.entry_inv_value', 'Current estimated value')}</label>
                      <input
                        type="number"
                        min={0}
                        value={invEstVal}
                        placeholder={invAmount === '' ? '' : (language === 'bn' ? toBanglaDigits(invAmount) : String(invAmount))}
                        onChange={e => setInvEstVal(toNum(e.target.value))}
                        className="form-input font-bold"
                      />
                      <p className="form-hint">{t('members.entry_inv_value_hint', 'Leave blank to use the invested amount.')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <DatePicker label={t('members.entry_inv_date', 'Purchase date')} required clearable={false} value={invDate} max={todayISO()} onChange={setInvDate} />
                    </div>
                    <div>
                      <DatePicker label={t('members.entry_inv_review', 'Next review date (optional)')} value={invReviewDate} min={invDate || undefined} onChange={setInvReviewDate} />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('members.entry_inv_notes', 'Deed / asset description')}</label>
                    <textarea rows={2} value={invNote} onChange={e => setInvNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4 min-w-0">
              <div className="bg-slate-50 dark:bg-[#121f26] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 text-xs shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('members.entry_summary', 'Entry summary')}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">{t('members.entry_summary_hint', 'Review the details before saving.')}</p>

                {entryType === 'money' ? (
                  <div className="space-y-3">
                    <Row label={t('members.entry_member', 'Member')} value={selectedMemberName} />
                    <Row label={t('members.entry_pay_month', 'Payment month')} value={formatMonth(paymentMonth)} />
                    <Row label={t('members.entry_pay_date', 'Payment date')} value={formatDate(paymentDate)} />
                    <Row label={t('members.entry_contribution', 'Contribution amount')} value={formatCurrency(Number(contributionAmount) || 0)} />
                    <Row label={t('members.entry_late_fee', 'Late fee')} value={formatCurrency(Number(lateFee) || 0)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('members.entry_total_received', 'Total received')}</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(totalMoneyReceived)}</span>
                    </div>
                    <div className="bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-3 text-[11px] text-amber-900 dark:text-amber-300 mt-4 leading-relaxed flex items-start gap-2">
                      <Info size={14} className="shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                      <span>{t('members.entry_money_tip', 'For a late payment, keep the original due month; the late fee is suggested automatically.')}</span>
                    </div>
                  </div>
                ) : entryType === 'expense' ? (
                  <div className="space-y-3">
                    <Row label={t('members.entry_exp_title', 'Expense title')} value={expenseTitle} />
                    <Row label={t('members.entry_category', 'Category')} value={tv(expenseCategory)} />
                    <Row label={t('members.entry_payee', 'Payee / Paid to')} value={expensePayee} />
                    <Row label={t('members.entry_exp_date', 'Expense date')} value={formatDate(expenseDate)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('members.entry_total_expense', 'Total expense')}</span>
                      <span className="text-base font-black text-rose-700 dark:text-rose-400">{formatCurrency(Number(expenseAmount) || 0)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Row label={t('members.entry_investment', 'Investment')} value={invName} />
                    <Row label={t('members.entry_sector', 'Sector')} value={tv(invSector)} />
                    <Row label={t('members.entry_inv_amount', 'Invested amount')} value={formatCurrency(Number(invAmount) || 0)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('members.entry_inv_value', 'Current estimated value')}</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(effectiveEstVal)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => resetForm(entryType)}
              disabled={saving}
              className="btn btn-outline"
            >
              <RotateCcw size={14} />
              <span>{t('members.entry_clear', 'Clear form')}</span>
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-lg"
            >
              <Check size={16} strokeWidth={2.5} />
              <span>{saving ? t('common.saving', 'Saving...') : t('members.entry_save', 'Save entry')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
