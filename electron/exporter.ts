/**
 * Shared export engine for every PDF and Excel file the app produces.
 *  - one visual design (brand header, summary, zebra tables, totals, page numbers)
 *  - empty / null values are always written as "N/A"
 *  - Bangla text is supported (embedded Noto Sans Bengali in PDFs; Nirmala UI cells in Excel)
 *  - every document ends with an authorized signature (the signed-in operator, bottom-left)
 *    and a receiver signature with name (bottom-right)
 * Pure builders: no database or window access except renderPdf().
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, app } from 'electron';

export const NA = 'N/A';
export type Lang = 'en' | 'bn';
export interface Operator { name: string; role: string }
export interface ExportCol { header: string; kind?: 'text' | 'money' | 'int' | 'date' | 'pct'; width?: number }
export interface ExportCell { v: any; f?: string }
export interface ExportSection { title?: string; columns: ExportCol[]; rows: ExportCell[][]; totals?: ExportCell[] }
export interface ExportDoc {
  orgName: string; title: string; subtitle?: string; lang?: Lang; landscape?: boolean;
  meta?: Array<[string, string]>; summary?: Array<[string, string]>;
  sections: ExportSection[]; receiverName?: string; generatedOn: string;
}

const BRAND = 'FF0F6B50', BRAND_HEX = '#0f6b50';
const BN = /[ঀ-৿]/;

const LABELS: Record<Lang, Record<string, string>> = {
  en: { authorized: 'Authorized signature', receiver: 'Receiver signature', name: 'Name', generated: 'Generated', page: 'Page', of: 'of', total: 'Total', noRows: 'No records.', by: 'Prepared by' },
  bn: { authorized: 'অনুমোদনকারীর স্বাক্ষর', receiver: 'গ্রহীতার স্বাক্ষর', name: 'নাম', generated: 'তৈরির তারিখ', page: 'পৃষ্ঠা', of: 'এর', total: 'মোট', noRows: 'কোনো রেকর্ড নেই।', by: 'প্রস্তুতকারী' },
};
export const L = (lang: Lang | undefined, k: string) => (LABELS[lang || 'en'] || LABELS.en)[k] || k;

export const isBlank = (v: any) => v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim() === '—' || v.trim() === '-'));
/** Display text of a cell: formatted text if given, otherwise the raw value, never empty. */
export const show = (c: ExportCell | any): string => {
  const cell: ExportCell = c && typeof c === 'object' && 'v' in c ? c : { v: c };
  if (cell.f !== undefined && cell.f !== '') return String(cell.f);
  return isBlank(cell.v) ? NA : String(cell.v);
};

