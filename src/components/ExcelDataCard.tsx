import React, { useState } from 'react';
import { FileSpreadsheet, Download, Upload, Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { ExcelImportModal } from './modals/ExcelImportModal';
import { useApp } from '../context/AppContext';
import { downloadImportTemplate } from '../services/db';

/**
 * Backup & Restore → "Members from Excel": download the data-entry workbook and upload the filled one.
 * Uploading data is limited to the iqbal_labs account (enforced in the main process); everyone else sees why the buttons are off.
 */
export const ExcelDataCard: React.FC = () => {
  const { t, canUpload, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const r = await downloadImportTemplate();
      if (!r.canceled) showToast(t('members.imp_template_saved', 'Template saved and opened in Excel') + (r.filePath ? `: ${r.filePath}` : ''));
    } catch (e: any) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };

  const steps = [
    t('excel.step1', '1. Download the Excel format and fill it in (Start Here sheet explains everything).'),
    t('excel.step2', '2. Come back here and press "Upload members from Excel".'),
    t('excel.step3', '3. Check the preview, then press Import. Nothing is saved before that.'),
  ];

  return (
    <div className="card-base p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-light dark:bg-emerald-950 text-brand dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-200 dark:border-emerald-800">
          <FileSpreadsheet size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('excel.card_title', 'Members & payment history from Excel')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {t('excel.card_desc', 'Enter all members, their National IDs and their past payments in one Excel file, then upload it. Use the download button to get the ready-made format.')}
          </p>
          <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" /><span>{s.replace(/^\d\.\s*/, '')}</span></li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={download} disabled={!canUpload || busy} className="btn btn-primary"
              title={canUpload ? undefined : t('excel.locked_short', 'Only the iqbal_labs account can use this')}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              <span>{t('excel.download', 'Download Excel format (.xlsx)')}</span>
            </button>
            <button type="button" onClick={() => setOpen(true)} disabled={!canUpload} className="btn btn-outline"
              title={canUpload ? undefined : t('excel.locked_short', 'Only the iqbal_labs account can use this')}>
              <Upload size={15} />
              <span>{t('excel.upload', 'Upload members from Excel')}</span>
            </button>
          </div>
          {!canUpload && (
            <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <Lock size={13} className="shrink-0" />
              {t('excel.locked', 'Uploading data is limited to the iqbal_labs Super User account. Sign in as iqbal_labs to download the format and upload members.')}
            </p>
          )}
        </div>
      </div>
      {canUpload && <ExcelImportModal open={open} onClose={() => setOpen(false)} />}
    </div>
  );
};
