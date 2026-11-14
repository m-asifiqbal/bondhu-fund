import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, AlertTriangle, Info, Check, ChevronDown, ChevronUp, CalendarClock, Sparkles, ShieldCheck, FileDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';
import { DatePicker } from '../common/DatePicker';
import { SearchableSelect, SelectOption } from '../common/SearchableSelect';
import { SegmentedTabs } from '../common/SegmentedTabs';
import { getAllMembersLite, previewLoan, previewGuarantor, addLoan, getLoan, getLoanApplication, createLoanApplication, updateLoanApplication } from '../../services/db';
import type { LoanMethod, LoanPreview, GuarantorCheck, LoanApplicationDetail } from '../../types';
import { todayISO } from '../../utils/date';
import { useMethodText, useMoney, useNum, useConsentPaper, consentFromDetail, consentFromApplication } from './loanUi';

const TERM_CHIPS = [6, 12, 18, 24, 36, 48];

interface Props {
  open: boolean;
  onClose: () => void;
  /** called after saving: a draft (consent paper required) or a disbursed loan */
  onSaved: (id: number, kind: 'loan' | 'draft') => void;
  presetMemberId?: number | null;
  /** edit this draft instead of creating a new loan */
  application?: LoanApplicationDetail | null;
}

type LiteMember = { id: number; member_code: string; name: string; name_bn?: string | null; status: string; monthly_due: number };

/**
 * New personal loan. The right-hand side is a live calculator: as the amount, period, method or rate change, the
 * monthly installment, total interest, real yearly cost and the whole schedule are recalculated by the same engine
 * that books the loan, so what the member is shown is exactly what will be recorded.
 */
