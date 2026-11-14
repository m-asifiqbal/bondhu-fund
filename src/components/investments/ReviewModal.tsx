import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ShieldCheck, Eye, BadgeDollarSign, MoreHorizontal, History, CalendarClock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { DatePicker } from '../common/DatePicker';
import { MoneyInput } from '../common/MoneyInput';
import { todayISO, daysBetween } from '../../utils/date';
import { completeInvestmentReview, getInvestmentReviews } from '../../services/db';
import type { Investment, InvestmentReview, ReviewDecision } from '../../types';

const plusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayISO(d);
};

const DECISIONS: { key: ReviewDecision; icon: React.ReactNode; tone: string }[] = [
  { key: 'Hold', icon: <ShieldCheck size={16} />, tone: 'emerald' },
  { key: 'Watch', icon: <Eye size={16} />, tone: 'amber' },
  { key: 'Sell', icon: <BadgeDollarSign size={16} />, tone: 'rose' },
  { key: 'Other', icon: <MoreHorizontal size={16} />, tone: 'slate' },
];
const TONE: Record<string, string> = {
  emerald: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200',
  amber: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200',
  rose: 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200',
  slate: 'border-slate-500 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100',
};
const BADGE: Record<ReviewDecision, string> = {
  Hold: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  Watch: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  Sell: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  Other: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

/**
 * Record the outcome of a committee meeting for one investment: the decision, the minutes, the value the committee agreed
 * and when to look again. Saving marks the review as done (it stops showing as due) and keeps a history.
 */
export const ReviewModal: React.FC<{ inv: Investment | null; onClose: () => void; onDone: (inv: Investment, decision: ReviewDecision) => void }> = ({ inv, onClose, onDone }) => {
  const { t, tv, formatCurrency, formatDate, language, toBanglaDigits } = useApp();
  const n = (v: number | string) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const today = todayISO();
  const [meeting, setMeeting] = useState(today);
  const [decision, setDecision] = useState<ReviewDecision>('Hold');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState('');
  const [value, setValue] = useState('');
  const [next, setNext] = useState('');
  const [nextTouched, setNextTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<InvestmentReview[] | null>(null);

  useEffect(() => {
    if (!inv) return;
    setMeeting(today); setDecision('Hold'); setNotes(''); setAttendees(''); setValue(String(inv.current_estimated_value ?? '')); setNext(''); setNextTouched(false); setError(''); setHistory(null);
    getInvestmentReviews(inv.id).then(setHistory, () => setHistory([]));
  }, [inv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // until the user picks a date, the next review follows the meeting by 90 days (a decision to sell: 30)
  useEffect(() => { if (!nextTouched) setNext(meeting ? plusDays(meeting, decision === 'Sell' ? 30 : 90) : ''); }, [meeting, decision, nextTouched]);

  const info = useMemo(() => {
    if (!inv) return null;
    const v = value === '' ? inv.current_estimated_value : Number(value);
    const status = decision === 'Hold' ? 'Growing' : decision === 'Other' ? inv.status : 'Review';
    return { delta: (Number.isFinite(v) ? v : inv.current_estimated_value) - inv.current_estimated_value, status };
  }, [inv, value, decision]);
  if (!inv || !info) return null;

  const dueDays = inv.review_date ? daysBetween(today, inv.review_date.slice(0, 10)) : null;
  const needNote = decision !== 'Hold' && notes.trim().length < 3;
  const label: Record<ReviewDecision, [string, string]> = {
    Hold: [t('review.d_hold', 'Hold'), t('review.d_hold_d', 'Keep it as it is')],
    Watch: [t('review.d_watch', 'Watch'), t('review.d_watch_d', 'Keep it, look again soon')],
    Sell: [t('review.d_sell', 'Sell'), t('review.d_sell_d', 'The committee decided to sell')],
    Other: [t('review.d_other', 'Other'), t('review.d_other_d', 'Something else, explained in the notes')],
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await completeInvestmentReview({ investment_id: inv.id, meeting_date: meeting, decision, notes, attendees, new_value: value === '' ? undefined : Number(value), next_review_date: next || undefined });
      onDone(inv, decision);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} locked={busy} size="md" icon={<ClipboardCheck size={18} />} title={t('review.title', 'Complete committee review')} subtitle={`${inv.name} · ${tv(inv.sector)}`}
      footer={<div className="flex flex-col gap-2">{error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="flex items-center justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="review-form" disabled={busy || !meeting || needNote} className="btn btn-primary"><ClipboardCheck size={15} />{busy ? t('common.saving', 'Saving…') : t('review.done', 'Mark review as done')}</button></div></div>}>
      <form id="review-form" onSubmit={submit} className="space-y-5 text-xs">
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#121f26] p-3">
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('review.cost', 'Cost')}</div><div className="font-black text-slate-900 dark:text-white mt-0.5">{formatCurrency(inv.invested_amount)}</div></div>
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('review.value_now', 'Estimated value')}</div><div className="font-black text-slate-900 dark:text-white mt-0.5">{formatCurrency(inv.current_estimated_value)}</div></div>
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('review.due', 'Review')}</div>
            <div className={`font-black mt-0.5 ${dueDays !== null && dueDays < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{inv.review_date ? formatDate(inv.review_date) : t('review.flagged', 'Flagged')}</div>
            {dueDays !== null && dueDays < 0 && <div className="text-[10px] text-rose-600 dark:text-rose-400">{t('review.overdue_days', '{n} day(s) overdue').replace('{n}', n(-dueDays))}</div>}</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DatePicker label={t('review.meeting', 'Meeting date')} required max={today} clearable={false} value={meeting} onChange={setMeeting} />
          <div><label className="form-label">{t('review.attendees', 'Who attended (optional)')}</label><input className="form-input" value={attendees} onChange={e => setAttendees(e.target.value)} maxLength={300} placeholder={t('review.attendees_ph', 'e.g. President, Treasurer, 5 members')} /></div>
        </div>

        <div>
          <label className="form-label">{t('review.decision', 'What did the committee decide?')} <span className="text-rose-500">*</span></label>
          <div className="grid grid-cols-2 gap-2.5 mt-1.5" role="radiogroup">
            {DECISIONS.map(d => (
              <button key={d.key} type="button" role="radio" aria-checked={decision === d.key} onClick={() => setDecision(d.key)}
                className={`text-left rounded-xl border-2 px-3 py-2.5 transition-colors ${decision === d.key ? TONE[d.tone] : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 text-slate-700 dark:text-slate-300'}`}>
                <span className="flex items-center gap-2 font-black text-[13px]">{d.icon}{label[d.key][0]}</span>
                <span className="block text-[11px] opacity-80 mt-0.5">{label[d.key][1]}</span>
              </button>))}
          </div>
        </div>

        <div>
          <label className="form-label">{t('review.notes', 'Minutes / notes')} {decision !== 'Hold' && <span className="text-rose-500">*</span>}</label>
          <textarea className="form-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000}
            placeholder={decision === 'Sell' ? t('review.notes_sell', 'e.g. Sell when the price reaches the agreed amount.') : t('review.notes_ph', 'What was discussed and agreed.')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">{t('review.new_value', 'Estimated value agreed')}</label>
            <MoneyInput min="0" step="any" value={value} onChange={e => setValue(e.target.value)} className="form-input font-bold" />
            <p className={`form-hint ${info.delta === 0 ? '' : info.delta > 0 ? '!text-emerald-700' : '!text-rose-600'}`}>{info.delta === 0 ? t('review.value_same', 'No change to the value.') : `${info.delta > 0 ? '+' : '−'}${formatCurrency(Math.abs(info.delta))} ${t('review.vs_now', 'compared with now')}`}</p>
          </div>
          <div>
            <DatePicker label={t('review.next', 'Next review')} min={plusDays(meeting || today, 1)} clearable value={next} onChange={iso => { setNextTouched(true); setNext(iso); }} placeholder={t('review.next_ph', 'Not scheduled')} />
            <p className="form-hint">{t('review.next_hint', 'Leave empty if no further review is planned.')}</p>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3.5 py-2.5 text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed flex items-start gap-2">
          <CalendarClock size={14} className="shrink-0 mt-0.5" />
          <span>{t('review.effect', 'After saving: status becomes {s}; {nx}; the value is {v}. The cash and the fund balance do not change.')
            .replace('{s}', tv(info.status)).replace('{nx}', next ? t('review.effect_next', 'next review on {d}').replace('{d}', formatDate(next)) : t('review.effect_none', 'no further review is scheduled'))
            .replace('{v}', info.delta === 0 ? t('review.effect_same', 'unchanged') : t('review.effect_new', 'updated to {x}').replace('{x}', formatCurrency(value === '' ? inv.current_estimated_value : Number(value))))}</span>
        </div>

        <details className="rounded-xl border border-slate-200 dark:border-slate-800" open={!!history && history.length > 0 && history.length <= 2}>
          <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2"><History size={13} />{t('review.history', 'Previous reviews')}{history ? ` (${n(history.length)})` : ''}</summary>
          <div className="px-3.5 pb-3 space-y-2.5">
            {history === null ? <p className="text-slate-400">{t('common.loading', 'Loading…')}</p> : history.length === 0 ? <p className="text-slate-400">{t('review.no_history', 'No review has been recorded yet.')}</p> : history.map(r => (
              <div key={r.id} className="border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-black text-slate-900 dark:text-white">{formatDate(r.meeting_date)}</span><span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${BADGE[r.decision]}`}>{label[r.decision][0]}</span>
                  {r.value_after !== r.value_before && <span className="text-[10px] text-slate-500">{formatCurrency(r.value_before)} → {formatCurrency(r.value_after)}</span>}</div>
                {r.notes && <p className="text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-line">{r.notes}</p>}
                <p className="text-[10px] text-slate-400 mt-0.5">{[r.attendees, r.next_review_date ? t('review.next_on', 'next review {d}').replace('{d}', formatDate(r.next_review_date)) : '', r.created_by].filter(Boolean).join(' · ')}</p>
              </div>))}
          </div>
        </details>
      </form>
    </Modal>
  );
};
