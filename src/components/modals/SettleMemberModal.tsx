import React, { useEffect, useMemo, useState } from 'react';
import { UserMinus, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { previewMemberSettlement, settleMember } from '../../services/db';
import type { SettlementPreview } from '../../types';
import { Modal } from '../common/Modal';
import { DatePicker } from '../common/DatePicker';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { todayISO } from '../../utils/date';

interface Props {
  member: { id: number; name: string; name_bn?: string | null; member_code: string } | null;
  onClose: () => void;
  onDone: () => void;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Final settlement for a member who is leaving: shows the member's own money (opening balance + contributions),
 * the share of investment benefit the system calculated for them, and records how the money was paid.
 * Saving records the payout AND makes the member inactive in one step.
 */
export const SettleMemberModal: React.FC<Props> = ({ member, onClose, onDone }) => {
  const { formatCurrency, formatDate, masterData, showToast, tv, bnName, t } = useApp();
  const [date, setDate] = useState(todayISO());
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState('');
  const [trx, setTrx] = useState('');
  const [note, setNote] = useState('');
  const [share, setShare] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  const methodOptions = useMemo<SelectOption[]>(
    () => masterData.filter(m => m.type === 'payment_method' && Number(m.is_active) === 1).map(m => ({ value: m.name, label: tv(m.name) })),
    [masterData, tv],
  );

  // fresh form each time the dialog opens for a member
  useEffect(() => {
    if (!member) return;
    setDate(todayISO()); setMethod(''); setTrx(''); setNote(''); setPreview(null); setShare('');
  }, [member?.id]);

  // recalculate whenever the member or the date changes (benefits are shared by date)
  useEffect(() => {
    if (!member || !date) return;
    let alive = true;
    setLoading(true);
    previewMemberSettlement(member.id, date)
      .then(p => { if (alive) { setPreview(p); setShare(p.profitShare); } })
      .catch(e => { if (alive) showToast(e.message, 'error'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [member?.id, date]);

  const calc = preview?.profitShare ?? 0;
  const shareNum = share === '' ? 0 : Number(share);
  const changed = !!preview && Math.abs(shareNum - calc) > 0.009;
  const total = preview ? r2(preview.principal + shareNum) : 0;
  const overCash = !!preview && total > preview.cashInHand + 0.009;
  const tooEarly = !!preview?.lastPaymentDate && date < preview.lastPaymentDate;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member || !preview || saving) return;
    if (!method) { showToast(t('settle.err_method', 'Choose how the money was paid (cash, bank, bKash…).'), 'error'); return; }
    if (tooEarly) { showToast(t('settle.err_date', 'Settlement date cannot be before the last payment.'), 'error'); return; }
    if (changed && !note.trim()) { showToast(t('settle.err_note', 'You changed the profit share — please write the reason in the note.'), 'error'); return; }
    if (total < 0) { showToast(t('settle.err_negative', 'The payout cannot be negative.'), 'error'); return; }
    setSaving(true);
    try {
      await settleMember({ member_id: member.id, settlement_date: date, payment_method: method, profit_share: shareNum, trx_id: trx.trim(), note: note.trim() });
      showToast(`${bnName(member.name, member.name_bn)}: ${t('settle.done', 'settled and set to Inactive.')}`);
      onDone();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const row = 'flex items-baseline justify-between gap-3 py-1.5';
  const lbl = 'text-xs text-slate-600 dark:text-slate-300';

  return (
    <Modal
      open={!!member}
      onClose={() => !saving && onClose()}
      locked={saving}
      size="lg"
      icon={<UserMinus size={20} />}
      title={t('settle.title', 'Settle & deactivate member')}
      subtitle={member ? `${bnName(member.name, member.name_bn)} · ${member.member_code}` : undefined}
      footer={
        <>
          <div className="mr-auto flex items-baseline gap-3" aria-live="polite">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t('settle.total', 'Total paid to member')}</span>
            <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(total)}</span>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel min-w-[7.5rem]">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="settle-form" disabled={saving || loading || !preview} className="btn btn-primary min-w-[12rem]">
            <UserMinus size={16} strokeWidth={2.4} />
            <span>{saving ? t('common.saving', 'Saving...') : t('settle.confirm', 'Pay & deactivate')}</span>
          </button>
        </>
      }
    >
      <form id="settle-form" onSubmit={handleSave} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
        {/* Left: the money */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/70 px-4 py-2 divide-y divide-slate-100 dark:divide-slate-800">
          <div className={row}><span className={lbl}>{t('settle.opening', 'Opening balance')}</span><span className="font-bold tabular-nums">{formatCurrency(preview?.openingBalance ?? 0)}</span></div>
          <div className={row}><span className={lbl}>{t('settle.contrib', 'Contributions paid')}</span><span className="font-bold tabular-nums">{formatCurrency(preview?.contributions ?? 0)}</span></div>
          <div className={row}><span className="text-xs font-bold text-slate-800 dark:text-slate-100">{t('settle.principal', 'Member\'s own money')}</span><span className="font-black tabular-nums">{formatCurrency(preview?.principal ?? 0)}</span></div>
          <div className={row}>
            <span className={lbl}>{t('settle.share', 'Investment benefit share')}<span className="block text-[10px] text-slate-400">{t('settle.calc', 'Calculated')}: {formatCurrency(calc)}</span></span>
            <input type="number" step="0.01" value={share} onChange={e => setShare(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label={t('settle.share', 'Investment benefit share')} className="form-input !w-36 text-right font-bold tabular-nums" />
          </div>
          <div className={row}><span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">{t('settle.payout', 'Total payout')}</span><span className="font-black text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(total)}</span></div>
          <p className="py-1.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
            {t('settle.late_note', 'Late fees stay in the fund:')} {formatCurrency(preview?.lateFeesKept ?? 0)} {t('settle.not_refunded', 'is not refunded.')}
          </p>
        </div>

        {/* Right: how it was paid */}
        <div className="grid grid-cols-1 gap-y-3.5">
          <DatePicker label={t('settle.date', 'Settlement date')} required clearable={false} value={date} max={todayISO()} onChange={setDate} />
          <SearchableSelect label={t('settle.method', 'Paid through')} required options={methodOptions} value={method}
            onChange={v => setMethod(String(v ?? ''))} placeholder={t('members.pay_method_ph', 'Select method…')} />
          <div>
            <label className="form-label">{t('members.trx', 'Transaction / Ref ID')}</label>
            <input type="text" value={trx} onChange={e => setTrx(e.target.value)} className="form-input font-mono" />
          </div>
          <div>
            <label className="form-label">{t('members.note', 'Note')}{changed && <span className="text-rose-500"> *</span>}</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className="form-input"
              placeholder={changed ? t('settle.note_reason', 'Reason for changing the share') : ''} />
          </div>
        </div>

        {(tooEarly || overCash || changed || (preview && preview.lines.length > 0)) && (
          <div className="md:col-span-2 space-y-1.5 text-[11px] leading-snug">
            {tooEarly && <p className="flex gap-1.5 text-rose-700 dark:text-rose-300"><AlertTriangle size={13} className="shrink-0 mt-px" />{t('settle.err_date', 'Settlement date cannot be before the last payment.')} ({formatDate(preview!.lastPaymentDate!)})</p>}
            {overCash && <p className="flex gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle size={13} className="shrink-0 mt-px" />{t('settle.cash_warn', 'The payout is more than the cash in hand')} ({formatCurrency(preview!.cashInHand)}). {t('settle.cash_warn2', 'Part of the fund is invested — make sure the money is available.')}</p>}
            {changed && <p className="flex gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle size={13} className="shrink-0 mt-px" />{t('settle.changed', 'The benefit share differs from the calculated amount; it will be recorded with your note.')}</p>}
            {preview && preview.lines.length > 0 && (
              <details className="text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-semibold">{t('settle.how', 'How the benefit share was calculated')} ({preview.lines.length})</summary>
                <ul className="mt-1 max-h-24 overflow-auto space-y-0.5">
                  {preview.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 tabular-nums"><span className="truncate">{formatDate(l.date)} · {l.label}: {formatCurrency(l.amount)}</span><span className="font-bold">{formatCurrency(l.share)}</span></li>
                  ))}
                </ul>
                <p className="mt-1 text-slate-500 dark:text-slate-400">{t('settle.how_note', 'Each profit or loss is shared among the members in the fund on that date, in proportion to the money each had put in by then.')}</p>
              </details>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
};