export const fmtDate = (iso?: string | null) => {
  if (!iso) return NA;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y) return String(iso);
  return `${String(d).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
export const dateCell = (iso?: string | null) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, d)) : null;
};
export const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fontFor = (text: unknown) => (BN.test(String(text ?? '')) ? 'Nirmala UI' : 'Segoe UI');

// ------------------------------------------------------------------ fonts (PDF)
let fontCss: string | null = null;
/** @font-face rules with the bundled Noto Sans Bengali embedded, so Bangla never renders as boxes. */
export function fontFaceCss(): string {
  if (fontCss !== null) return fontCss;
  let css = '';
  try {
    const dir = path.join(__dirname, '..', 'dist', 'assets');
    const files = fs.readdirSync(dir);
    for (const w of [400, 700, 800]) {
      const f = files.find(x => x.startsWith(`noto-sans-bengali-bengali-${w}-normal`) && x.endsWith('.woff'));
      if (f) css += `@font-face{font-family:"Noto Sans Bengali";font-weight:${w};src:url(data:font/woff;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}) format("woff");}`;
    }
  } catch { /* falls back to Nirmala UI, which ships with Windows */ }
  return (fontCss = css);
}
const FONT_STACK = '"Segoe UI","Noto Sans Bengali","Nirmala UI",Arial,sans-serif';

// ------------------------------------------------------------------ PDF
/** Signature block: authorized (operator) bottom-left, receiver bottom-right. */
export function signatureHtml(op: Operator, receiverName: string | undefined, lang?: Lang): string {
  const rn = isBlank(receiverName) ? '' : String(receiverName);
  return `<div class="sign">
    <div class="sig"><div class="line"></div><div class="cap">${esc(L(lang, 'authorized'))}</div>
      <div class="nm">${esc(L(lang, 'name'))}: <b>${esc(op.name || NA)}</b></div><div class="rl">${esc(op.role || NA)}</div></div>
    <div class="sig r"><div class="line"></div><div class="cap">${esc(L(lang, 'receiver'))}</div>
      <div class="nm">${esc(L(lang, 'name'))}: ${rn ? `<b>${esc(rn)}</b>` : '<span class="blank"></span>'}</div></div>
  </div>`;
}

export const PDF_CSS = (landscape: boolean) => `
  ${fontFaceCss()}
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${FONT_STACK}; color: #0f172a; font-size: 10.5px; margin: 0; }
  .page { padding: 0; display: flex; flex-direction: column; min-height: ${landscape ? '176mm' : '263mm'}; }
  .page.brk { page-break-after: always; }
  .band { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${BRAND_HEX}; padding-bottom: 9px; }
  .org { font-size: 18px; font-weight: 800; color: ${BRAND_HEX}; } .doc { font-size: 12px; color: #334155; font-weight: 700; margin-top: 2px; } .sub { color: #64748b; font-size: 10px; margin-top: 2px; }
  .gen { color: #64748b; font-size: 9.5px; text-align: right; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 10px 0 2px; color: #475569; } .meta b { color: #0f172a; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 7px; margin: 10px 0; }
  .cards div { border: 1px solid #cbd5e1; border-left: 4px solid ${BRAND_HEX}; border-radius: 8px; padding: 6px 9px; background: #f8fafc; }
  .cards span { display: block; color: #64748b; font-size: 9px; } .cards b { font-size: 12px; }
  h3.st { margin: 14px 0 5px; font-size: 12px; color: ${BRAND_HEX}; }
  table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
  th { background: ${BRAND_HEX}; color: #fff; text-align: left; padding: 6px 7px; font-size: 9.5px; font-weight: 700; }
  td { padding: 5px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } tbody tr:nth-child(even) td { background: #f8fafc; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } .c { text-align: center; } .na { color: #94a3b8; }
  tfoot td { font-weight: 800; border-top: 2px solid ${BRAND_HEX}; background: #ecfdf5; }
  .empty { text-align: center; color: #94a3b8; padding: 14px; }
  .pill { padding: 1px 7px; border-radius: 99px; font-weight: 700; font-size: 9px; } .pill.paid { background: #d1fae5; color: #047857; } .pill.overdue { background: #ffe4e6; color: #be123c; } .pill.pending { background: #fef3c7; color: #b45309; }
  .grow { flex: 1; }
  .sign { display: flex; justify-content: space-between; gap: 60px; margin-top: 46px; padding-top: 8px; page-break-inside: avoid; }
  .sig { width: 42%; } .sig.r { text-align: right; } .sig .line { border-top: 1.5px solid #0f172a; margin-bottom: 5px; height: 0; }
  .sig .cap { font-weight: 800; font-size: 10.5px; } .sig .nm { margin-top: 5px; } .sig .rl { color: #64748b; font-size: 9.5px; }
  .blank { display: inline-block; width: 150px; border-bottom: 1px dotted #475569; height: 11px; vertical-align: bottom; }
`;

export function pageHtml(inner: string, landscape: boolean, title = 'Document'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PDF_CSS(landscape)}</style></head><body>${inner}</body></html>`;
}

const cellHtml = (c: ExportCell, col: ExportCol) => {
  const t = show(c);
  const numeric = col.kind === 'money' || col.kind === 'int' || col.kind === 'pct';
  const cls = [numeric ? 'n' : '', t === NA ? 'na' : ''].filter(Boolean).join(' ');
  return `<td${cls ? ` class="${cls}"` : ''}>${esc(t)}</td>`;
};

/** A generic report / list document as printable HTML. */
export function buildTableHtml(doc: ExportDoc, op: Operator): string {
  const lang = doc.lang || 'en';
  const sections = doc.sections.map(s => {
    const head = `<tr>${s.columns.map(c => `<th${c.kind === 'money' || c.kind === 'int' || c.kind === 'pct' ? ' class="n"' : ''}>${esc(c.header)}</th>`).join('')}</tr>`;
    const body = s.rows.length ? s.rows.map(r => `<tr>${s.columns.map((c, i) => cellHtml(r[i] ?? { v: null }, c)).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${s.columns.length}">${esc(L(lang, 'noRows'))}</td></tr>`;
    const foot = s.totals ? `<tfoot><tr>${s.columns.map((c, i) => cellHtml(s.totals![i] ?? { v: '' }, c).replace('class="na"', '').replace(`>${NA}<`, '><')).join('')}</tr></tfoot>` : '';
    return `${s.title ? `<h3 class="st">${esc(s.title)}</h3>` : ''}<table><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>`;
  }).join('');
  const meta = (doc.meta || []).length ? `<div class="meta">${doc.meta!.map(([k, v]) => `<span>${esc(k)}: <b>${esc(isBlank(v) ? NA : v)}</b></span>`).join('')}</div>` : '';
  const cards = (doc.summary || []).length ? `<div class="cards">${doc.summary!.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(isBlank(v) ? NA : v)}</b></div>`).join('')}</div>` : '';
  const inner = `<div class="page">
    <div class="band"><div><div class="org">${esc(doc.orgName)}</div><div class="doc">${esc(doc.title)}</div>${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}</div>
      <div class="gen">${esc(L(lang, 'generated'))}: ${esc(fmtDate(doc.generatedOn))}<br/>${esc(L(lang, 'by'))}: ${esc(op.name || NA)}</div></div>
    ${meta}${cards}${sections}<div class="grow"></div>${signatureHtml(op, doc.receiverName, lang)}</div>`;
  return pageHtml(inner, !!doc.landscape, doc.title);
}

/** Renders HTML to a PDF in a hidden window (no dependency on what is on screen). */
export async function renderPdf(html: string, landscape: boolean): Promise<Buffer> {
  const tmp = path.join(app.getPath('temp'), `bf-export-${Date.now()}-${Math.floor(Math.random() * 1e6)}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  if (process.env.BF_EXPORT_DEBUG_DIR) { try { fs.copyFileSync(tmp, path.join(process.env.BF_EXPORT_DEBUG_DIR, path.basename(tmp))); } catch { /* debug only */ } }
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    return await win.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', landscape,
      margins: { top: 0.5, bottom: 0.6, left: 0.45, right: 0.45 },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#64748b;font-family:Segoe UI,Arial"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally { win.destroy(); try { fs.unlinkSync(tmp); } catch { /* temp file */ } }
}

// ------------------------------------------------------------------ Excel
export function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: fontFor(c.value) };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: BRAND } } };
  });
}

/** Writes the title block (org, title, subtitle, meta) and returns the next free row. */
export function addTitleBlock(ws: ExcelJS.Worksheet, doc: Pick<ExportDoc, 'orgName' | 'title' | 'subtitle' | 'meta' | 'generatedOn' | 'lang'>, op: Operator, lastCol: number): number {
  const merge = (r: number) => { if (lastCol > 1) ws.mergeCells(r, 1, r, lastCol); };
  merge(1); const a = ws.getCell(1, 1); a.value = doc.orgName; a.font = { bold: true, size: 17, color: { argb: BRAND }, name: fontFor(doc.orgName) }; ws.getRow(1).height = 26;
  merge(2); const b = ws.getCell(2, 1); b.value = doc.title; b.font = { bold: true, size: 12, color: { argb: 'FF334155' }, name: fontFor(doc.title) };
  let r = 3;
  if (doc.subtitle) { merge(r); const c = ws.getCell(r, 1); c.value = doc.subtitle; c.font = { size: 10, color: { argb: 'FF64748B' }, name: fontFor(doc.subtitle) }; r++; }
  merge(r); const g = ws.getCell(r, 1);
  g.value = `${L(doc.lang, 'generated')}: ${fmtDate(doc.generatedOn)}  ·  ${L(doc.lang, 'by')}: ${op.name || NA}`;
  g.font = { size: 9, color: { argb: 'FF64748B' }, name: fontFor(g.value) };
  r++;
  for (const [k, v] of doc.meta || []) {
    ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = { bold: true, color: { argb: 'FF475569' }, name: fontFor(k) };
    ws.getCell(r, 2).value = isBlank(v) ? NA : v; ws.getCell(r, 2).font = { name: fontFor(v) };
    r++;
  }
  // brand rule under the block
  for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = { top: { style: 'medium', color: { argb: BRAND } } };
  ws.getRow(r).height = 6;
  return r + 1;
}

/** Authorized (operator) signature at the bottom-left, receiver signature with name at the bottom-right. */
export function addSignatureRows(ws: ExcelJS.Worksheet, startRow: number, lastCol: number, op: Operator, receiverName: string | undefined, lang?: Lang) {
  const span = Math.max(1, Math.min(3, Math.floor(lastCol / 2)));
  const leftFrom = 1, leftTo = span;
  const rightTo = lastCol, rightFrom = Math.max(leftTo + 1, lastCol - span + 1);
  const r = startRow + 2;
  ws.getRow(r).height = 34;
  const put = (row: number, from: number, to: number, text: string, opt: Partial<ExcelJS.Font> & { top?: boolean; align?: 'left' | 'right' | 'center' }) => {
    if (to > from) ws.mergeCells(row, from, row, to);
    const c = ws.getCell(row, from);
    c.value = text;
    c.font = { name: fontFor(text), size: opt.size || 10, bold: opt.bold, color: opt.color };
    c.alignment = { horizontal: opt.align || 'left', vertical: 'middle' };
    if (opt.top) for (let k = from; k <= to; k++) ws.getCell(row, k).border = { top: { style: 'medium', color: { argb: 'FF0F172A' } } };
  };
  put(r + 1, leftFrom, leftTo, L(lang, 'authorized'), { bold: true, top: true });
  put(r + 2, leftFrom, leftTo, `${L(lang, 'name')}: ${op.name || NA}`, {});
  put(r + 3, leftFrom, leftTo, op.role || NA, { size: 9, color: { argb: 'FF64748B' } });
  put(r + 1, rightFrom, rightTo, L(lang, 'receiver'), { bold: true, top: true, align: 'right' });
  put(r + 2, rightFrom, rightTo, `${L(lang, 'name')}: ${isBlank(receiverName) ? '________________' : receiverName}`, { align: 'right' });
}

export function pageSetup(ws: ExcelJS.Worksheet, landscape: boolean, headerRow?: number) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 } };
  if (headerRow) ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  ws.headerFooter = { oddFooter: '&C&8&P / &N' };
}

