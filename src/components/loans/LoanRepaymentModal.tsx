import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HandCoins, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';
import { DatePicker } from '../common/DatePicker';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { previewLoanRepayment, recordLoanRepayment } from '../../services/db';
import type { Loan, LoanRepaymentQuote } from '../../types';
import { todayISO } from '../../utils/date';
import { useMoney, useNum } from './loanUi';

interface Props {
  loan: Loan | null;
  /** 'Installment' = normal payment; 'Closure' = pay everything off early */
  kind: 'Installment' | 'Closure';
  onClose: () => void;
  onDone: () => void;
}

/** Records money received on a loan. The split into principal and interest is worked out live and is exactly what gets booked. */
export const LoanRepaymentModal: React.FC<Props> = ({ loan, kind, onClose, onDone }) => {
  const { t, tv, formatDate, showToast, triggerRefresh, masterData } = useApp();
  const n = useNum();
  const formatCurrency = useMoney();
  const open = !!loan;
  const closure = kind === 'Closure';

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [interest, setInterest] = useState('');
  const [penalty, setPenalty] = useState('');
  const [method, setMethod] = useState('');
  const [trx, setTrx] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState<LoanRepaymentQuote | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const penaltyTouched = useRef(false);

  useEffect(() => {
    if (!loan) return;
    setDate(todayISO()); setAmount(loan.next_due_amount > 0 ? String(loan.next_due_amount) : ''); setInterest(''); setPenalty(''); setMethod(''); setTrx(''); setNote(''); setQ(null);
    penaltyTouched.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id, kind]);

  useEffect(() => {
    if (!loan) return;
    const my = ++seq.current;
    const id = setTimeout(() => {
      previewLoanRepayment(loan.id, date, closure ? undefined : amount === '' ? 0 : Number(amount), kind, closure && interest !== '' ? Number(interest) : undefined)
        .then(r => {
          if (my !== seq.current) return;
          setQ(r);
          if (!penaltyTouched.current) setPenalty(r.suggestedPenalty ? String(r.suggestedPenalty) : '');
        })
        .catch((e: any) => { if (my === seq.current) showToast(e.message, 'error'); });
    }, 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id, date, amount, interest, kind]);

  const methodOptions = useMemo<SelectOption[]>(
    () => masterData.filter(m => m.type === 'payment_method' && Number(m.is_active) === 1).map(m => ({ value: m.name, label: tv(m.name) })),
    [masterData, tv],
  );

  if (!loan) return <Modal open={false} onClose={onClose} children={null} />;

  const principal = q?.principal ?? 0, intr = q?.interest ?? 0, pen = Number(penalty) || 0;
  const total = Math.round((principal + intr + pen) * 100) / 100;
  const interestChanged = closure && q?.calcInterest !== undefined && interest !== '' && Math.abs(Number(interest) - q.calcInterest) > 0.009;
  const amountN = Number(amount);
  const overpay = !closure && amountN > loan.remaining_payable + 0.005;
  const canSave = !saving && !!method && total > 0 && !overpay && (!interestChanged || note.trim().length > 0);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSave) {
      if (!method) showToast(t('loan.err_received_via', 'Choose how the money was received (cash, bank, bKash…).'), 'error');
      else if (interestChanged && !note.trim()) showToast(t('loan.err_interest_note', 'You changed the interest — please write the reason in the note.'), 'error');
      return;
    }
    setSaving(true);
    try {
      await recordLoanRepayment({
        loan_id: loan.id, paid_date: date, kind, amount: closure ? undefined : amountN, interest: closure && interest !== '' ? Number(interest) : undefined,
        penalty: pen, payment_method: method, trx_id: trx.trim(), note: note.trim(),
      });
      showToast(q?.closes ? t('loan.repaid_closed', 'Repayment recorded. The loan is now fully repaid.') : t('loan.repaid', 'Repayment recorded.'));
      triggerRefresh();
      onDone();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally { setSaving(false); }
  };

  const line = (label: string, value: string, strong = false, tone = '') => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-black text-sm text-slate-900 dark:text-white' : 'font-bold text-slate-800 dark:text-slate-100'} ${tone}`}>{value}</span>
    </div>
  );
  const quick = (label: string, value: number) => value > 0 ? (
    <button type="button" onClick={() => setAmount(String(value))} className="px-2.5 py-1 rounded-full border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1a2b34]">
      {label} · {formatCurrency(value)}
    </button>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      locked={saving}
      size="md"
      icon={<HandCoins size={18} />}
      title={closure ? t('loan.close_title', 'Close loan early') : t('loan.repay_title', 'Record repayment')}
      subtitle={`${loan.loan_no} · ${loan.member_name}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="loan-repay-form" disabled={!canSave} className="btn btn-primary">
            {saving ? t('common.saving', 'Saving…') : closure ? t('loan.close_now', 'Receive and close loan') : t('loan.record', 'Record payment')}
          </button>
        </div>
      }
    >
      <form id="loan-repay-form" onSubmit={submit} className="space-y-4 text-xs">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800 p-3">
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('loan.outstanding', 'Principal owed')}</div><div className="font-black tabular-nums text-sm mt-0.5">{formatCurrency(loan.outstanding_principal)}</div></div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('loan.next_due', 'Next installment')}</div>
            <div className="font-black tabular-nums text-sm mt-0.5">{formatCurrency(loan.next_due_amount)}{loan.next_due_date && <span className="font-semibold text-[11px] text-slate-500 dark:text-slate-400"> · {formatDate(loan.next_due_date)}</span>}</div>
          </div>
          {loan.overdue_amount > 0 && (
            <div className="col-span-2 flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-bold">
              <AlertTriangle size={13} />{t('loan.overdue_line', '{amt} overdue ({n} installments, {d} days late)').replace('{amt}', formatCurrency(loan.overdue_amount)).replace('{n}', n(loan.overdue_count)).replace('{d}', n(loan.days_overdue))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DatePicker label={t('loan.paid_on', 'Received on')} required max={todayISO()} min={loan.last_payment_date || loan.disbursed_date} value={date} onChange={setDate} />
          {!closure ? (
            <div>
              <label className="form-label">{t('loan.amount_received', 'Amount received')} <span className="text-rose-500">*</span></label>
              <MoneyInput min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className="form-input font-bold tabular-nums" autoFocus />
            </div>
          ) : (
            <div>
              <label className="form-label">{t('loan.interest_charged', 'Interest to collect')}</label>
              <MoneyInput min="0" step="any" value={interest === '' ? (q?.calcInterest !== undefined ? String(q.calcInterest) : '') : interest} onChange={e => setInterest(e.target.value)} className="form-input font-bold tabular-nums" />
            </div>
          )}
        </div>

        {!closure && (
          <div className="flex flex-wrap gap-2 -mt-1">
            {quick(t('loan.q_next', 'Next installment'), loan.next_due_amount)}
            {loan.overdue_amount > 0 && loan.overdue_amount !== loan.next_due_amount && quick(t('loan.q_overdue', 'All overdue'), loan.overdue_amount)}
            {quick(t('loan.q_all', 'Everything left'), loan.remaining_payable)}
          </div>
        )}

        {/* the split */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] px-4 py-2 divide-y divide-slate-100 dark:divide-slate-800/80">
          {line(t('loan.toward_principal', 'Goes to principal'), formatCurrency(principal))}
          {line(t('loan.toward_interest', 'Goes to interest'), formatCurrency(intr))}
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-slate-600 dark:text-slate-300">{t('loan.penalty', 'Late penalty (optional)')}</span>
            <div className="w-32"><MoneyInput min="0" step="any" value={penalty} onChange={e => { penaltyTouched.current = true; setPenalty(e.target.value); }} className="form-input py-1 text-right font-bold tabular-nums" /></div>
          </div>
          {line(t('loan.total_received', 'Total received'), formatCurrency(total), true)}
        </div>

        {closure && q && (
          <div className="flex gap-2 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 p-3 text-sky-900 dark:text-sky-300 text-[11px]">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>{t('loan.close_explain', 'The member pays the principal still owed plus interest only up to {date}. Interest for later months ({amt}) is not charged.').replace('{date}', formatDate(date)).replace('{amt}', formatCurrency(Math.max(0, q.waivedInterest || 0)))}</span>
          </div>
        )}
        {!closure && q?.completed && q.completed.length > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] text-emerald-800 dark:text-emerald-400 font-semibold">
            <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
            {q.completed.length === 1
              ? t('loan.completes_one', 'Completes installment {a}.').replace('{a}', n(q.completed[0]))
              : t('loan.completes_many', 'Completes installments {a} to {b}.').replace('{a}', n(q.completed[0])).replace('{b}', n(q.completed[q.completed.length - 1]))}
            {q.closes && ` ${t('loan.fully_repaid', 'The loan will be fully repaid.')}`}
          </p>
        )}
        {overpay && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{t('loan.err_overpay', 'This is more than the loan still needs ({amt}). Use "Close loan early" to pay it all off.').replace('{amt}', formatCurrency(loan.remaining_payable))}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SearchableSelect label={t('loan.received_via', 'Received through')} required options={methodOptions} value={method || null} onChange={v => setMethod(v == null ? '' : String(v))} placeholder={t('loan.paid_via_ph', 'Cash, bank, bKash…')} />
          <div>
            <label className="form-label">{t('loan.trx', 'Transaction no.')}</label>
            <input type="text" value={trx} onChange={e => setTrx(e.target.value)} className="form-input" />
          </div>
        </div>
        <div>
          <label className="form-label">{t('common.notes', 'Notes')}{interestChanged && <span className="text-rose-500"> *</span>}</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} className={`form-input ${interestChanged && !note.trim() ? 'border-rose-400' : ''}`} placeholder={interestChanged ? t('loan.interest_note_ph', 'Why the interest was changed') : ''} />
        </div>
      </form>
    </Modal>
  );
};