export const LoanFormModal: React.FC<Props> = ({ open, onClose, onSaved, presetMemberId, application }) => {
  const { t, tv, formatDate, showToast, triggerRefresh, masterData, settings, bnName } = useApp();
  const n = useNum();
  const formatCurrency = useMoney();
  const mt = useMethodText();

  const [members, setMembers] = useState<LiteMember[]>([]);
  const [memberId, setMemberId] = useState<number | ''>('');
  const [principal, setPrincipal] = useState('');
  const [term, setTerm] = useState('12');
  const [method, setMethod] = useState<LoanMethod>('reducing');
  const [rate, setRate] = useState('12');
  const [loanDate, setLoanDate] = useState(todayISO());
  const [firstDue, setFirstDue] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [purpose, setPurpose] = useState('');
  // guarantor (mandatory): a fund member, or an outsider with name, address and NID
  const [gMember, setGMember] = useState(true);
  const [gMemberId, setGMemberId] = useState<number | ''>('');
  const [gName, setGName] = useState('');
  const [gAddress, setGAddress] = useState('');
  const [gNid, setGNid] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [gRelation, setGRelation] = useState('');
  const [gCheck, setGCheck] = useState<GuarantorCheck | null>(null);
  const [gShowErr, setGShowErr] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [limitNote, setLimitNote] = useState('');
  const [pv, setPv] = useState<LoanPreview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const gseq = useRef(0);
  const makePaper = useConsentPaper();
  const editing = !!application;
  // signed consent paper required (Loan policy): the loan is saved as a draft and disbursed only after the signed paper is uploaded
  const consent = editing || settings?.loan_consent_required !== false;

  // fresh form every time the dialog opens, starting from the fund's loan policy
  useEffect(() => {
    if (!open) return;
    const a = application?.application;
    if (a) {
      setMemberId(a.member_id); setPrincipal(String(a.principal)); setTerm(String(a.term_months));
      setMethod(a.method); setRate(String(a.annual_rate));
      setLoanDate(a.disbursed_date); setFirstDue(a.first_due_date); setPayMethod(a.payment_method || ''); setPurpose(a.purpose || ''); setReference(a.reference || '');
      setGMember(a.guarantor_type !== 'outsider'); setGMemberId(a.guarantor_member_id || ''); setGName(a.guarantor_name || ''); setGAddress(a.guarantor_address || '');
      setGNid(a.guarantor_nid || ''); setGPhone(a.guarantor_phone || ''); setGRelation(a.guarantor_relation || ''); setGCheck(null); setGShowErr(false);
      setNotes(a.notes || ''); setLimitNote(a.limit_note || '');
    } else {
    setMemberId(presetMemberId || ''); setPrincipal(''); setTerm('12');
    setMethod((settings?.loan_default_method as LoanMethod) || 'reducing');
    setRate(String(settings?.loan_default_rate ?? 12));
    setLoanDate(todayISO()); setFirstDue(''); setPayMethod(''); setPurpose(''); setReference('');
    setGMember(true); setGMemberId(''); setGName(''); setGAddress(''); setGNid(''); setGPhone(''); setGRelation(''); setGCheck(null); setGShowErr(false);
    setNotes(''); setLimitNote('');
    }
    setPv(null); setShowAll(false);
    getAllMembersLite().then(l => setMembers(l as LiteMember[])).catch((e: any) => showToast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, application?.application.id]);

  const principalN = Number(principal);
  const termN = Number(term);
  const rateN = Number(rate);

  // live calculation (debounced; stale answers are ignored)
  useEffect(() => {
    if (!open) return;
    if (!(principalN > 0)) { setPv(null); return; }
    const my = ++seq.current;
    setCalculating(true);
    const id = setTimeout(() => {
      previewLoan({
        member_id: memberId === '' ? undefined : Number(memberId), principal: principalN, method, annual_rate: rate === '' ? undefined : rateN, term_months: termN,
        disbursed_date: loanDate, first_due_date: firstDue || undefined, draft: consent,
      } as any)
        .then(r => { if (my === seq.current) setPv(r); })
        .catch((e: any) => { if (my === seq.current) setPv({ valid: false, error: e.message }); })
        .finally(() => { if (my === seq.current) setCalculating(false); });
    }, 180);
    return () => clearTimeout(id);
  }, [open, memberId, principalN, termN, method, rate, rateN, loanDate, firstDue, consent]);

  // the guarantor is checked by the same rules that will save it
  useEffect(() => {
    if (!open) return;
    const my = ++gseq.current;
    const id = setTimeout(() => {
      previewGuarantor({
        member_id: memberId === '' ? undefined : Number(memberId), guarantor_type: gMember ? 'member' : 'outsider',
        guarantor_member_id: gMember && gMemberId !== '' ? Number(gMemberId) : undefined,
        guarantor_name: gName, guarantor_address: gAddress, guarantor_nid: gNid, guarantor_phone: gPhone, guarantor_relation: gRelation,
      }).then(r => { if (my === gseq.current) setGCheck(r); }).catch(() => undefined);
    }, 220);
    return () => clearTimeout(id);
  }, [open, memberId, gMember, gMemberId, gName, gAddress, gNid, gPhone, gRelation]);

  const guarantorOptions = useMemo<SelectOption[]>(
    () => members.filter(m => m.status === 'Active' && m.id !== memberId).map(m => ({ value: m.id, label: bnName(m.name, m.name_bn), subLabel: m.member_code })),
    [members, memberId, bnName],
  );

  const memberOptions = useMemo<SelectOption[]>(
    () => members.filter(m => m.status === 'Active').map(m => ({ value: m.id, label: bnName(m.name, m.name_bn), subLabel: m.member_code })),
    [members, bnName],
  );
  const payOptions = useMemo<SelectOption[]>(
    () => masterData.filter(m => m.type === 'payment_method' && Number(m.is_active) === 1).map(m => ({ value: m.name, label: tv(m.name) })),
    [masterData, tv],
  );

  const plan = pv?.valid ? pv.plan : undefined;
  const mem = pv?.valid ? pv.member : null;
  const errors = (pv?.warnings || []).filter(w => w.level === 'error');
  const needsLimitNote = !!(mem && mem.limit !== null && principalN + mem.owed > mem.limit + 0.005);
  const rows = plan?.rows || [];
  const shown = showAll ? rows : rows.slice(0, 6);
  const gOk = !!gCheck?.ok;
  const canSave = !saving && memberId !== '' && !!plan && errors.length === 0 && !!payMethod && gOk && (!needsLimitNote || limitNote.trim().length > 0);
  const payName = payMethod ? tv(payMethod) : '';
  const makePaperNow = () => {
    if (!plan || !pv?.terms || !gCheck?.info || !mem) return;
    void makePaper({
      ref_no: application?.application.app_no || (consent ? pv.nextAppNo : pv.nextLoanNo) || 'NEW', ref_is_draft: consent, loan_date: loanDate, principal: principalN, term_months: rows.length, method,
      annual_rate: method === 'free' ? 0 : rateN, installment: plan.installment, total_interest: plan.totalInterest, total_payable: plan.totalPayable, first_due_date: rows[0]?.due_date || '',
      purpose: purpose.trim(), paid_via: payName, schedule: rows, borrower: { name: mem.name, name_bn: mem.name_bn, code: mem.member_code, nid: mem.nid || '', phone: mem.phone || '' }, guarantor: gCheck.info,
    });
  };
  const flatPremium = plan && method === 'flat' && plan.effectiveRate - rateN >= 0.5;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSave) {
      if (memberId === '') showToast(t('loan.err_member', 'Choose the member who is taking the loan.'), 'error');
      else if (!(principalN > 0)) showToast(t('loan.err_amount', 'Enter the loan amount.'), 'error');
      else if (!payMethod) showToast(t('loan.err_paid_via', 'Choose how the money is paid out (cash, bank, bKash…).'), 'error');
      else if (!gOk) { setGShowErr(true); showToast(gCheck?.error || t('loan.err_guarantor', 'A guarantor is required: choose a member or enter the outside guarantor\'s details.'), 'error'); }
      else if (needsLimitNote && !limitNote.trim()) showToast(t('loan.err_limit_note', 'Write the approval reason: this loan is above the fund limit.'), 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        member_id: Number(memberId), principal: principalN, method, annual_rate: method === 'free' ? 0 : rateN, term_months: termN,
        disbursed_date: loanDate, first_due_date: firstDue || undefined, payment_method: payMethod,
        reference: reference.trim(), purpose: purpose.trim(), notes: notes.trim(), limit_note: limitNote.trim(),
        guarantor_type: (gMember ? 'member' : 'outsider') as 'member' | 'outsider', guarantor_member_id: gMember && gMemberId !== '' ? Number(gMemberId) : undefined,
        guarantor_name: gName, guarantor_address: gAddress, guarantor_nid: gNid, guarantor_phone: gPhone, guarantor_relation: gRelation,
      };
      if (application) {
        const r = await updateLoanApplication(application.application.id, payload);
        showToast(r.consentRemoved ? t('loan.draft_updated_resign', 'Draft updated. The loan terms changed, so the uploaded paper was removed: print the new consent paper and get it signed again.') : t('loan.draft_updated', 'Draft updated.'));
        triggerRefresh();
        onSaved(application.application.id, 'draft');
      } else if (consent) {
        const id = await createLoanApplication(payload);
        showToast(t('loan.draft_saved', 'Saved as a draft. No money has moved yet: print the consent paper, get it signed, then upload it to disburse the loan.'));
        triggerRefresh();
        // the consent paper is generated straight away from the saved draft
        try { const det = await getLoanApplication(id); const ci = consentFromApplication(det); if (ci) await makePaper(ci); } catch { /* it can be generated again from the draft */ }
        onSaved(id, 'draft');
      } else {
        const id = await addLoan(payload);
        showToast(t('loan.saved', 'Loan given. The repayment schedule has been created.'));
        triggerRefresh();
        // an outside guarantor must sign: the paper is generated straight away from the saved loan
        if (!gMember) {
          try { const det = await getLoan(id); const ci = consentFromDetail(det); if (ci) await makePaper(ci); } catch { /* it can be downloaded again from the loan */ }
        }
        onSaved(id, 'loan');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally { setSaving(false); }
  };

  const warnBox = (level: string) =>
    level === 'error' ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
      : level === 'warn' ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300'
        : 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 text-sky-900 dark:text-sky-300';

  const stat = (label: string, value: string, sub?: string, tip?: string) => (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] px-2.5 py-2.5 min-w-0" title={tip}>
      <div className="text-[9.5px] font-bold uppercase tracking-wide leading-tight text-slate-500 dark:text-slate-400 min-h-[2.1em]">{label}</div>
      <div className="text-[13px] font-black text-slate-900 dark:text-white tabular-nums mt-1 break-words leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      locked={saving}
      size="xl"
      icon={<Landmark size={18} />}
      title={editing ? t('loan.edit_draft_title', 'Edit loan draft') : t('loan.add_title', 'New personal loan')}
      subtitle={editing ? `${application!.application.app_no} · ${t('loan.edit_draft_sub', 'Changing the amount, period, rate, dates or guarantor means the paper must be signed again.')}` : t('loan.add_sub', 'Give a loan from the fund to a member. The monthly installment is calculated automatically.')}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
            {plan ? t('loan.footer_total', 'Member repays {total} in {n} installments.').replace('{total}', formatCurrency(plan.totalPayable)).replace('{n}', n(rows.length)) : t('loan.footer_hint', 'Fill the amount and period to see the plan.')}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={onClose} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
            <button type="submit" form="loan-form" disabled={!canSave} className="btn btn-primary">
              {saving ? t('common.saving', 'Saving…') : editing ? t('common.save', 'Save') : consent ? t('loan.save_draft', 'Save as draft') : t('loan.give', 'Give loan')}
            </button>
          </div>
        </div>
      }
    >
      <form id="loan-form" onSubmit={submit} className="text-xs grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* ------------------------------------------------ form */}
        <div className="lg:col-span-3 space-y-4 min-w-0">
          <SearchableSelect
            label={t('loan.member', 'Member')} required options={memberOptions} value={memberId === '' ? null : memberId}
            onChange={v => setMemberId(v == null || v === '' ? '' : Number(v))} placeholder={t('loan.member_ph', 'Choose the borrower…')}
          />
          {mem && (
            <div className="grid grid-cols-3 gap-2">
              {stat(t('loan.savings', 'Savings in fund'), formatCurrency(mem.savings))}
              {stat(t('loan.owes', 'Owes on other loans'), formatCurrency(mem.owed))}
              {stat(t('loan.limit', 'Loan limit'), mem.limit === null ? t('loan.no_limit', 'No limit') : formatCurrency(mem.limit),
                mem.limit === null ? undefined : t('loan.limit_sub', '{m}× savings').replace('{m}', n(mem.multiple)))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('loan.amount', 'Loan amount')} <span className="text-rose-500">*</span></label>
              <MoneyInput min="0" step="any" value={principal} onChange={e => setPrincipal(e.target.value)} className="form-input font-bold tabular-nums" placeholder="0" autoFocus />
            </div>
            <DatePicker label={t('loan.date', 'Loan date')} required max={todayISO()} value={loanDate} onChange={setLoanDate} />
          </div>

          <div>
            <label className="form-label">{t('loan.period', 'Repayment period')} <span className="text-rose-500">*</span></label>
            <div className="flex flex-wrap items-center gap-2">
              {TERM_CHIPS.map(m => (
                <button key={m} type="button" onClick={() => setTerm(String(m))} aria-pressed={termN === m}
                  className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors ${termN === m
                    ? 'bg-[#0f4a3c] border-[#0f4a3c] text-white dark:bg-emerald-600 dark:border-emerald-600'
                    : 'bg-white dark:bg-[#142026] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-slate-400'}`}>
                  {n(m)} {t('loan.months_short', 'months')}
                </button>
              ))}
              <div className="flex items-center gap-1.5 ml-1">
                <input type="number" min={1} max={120} step={1} value={term} onChange={e => setTerm(e.target.value)} aria-label={t('loan.custom_months', 'Custom number of months')}
                  data-no-clear className="form-input w-20 text-center font-bold tabular-nums" />
                <span className="text-slate-500 dark:text-slate-400 font-semibold">{t('loan.months', 'months')}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="form-label">{t('loan.method', 'Interest method')}</label>
            <SegmentedTabs<LoanMethod>
              size="sm" value={method} onChange={setMethod}
              items={[{ key: 'reducing', label: mt.label('reducing') }, { key: 'flat', label: mt.label('flat') }, { key: 'free', label: mt.label('free') }]}
              ariaLabel={t('loan.method', 'Interest method')}
            />
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{mt.hint(method)}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {method !== 'free' && (
              <div>
                <label className="form-label">{t('loan.rate', 'Interest rate (% a year)')}</label>
                <div className="relative">
                  <input type="number" min={0} max={100} step="any" value={rate} onChange={e => setRate(e.target.value)} data-no-clear className="form-input font-bold tabular-nums pr-9" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                </div>
              </div>
            )}
            <DatePicker
              label={t('loan.first_due', 'First installment date')} clearable value={firstDue} onChange={setFirstDue} min={loanDate || undefined}
              placeholder={pv?.valid && pv.terms ? `${t('loan.auto', 'Auto')}: ${formatDate(pv.terms.first_due_date)}` : t('loan.auto_ph', 'Auto: one month after the loan')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SearchableSelect label={t('loan.paid_via', 'Paid out through')} required options={payOptions} value={payMethod || null}
              onChange={v => setPayMethod(v == null ? '' : String(v))} placeholder={t('loan.paid_via_ph', 'Cash, bank, bKash…')} />
            <div>
              <label className="form-label">{t('loan.reference', 'Reference / transaction no.')}</label>
              <input type="text" value={reference} onChange={e => setReference(e.target.value)} className="form-input"
                placeholder={pv?.autoReference ? t('loan.auto_ref', 'Auto: {ref}').replace('{ref}', pv.autoReference) : t('loan.auto_ref_ph', 'Auto-generated if left blank')} />
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{t('loan.auto_ref_hint', 'Leave blank and a unique reference is created. Type one to use your own (e.g. a bank transaction ID).')}</p>
            </div>
            <div>
              <label className="form-label">{t('loan.purpose', 'Purpose of the loan')}</label>
              <input type="text" value={purpose} onChange={e => setPurpose(e.target.value)} className="form-input" placeholder={t('loan.purpose_ph', 'e.g. shop stock, medical, education')} />
            </div>
          </div>

          {/* guarantor — mandatory */}
          <div className={`rounded-2xl border p-4 space-y-3 ${gShowErr && !gOk ? 'border-rose-300 dark:border-rose-800' : 'border-slate-200 dark:border-slate-800'} bg-slate-50/60 dark:bg-[#121f26]`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px] font-black text-slate-900 dark:text-white"><ShieldCheck size={16} className="text-emerald-700 dark:text-emerald-400" />{t('loan.guarantor', 'Guarantor')} <span className="text-rose-500">*</span></div>
              <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] font-bold text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={gMember} onChange={e => setGMember(e.target.checked)} className="w-4 h-4 accent-[#0f4a3c]" />
                {t('loan.g_is_member', 'Guarantor is a fund member')}
              </label>
            </div>
            {gMember ? (
              <SearchableSelect
                label={t('loan.g_pick_member', 'Guarantor (search by name or code)')} required options={guarantorOptions} value={gMemberId === '' ? null : gMemberId}
                onChange={v => setGMemberId(v == null || v === '' ? '' : Number(v))} placeholder={t('loan.g_pick_ph', 'Choose a member…')}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">{t('loan.g_name', 'Full name')} <span className="text-rose-500">*</span></label>
                  <input type="text" value={gName} onChange={e => setGName(e.target.value)} className="form-input" placeholder={t('loan.g_name_ph', 'As on the National ID')} maxLength={80} />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">{t('loan.g_address', 'Full address')} <span className="text-rose-500">*</span></label>
                  <input type="text" value={gAddress} onChange={e => setGAddress(e.target.value)} className="form-input" placeholder={t('loan.g_address_ph', 'House / road, area, upazila, district')} maxLength={250} />
                </div>
                <div>
                  <label className="form-label">{t('loan.g_nid', 'National ID (NID)')} <span className="text-rose-500">*</span></label>
                  <input type="text" inputMode="numeric" value={gNid} onChange={e => setGNid(e.target.value)} className="form-input tabular-nums" placeholder={t('loan.g_nid_ph', '10, 13 or 17 digits')} maxLength={25} />
                </div>
                <div>
                  <label className="form-label">{t('loan.g_phone', 'Phone (optional)')}</label>
                  <input type="text" inputMode="tel" value={gPhone} onChange={e => setGPhone(e.target.value)} className="form-input tabular-nums" maxLength={20} />
                </div>
              </div>
            )}
            <div>
              <label className="form-label">{t('loan.g_relation', 'Relationship to the borrower (optional)')}</label>
              <input type="text" value={gRelation} onChange={e => setGRelation(e.target.value)} className="form-input" placeholder={t('loan.g_relation_ph', 'e.g. brother, colleague, neighbour')} maxLength={60} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={`text-[11px] font-semibold flex items-start gap-1.5 min-w-0 ${gOk ? 'text-emerald-800 dark:text-emerald-400' : gShowErr ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {gOk ? <Check size={13} className="shrink-0 mt-0.5" /> : <Info size={13} className="shrink-0 mt-0.5" />}
                <span>{gOk
                  ? (gMember ? t('loan.g_ok_member', 'Guarantor selected.') : t('loan.g_ok_out', 'Details complete. The guarantee form will be created automatically when you save the loan.'))
                  : (gShowErr || gName || gAddress || gNid || gMemberId !== '' ? (gCheck?.error || '') : gMember ? t('loan.g_hint_member', 'Choose the member who guarantees this loan.') : t('loan.g_hint_out', 'An outside guarantor needs a full name, a valid address and a National ID.'))}</span>
              </p>
              <button type="button" onClick={makePaperNow} disabled={!gOk || !plan || !mem || !payMethod} className="btn btn-outline btn-sm shrink-0"
                title={!gOk || !plan || !payMethod ? t('loan.g_form_need', 'Fill in the loan and guarantor details first') : undefined}>
                <FileDown size={13} /><span>{t('loan.paper_btn', 'Generate consent paper (PDF)')}</span>
              </button>
            </div>
          </div>

          {needsLimitNote && (
            <div>
              <label className="form-label text-amber-700 dark:text-amber-400">{t('loan.limit_note', 'Approval reason (loan is above the fund limit)')} <span className="text-rose-500">*</span></label>
              <input type="text" value={limitNote} onChange={e => setLimitNote(e.target.value)} className="form-input border-amber-400" placeholder={t('loan.limit_note_ph', 'e.g. Committee approved on 12 May')} />
            </div>
          )}
          <div className={`rounded-2xl border p-4 flex gap-3 text-[11px] leading-relaxed ${consent ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#121f26] text-slate-600 dark:text-slate-300'}`}>
            <Info size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-black text-[12px] mb-0.5">{consent ? t('loan.consent_on_title', 'Signed consent paper required') : t('loan.consent_off_title', 'No signed paper required')}</div>
              {consent
                ? t('loan.consent_on_body', 'Fill in everything above, then press "Generate consent paper". Print it, get the borrower and the guarantor to sign, and upload the signed copy from the loan\'s page. The loan stays a DRAFT — no money leaves the fund — until the signed paper is uploaded.')
                : t('loan.consent_off_body', 'Signed consent papers are switched off in the Loan policy, so this loan is disbursed as soon as you save it. You can still generate the standard consent paper above.')}
              {editing && application!.application.has_consent && <div className="mt-1.5 font-bold">{t('loan.edit_paper_warn', 'A signed paper is already uploaded. If you change the amount, period, rate, dates or guarantor, it is removed and the new paper must be signed.')}</div>}
            </div>
          </div>
          <div>
            <label className="form-label">{t('common.notes', 'Notes')}</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="form-input" />
          </div>
        </div>

        {/* ------------------------------------------------ live calculator */}
        <div role="region" aria-label={t('loan.calc_empty_title', 'Instant repayment plan')} className="lg:col-span-2 space-y-3 min-w-0 lg:sticky lg:top-0" aria-live="polite">
          {!principalN || principalN <= 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
              <Sparkles size={22} className="mx-auto text-slate-400" />
              <p className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200">{t('loan.calc_empty_title', 'Instant repayment plan')}</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('loan.calc_empty_body', 'Enter the amount and the period. The monthly installment, total interest and the full schedule appear here immediately.')}</p>
            </div>
          ) : pv && !pv.valid ? (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 text-rose-800 dark:text-rose-300 flex gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="font-semibold">{pv.error}</span>
            </div>
          ) : plan ? (
            <>
              <div className={`rounded-2xl p-5 text-white bg-gradient-to-br from-[#0f4a3c] to-[#0a362c] shadow-lg transition-opacity ${calculating ? 'opacity-70' : ''}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-100/80">{t('loan.monthly', 'Monthly installment')}</div>
                <div className="text-3xl font-black tabular-nums mt-1 tracking-tight">{formatCurrency(plan.installment)}</div>
                <div className="text-[11px] text-emerald-100/90 mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <CalendarClock size={12} />
                  {t('loan.x_months_from', '× {n} months, first on {date}').replace('{n}', n(rows.length)).replace('{date}', formatDate(rows[0]?.due_date))}
                </div>
                {Math.abs(plan.lastInstallment - plan.installment) >= 0.5 && (
                  <div className="text-[11px] text-emerald-100/80 mt-1">{t('loan.last_inst', 'Last installment {amt} (settles the rounding)').replace('{amt}', formatCurrency(plan.lastInstallment))}</div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {stat(t('loan.total_interest', 'Total interest'), formatCurrency(plan.totalInterest), method === 'free' ? t('loan.no_interest', 'No interest') : undefined)}
                {stat(t('loan.total_payable', 'Total to repay'), formatCurrency(plan.totalPayable))}
                {stat(t('loan.real_rate', 'Real yearly cost'), method === 'free' ? '0%' : `${n(plan.effectiveRate.toFixed(1))}%`, undefined,
                  t('loan.real_rate_tip', 'The equivalent rate on a reducing balance. For a flat-rate loan this is higher than the quoted rate.'))}
              </div>
              {flatPremium && (
                <div className="flex gap-2 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 p-3 text-sky-900 dark:text-sky-300 text-[11px]">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span>{t('loan.flat_note', 'A flat {r}% costs the same as about {e}% on a reducing balance, because the member keeps paying interest on money already repaid.').replace('{r}', n(+rateN.toFixed(2))).replace('{e}', n(plan.effectiveRate.toFixed(1)))}</span>
                </div>
              )}

              {(pv?.warnings || []).map((w, i) => (
                <div key={i} className={`flex gap-2 rounded-xl border p-3 text-[11px] font-semibold ${warnBox(w.level)}`}>
                  {w.level === 'info' ? <Info size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
                  <span>{w.text}</span>
                </div>
              ))}

              {/* same loan over other periods */}
              {pv?.options && pv.options.length > 1 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#142026]">
                  <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111e24]">
                    <div className="text-[11px] font-black text-slate-800 dark:text-slate-100">{t('loan.compare', 'Compare periods')}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{t('loan.compare_hint', 'Longer = smaller installment, more interest. Click a row to choose it.')}</div>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <tr><th className="text-left py-1.5 px-3 font-bold">{t('loan.period_short', 'Period')}</th><th className="text-right py-1.5 px-2 font-bold">{t('loan.monthly_short', 'Monthly')}</th><th className="text-right py-1.5 px-3 font-bold">{t('loan.total_interest', 'Total interest')}</th></tr>
                    </thead>
                    <tbody>
                      {pv.options.map(o => {
                        const cur = o.term === rows.length;
                        return (
                          <tr key={o.term} onClick={() => setTerm(String(o.term))} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-[#1a2b34] ${cur ? 'bg-emerald-50 dark:bg-emerald-950/40 font-black' : 'font-semibold'}`}>
                            <td className="py-1.5 px-3 whitespace-nowrap">{cur && <Check size={11} className="inline mr-1 text-emerald-700 dark:text-emerald-400" />}{n(o.term)} {t('loan.months_short', 'months')}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(o.installment)}</td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(o.totalInterest)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* schedule */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#142026]">
                <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111e24] text-[11px] font-black text-slate-800 dark:text-slate-100">{t('loan.schedule', 'Repayment schedule')}</div>
                <div className={showAll ? 'max-h-72 overflow-y-auto' : ''}>
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 sticky top-0 bg-white dark:bg-[#142026]">
                      <tr>
                        <th className="py-1.5 px-2 text-center font-bold">#</th>
                        <th className="py-1.5 px-2 text-left font-bold">{t('loan.due_date', 'Due')}</th>
                        <th className="py-1.5 px-2 text-right font-bold">{t('loan.principal', 'Principal')}</th>
                        <th className="py-1.5 px-2 text-right font-bold">{t('loan.interest', 'Interest')}</th>
                        <th className="py-1.5 px-2 text-right font-bold">{t('loan.installment', 'Installment')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(r => (
                        <tr key={r.no} className="border-t border-slate-100 dark:border-slate-800/80">
                          <td className="py-1.5 px-2 text-center text-slate-400">{n(r.no)}</td>
                          <td className="py-1.5 px-2 whitespace-nowrap">{formatDate(r.due_date)}</td>
                          <td className="py-1.5 px-2 text-right">{formatCurrency(r.principal)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-300">{formatCurrency(r.interest)}</td>
                          <td className="py-1.5 px-2 text-right font-bold">{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 6 && (
                  <button type="button" onClick={() => setShowAll(s => !s)} className="w-full py-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-[#1a2b34] border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-1">
                    {showAll ? <><ChevronUp size={13} />{t('loan.show_less', 'Show fewer')}</> : <><ChevronDown size={13} />{t('loan.show_all', 'Show all {n} installments').replace('{n}', n(rows.length))}</>}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-slate-400">{t('common.loading', 'Loading…')}</div>
          )}
        </div>
      </form>
    </Modal>
  );
};