const NUMFMT: Record<string, string> = { money: '#,##0.##', int: '#,##0', pct: '0.0"%"', date: 'dd/mm/yyyy' };

/** A generic report / list document as a styled workbook (one sheet per section group). */
export async function buildTableXlsx(doc: ExportDoc, op: Operator): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = op.name || doc.orgName;
  const ws = wb.addWorksheet((doc.title || 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { views: [{ showGridLines: false }] });
  const lastCol = Math.max(4, ...doc.sections.map(s => s.columns.length));
  let r = addTitleBlock(ws, doc, op, lastCol);
  if ((doc.summary || []).length) {
    doc.summary!.forEach(([k, v], i) => {
      const row = r + Math.floor(i / 2), col = (i % 2) * 2 + 1;
      ws.getCell(row, col).value = k; ws.getCell(row, col).font = { bold: true, color: { argb: 'FF475569' }, name: fontFor(k) };
      ws.getCell(row, col + 1).value = isBlank(v) ? NA : v; ws.getCell(row, col + 1).font = { bold: true, name: fontFor(v) };
    });
    r += Math.ceil(doc.summary!.length / 2) + 1;
  }
  let firstHeader = 0;
  const widths: number[] = Array(lastCol).fill(10);
  for (const s of doc.sections) {
    if (s.title) { ws.mergeCells(r, 1, r, lastCol); const t = ws.getCell(r, 1); t.value = s.title; t.font = { bold: true, size: 12, color: { argb: BRAND }, name: fontFor(s.title) }; r++; }
    const hr = ws.getRow(r); s.columns.forEach((c, i) => { hr.getCell(i + 1).value = c.header; }); styleHeaderRow(hr);
    if (!firstHeader) firstHeader = r;
    r++;
    const body = s.rows.length ? s.rows : [];
    body.forEach((cells, idx) => {
      const row = ws.getRow(r++);
      s.columns.forEach((c, i) => {
        const cell = cells[i] ?? { v: null };
        const cx = row.getCell(i + 1);
        if (isBlank(cell.v) && !cell.f) { cx.value = NA; cx.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI' }; cx.alignment = { horizontal: 'center' }; }
        else if (c.kind === 'date') { const d = typeof cell.v === 'string' ? dateCell(cell.v) : cell.v; if (d) { cx.value = d; cx.numFmt = NUMFMT.date; cx.alignment = { horizontal: 'center' }; } else { cx.value = show(cell); } cx.font = { name: 'Segoe UI' }; }
        else if ((c.kind === 'money' || c.kind === 'int' || c.kind === 'pct') && typeof cell.v === 'number') { cx.value = cell.v; cx.numFmt = NUMFMT[c.kind]; cx.alignment = { horizontal: 'right' }; cx.font = { name: 'Segoe UI' }; }
        else { const t = show(cell); cx.value = t; cx.font = { name: fontFor(t) }; cx.alignment = { vertical: 'top', wrapText: true }; }
        widths[i] = Math.min(46, Math.max(widths[i], String(show(cell)).length + 2, c.header.length + 3, c.width || 0));
        cx.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
        if (idx % 2) cx.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    });
    if (!s.rows.length) { ws.mergeCells(r, 1, r, lastCol); const e = ws.getCell(r, 1); e.value = L(doc.lang, 'noRows'); e.font = { color: { argb: 'FF94A3B8' } }; e.alignment = { horizontal: 'center' }; r++; }
    if (s.totals) {
      const tr = ws.getRow(r++);
      s.columns.forEach((c, i) => {
        const cell = s.totals![i] ?? { v: '' }; const cx = tr.getCell(i + 1);
        if (typeof cell.v === 'number') { cx.value = cell.v; cx.numFmt = NUMFMT[c.kind || 'money'] || NUMFMT.money; cx.alignment = { horizontal: 'right' }; }
        else cx.value = isBlank(cell.v) ? '' : String(cell.f ?? cell.v);
        cx.font = { bold: true, name: fontFor(cx.value) };
        cx.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
        cx.border = { top: { style: 'medium', color: { argb: BRAND } } };
      });
    }
    r += 1;
  }
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  addSignatureRows(ws, r, lastCol, op, doc.receiverName, doc.lang);
  if (firstHeader) { ws.views = [{ showGridLines: false, state: 'frozen', ySplit: firstHeader }]; }
  pageSetup(ws, !!doc.landscape || lastCol > 6, firstHeader || undefined);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ------------------------------------------------------------------ Payment voucher (PDF)
export interface VoucherData {
  orgName: string; lang?: Lang; no: string; member_code?: string; member_name?: string; member_name_bn?: string | null;
  payment_month?: string; payment_date?: string; payment_method?: string; trx_id?: string; note?: string;
  contribution: number; late_fee: number; total: number; currency: string; monthLabel?: string; generatedOn: string;
}
export function buildVoucherHtml(v: VoucherData, op: Operator): string {
  const lang = v.lang || 'en';
  const money = (n: number) => `${esc(v.currency)} ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
  const row = (k: string, val: unknown) => `<tr><td class="k">${esc(k)}</td><td class="${isBlank(val) ? 'na' : ''}">${esc(isBlank(val) ? NA : val)}</td></tr>`;
  const member = [v.member_name, v.member_name_bn].filter(x => !isBlank(x)).join(' / ');
  const inner = `<div class="page" style="max-width:170mm;margin:0 auto">
    <div class="band"><div><div class="org">${esc(v.orgName)}</div><div class="doc">${lang === 'bn' ? 'পেমেন্ট ভাউচার' : 'Payment voucher'}</div></div>
      <div class="gen">${lang === 'bn' ? 'ভাউচার নং' : 'Voucher no.'} <b>${esc(v.no)}</b><br/>${esc(L(lang, 'generated'))}: ${esc(fmtDate(v.generatedOn))}</div></div>
    <table class="vt" style="margin-top:14px">
      ${row(lang === 'bn' ? 'সদস্য কোড' : 'Member code', v.member_code)}${row(lang === 'bn' ? 'সদস্যের নাম' : 'Member name', member)}
      ${row(lang === 'bn' ? 'পেমেন্টের মাস' : 'Payment month', v.monthLabel || v.payment_month)}${row(lang === 'bn' ? 'পেমেন্টের তারিখ' : 'Payment date', v.payment_date ? fmtDate(v.payment_date) : '')}
      ${row(lang === 'bn' ? 'পদ্ধতি' : 'Payment method', v.payment_method)}${row(lang === 'bn' ? 'ট্রানজেকশন/রেফারেন্স' : 'Transaction / reference', v.trx_id)}
      ${row(lang === 'bn' ? 'মন্তব্য' : 'Note', v.note)}
    </table>
    <table style="margin-top:14px"><thead><tr><th>${lang === 'bn' ? 'বিবরণ' : 'Description'}</th><th class="n">${lang === 'bn' ? 'পরিমাণ' : 'Amount'}</th></tr></thead>
      <tbody><tr><td>${lang === 'bn' ? 'মাসিক চাঁদা' : 'Contribution'}</td><td class="n">${money(v.contribution)}</td></tr>
      <tr><td>${lang === 'bn' ? 'বিলম্ব ফি' : 'Late fee'}</td><td class="n">${money(v.late_fee)}</td></tr></tbody>
      <tfoot><tr><td>${lang === 'bn' ? 'মোট গৃহীত' : 'Total received'}</td><td class="n">${money(v.total)}</td></tr></tfoot></table>
    <div class="grow"></div>${signatureHtml(op, member, lang)}</div>
    <style>.vt td{padding:7px 9px}.vt td.k{width:38%;color:#475569;font-weight:700;background:#f8fafc}</style>`;
  return pageHtml(inner, false, 'Payment voucher');
}
