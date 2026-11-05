import React, { useState, useEffect } from 'react';
import {
  History,
  Check,
  RotateCcw,
  Coins,
  Receipt,
  TrendingUp,
  Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getMembers,
  recordPayment,
  addExpense,
  addInvestment,
  getMasterData,
} from '../services/db';
import { Member, MasterCategory } from '../types';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { MonthPicker } from '../components/common/MonthPicker';

export const EntryCenterView: React.FC = () => {
  const { entryCenterInitialTab, showToast, triggerRefresh, setActiveTab, language, t, formatCurrency, toBanglaDigits } = useApp();
  const [entryType, setEntryType] = useState<'money' | 'expense' | 'investment'>(entryCenterInitialTab);

  // Lists
  const [members, setMembers] = useState<Member[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MasterCategory[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<MasterCategory[]>([]);
  const [investmentSectors, setInvestmentSectors] = useState<MasterCategory[]>([]);

  // Money Received Form state
  const [selectedMemberId, setSelectedMemberId] = useState<number>(1);
  const [paymentMonth, setPaymentMonth] = useState('June 2024');
  const [paymentDate, setPaymentDate] = useState('28 Jun 2024');
  const [contributionAmount, setContributionAmount] = useState<number>(2000);
  const [lateFee, setLateFee] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer');
  const [trxId, setTrxId] = useState('TRX-240628-001');
  const [note, setNote] = useState('Monthly contribution');

  // Expense Form state
  const [expenseTitle, setExpenseTitle] = useState('June meetup expense');
  const [expenseCategory, setExpenseCategory] = useState('Meetup & Events');
  const [expenseAmount, setExpenseAmount] = useState<number>(6800);
  const [expenseDate, setExpenseDate] = useState('28 Jun 2024');
  const [expensePayee, setExpensePayee] = useState('Rafiq Hasan');
  const [expenseReceiptRef, setExpenseReceiptRef] = useState('RCP-240628-09');
  const [expenseNote, setExpenseNote] = useState('Hall rental and refreshments');

  // Investment Form state
  const [invName, setInvName] = useState('Keraniganj Land Extension');
  const [invSector, setInvSector] = useState('Land purchase');
  const [invAmount, setInvAmount] = useState<number>(150000);
  const [invEstVal, setInvEstVal] = useState<number>(175000);
  const [invDate, setInvDate] = useState('28 Jun 2024');
  const [invReviewDate, setInvReviewDate] = useState('15 Aug 2024');
  const [invNote, setInvNote] = useState('Commercial highway front land');

  useEffect(() => {
    setEntryType(entryCenterInitialTab);
  }, [entryCenterInitialTab]);

  useEffect(() => {
    getMembers('', 'All', 1, 100).then(res => {
      setMembers(res.members);
      if (res.members.length > 0) setSelectedMemberId(res.members[0].id);
    });
    getMasterData('payment_method').then(setPaymentMethods);
    getMasterData('expense_category').then(setExpenseCategories);
    getMasterData('investment_sector').then(setInvestmentSectors);
  }, []);

  const selectedMember = members.find(m => m.id === Number(selectedMemberId));

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

  const expenseCategoryOptions: SelectOption[] = (
    expenseCategories.length > 0
      ? expenseCategories.map(ec => ({ value: ec.name, label: ec.name }))
      : [
          { value: 'Meetup & Events', label: 'Meetup & Events' },
          { value: 'Office Supplies', label: 'Office Supplies' },
          { value: 'Legal & Documentation', label: 'Legal & Documentation' },
          { value: 'Maintenance', label: 'Maintenance' },
        ]
  );

  const investmentSectorOptions: SelectOption[] = (
    investmentSectors.length > 0
      ? investmentSectors.map(is => ({ value: is.name, label: is.name }))
      : [
          { value: 'Land purchase', label: 'Land purchase' },
          { value: 'Flat purchase', label: 'Flat purchase' },
          { value: 'Plot purchase', label: 'Plot purchase' },
          { value: 'Assets', label: 'Assets' },
        ]
  );

  const handleClear = () => {
    if (entryType === 'money') {
      setContributionAmount(2000);
      setLateFee(0);
      setTrxId('');
      setNote('');
    } else if (entryType === 'expense') {
      setExpenseTitle('');
      setExpenseAmount(0);
      setExpensePayee('');
      setExpenseReceiptRef('');
      setExpenseNote('');
    } else {
      setInvName('');
      setInvAmount(0);
      setInvEstVal(0);
      setInvNote('');
    }
    showToast('Form cleared');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (entryType === 'money') {
        await recordPayment({
          member_id: Number(selectedMemberId),
          payment_month: paymentMonth,
          payment_date: paymentDate,
          contribution_amount: Number(contributionAmount),
          late_fee: Number(lateFee),
          payment_method: paymentMethod,
          trx_id: trxId || `TRX-${Date.now().toString().slice(-6)}`,
          note,
        });
        showToast(
          `Money received: TK ${(Number(contributionAmount) + Number(lateFee)).toLocaleString()} saved for ${selectedMember?.name}!`
        );
      } else if (entryType === 'expense') {
        await addExpense({
          title: expenseTitle,
          category: expenseCategory,
          amount: Number(expenseAmount),
          expense_date: expenseDate,
          payee: expensePayee,
          receipt_ref: expenseReceiptRef || 'RCP-PENDING',
          status: expenseReceiptRef ? 'Verified' : 'Needs receipt',
          notes: expenseNote,
        });
        showToast(`Expense: "${expenseTitle}" of TK ${Number(expenseAmount).toLocaleString()} recorded!`);
      } else {
        await addInvestment({
          name: invName,
          sector: invSector,
          purchase_date: invDate,
          invested_amount: Number(invAmount),
          current_estimated_value: Number(invEstVal),
          status: 'Growing',
          review_date: invReviewDate,
          notes: invNote,
        });
        showToast(`Investment: "${invName}" of TK ${Number(invAmount).toLocaleString()} recorded!`);
      }

      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const totalMoneyReceived = Number(contributionAmount) + Number(lateFee);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Add a fund entry</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Record member money, operating expenses, or a new union investment with a clear audit trail.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold hidden sm:inline">
            All amounts in Bangladeshi Taka
          </span>
          <button
            onClick={() => setActiveTab('collections')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <History size={14} className="text-slate-500 dark:text-slate-400" />
            <span>View entry history</span>
          </button>
        </div>
      </div>

      {/* Main Card with Form & Summary */}
      <div className="card-base p-6">
        {/* Entry Type Selector Tabs (Matching Image 5) */}
        <div className="mb-6">
          <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
            Entry type
          </label>
          <div className="inline-flex bg-slate-100 dark:bg-[#111e24] p-1 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setEntryType('money')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                entryType === 'money'
                  ? 'bg-white dark:bg-[#182830] text-[#0f4a3c] dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Coins size={15} />
              <span>Money received</span>
            </button>
            <button
              onClick={() => setEntryType('expense')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                entryType === 'expense'
                  ? 'bg-white dark:bg-[#182830] text-rose-700 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Receipt size={15} />
              <span>Expense</span>
            </button>
            <button
              onClick={() => setEntryType('investment')}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                entryType === 'investment'
                  ? 'bg-white dark:bg-[#182830] text-blue-700 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TrendingUp size={15} />
              <span>Investment</span>
            </button>
          </div>
        </div>

        {/* 2-Column Layout: Form on Left, Summary Card on Right */}
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form Fields Column (2 Cols) */}
            <div className="lg:col-span-2 space-y-4">
              {entryType === 'money' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <SearchableSelect
                        label={language === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Member'}
                        required
                        options={memberOptions}
                        value={selectedMemberId}
                        onChange={val => setSelectedMemberId(Number(val))}
                        placeholder={language === 'bn' ? 'নাম বা আইডি দিয়ে খুঁজুন...' : 'Search member...'}
                      />
                      <p className="form-hint">
                        {language === 'bn' ? 'নিবন্ধিত সদস্যের নাম বা কোড নির্বাচন করুন।' : 'Select registered union contributor.'}
                      </p>
                    </div>

                    <div>
                      <label className="form-label mb-1.5 block">
                        {language === 'bn' ? 'পেমেন্টের মাস' : 'Payment month'} <span className="text-rose-500">*</span>
                      </label>
                      <MonthPicker
                        value={paymentMonth}
                        onChange={setPaymentMonth}
                        align="left"
                        className="w-full"
                      />
                      <p className="form-hint">
                        {language === 'bn' ? 'চাঁদার হিসাব চক্রের মাস।' : 'Assign contribution billing cycle.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        {language === 'bn' ? 'পেমেন্টের তারিখ' : 'Payment date'} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={paymentDate}
                        onChange={e => setPaymentDate(e.target.value)}
                        className="form-input"
                        required
                      />
                    </div>

                    <div>
                      <label className="form-label">
                        {language === 'bn' ? 'চাঁদার পরিমাণ' : 'Contribution amount'} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={contributionAmount}
                        onChange={e => setContributionAmount(Number(e.target.value))}
                        className="form-input font-bold"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">{language === 'bn' ? 'বিলম্ব জরিমানা' : 'Late fee'}</label>
                      <select
                        value={lateFee}
                        onChange={e => setLateFee(Number(e.target.value))}
                        className="form-select font-semibold"
                      >
                        <option value={0}>TK 0 ({language === 'bn' ? 'সময়মত পেমেন্ট' : 'On-time payment'})</option>
                        <option value={300}>TK 300 ({language === 'bn' ? 'নিয়মিত বিলম্ব ফি' : 'Standard overdue penalty'})</option>
                        <option value={500}>TK 500 ({language === 'bn' ? 'বর্ধিত জরিমানা' : 'Extended delay penalty'})</option>
                      </select>
                      <p className="form-hint">
                        {language === 'bn' ? 'মাসের ১০ তারিখের পর দিলে বিলম্ব ফি যুক্ত হবে।' : 'Auto-calculated if paid past 10th of month.'}
                      </p>
                    </div>

                    <div>
                      <SearchableSelect
                        label={language === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment method'}
                        required
                        options={paymentMethodOptions}
                        value={paymentMethod}
                        onChange={val => setPaymentMethod(String(val))}
                        placeholder="Select method..."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Transaction / Reference ID</label>
                    <input
                      type="text"
                      value={trxId}
                      onChange={e => setTrxId(e.target.value)}
                      placeholder="e.g. TRX-240628-001"
                      className="form-input font-mono font-bold"
                    />
                    <p className="form-hint">Bank voucher number or bKash TrxID for reconciliation.</p>
                  </div>

                  <div>
                    <label className="form-label">Note</label>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Monthly contribution note"
                      className="form-input"
                    />
                  </div>
                </>
              )}

              {entryType === 'expense' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        Expense Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={expenseTitle}
                        onChange={e => setExpenseTitle(e.target.value)}
                        className="form-input"
                        required
                      />
                    </div>
                    <div>
                      <SearchableSelect
                        label={language === 'bn' ? 'ব্যয়ের খাত' : 'Category'}
                        required
                        options={expenseCategoryOptions}
                        value={expenseCategory}
                        onChange={val => setExpenseCategory(String(val))}
                        placeholder="Select category..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        Amount (TK) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={expenseAmount}
                        onChange={e => setExpenseAmount(Number(e.target.value))}
                        className="form-input font-bold"
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Expense Date <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={expenseDate}
                        onChange={e => setExpenseDate(e.target.value)}
                        className="form-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        Payee / Disbursed to <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={expensePayee}
                        onChange={e => setExpensePayee(e.target.value)}
                        className="form-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">Receipt Voucher Number</label>
                      <input
                        type="text"
                        value={expenseReceiptRef}
                        onChange={e => setExpenseReceiptRef(e.target.value)}
                        placeholder="e.g. RCP-240628-09"
                        className="form-input font-mono"
                      />
                      <p className="form-hint">Physical receipt voucher reference.</p>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Audit Notes</label>
                    <textarea
                      rows={2}
                      value={expenseNote}
                      onChange={e => setExpenseNote(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </>
              )}

              {entryType === 'investment' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        Investment Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={invName}
                        onChange={e => setInvName(e.target.value)}
                        className="form-input"
                        required
                      />
                    </div>
                    <div>
                      <SearchableSelect
                        label={language === 'bn' ? 'বিনিয়োগের খাত / সেক্টর' : 'Sector'}
                        required
                        options={investmentSectorOptions}
                        value={invSector}
                        onChange={val => setInvSector(String(val))}
                        placeholder="Select sector..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">
                        Invested Amount (TK) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={invAmount}
                        onChange={e => setInvAmount(Number(e.target.value))}
                        className="form-input font-bold"
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Estimated Value (TK) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={invEstVal}
                        onChange={e => setInvEstVal(Number(e.target.value))}
                        className="form-input font-bold"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Purchase Date</label>
                      <input
                        type="text"
                        value={invDate}
                        onChange={e => setInvDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Review Schedule</label>
                      <input
                        type="text"
                        value={invReviewDate}
                        onChange={e => setInvReviewDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Deed / Asset Description</label>
                    <textarea
                      rows={2}
                      value={invNote}
                      onChange={e => setInvNote(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Right Side: Entry Summary Card (Matching Image 5) */}
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-[#121f26] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 text-xs shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Entry summary</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">Review ledger details before saving.</p>

                {entryType === 'money' ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Member</span>
                      <span className="font-bold text-slate-900 dark:text-white">{selectedMember?.name || 'Mim Akter'}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>June contribution</span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        TK {Number(contributionAmount).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Late fee</span>
                      <span className="font-bold text-slate-900 dark:text-white">TK {Number(lateFee).toLocaleString()}</span>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">Total received</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        TK {totalMoneyReceived.toLocaleString()}
                      </span>
                    </div>

                    <div className="pt-2">
                      <span className="inline-block px-3 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full text-[10px] font-bold">
                        Ready to save
                      </span>
                    </div>

                    {/* Tip box (Matching Image 5) */}
                    <div className="bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-3 text-[11px] text-amber-900 dark:text-amber-300 mt-4 leading-relaxed flex items-start gap-2">
                      <Info size={14} className="shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                      <span>
                        If this is a previous-month payment, choose the applicable late fee and keep the original due month.
                      </span>
                    </div>
                  </div>
                ) : entryType === 'expense' ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Title</span>
                      <span className="font-bold text-slate-900 dark:text-white">{expenseTitle}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Category</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{expenseCategory}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Payee</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{expensePayee}</span>
                    </div>
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">Total Expense</span>
                      <span className="text-base font-black text-rose-700 dark:text-rose-400">
                        TK {Number(expenseAmount).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Investment</span>
                      <span className="font-bold text-slate-900 dark:text-white">{invName}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Sector</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{invSector}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                      <span>Invested</span>
                      <span className="font-semibold text-slate-900 dark:text-white">TK {Number(invAmount).toLocaleString()}</span>
                    </div>
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                      <span className="font-bold text-slate-900 dark:text-white">Current Valuation</span>
                      <span className="text-base font-black text-emerald-700 dark:text-emerald-400">
                        TK {Number(invEstVal).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions (Matching Image 5) */}
          <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <RotateCcw size={14} />
              <span>Clear form</span>
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
            >
              <Check size={16} strokeWidth={2.5} />
              <span>Save entry</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
