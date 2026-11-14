import React, { useCallback, useEffect, useState } from 'react';
import { Landmark, HandCoins, Ban, Trash2, Undo2, Lock, FileText, ShieldCheck, FileDown, FileCheck2, Upload, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { DatePicker } from '../common/DatePicker';
import { SegmentedTabs } from '../common/SegmentedTabs';
import { getLoan, deleteLoan, deleteLoanRepayment, writeOffLoan, cancelLoanWriteOff, uploadLoanConsent, openLoanConsent } from '../../services/db';
import type { LoanDetail } from '../../types';
import { todayISO } from '../../utils/date';
import { LoanStatusBadge, InstallmentBadge, ProgressBar, useMoney, useNum, useRateText, useConsentPaper, consentFromDetail } from './loanUi';
import { LoanRepaymentModal } from './LoanRepaymentModal';

type Tab = 'schedule' | 'history' | 'member';

interface Props {
  loanId: number | null;
  onClose: () => void;
  /** open another loan of the same borrower */
  onOpenLoan: (id: number) => void;
  /** after anything changed (the list behind refreshes) */
  onChanged: () => void;
}

export const LoanDetailModal: React.FC<Props> = ({ loanId, onClose, onOpenLoan, onChanged }) => {
  const { t, tv, formatDate, showToast, triggerRefresh, refreshKey, isAdmin, bnName, session } = useApp();
  const n = useNum();
  const formatCurrency = useMoney();
  const rateText = useRateText();
  const makePaper = useConsentPaper();
  const readOnly = session?.user.role === 'Auditor';
  const [d, setD] = useState<LoanDetail | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [pay, setPay] = useState<null | 'Installment' | 'Closure'>(null);
  const [confirm, setConfirm] = useState<null | 'delete' | 'writeoff' | 'cancelwo' | { repayId: number }>(null);
  const [woDate, setWoDate] = useState(todayISO());
  const [woReason, setWoReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!loanId) return;
    getLoan(loanId).then(setD).catch((e: any) => showToast(e.message, 'error'));
  }, [loanId, showToast]);

  useEffect(() => { if (loanId) { setTab('schedule'); setD(null); } }, [loanId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const loan = d?.loan;
  const open = loan?.status === 'Active';
  const changed = () => { triggerRefresh(); onChanged(); };

  const uploadPaper = async () => {
    if (!loanId) return;
    setBusy(true);
    try {
      const r = await uploadLoanConsent('loan', loanId);
      if (!r.canceled) { showToast(t('loan.paper_uploaded', 'Signed paper uploaded: {name}').replace('{name}', r.name || '')); triggerRefresh(); onChanged(); load(); }
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  const openPaper = async () => { if (loanId) { try { await openLoanConsent('loan', loanId); } catch (e: any) { showToast(e.message, 'error'); } } };

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); showToast(ok); setConfirm(null); changed(); after?.(); }
    catch (e: any) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const tile = (label: string, value: string, sub?: React.ReactNode, tone = '') => (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className={`text-base font-black tabular-nums mt-1 truncate ${tone || 'text-slate-900 dark:text-white'}`} title={value}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );

  const th = 'py-2 px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';
  const td = 'py-2 px-2.5';

  return (
    <>
      <Modal
        open={!!loanId}
        onClose={onClose}
        size="xl"
        icon={<Landmark size={18} />}
        title={loan ? <span className="flex items-center gap-2.5 flex-wrap">{loan.loan_no}<LoanStatusBadge status={loan.derived_status} /></span> : t('common.loading', 'Loading…')}
        subtitle={loan ? `${bnName(loan.member_name, loan.member_name_bn)} · ${loan.member_code}` : undefined}
        footer={loan && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {!readOnly && loan.status === 'Written off' && isAdmin && (
                <button type="button" onClick={() => setConfirm('cancelwo')} className="btn btn-outline btn-sm"><Undo2 size={13} />{t('loan.cancel_writeoff', 'Cancel write-off')}</button>
              )}
              {!readOnly && loan.repayment_count === 0 && loan.status === 'Active' && (
                <button type="button" onClick={() => setConfirm('delete')} className="btn btn-danger-outline btn-sm"><Trash2 size={13} />{t('loan.delete', 'Delete loan')}</button>
              )}
              {!readOnly && open && isAdmin && (
                <button type="button" onClick={() => { setWoDate(todayISO()); setWoReason(''); setConfirm('writeoff'); }} className="btn btn-danger-outline btn-sm"><Ban size={13} />{t('loan.write_off', 'Write off')}</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onClose} className="btn btn-cancel">{t('common.close', 'Close')}</button>
              {!readOnly && open && <button type="button" onClick={() => setPay('Closure')} className="btn btn-outline">{t('loan.close_early', 'Close loan early')}</button>}
              {!readOnly && open && <button type="button" onClick={() => setPay('Installment')} className="btn btn-primary"><HandCoins size={15} />{t('loan.record_repayment', 'Record repayment')}</button>}
            </div>
          </div>
        )}
      >
        {!d || !loan ? (
          <div className="py-16 text-center text-xs text-slate-400">{t('common.loading', 'Loading…')}</div>
        ) : (
          <div className="space-y-5 text-xs">
            {/* headline numbers */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tile(t('loan.amount', 'Loan amount'), formatCurrency(loan.principal), `${formatDate(loan.disbursed_date)} · ${tv(loan.payment_method || '')}`)}
              {tile(t('loan.repaid_so_far', 'Repaid so far'), formatCurrency(loan.total_paid), t('loan.repaid_split', '{p} principal · {i} interest').replace('{p}', formatCurrency(loan.paid_principal)).replace('{i}', formatCurrency(loan.paid_interest)), 'text-emerald-700 dark:text-emerald-400')}
              {tile(t('loan.outstanding', 'Principal owed'), formatCurrency(loan.outstanding_principal), loan.status === 'Active' ? t('loan.interest_left', '{i} interest still to come').replace('{i}', formatCurrency(loan.remaining_interest)) : undefined, loan.outstanding_principal > 0 ? 'text-amber-700 dark:text-amber-400' : '')}
              {loan.status === 'Active'
                ? tile(loan.overdue_amount > 0 ? t('loan.overdue_now', 'Overdue now') : t('loan.next_due', 'Next installment'),
                  formatCurrency(loan.overdue_amount > 0 ? loan.overdue_amount : loan.next_due_amount),
                  loan.overdue_amount > 0 ? t('loan.late_days', '{n} installments · {d} days late').replace('{n}', n(loan.overdue_count)).replace('{d}', n(loan.days_overdue)) : (loan.next_due_date ? formatDate(loan.next_due_date) : ''),
                  loan.overdue_amount > 0 ? 'text-rose-600 dark:text-rose-400' : '')
                : tile(loan.status === 'Closed' ? t('loan.closed_on', 'Fully repaid on') : t('loan.written_off_on', 'Written off on'),
                  formatDate(loan.closed_date || loan.written_off_date), loan.status === 'Written off' ? t('loan.lost', '{a} lost').replace('{a}', formatCurrency(loan.written_off_amount)) : undefined,
                  loan.status === 'Written off' ? 'text-amber-700 dark:text-amber-400' : '')}
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                <span>{t('loan.progress', 'Principal repaid')}: {n(loan.progress_pct.toFixed(0))}%</span>
                <span>{t('loan.inst_progress', '{a} of {b} installments paid').replace('{a}', n(loan.installments_paid)).replace('{b}', n(loan.installments_total))}</span>
              </div>
              <ProgressBar pct={loan.progress_pct} tone={loan.derived_status === 'Overdue' ? 'rose' : loan.status === 'Written off' ? 'amber' : 'green'} />
            </div>

            {/* terms */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 rounded-xl bg-slate-50 dark:bg-[#121f26] border border-slate-200 dark:border-slate-800 p-4">
              {[
                [t('loan.terms', 'Terms'), `${n(loan.term_months)} ${t('loan.months_short', 'months')} · ${rateText(loan.method, loan.annual_rate)}`],
                [t('loan.monthly', 'Monthly installment'), formatCurrency(loan.installment)],
                [t('loan.total_interest', 'Total interest'), formatCurrency(loan.total_interest)],
                [t('loan.total_payable', 'Total to repay'), formatCurrency(loan.total_payable)],
                [t('loan.purpose_short', 'Purpose'), loan.purpose || '—'],
                [t('loan.ref_short', 'Reference'), loan.reference || '—'],
                [t('loan.savings', 'Savings in fund'), formatCurrency(d.member.savings)],
              ].map(([k, v]) => (
                <div key={k as string} className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k}</div><div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5 break-words">{v}</div></div>
              ))}
              {loan.notes && <div className="col-span-full"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('common.notes', 'Notes')}</div><div className="font-medium text-slate-700 dark:text-slate-200 mt-0.5">{loan.notes}</div></div>}
              {loan.status === 'Written off' && <div className="col-span-full text-amber-800 dark:text-amber-300 font-semibold flex gap-1.5"><Ban size={13} className="mt-0.5 shrink-0" />{t('loan.wo_reason', 'Write-off reason')}: {loan.written_off_reason}</div>}
            </div>

            {/* guarantor */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-[12px] font-black text-slate-900 dark:text-white">
                  <ShieldCheck size={15} className="text-emerald-700 dark:text-emerald-400" />{t('loan.guarantor', 'Guarantor')}
                  {d.guarantor && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                    {d.guarantor.type === 'member' ? t('loan.g_type_member', 'Fund member') : d.guarantor.type === 'outsider' ? t('loan.g_type_out', 'Outside person') : t('loan.g_type_legacy', 'Name only (older loan)')}</span>}
                </div>
                {d.guarantor ? (
                  <div className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
                    <span className="font-bold">{bnName(d.guarantor.name, d.guarantor.name_bn)}</span>{d.guarantor.code ? <span className="text-slate-500 dark:text-slate-400"> · {d.guarantor.code}</span> : null}
                    {d.guarantor.nid ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_nid', 'National ID (NID)')}: <span className="tabular-nums font-semibold">{d.guarantor.nid}</span></div> : null}
                    {d.guarantor.address ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_address', 'Full address')}: {d.guarantor.address}</div> : null}
                    {d.guarantor.phone ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_phone_short', 'Phone')}: <span className="tabular-nums">{d.guarantor.phone}</span></div> : null}
                    {d.guarantor.relation ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_relation_short', 'Relationship')}: {d.guarantor.relation}</div> : null}
                  </div>
                ) : <div className="text-[12px] text-amber-700 dark:text-amber-400 font-semibold">{t('loan.g_none', 'No guarantor was recorded for this loan.')}</div>}
              </div>
              {d.guarantor && (
                <button type="button" onClick={() => { const ci = consentFromDetail(d); if (ci) void makePaper(ci); }} className="btn btn-outline btn-sm shrink-0">
                  <FileDown size={13} /><span>{t('loan.paper_btn', 'Generate consent paper (PDF)')}</span>
                </button>
              )}
            </div>

            {/* signed consent paper */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2.5">
                <FileCheck2 size={17} className={`shrink-0 mt-0.5 ${loan.consent_status === 'Signed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`} />
                <div className="text-[12px]">
                  <div className="font-black text-slate-900 dark:text-white">{t('loan.signed_paper', 'Signed consent paper')}</div>
                  <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                    {loan.consent_status === 'Signed'
                      ? t('loan.paper_on_file_date', '{name} · uploaded {date}').replace('{name}', loan.consent_name || '').replace('{date}', formatDate(String(loan.consent_uploaded_at || '').slice(0, 10)))
                      : loan.consent_status === 'Waived' ? t('loan.paper_waived', 'Not required: this loan was disbursed while signed papers were switched off.') : t('loan.paper_none', 'No signed paper on file (loan made before this feature).')}
                    {loan.application_no ? <span className="text-slate-400"> · {t('loan.from_draft', 'from draft {no}').replace('{no}', loan.application_no)}</span> : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {loan.consent_status === 'Signed' && <button type="button" onClick={openPaper} className="btn btn-outline btn-sm"><ExternalLink size={13} />{t('loan.open_paper', 'Open')}</button>}
                {!readOnly && <button type="button" onClick={uploadPaper} disabled={busy} className="btn btn-green-outline btn-sm"><Upload size={13} />{loan.consent_status === 'Signed' ? t('loan.replace_paper', 'Replace') : t('loan.upload_paper', 'Upload signed paper')}</button>}
              </div>
            </div>

            <SegmentedTabs<Tab>
              size="sm" value={tab} onChange={setTab} ariaLabel={t('loan.detail_tabs', 'Loan details')}
              items={[
                { key: 'schedule', label: t('loan.schedule', 'Repayment schedule'), count: n(d.schedule.length) },
                { key: 'history', label: t('loan.history', 'Payments received'), count: n(d.repayments.length) },
                { key: 'member', label: t('loan.borrower_loans', 'Borrower\'s other loans'), count: n(d.memberLoans.length) },
              ]}
            />

            {tab === 'schedule' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left tabular-nums">
                  <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800">
                    <tr><th className={`${th} text-center w-10`}>#</th><th className={th}>{t('loan.due_on', 'Due date')}</th><th className={`${th} text-right`}>{t('loan.principal', 'Principal')}</th><th className={`${th} text-right`}>{t('loan.interest', 'Interest')}</th><th className={`${th} text-right`}>{t('loan.installment', 'Installment')}</th><th className={`${th} text-right`}>{t('loan.paid', 'Paid')}</th><th className={`${th} text-right`}>{t('loan.balance_after', 'Balance after')}</th><th className={th}>{t('common.status', 'Status')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                    {d.schedule.map(r => (
                      <tr key={r.no} className={r.status === 'Overdue' ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                        <td className={`${td} text-center text-slate-400`}>{n(r.no)}</td>
                        <td className={`${td} whitespace-nowrap`}>{formatDate(r.due_date)}</td>
                        <td className={`${td} text-right`}>{formatCurrency(r.principal)}</td>
                        <td className={`${td} text-right text-slate-600 dark:text-slate-300`}>{formatCurrency(r.interest)}</td>
                        <td className={`${td} text-right font-bold`}>{formatCurrency(r.total)}</td>
                        <td className={`${td} text-right ${r.paid > 0 ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-slate-400'}`}>{r.paid > 0 ? formatCurrency(r.paid) : '—'}</td>
                        <td className={`${td} text-right text-slate-600 dark:text-slate-300`}>{formatCurrency(r.balance_after)}</td>
                        <td className={td}><InstallmentBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'history' && (
              d.repayments.length === 0 ? (
                <div className="py-10 text-center text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">{t('loan.no_payments', 'No payments received yet.')}</div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left tabular-nums">
                    <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800">
                      <tr><th className={th}>{t('common.date', 'Date')}</th><th className={`${th} text-right`}>{t('loan.principal', 'Principal')}</th><th className={`${th} text-right`}>{t('loan.interest', 'Interest')}</th><th className={`${th} text-right`}>{t('loan.penalty_short', 'Penalty')}</th><th className={`${th} text-right`}>{t('loan.total_received', 'Total received')}</th><th className={th}>{t('loan.received_via', 'Received through')}</th><th className={th}>{t('common.notes', 'Notes')}</th><th className={`${th} text-right`} /></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                      {d.repayments.map(r => (
                        <tr key={r.id}>
                          <td className={`${td} whitespace-nowrap`}>{formatDate(r.paid_date)}{r.kind === 'Closure' && <span className="ml-1.5 text-[10px] font-bold text-sky-700 dark:text-sky-400">{t('loan.early_close_tag', 'early close')}</span>}</td>
                          <td className={`${td} text-right`}>{formatCurrency(r.principal_paid)}</td>
                          <td className={`${td} text-right`}>{formatCurrency(r.interest_paid)}</td>
                          <td className={`${td} text-right ${r.penalty_paid > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>{r.penalty_paid > 0 ? formatCurrency(r.penalty_paid) : '—'}</td>
                          <td className={`${td} text-right font-black text-emerald-700 dark:text-emerald-400`}>{formatCurrency(r.total_paid)}</td>
                          <td className={td}>{tv(r.payment_method || '')}{r.trx_id ? <span className="block text-[10px] text-slate-400">{r.trx_id}</span> : null}</td>
                          <td className={`${td} text-slate-500 dark:text-slate-400 max-w-[200px] truncate`} title={r.note || ''}>{r.note || '—'}</td>
                          <td className={`${td} text-right`}>
                            {!readOnly && r.id === d.latestRepaymentId && loan.status !== 'Written off' && (
                              <button type="button" onClick={() => setConfirm({ repayId: r.id })} className="btn btn-danger-outline btn-sm btn-icon" title={t('loan.remove_payment', 'Remove this payment')} aria-label={t('loan.remove_payment', 'Remove this payment')}><Trash2 size={13} /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === 'member' && (
              d.memberLoans.length === 0 ? (
                <div className="py-10 text-center text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">{t('loan.no_other_loans', 'This member has no other loans.')}</div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left tabular-nums">
                    <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800">
                      <tr><th className={th}>{t('loan.loan_no', 'Loan')}</th><th className={th}>{t('loan.date', 'Loan date')}</th><th className={`${th} text-right`}>{t('loan.amount', 'Loan amount')}</th><th className={`${th} text-right`}>{t('loan.outstanding', 'Principal owed')}</th><th className={th}>{t('common.status', 'Status')}</th><th className={th} /></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                      {d.memberLoans.map(l => (
                        <tr key={l.id}>
                          <td className={`${td} font-bold`}>{l.loan_no}</td>
                          <td className={td}>{formatDate(l.disbursed_date)}</td>
                          <td className={`${td} text-right`}>{formatCurrency(l.principal)}</td>
                          <td className={`${td} text-right`}>{formatCurrency(l.outstanding_principal)}</td>
                          <td className={td}><LoanStatusBadge status={l.derived_status} /></td>
                          <td className={`${td} text-right`}><button type="button" onClick={() => onOpenLoan(l.id)} className="btn btn-outline btn-sm"><FileText size={12} />{t('common.view', 'View')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        )}
      </Modal>

      <LoanRepaymentModal loan={pay ? loan || null : null} kind={pay || 'Installment'} onClose={() => setPay(null)} onDone={() => { setPay(null); changed(); load(); }} />

      {/* confirmations */}
      <Modal
        open={confirm === 'delete' || (typeof confirm === 'object' && confirm !== null)}
        onClose={() => !busy && setConfirm(null)} locked={busy} size="sm" tone="danger" icon={<Trash2 size={18} />}
        title={typeof confirm === 'object' && confirm ? t('loan.remove_payment_title', 'Remove this payment?') : t('loan.delete_title', 'Delete this loan?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy} className="btn btn-danger" onClick={() => {
              if (typeof confirm === 'object' && confirm) run(() => deleteLoanRepayment(confirm.repayId), t('loan.payment_removed', 'Payment removed.'));
              else if (loan) run(() => deleteLoan(loan.id), t('loan.deleted', 'Loan deleted.'), onClose);
            }}>{busy ? t('finance.deleting', 'Deleting…') : t('common.delete', 'Delete')}</button>
          </div>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {typeof confirm === 'object' && confirm
            ? t('loan.remove_payment_body', 'The latest payment will be removed and the loan goes back to how it was before it. Use this only to correct a mistake.')
            : t('loan.delete_body', 'This loan has no payments. Deleting it removes the loan and its schedule, and the money goes back to the fund\'s cash. This cannot be undone.')}
        </p>
      </Modal>

      <Modal
        open={confirm === 'writeoff'} onClose={() => !busy && setConfirm(null)} locked={busy} size="sm" tone="danger" icon={<Ban size={18} />}
        title={t('loan.writeoff_title', 'Write off this loan?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy || !woReason.trim() || !loan} className="btn btn-danger"
              onClick={() => loan && run(() => writeOffLoan({ loan_id: loan.id, date: woDate, reason: woReason.trim() }), t('loan.written_off_done', 'Loan written off.'))}>
              {t('loan.write_off', 'Write off')}
            </button>
          </div>
        }
      >
        {loan && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('loan.writeoff_body', 'The borrower cannot pay. The unpaid principal ({amt}) becomes a loss. The borrower\'s own savings in the fund absorb it first; only what their savings cannot cover is shared by the other members. Interest not yet received is simply never counted.').replace('{amt}', formatCurrency(loan.outstanding_principal))}
            </p>
            <DatePicker label={t('common.date', 'Date')} required max={todayISO()} min={loan.last_payment_date || loan.disbursed_date} value={woDate} onChange={setWoDate} />
            <div>
              <label className="form-label">{t('loan.wo_reason', 'Write-off reason')} <span className="text-rose-500">*</span></label>
              <input type="text" value={woReason} onChange={e => setWoReason(e.target.value)} className="form-input" autoFocus />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirm === 'cancelwo'} onClose={() => !busy && setConfirm(null)} locked={busy} size="sm" tone="warning" icon={<Lock size={18} />}
        title={t('loan.cancel_wo_title', 'Cancel the write-off?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" disabled={busy || !loan} className="btn btn-primary" onClick={() => loan && run(() => cancelLoanWriteOff(loan.id), t('loan.writeoff_cancelled', 'Write-off cancelled. The loan is running again.'))}>{t('common.confirm', 'Confirm')}</button>
          </div>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('loan.cancel_wo_body', 'The loan becomes a running loan again and the loss is taken back out of the books.')}</p>
      </Modal>
    </>
  );
};
