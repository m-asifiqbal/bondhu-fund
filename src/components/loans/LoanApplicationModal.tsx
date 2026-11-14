import React, { useCallback, useEffect, useState } from 'react';
import { FileSignature, FileDown, Upload, FileCheck2, Pencil, Trash2, Banknote, CheckCircle2, Circle, ShieldCheck, ChevronDown, ChevronUp, AlertTriangle, Info, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { DatePicker } from '../common/DatePicker';
import { getLoanApplication, deleteLoanApplication, activateLoanApplication, uploadLoanConsent, openLoanConsent } from '../../services/db';
import type { LoanApplicationDetail } from '../../types';
import { todayISO } from '../../utils/date';
import { useMoney, useNum, useRateText, useConsentPaper, consentFromApplication } from './loanUi';

interface Props {
  applicationId: number | null;
  onClose: () => void;
  /** open the edit form for this draft */
  onEdit: (d: LoanApplicationDetail) => void;
  /** the draft was disbursed: the loan now exists */
  onDisbursed: (loanId: number) => void;
  onChanged: () => void;
}

/**
 * A loan draft: terms are fixed and printed on the consent paper, but NO money has moved. The user generates the paper, gets it signed by the borrower and
 * the guarantor, uploads the scan here, and only then is the loan disbursed in the borrower's name.
 */
export const LoanApplicationModal: React.FC<Props> = ({ applicationId, onClose, onEdit, onDisbursed, onChanged }) => {
  const { t, tv, formatDate, showToast, triggerRefresh, refreshKey, session, bnName } = useApp();
  const n = useNum();
  const formatCurrency = useMoney();
  const rateText = useRateText();
  const makePaper = useConsentPaper();
  const readOnly = session?.user.role === 'Auditor';
  const [d, setD] = useState<LoanApplicationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'disburse'>(null);
  const [date, setDate] = useState(todayISO());
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    if (!applicationId) return Promise.resolve();
    return getLoanApplication(applicationId).then(setD).catch((e: any) => showToast(e.message, 'error'));
  }, [applicationId, showToast]);
  useEffect(() => { if (applicationId) { setD(null); setShowAll(false); } }, [applicationId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const a = d?.application;
  const needPaper = !!d?.consentRequired;
  const paperOk = !!a?.has_consent && !!a?.consent_file_exists;
  const canDisburse = !!a && (!needPaper || paperOk);
  const changed = () => { triggerRefresh(); onChanged(); };

  const generate = () => { if (d) { const ci = consentFromApplication(d); if (ci) void makePaper(ci); } };

  const upload = async () => {
    if (!a) return;
    setBusy(true);
    try {
      const r = await uploadLoanConsent('application', a.id);
      if (!r.canceled) {
        showToast(t('loan.paper_uploaded', 'Signed paper uploaded: {name}').replace('{name}', r.name || ''));
        changed(); await load();
        setDate(todayISO()); setConfirm('disburse');          // the next step is to disburse: ask straight away
      }
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const openPaper = async () => { if (a) { try { await openLoanConsent('application', a.id); } catch (e: any) { showToast(e.message, 'error'); } } };

  const disburse = async () => {
    if (!a) return;
    setBusy(true);
    try {
      const loanId = await activateLoanApplication({ id: a.id, disbursed_date: date });
      showToast(t('loan.disbursed', 'Loan disbursed. The money has left the fund and the repayment schedule is active.'));
      setConfirm(null); changed(); onDisbursed(loanId);
    } catch (e: any) { showToast(e.message, 'error'); setConfirm(null); await load(); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!a) return;
    setBusy(true);
    try { await deleteLoanApplication(a.id); showToast(t('loan.draft_deleted', 'Draft deleted.')); setConfirm(null); changed(); onClose(); }
    catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const tile = (label: string, value: string, sub?: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className="text-base font-black tabular-nums mt-1 truncate text-slate-900 dark:text-white" title={value}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );

  const step = (done: boolean, title: string, body: React.ReactNode, action?: React.ReactNode) => (
    <div className="flex items-start gap-3 py-3">
      {done ? <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" /> : <Circle size={20} className="text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-black text-slate-900 dark:text-white">{title}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{body}</div>
      </div>
      {action && <div className="shrink-0 flex flex-wrap gap-2 justify-end">{action}</div>}
    </div>
  );

  const g = d?.guarantor;
  const rows = d?.plan.rows || [];
  const shown = showAll ? rows : rows.slice(0, 6);
  const th = 'py-2 px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';

  return (
    <>
      <Modal
        open={!!applicationId}
        onClose={() => !busy && onClose()}
        locked={busy}
        size="xl"
        icon={<FileSignature size={18} />}
        title={a ? <span className="flex items-center gap-2.5 flex-wrap">{a.app_no}<span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800">{t('loan.s_draft', 'Draft')}</span></span> : t('common.loading', 'Loading…')}
        subtitle={a ? `${bnName(a.member_name, a.member_name_bn)} · ${a.member_code}` : undefined}
        footer={a && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {!readOnly && <button type="button" onClick={() => setConfirm('delete')} disabled={busy} className="btn btn-danger-outline btn-sm"><Trash2 size={13} />{t('loan.delete_draft', 'Delete draft')}</button>}
              {!readOnly && <button type="button" onClick={() => d && onEdit(d)} disabled={busy} className="btn btn-outline btn-sm"><Pencil size={13} />{t('loan.edit_draft', 'Edit draft')}</button>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="btn btn-cancel">{t('common.close', 'Close')}</button>
              {!readOnly && (canDisburse
                ? <button type="button" onClick={() => { setDate(todayISO()); setConfirm('disburse'); }} disabled={busy} className="btn btn-primary"><Banknote size={15} />{t('loan.disburse', 'Disburse loan')}</button>
                : <button type="button" onClick={upload} disabled={busy} className="btn btn-primary"><Upload size={15} />{t('loan.upload_paper', 'Upload signed paper')}</button>)}
            </div>
          </div>
        )}
      >
        {!d || !a ? (
          <div className="py-16 text-center text-xs text-slate-400">{t('common.loading', 'Loading…')}</div>
        ) : (
          <div className="space-y-5 text-xs">
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 flex gap-2.5 text-amber-900 dark:text-amber-200 text-[11px] leading-relaxed">
              <Info size={15} className="shrink-0 mt-0.5" />
              <span>{needPaper
                ? t('loan.draft_banner', 'This loan is a DRAFT. No money has left the fund and the member has no loan yet. It is disbursed only after the signed consent paper is uploaded.')
                : t('loan.draft_banner_off', 'This loan is a draft from before signed papers were switched off. You can disburse it now.')}</span>
            </div>

            {d.warnings.map((w, i) => (
              <div key={i} className={`flex gap-2 rounded-xl border p-3 text-[11px] font-semibold ${w.level === 'error' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300'}`}>
                <AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{w.text}</span>
              </div>
            ))}

            {/* the steps */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] px-4 divide-y divide-slate-100 dark:divide-slate-800/80">
              {step(true, t('loan.step1', '1. Loan prepared'), t('loan.step1_body', 'Terms and guarantor are recorded and fixed. They are exactly what the consent paper shows.'))}
              {step(false, t('loan.step2', '2. Consent paper'), t('loan.step2_body', 'Print it. The borrower and the guarantor sign (and a witness), and the fund countersigns.'),
                <button type="button" onClick={generate} className="btn btn-outline btn-sm"><FileDown size={13} />{t('loan.paper_btn', 'Generate consent paper (PDF)')}</button>)}
              {needPaper ? step(paperOk, t('loan.step3', '3. Signed paper uploaded'),
                paperOk
                  ? <>{t('loan.step3_done', '{name} · uploaded {date}').replace('{name}', a.consent_name || '').replace('{date}', formatDate(String(a.consent_uploaded_at || '').slice(0, 10)))}</>
                  : a.has_consent ? t('loan.step3_missing', 'The uploaded file cannot be found on this computer. Upload it again.') : t('loan.step3_body', 'Scan or photograph the signed paper (PDF, JPG or PNG) and upload it here.'),
                !readOnly && <>
                  {a.has_consent && <button type="button" onClick={openPaper} className="btn btn-outline btn-sm"><ExternalLink size={13} />{t('loan.open_paper', 'Open')}</button>}
                  <button type="button" onClick={upload} disabled={busy} className="btn btn-green-outline btn-sm"><Upload size={13} />{a.has_consent ? t('loan.replace_paper', 'Replace') : t('loan.upload_paper', 'Upload signed paper')}</button>
                </>) : step(true, t('loan.step3_off', '3. Signed paper'), t('loan.step3_off_body', 'Not required (switched off in the Loan policy).'))}
              {step(false, t('loan.step4', '4. Disbursed'), canDisburse ? t('loan.step4_ready', 'Ready. Press "Disburse loan" to give the money to the member and start the schedule.') : t('loan.step4_wait', 'Happens after the signed paper is uploaded.'))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tile(t('loan.amount', 'Loan amount'), formatCurrency(a.principal), `${n(a.term_months)} ${t('loan.months_short', 'months')} · ${rateText(a.method, a.annual_rate)}`)}
              {tile(t('loan.monthly', 'Monthly installment'), formatCurrency(a.installment), `${t('loan.first_due', 'First installment date')}: ${formatDate(a.first_due_date)}`)}
              {tile(t('loan.total_interest', 'Total interest'), formatCurrency(a.total_interest))}
              {tile(t('loan.total_payable', 'Total to repay'), formatCurrency(a.total_payable), `${t('loan.paid_via', 'Paid out through')}: ${tv(a.payment_method || '') || '—'}`)}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] p-4">
              <div className="flex items-center gap-2 text-[12px] font-black text-slate-900 dark:text-white mb-1.5">
                <ShieldCheck size={15} className="text-emerald-700 dark:text-emerald-400" />{t('loan.guarantor', 'Guarantor')}
                {g && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{g.type === 'member' ? t('loan.g_type_member', 'Fund member') : t('loan.g_type_out', 'Outside person')}</span>}
              </div>
              {g ? (
                <div className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
                  <span className="font-bold">{bnName(g.name, g.name_bn)}</span>{g.code ? <span className="text-slate-500 dark:text-slate-400"> · {g.code}</span> : null}
                  {g.nid ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_nid', 'National ID (NID)')}: <span className="tabular-nums font-semibold">{g.nid}</span></div> : null}
                  {g.address ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_address', 'Full address')}: {g.address}</div> : null}
                  {g.phone ? <div className="text-slate-600 dark:text-slate-300">{t('loan.g_phone_short', 'Phone')}: <span className="tabular-nums">{g.phone}</span></div> : null}
                </div>
              ) : <div className="text-amber-700 dark:text-amber-400 font-semibold">{t('loan.g_none', 'No guarantor was recorded for this loan.')}</div>}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111e24] text-[11px] font-black text-slate-800 dark:text-slate-100">{t('loan.schedule', 'Repayment schedule')}</div>
              <table className="w-full text-left tabular-nums">
                <thead><tr><th className={`${th} text-center w-10`}>#</th><th className={th}>{t('loan.due_on', 'Due date')}</th><th className={`${th} text-right`}>{t('loan.principal', 'Principal')}</th><th className={`${th} text-right`}>{t('loan.interest', 'Interest')}</th><th className={`${th} text-right`}>{t('loan.installment', 'Installment')}</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                  {shown.map(r => (
                    <tr key={r.no}><td className="py-1.5 px-2.5 text-center text-slate-400">{n(r.no)}</td><td className="py-1.5 px-2.5 whitespace-nowrap">{formatDate(r.due_date)}</td>
                      <td className="py-1.5 px-2.5 text-right">{formatCurrency(r.principal)}</td><td className="py-1.5 px-2.5 text-right text-slate-600 dark:text-slate-300">{formatCurrency(r.interest)}</td><td className="py-1.5 px-2.5 text-right font-bold">{formatCurrency(r.total)}</td></tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 6 && (
                <button type="button" onClick={() => setShowAll(s => !s)} className="w-full py-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#1a2b34] border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-1">
                  {showAll ? <><ChevronUp size={13} />{t('loan.show_less', 'Show fewer')}</> : <><ChevronDown size={13} />{t('loan.show_all', 'Show all {n} installments').replace('{n}', n(rows.length))}</>}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* disburse */}
      <Modal
        open={confirm === 'disburse'} onClose={() => !busy && setConfirm(null)} locked={busy} size="sm" icon={<Banknote size={18} />}
        title={t('loan.disburse_title', 'Disburse this loan?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" onClick={disburse} disabled={busy || !a} className="btn btn-primary">{busy ? t('common.saving', 'Saving…') : a ? t('loan.disburse_btn', 'Disburse {amt}').replace('{amt}', formatCurrency(a.principal)) : ''}</button>
          </div>
        }
      >
        {a && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('loan.disburse_body', '{amt} will leave the fund\'s cash and be given to {name}. The repayment schedule stays exactly as printed on the signed paper (first installment {date}).')
                .replace('{amt}', formatCurrency(a.principal)).replace('{name}', a.member_name).replace('{date}', formatDate(a.first_due_date))}
            </p>
            <DatePicker label={t('loan.disburse_date', 'Disbursement date')} required max={todayISO()} value={date} onChange={setDate} />
            {needPaper && <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-400"><FileCheck2 size={13} />{t('loan.paper_on_file', 'Signed paper on file: {name}').replace('{name}', a.consent_name || '')}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={confirm === 'delete'} onClose={() => !busy && setConfirm(null)} locked={busy} size="sm" tone="danger" icon={<Trash2 size={18} />}
        title={t('loan.draft_delete_title', 'Delete this draft?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="button" onClick={remove} disabled={busy} className="btn btn-danger">{t('common.delete', 'Delete')}</button>
          </div>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('loan.draft_delete_body', 'The draft and its uploaded signed paper are removed. No money was disbursed, so the books do not change. This cannot be undone.')}</p>
      </Modal>
    </>
  );
};
