import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet, Download, FolderOpen, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Upload, Users, Receipt,
  CalendarRange, Info, Loader2, ClipboardList, ShieldCheck,
} from 'lucide-react';
import { ChipTabs } from '../common/ChipTabs';
import { Modal } from '../common/Modal';
import { SearchableSelect } from '../common/SearchableSelect';
import { useApp } from '../../context/AppContext';
import { downloadImportTemplate, pickImportFile, previewImport, commitImport } from '../../services/db';
import type { ImportOptions, ImportPreview, ImportResult, ImportLevel, ImportMemberRow } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opens the simple "paste a list" importer */
  onPasteInstead?: () => void;
}

type Step = 'prepare' | 'review' | 'done';

const LEVEL_STYLE: Record<ImportLevel, string> = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  error: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

export const ExcelImportModal: React.FC<Props> = ({ open, onClose, onPasteInstead }) => {
  const { t, tv, formatCurrency, formatDate, formatMonth, toBanglaDigits, language, masterData, showToast, triggerRefresh, setActiveTab } = useApp();
  const n = (v: number) => (language === 'bn' ? toBanglaDigits(v) : String(v));
  const [step, setStep] = useState<Step>('prepare');
  const [opts, setOpts] = useState<ImportOptions>({ existing: 'skip', payment_method: 'Cash' });
  const [token, setToken] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | 'template' | 'pick' | 'preview' | 'commit'>(null);
  const [tab, setTab] = useState<'members' | 'payments'>('members');
  const [onlyProblems, setOnlyProblems] = useState(false);

  const methodOptions = useMemo(() => masterData.filter(m => m.type === 'payment_method' && m.is_active)
    .map(m => ({ value: m.name, label: tv(m.name) })), [masterData, tv]);
  const existingOptions = useMemo(() => [
    { value: 'skip', label: t('members.imp_existing_skip', 'Keep existing members as they are'), subLabel: t('members.imp_existing_skip_sub', 'Only new members are added; payments are still imported') },
    { value: 'update', label: t('members.imp_existing_update', 'Update existing members from the sheet'), subLabel: t('members.imp_existing_update_sub', 'Matched by Member Code (or exact name)') },
  ], [t]);

  const reset = () => { setStep('prepare'); setToken(null); setPreview(null); setResult(null); setFileName(''); setTab('members'); setOnlyProblems(false); };
  const close = () => { if (busy === 'commit') return; reset(); onClose(); };

  const onTemplate = async () => {
    setBusy('template');
    try {
      const r = await downloadImportTemplate();
      if (!r.canceled) showToast(t('members.imp_template_saved', 'Template saved and opened in Excel') + (r.filePath ? `: ${r.filePath}` : ''));
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(null); }
  };

  const onPick = async () => {
    setBusy('pick');
    try {
      const r = await pickImportFile(opts);
      if (r.canceled || !r.preview || !r.token) return;
      setToken(r.token); setFileName(r.fileName || ''); setPreview(r.preview); setStep('review');
      setTab(r.preview.members.length ? 'members' : 'payments');
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(null); }
  };

  const changeOpts = async (next: ImportOptions) => {
    setOpts(next);
    if (!token) return;
    setBusy('preview');
    try { setPreview(await previewImport(token, next)); } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(null); }
  };

  const onCommit = async () => {
    if (!token) return;
    setBusy('commit');
    try {
      const r = await commitImport(token, opts);
      setResult(r); setStep('done'); triggerRefresh();
      showToast(t('members.imp_done_toast', 'Import complete'));
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(null); }
  };

  const s = preview?.summary;
  const importable = s ? s.newMembers + s.updatedMembers + s.newPayments + (s.openingTotal > 0 ? 1 : 0) : 0;
  const members = useMemo(() => (preview?.members || []).filter(m => !onlyProblems || m.level !== 'ok'), [preview, onlyProblems]);
  const payIssues = preview?.payments || [];

  const actionLabel = (m: ImportMemberRow) => ({
    new: t('members.imp_act_new', 'New'), update: t('members.imp_act_update', 'Update'),
    skip: t('members.imp_act_skip', 'Exists'), error: t('members.imp_act_error', 'Error'),
  }[m.action]);

  // ---------------------------------------------------------------------------
  const footer = step === 'prepare' ? (
    <>
      {onPasteInstead && (
        <button type="button" onClick={() => { close(); onPasteInstead(); }} className="mr-auto text-xs font-bold text-slate-500 hover:text-brand dark:hover:text-emerald-400 flex items-center gap-1.5">
          <ClipboardList size={14} />{t('members.imp_paste_instead', 'Paste a simple list instead')}
        </button>
      )}
      <button type="button" onClick={close} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
      <button type="button" onClick={onPick} disabled={!!busy} className="btn btn-primary">
        {busy === 'pick' ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
        {t('members.imp_choose_file', 'Choose filled Excel file')}
      </button>
    </>
  ) : step === 'review' ? (
    <>
      <button type="button" onClick={reset} disabled={busy === 'commit'} className="mr-auto btn btn-outline"><ArrowLeft size={15} />{t('members.imp_back', 'Back')}</button>
      <button type="button" onClick={onPick} disabled={!!busy} className="btn btn-outline"><FolderOpen size={15} />{t('members.imp_other_file', 'Choose another file')}</button>
      <button type="button" onClick={onCommit} disabled={!!busy || !importable} className="btn btn-primary">
        {busy === 'commit' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {s ? t('members.imp_import_btn', 'Import {m} members & {p} payments').replace('{m}', n(s.newMembers + s.updatedMembers)).replace('{p}', n(s.newPayments)) : ''}
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={reset} className="btn btn-outline">{t('members.imp_import_more', 'Import another file')}</button>
      <button type="button" onClick={() => { close(); setActiveTab('members'); }} className="btn btn-primary"><Users size={15} />{t('members.imp_view_members', 'View members')}</button>
    </>
  );

  return (
    <Modal open={open} onClose={close} locked={busy === 'commit'} size="xl" icon={<FileSpreadsheet size={20} />}
      title={t('members.imp_title', 'Import members from Excel')}
      subtitle={step === 'review' ? fileName : t('members.imp_subtitle', 'Add members in bulk, together with the collections you have recorded so far.')}
      footer={footer}>
      {/* Stepper */}
      <ol className="flex items-center gap-2 mb-5 text-[11px] font-bold">
        {(['prepare', 'review', 'done'] as Step[]).map((k, i) => {
          const idx = ['prepare', 'review', 'done'].indexOf(step);
          const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
          return (
            <li key={k} className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${state === 'todo' ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : 'bg-brand text-white dark:bg-emerald-600'}`}>
                {state === 'done' ? <CheckCircle2 size={14} /> : n(i + 1)}
              </span>
              <span className={`truncate ${state === 'todo' ? 'text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {[t('members.imp_step1', 'Prepare the sheet'), t('members.imp_step2', 'Review'), t('members.imp_step3', 'Done')][i]}
              </span>
              {i < 2 && <span className="flex-1 h-px bg-slate-200 dark:bg-[#22353f]" />}
            </li>
          );
        })}
      </ol>

      {step === 'prepare' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-[#22353f] p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-8 h-8 rounded-xl bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center font-black text-sm">{n(1)}</span>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('members.imp_get_template', 'Download the template')}</h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t('members.imp_template_desc', 'An Excel file with three sheets: Instructions (English + বাংলা), Members, and Payment History. Example rows show exactly how to fill each column.')}
              </p>
              <button type="button" onClick={onTemplate} disabled={!!busy} className="mt-4 btn btn-green-outline w-full">
                {busy === 'template' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {t('members.imp_download', 'Download template (.xlsx)')}
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-[#22353f] p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-8 h-8 rounded-xl bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center font-black text-sm">{n(2)}</span>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{t('members.imp_fill', 'Fill members and till-date collections')}</h3>
              </div>
              <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
                <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" /><span><b>{t('members.imp_method_a', 'Month by month (best):')}</b> {t('members.imp_method_a_desc', 'in "Payment History" enter the amount under each month, or P for paid in full. Arrears and statements will be exact.')}</span></li>
                <li className="flex gap-2"><CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" /><span><b>{t('members.imp_method_b', 'Only a total:')}</b> {t('members.imp_method_b_desc', 'put the total paid so far in "Opening Balance" and set Join Date to the first month you will track in the app.')}</span></li>
                <li className="flex gap-2"><AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" /><span>{t('members.imp_no_both', 'Don\'t use both for the same months — the money would be counted twice.')}</span></li>
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchableSelect label={t('members.imp_existing_label', 'Members that already exist in the app')} options={existingOptions}
              value={opts.existing} onChange={v => setOpts(o => ({ ...o, existing: v }))} />
            <SearchableSelect label={t('members.imp_method_label', 'Payment method for imported payments')} options={methodOptions}
              value={opts.payment_method} onChange={v => setOpts(o => ({ ...o, payment_method: v }))} />
          </div>
          <p className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-brand dark:text-emerald-400" />
            {t('members.imp_safe', 'Nothing is saved until you confirm on the next screen. A safety snapshot is taken right before the import, so it can be undone from Backup & Restore.')}
          </p>
        </div>
      )}

      {step === 'review' && preview && s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={<Users size={15} />} label={t('members.imp_new_members', 'New members')} value={n(s.newMembers)} sub={s.updatedMembers ? `+${n(s.updatedMembers)} ${t('members.imp_updated', 'updated')}` : s.skippedMembers ? `${n(s.skippedMembers)} ${t('members.imp_already', 'already in app')}` : undefined} />
            <Tile icon={<Receipt size={15} />} label={t('members.imp_payments', 'Payments to add')} value={n(s.newPayments)} sub={s.existingPayments ? `${n(s.existingPayments)} ${t('members.imp_already_recorded', 'already recorded')}` : undefined} />
            <Tile icon={<CalendarRange size={15} />} label={t('members.imp_amount', 'Collections amount')} value={formatCurrency(s.paymentTotal)}
              sub={s.monthRange ? `${formatMonth(s.monthRange[0])} – ${formatMonth(s.monthRange[1])}` : undefined} />
            <Tile icon={<Info size={15} />} label={t('members.imp_opening', 'Opening balances')} value={formatCurrency(s.openingTotal)} />
          </div>

          {(s.memberErrors + s.paymentErrors > 0 || preview.sheetWarnings.length > 0) && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              {s.memberErrors + s.paymentErrors > 0 && (
                <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={14} />
                  {t('members.imp_errors_note', '{n} rows have errors and will be skipped. Fix them in Excel and choose the file again, or import the valid rows now.').replace('{n}', n(s.memberErrors + s.paymentErrors))}
                </p>
              )}
              {preview.sheetWarnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}
          {s.examplesSkipped > 0 && <p className="text-[11px] text-slate-500">{t('members.imp_examples', '{n} example rows (codes starting with EX-) were ignored.').replace('{n}', n(s.examplesSkipped))}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <ChipTabs value={tab} onChange={setTab}
              items={[
                { key: 'members' as const, label: t('members.imp_tab_members', 'Members'), count: n(preview.members.length) },
                { key: 'payments' as const, label: t('members.imp_tab_issues', 'Payment issues'), count: n(payIssues.length) },
              ]} />
            {tab === 'members' && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} className="accent-[#0f4a3c] w-4 h-4" />
                {t('members.imp_only_problems', 'Show only rows with warnings or errors')}
              </label>
            )}
            <div className="ml-auto min-w-[260px]">
              <SearchableSelect size="sm" options={existingOptions} value={opts.existing} onChange={v => changeOpts({ ...opts, existing: v })} isLoading={busy === 'preview'} />
            </div>
          </div>

          <div className="overflow-auto max-h-[46vh] rounded-xl border border-slate-200 dark:border-[#22353f]">
            {tab === 'members' ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0f1a20] z-10">
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    {[t('members.imp_col_row', 'Row'), t('members.imp_col_member', 'Member'), t('members.imp_col_due', 'Monthly due'), t('members.imp_col_join', 'Joined'),
                      t('members.imp_col_opening', 'Opening'), t('members.imp_col_history', 'History'), t('members.imp_col_result', 'Result')].map((h, i) => (
                      <th key={i} className={`px-3 py-2.5 font-bold ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.row} className="border-t border-slate-100 dark:border-[#1b2c34] align-top">
                      <td className="px-3 py-2.5 text-slate-400 tabular-nums">{n(m.row)}</td>
                      <td className="px-3 py-2.5 min-w-[200px]">
                        <div className="font-bold text-slate-800 dark:text-slate-100">{(language === 'bn' && m.name_bn) || m.name || '—'}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                          <span className="font-mono">{m.code || '—'}</span>
                          {m.autoGeneratedCode && <span className="px-1.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">{t('members.imp_auto', 'auto')}</span>}
                          {m.status === 'Inactive' && <span>{tv('Inactive')}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(m.monthly_due)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatDate(m.join_date)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.opening_balance ? formatCurrency(m.opening_balance) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{m.payments ? `${n(m.payments)} · ${formatCurrency(m.paidTotal)}` : '—'}</td>
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${LEVEL_STYLE[m.level]}`}>
                          {m.level === 'error' ? <XCircle size={11} /> : m.level === 'warning' ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}{actionLabel(m)}
                        </span>
                        {m.messages.map((x, i) => <div key={i} className={`mt-1 text-[11px] ${x.level === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300'}`}>{x.text}</div>)}
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">{t('members.imp_none', 'Nothing to show.')}</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0f1a20] z-10">
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    {[t('members.imp_col_cell', 'Cell'), t('members.imp_col_member', 'Member'), t('common.month', 'Month'), t('common.amount', 'Amount'), t('members.imp_col_result', 'Result')].map((h, i) => (
                      <th key={i} className={`px-3 py-2.5 font-bold ${i === 3 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payIssues.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-[#1b2c34] align-top">
                      <td className="px-3 py-2.5 font-mono text-slate-500">{p.cell}</td>
                      <td className="px-3 py-2.5"><div className="font-bold text-slate-800 dark:text-slate-100">{p.name || '—'}</div><div className="text-[10px] font-mono text-slate-500">{p.code}</div></td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatMonth(p.month)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(p.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${LEVEL_STYLE[p.level]}`}>
                          {p.action === 'exists' ? t('members.imp_pay_exists', 'Already recorded') : p.action === 'error' ? t('members.imp_act_error', 'Error') : t('members.imp_act_new', 'New')}
                        </span>
                        {p.messages.map((x, j) => <div key={j} className={`mt-1 text-[11px] ${x.level === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300'}`}>{x.text}</div>)}
                      </td>
                    </tr>
                  ))}
                  {payIssues.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-10 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
                      <CheckCircle2 size={16} className="inline mr-1.5" />{t('members.imp_no_issues', 'All payments look good.')}
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="py-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><CheckCircle2 size={28} /></div>
          <h3 className="mt-4 text-lg font-black text-slate-900 dark:text-white">{t('members.imp_done_title', 'Import complete')}</h3>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto text-left">
            <Tile label={t('members.imp_added', 'Members added')} value={n(result.created)} />
            <Tile label={t('members.imp_updated_cap', 'Members updated')} value={n(result.updated)} />
            <Tile label={t('members.imp_payments_added', 'Payments added')} value={n(result.paymentsAdded)} />
            <Tile label={t('members.imp_amount', 'Collections amount')} value={formatCurrency(result.amount)} />
          </div>
          {result.errors > 0 && <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">{t('members.imp_skipped_errors', '{n} rows with errors were skipped.').replace('{n}', n(result.errors))}</p>}
          <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            {t('members.imp_undo', 'To undo this import, restore the "PreImport" snapshot in Backup & Restore.')}
          </p>
        </div>
      )}
    </Modal>
  );
};

const Tile: React.FC<{ icon?: React.ReactNode; label: string; value: string; sub?: string }> = ({ icon, label, value, sub }) => (
  <div className="rounded-xl border border-slate-200 dark:border-[#22353f] bg-white dark:bg-[#132027] p-3.5 min-w-0">
    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">{icon}{label}</div>
    <div className="mt-1 text-lg font-black text-slate-900 dark:text-white tabular-nums truncate">{value}</div>
    {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{sub}</div>}
  </div>
);

export default ExcelImportModal;
