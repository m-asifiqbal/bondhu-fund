import React, { useState, useEffect } from 'react';
import { History, Check, RotateCcw, Coins, Receipt, TrendingUp, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getAllMembersLite, recordPayment, addExpense, addInvestment, getMasterData, suggestLateFee } from '../services/db';
import { Member, MasterCategory } from '../types';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { MonthPicker } from '../components/common/MonthPicker';
import { todayISO } from '../utils/date';

type LiteMember = Pick<Member, 'id' | 'member_code' | 'name' | 'phone' | 'monthly_due' | 'status' | 'avatar_initials'>;
type EntryType = 'money' | 'expense' | 'investment';
type Num = number | '';

const toNum = (v: string): Num => (v === '' ? '' : Number(v));
const Req = () => <span className="text-rose-500">*</span>;

export const EntryCenterView: React.FC = () => {
  const { entryCenterInitialTab, showToast, triggerRefresh, setActiveTab, selectedMonth, refreshKey, t, formatCurrency, formatMonth, formatDate } = useApp();
  const [entryType, setEntryType] = useState<EntryType>(entryCenterInitialTab);
  const [saving, setSaving] = useState(false);

  // Lists
  const [members, setMembers] = useState<LiteMember[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MasterCategory[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<MasterCategory[]>([]);
  const [investmentSectors, setInvestmentSectors] = useState<MasterCategory[]>([]);

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
    Promise.all([
      getAllMembersLite(),
      getMasterData('payment_method', true),
      getMasterData('expense_category', true),
      getMasterData('investment_sector', true),
    ])
      .then(([list, methods, cats, sectors]) => {
        if (!alive) return;
        setMembers(list.filter(m => m.status === 'Active'));
        setPaymentMethods(methods);
        setExpenseCategories(cats);
        setInvestmentSectors(sectors);
        setPaymentMethod(p => (methods.some(x => x.name === p) ? p : methods[0]?.name || ''));
        setExpenseCategory(p => (cats.some(x => x.name === p) ? p : cats[0]?.name || ''));
        setInvSector(p => (sectors.some(x => x.name === p) ? p : sectors[0]?.name || ''));
      })
      .catch((e: any) => showToast(e.message, 'error'));
    return () => { alive = false; };
  }, [refreshKey]);

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

  const memberOptions: SelectOption[] = members.map(m => ({
    value: m.id,
    label: m.name,
    subLabel: m.phone,
    badge: m.member_code,
    badgeColor: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300',
  }));
  const toOptions = (list: MasterCategory[]): SelectOption[] => list.map(x => ({ value: x.name, label: x.name }));

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
      if (!selectedMemberId) return t('entry.err_member', 'Please select a member.');
      if (!paymentMonth) return t('entry.err_month', 'Please choose the payment month.');
      if (!paymentDate) return t('entry.err_date', 'Please choose the payment date.');
      if (contributionAmount === '' || Number(contributionAmount) < 0) return t('entry.err_amount', 'Enter a valid contribution amount.');
      if (Number(lateFee) < 0) return t('entry.err_late', 'Late fee cannot be negative.');
      if (!paymentMethod) return t('entry.err_method', 'Please choose a payment method.');
    } else if (entryType === 'expense') {
      if (!expenseTitle.trim()) return t('entry.err_title', 'Expense title is required.');
      if (!expenseCategory) return t('entry.err_category', 'Please choose a category.');
      if (expenseAmount === '' || Number(expenseAmount) <= 0) return t('entry.err_exp_amount', 'Enter an expense amount greater than zero.');
      if (!expenseDate) return t('entry.err_exp_date', 'Please choose the expense date.');
      if (!expensePayee.trim()) return t('entry.err_payee', 'Payee is required.');
    } else {
      if (!invName.trim()) return t('entry.err_inv_name', 'Investment name is required.');
      if (!invSector) return t('entry.err_sector', 'Please choose a sector.');
      if (invAmount === '' || Number(invAmount) <= 0) return t('entry.err_inv_amount', 'Enter an invested amount greater than zero.');
      if (invEstVal !== '' && Number(invEstVal) < 0) return t('entry.err_inv_value', 'Estimated value cannot be negative.');
      if (!invDate) return t('entry.err_inv_date', 'Please choose the purchase date.');
      if (invReviewDate && invReviewDate < invDate) return t('entry.err_review', 'Review date cannot be before the purchase date.');
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
        showToast(`${t('entry.money_saved', 'Payment saved')}: ${selectedMember?.name ?? ''} · ${formatCurrency(total)}`);
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
        showToast(`${t('entry.expense_saved', 'Expense saved')}: ${expenseTitle.trim()} · ${formatCurrency(Number(expenseAmount))}`);
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
        showToast(`${t('entry.investment_saved', 'Investment saved')}: ${invName.trim()} · ${formatCurrency(Number(invAmount))}`);
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

  const tabBtn = (type: EntryType, icon: React.ReactNode, label: string, active: string) => (
    <button
      type="button"
      onClick={() => setEntryType(type)}
      className={`flex items-center gap-2 px-4 lg:px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${entryType === type
        ? `bg-white dark:bg-[#182830] ${active} shadow-sm`
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex justify-between items-center gap-3 text-slate-600 dark:text-slate-400">
      <span className="shrink-0">{label}</span>
      <span className="font-bold text-slate-900 dark:text-white text-right truncate">{value || '—'}</span>
    </div>
  );

  return (
    <div className="p-4 md:p-6 xl:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('entry.title', 'Add a fund entry')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('entry.subtitle', 'Record member money, operating expenses, or a new investment with a clear audit trail.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab(entryType === 'money' ? 'collections' : entryType === 'expense' ? 'expenses' : 'investments')}
          className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <History size={14} className="text-slate-500 dark:text-slate-400" />
          <span>{t('entry.history', 'View entry history')}</span>
        </button>
      </div>

      <div className="card-base p-4 md:p-6">
        <div className="mb-6">
          <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
            {t('entry.type', 'Entry type')}
          </label>
          <div className="inline-flex flex-wrap bg-slate-100 dark:bg-[#111e24] p-1 rounded-xl border border-slate-200 dark:border-slate-800">
            {tabBtn('money', <Coins size={15} />, t('entry.money', 'Money received'), 'text-[#0f4a3c] dark:text-emerald-400')}
            {tabBtn('expense', <Receipt size={15} />, t('entry.expense', 'Expense'), 'text-rose-700 dark:text-rose-400')}
            {tabBtn('investment', <TrendingUp size={15} />, t('entry.investment', 'Investment'), 'text-blue-700 dark:text-blue-400')}
          </div>
        </div>

        <form onSubmit={handleSave} noValidate>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:gap-8">
            <div className="xl:col-span-2 space-y-4 min-w-0">
              {entryType === 'money' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <SearchableSelect
                        label={t('entry.member', 'Member')}
                        required
                        options={memberOptions}
                        value={selectedMemberId}
                        onChange={val => handleMemberChange(Number(val))}
                        placeholder={t('entry.member_ph', 'Search member...')}
                      />
                      <p className="form-hint">{t('entry.member_hint', 'Only active members are listed.')}</p>
                    </div>
                    <div>
                      <label className="form-label mb-1.5 block">{t('entry.pay_month', 'Payment month')} <Req /></label>
                      <MonthPicker value={paymentMonth} onChange={setPaymentMonth} align="left" className="w-full" />
                      <p className="form-hint">{t('entry.pay_month_hint', 'The month this contribution is for.')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.pay_date', 'Payment date')} <Req /></label>
                      <input type="date" value={paymentDate} max={todayISO()} onChange={e => setPaymentDate(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">{t('entry.contribution', 'Contribution amount')} <Req /></label>
                      <input type="number" min={0} value={contributionAmount} onChange={e => setContributionAmount(toNum(e.target.value))} className="form-input font-bold" required />
                      <p className="form-hint">{t('entry.contribution_hint', "Defaults to the member's monthly due.")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.late_fee', 'Late fee')}</label>
                      <input type="number" min={0} value={lateFee} onChange={e => setLateFee(toNum(e.target.value))} className="form-input font-semibold" />
                      <p className="form-hint">{t('entry.late_fee_hint', 'Suggested from the due day in Settings; you can change it.')}</p>
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('entry.method', 'Payment method')}
                        required
                        options={toOptions(paymentMethods)}
                        value={paymentMethod}
                        onChange={val => setPaymentMethod(String(val))}
                        placeholder={t('entry.method_ph', 'Select method...')}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('entry.trx', 'Transaction / Reference ID')}</label>
                    <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)} className="form-input font-mono" />
                    <p className="form-hint">{t('entry.trx_hint', 'Bank voucher number or bKash TrxID for reconciliation.')}</p>
                  </div>

                  <div>
                    <label className="form-label">{t('entry.note', 'Note')}</label>
                    <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}

              {entryType === 'expense' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.exp_title', 'Expense title')} <Req /></label>
                      <input type="text" value={expenseTitle} onChange={e => setExpenseTitle(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('entry.category', 'Category')}
                        required
                        options={toOptions(expenseCategories)}
                        value={expenseCategory}
                        onChange={val => setExpenseCategory(String(val))}
                        placeholder={t('entry.category_ph', 'Select category...')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.amount', 'Amount')} <Req /></label>
                      <input type="number" min={0} value={expenseAmount} onChange={e => setExpenseAmount(toNum(e.target.value))} className="form-input font-bold" required />
                    </div>
                    <div>
                      <label className="form-label">{t('entry.exp_date', 'Expense date')} <Req /></label>
                      <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="form-input" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.payee', 'Payee / Paid to')} <Req /></label>
                      <input type="text" value={expensePayee} onChange={e => setExpensePayee(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">{t('entry.receipt', 'Receipt / voucher number')}</label>
                      <input type="text" value={expenseReceiptRef} onChange={e => setExpenseReceiptRef(e.target.value)} className="form-input font-mono" />
                      <p className="form-hint">{t('entry.receipt_hint', 'Leave blank to mark the expense as "Needs receipt".')}</p>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('entry.exp_notes', 'Notes')}</label>
                    <textarea rows={2} value={expenseNote} onChange={e => setExpenseNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}

              {entryType === 'investment' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.inv_name', 'Investment name')} <Req /></label>
                      <input type="text" value={invName} onChange={e => setInvName(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <SearchableSelect
                        label={t('entry.sector', 'Sector')}
                        required
                        options={toOptions(investmentSectors)}
                        value={invSector}
                        onChange={val => setInvSector(String(val))}
                        placeholder={t('entry.sector_ph', 'Select sector...')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.inv_amount', 'Invested amount')} <Req /></label>
                      <input type="number" min={0} value={invAmount} onChange={e => setInvAmount(toNum(e.target.value))} className="form-input font-bold" required />
                    </div>
                    <div>
                      <label className="form-label">{t('entry.inv_value', 'Current estimated value')}</label>
                      <input
                        type="number"
                        min={0}
                        value={invEstVal}
                        placeholder={invAmount === '' ? '' : String(invAmount)}
                        onChange={e => setInvEstVal(toNum(e.target.value))}
                        className="form-input font-bold"
                      />
                      <p className="form-hint">{t('entry.inv_value_hint', 'Leave blank to use the invested amount.')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{t('entry.inv_date', 'Purchase date')} <Req /></label>
                      <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} className="form-input" required />
                    </div>
                    <div>
                      <label className="form-label">{t('entry.inv_review', 'Next review date (optional)')}</label>
                      <input type="date" value={invReviewDate} min={invDate || undefined} onChange={e => setInvReviewDate(e.target.value)} className="form-input" />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">{t('entry.inv_notes', 'Deed / asset description')}</label>
                    <textarea rows={2} value={invNote} onChange={e => setInvNote(e.target.value)} className="form-input" />
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4 min-w-0">
              <div className="bg-slate-50 dark:bg-[#121f26] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 text-xs shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('entry.summary', 'Entry summary')}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">{t('entry.summary_hint', 'Review the details before saving.')}</p>

                {entryType === 'money' ? (
                  <div className="space-y-3">
                    <Row label={t('entry.member', 'Member')} value={selectedMember?.name} />
                    <Row label={t('entry.pay_month', 'Payment month')} value={formatMonth(paymentMonth)} />
                    <Row label={t('entry.pay_date', 'Payment date')} value={formatDate(paymentDate)} />
                    <Row label={t('entry.contribution', 'Contribution amount')} value={formatCurrency(Number(contributionAmount) || 0)} />
                    <Row label={t('entry.late_fee', 'Late fee')} value={formatCurrency(Number(lateFee) || 0)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('entry.total_received', 'Total received')}</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(totalMoneyReceived)}</span>
                    </div>
                    <div className="bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-3 text-[11px] text-amber-900 dark:text-amber-300 mt-4 leading-relaxed flex items-start gap-2">
                      <Info size={14} className="shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                      <span>{t('entry.money_tip', 'For a late payment, keep the original due month; the late fee is suggested automatically.')}</span>
                    </div>
                  </div>
                ) : entryType === 'expense' ? (
                  <div className="space-y-3">
                    <Row label={t('entry.exp_title', 'Expense title')} value={expenseTitle} />
                    <Row label={t('entry.category', 'Category')} value={expenseCategory} />
                    <Row label={t('entry.payee', 'Payee / Paid to')} value={expensePayee} />
                    <Row label={t('entry.exp_date', 'Expense date')} value={formatDate(expenseDate)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('entry.total_expense', 'Total expense')}</span>
                      <span className="text-base font-black text-rose-700 dark:text-rose-400">{formatCurrency(Number(expenseAmount) || 0)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Row label={t('entry.investment', 'Investment')} value={invName} />
                    <Row label={t('entry.sector', 'Sector')} value={invSector} />
                    <Row label={t('entry.inv_amount', 'Invested amount')} value={formatCurrency(Number(invAmount) || 0)} />
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">{t('entry.inv_value', 'Current estimated value')}</span>
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
              className="flex items-center gap-1.5 px-4 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={14} />
              <span>{t('entry.clear', 'Clear form')}</span>
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-6 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            >
              <Check size={16} strokeWidth={2.5} />
              <span>{saving ? t('common.saving', 'Saving...') : t('entry.save', 'Save entry')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
