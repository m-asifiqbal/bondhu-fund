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

const BRAND = 'FF0F6B50';
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

/**
 * Print-first design: every distinction is made with ink weight, outline and tone, never with hue alone, so the document
 * reads just as well on a black-and-white printer or photocopy as on screen. No solid dark fills except the "Overdue" tag.
 */
export const PDF_CSS = (landscape: boolean) => `
  ${fontFaceCss()}
  /* real page margins: the printable area is inset from every paper edge */
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '13mm 15mm 17mm' : '15mm 17mm 19mm'}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${FONT_STACK}; color: #111827; font-size: 10.5px; line-height: 1.4; margin: 0; }
  .page { display: flex; flex-direction: column; min-height: ${landscape ? '178mm' : '260mm'}; }
  .page.brk { page-break-after: always; }
  /* letterhead: dark text on white, closed by a double rule */
  .band { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 0 2px 10px; border-bottom: 4px double #14532d; }
  .org { font-size: 21px; font-weight: 800; letter-spacing: .2px; color: #0b3d2e; line-height: 1.2; }
  .doc { font-size: 11px; font-weight: 700; margin-top: 5px; color: #4b5563; text-transform: uppercase; letter-spacing: 1.8px; }
  .sub { color: #6b7280; font-size: 10px; margin-top: 3px; }
  .gen { color: #4b5563; font-size: 9.5px; text-align: right; line-height: 1.7; } .gen b { color: #111827; }
  .mname { font-size: 18px; font-weight: 800; color: #0b3d2e; } .mname span { font-weight: 600; color: #4b5563; }
  .meta { display: flex; flex-wrap: wrap; gap: 5px 0; margin: 7px 2px 2px; color: #4b5563; } .meta b { color: #111827; }
  .meta span { padding: 0 16px; border-left: 1px solid #9ca3af; } .meta span:first-child { padding-left: 0; border-left: 0; }
  /* summary cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 14px 0 16px; }
  .cards div { border: 1px solid #9ca3af; border-left: 4px solid #14532d; border-radius: 6px; padding: 7px 12px 8px; background: #f5f7f6; }
  .cards span { display: block; color: #4b5563; font-size: 8.8px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; } .cards b { font-size: 14px; color: #111827; }
  h3.st { margin: 18px 0 7px; font-size: 11.5px; font-weight: 800; color: #0b3d2e; text-transform: uppercase; letter-spacing: .8px; padding-bottom: 4px; border-bottom: 1.5px solid #374151; }
  /* tables: light header with a strong rule, faint zebra, strong total row */
  table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #6b7280; border-radius: 6px; overflow: hidden; }
  thead { display: table-header-group; } tfoot { display: table-row-group; } tr { page-break-inside: avoid; }
  th { background: #e6ece9; color: #111827; text-align: left; padding: 8px 9px; font-size: 9.5px; font-weight: 800; letter-spacing: .2px; border-bottom: 1.5px solid #374151; }
  td { padding: 6.5px 9px; border-bottom: 1px solid #d9dedc; vertical-align: top; } tbody tr:nth-child(even) td { background: #f7f8f8; } tbody tr:last-child td { border-bottom: 0; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } .c { text-align: center; } .na { color: #9ca3af; }
  tfoot td { font-weight: 800; border-top: 1.5px solid #374151; border-bottom: 0; background: #e6ece9; color: #111827; padding-top: 8px; padding-bottom: 8px; }
  .empty { text-align: center; color: #6b7280; padding: 16px; }
  /* status tags differ in outline style as well as colour: Paid = thin outline, Pending = dashed, Overdue = solid dark */
  .pill { display: inline-block; padding: 1px 9px; border-radius: 99px; font-weight: 800; font-size: 8.8px; letter-spacing: .2px; border: 1px solid; }
  .pill.paid { color: #166534; border-color: #166534; background: #f0fdf4; }
  .pill.overdue { color: #fff; border-color: #9f1239; background: #9f1239; }
  .pill.pending { color: #92400e; border: 1px dashed #92400e; background: #fffbeb; }
  .note { background: #fafaf9; border: 1px solid #9ca3af; border-left: 4px solid #92400e; border-radius: 6px; padding: 8px 12px; margin: 0 0 12px; color: #1f2937; }
  .grow { flex: 1; }
  /* signatures: generous room above the line to sign, kept inside the margins and together on one page */
  .sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 24mm; padding: 0 6px; page-break-inside: avoid; }
  .sig { width: 40%; } .sig.r { text-align: right; } .sig .line { border-top: 1.3px solid #111827; margin-bottom: 6px; height: 0; }
  .sig .cap { font-weight: 800; font-size: 10.5px; letter-spacing: .2px; } .sig .nm { margin-top: 5px; } .sig .rl { color: #4b5563; font-size: 9.5px; }
  .blank { display: inline-block; width: 150px; border-bottom: 1px dotted #4b5563; height: 11px; vertical-align: bottom; }
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
      preferCSSPageSize: true,
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

// ------------------------------------------------------------------ Loan consent & guarantee paper (PDF)
export interface ConsentPaperData {
  orgName: string; lang?: Lang; generatedOn: string; currency: string;
  /** 'Application no.' for a draft, 'Loan no.' for a disbursed loan */
  ref_no: string; ref_is_draft: boolean; loan_date: string; principal: number; term_months: number; method: string; method_label: string; annual_rate: number;
  installment: number; total_interest: number; total_payable: number; first_due_date: string; purpose?: string; paid_via?: string; late_fee?: number;
  schedule: Array<{ no: number; due_date: string; principal: number; interest: number; total: number }>;
  borrower: { name: string; name_bn?: string | null; code?: string; nid?: string; phone?: string };
  guarantor: { type: 'member' | 'outsider' | 'legacy'; name: string; name_bn?: string | null; code?: string; address?: string; nid?: string; phone?: string; relation?: string };
}

/**
 * The standard consent paper for a personal loan: loan terms, full repayment schedule, guarantor details, the conditions the borrower and guarantor accept,
 * and signature boxes for borrower, guarantor, a witness and the fund. Printed, signed, scanned and uploaded before the loan is disbursed.
 */
export function buildConsentPaperHtml(v: ConsentPaperData, op: Operator): string {
  const bn = v.lang === 'bn';
  const T = (en: string, b: string) => (bn ? b : en);
  const money = (n: number) => { const x = Math.round((Number(n) || 0) * 100) / 100; const whole = Math.abs(x - Math.round(x)) < 0.005; return `${esc(v.currency)} ${x.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`; };
  const row = (k: string, val: unknown) => `<tr><td class="k">${esc(k)}</td><td class="${isBlank(val) ? 'na' : ''}">${isBlank(val) ? '<span class="blank" style="width:260px"></span>' : esc(val)}</td></tr>`;
  const g = v.guarantor, b = v.borrower;
  const gName = [g.name, g.name_bn].filter(x => !isBlank(x)).join(' / ');
  const bName = [b.name, b.name_bn].filter(x => !isBlank(x)).join(' / ');
  const rate = v.method === 'free' ? T('interest-free (no interest)', 'সুদমুক্ত (কোনো সুদ নেই)') : `${v.annual_rate}% ${T('a year', 'বার্ষিক')}, ${v.method_label}`;
  const refLabel = v.ref_is_draft ? T('Application no.', 'আবেদন নং') : T('Loan no.', 'ঋণ নং');
  const sched = v.schedule.map(r => `<tr><td class="c">${r.no}</td><td>${esc(fmtDate(r.due_date))}</td><td class="n">${money(r.principal)}</td><td class="n">${money(r.interest)}</td><td class="n"><b>${money(r.total)}</b></td></tr>`).join('');
  const late = Number(v.late_fee) > 0 ? T(`A late payment penalty of ${money(Number(v.late_fee))} may be charged for each installment paid after its due date.`, `নির্ধারিত তারিখের পরে জমা দেওয়া প্রতিটি কিস্তির জন্য ${money(Number(v.late_fee))} জরিমানা ধার্য হতে পারে।`)
    : T('Any late payment penalty will be as set by the Fund and told to the borrower.', 'দেরিতে পরিশোধের জরিমানা (যদি থাকে) ফান্ডের নিয়ম অনুযায়ী হবে এবং ঋণগ্রহীতাকে জানানো হবে।');
  const clauses = bn ? [
    `ফান্ড উপরে উল্লিখিত শর্তে ঋণগ্রহীতাকে ঋণ দেবে। এই কাগজে ঋণগ্রহীতা ও জামিনদারের স্বাক্ষর ফান্ডের কাছে জমা না পড়া পর্যন্ত কোনো টাকা বিতরণ করা হবে না।`,
    `ঋণগ্রহীতা প্রতিটি কিস্তি উপরের সূচি অনুযায়ী নির্ধারিত তারিখে বা তার আগে নগদ, ব্যাংক বা মোবাইল মাধ্যমে পরিশোধ করবেন; প্রতিটি জমার জন্য রসিদ দেওয়া হবে।`,
    `সুদের হিসাব উপরের পদ্ধতি অনুযায়ী হবে; এখানে উল্লিখিত ছাড়া কোনো লুকানো চার্জ নেই। ${late}`,
    `ঋণগ্রহীতা চাইলে যেকোনো সময় আগেই ঋণ শোধ করতে পারবেন; তখন বাকি আসল এবং সেই তারিখ পর্যন্ত সুদ দিতে হবে।`,
    `ঋণগ্রহীতা কিস্তি পরিশোধে ব্যর্থ হলে ফান্ড বকেয়া টাকা ঋণগ্রহীতার ফান্ডে থাকা সঞ্চয়/পাওনা থেকে সমন্বয় করতে পারবে এবং না কুলালে চাহিবামাত্র বাকি অর্থ জামিনদার পরিশোধ করতে বাধ্য থাকবেন।`,
    `আদায় অসম্ভব হলে ফান্ড হিসাবে ঋণটি অবলোপন (write-off) করতে পারে; এতে ঋণগ্রহীতা ও জামিনদারের দায় বাতিল হয় না।`,
    `ঋণগ্রহীতা ও জামিনদার নিশ্চিত করছেন যে এই কাগজে দেওয়া সব তথ্য সত্য এবং তারা স্বেচ্ছায়, সম্পূর্ণ বুঝে স্বাক্ষর করছেন।`,
  ] : [
    `The Fund lends the amount above to the borrower on the terms stated here. No money is disbursed until this paper, signed by the borrower and the guarantor, has been received by the Fund.`,
    `The borrower will pay each installment on or before its due date in the schedule above (cash, bank or mobile payment). A receipt is issued for every payment.`,
    `Interest is calculated by the method stated above; there are no hidden charges beyond those written here. ${late}`,
    `The borrower may repay the loan early at any time by paying the outstanding principal plus interest up to that date.`,
    `If the borrower fails to pay installments, the Fund may adjust the overdue amount against the borrower's savings and dues held by the Fund, and the guarantor agrees to pay any unpaid balance to the Fund on demand.`,
    `If recovery is not possible the Fund may write the loan off in its books; this does not cancel the liability of the borrower or the guarantor.`,
    `The borrower and the guarantor confirm that everything written on this paper is true and that they sign willingly and after understanding it.`,
  ];
  const sig = (cap: string, name: string, sub: string) => `<div class="sig2"><div class="line"></div><div class="cap">${esc(cap)}</div><div class="nm">${name ? `<b>${esc(name)}</b>` : '&nbsp;'}</div><div class="rl">${esc(sub)}</div></div>`;
  const dateLine = `${T('Date', 'তারিখ')}: ____ / ____ / ______`;
  const inner = `<div class="page" style="max-width:176mm;margin:0 auto">
    <div class="band"><div><div class="org">${esc(v.orgName)}</div><div class="doc">${T('Loan consent &amp; guarantee paper', 'ঋণ গ্রহণ ও জামিন সম্মতিপত্র')}</div></div>
      <div class="gen">${esc(refLabel)} <b>${esc(v.ref_no)}</b><br/>${esc(L(v.lang, 'generated'))}: ${esc(fmtDate(v.generatedOn))}</div></div>
    <h3 class="st">${T('1. Loan details', '১. ঋণের বিবরণ')}</h3>
    <table class="vt">
      ${row(T('Borrower', 'ঋণগ্রহীতা'), `${bName}${b.code ? ` (${b.code})` : ''}`)}${row(T('Borrower NID', 'ঋণগ্রহীতার এনআইডি'), b.nid)}${row(T('Borrower phone', 'ঋণগ্রহীতার ফোন'), b.phone)}
      ${row(T('Loan amount', 'ঋণের পরিমাণ'), money(v.principal))}${row(T('Purpose', 'উদ্দেশ্য'), v.purpose)}
      ${row(T('Interest', 'সুদ'), rate)}${row(T('Repayment period', 'পরিশোধের মেয়াদ'), `${v.term_months} ${T('months', 'মাস')}`)}
      ${row(T('Monthly installment', 'মাসিক কিস্তি'), money(v.installment))}${row(T('First installment due', 'প্রথম কিস্তির তারিখ'), fmtDate(v.first_due_date))}
      ${row(T('Total interest', 'মোট সুদ'), money(v.total_interest))}${row(T('Total to repay', 'মোট পরিশোধযোগ্য'), money(v.total_payable))}
      ${row(T('Money paid out by', 'টাকা দেওয়া হবে'), v.paid_via)}
    </table>
    <h3 class="st">${T('2. Repayment schedule', '২. পরিশোধের সূচি')}</h3>
    <table><thead><tr><th class="c">#</th><th>${T('Due date', 'তারিখ')}</th><th class="n">${T('Principal', 'আসল')}</th><th class="n">${T('Interest', 'সুদ')}</th><th class="n">${T('Installment', 'কিস্তি')}</th></tr></thead>
      <tbody>${sched}</tbody><tfoot><tr><td colspan="2">${T('Total', 'মোট')}</td><td class="n">${money(v.principal)}</td><td class="n">${money(v.total_interest)}</td><td class="n">${money(v.total_payable)}</td></tr></tfoot></table>
    <div style="page-break-before:always"></div>
    <h3 class="st">${T('3. Guarantor details', '৩. জামিনদারের বিবরণ')}</h3>
    <table class="vt">
      ${row(T('Guarantor type', 'জামিনদারের ধরন'), g.type === 'member' ? T('Fund member', 'ফান্ডের সদস্য') : g.type === 'outsider' ? T('Outside person (not a member)', 'বাইরের ব্যক্তি (সদস্য নন)') : '')}
      ${row(T('Full name', 'পূর্ণ নাম'), gName)}${g.type === 'member' ? row(T('Member code', 'সদস্য কোড'), g.code) : ''}
      ${row(T('Full address', 'পূর্ণ ঠিকানা'), g.address)}${row(T('National ID (NID)', 'জাতীয় পরিচয়পত্র নং'), g.nid)}
      ${row(T('Phone', 'ফোন'), g.phone)}${row(T('Relationship to borrower', 'ঋণগ্রহীতার সাথে সম্পর্ক'), g.relation)}
    </table>
    <h3 class="st">${T('4. Conditions accepted by the borrower and the guarantor', '৪. ঋণগ্রহীতা ও জামিনদারের গৃহীত শর্তাবলী')}</h3>
    <ol class="cl">${clauses.map(c => `<li>${c}</li>`).join('')}</ol>
    <h3 class="st">${T('5. Consent', '৫. সম্মতি')}</h3>
    <p style="line-height:1.7;margin:4px 2px 0">${bn
      ? `আমি, <b>${esc(b.name)}</b>, উপরের শর্তে ${money(v.principal)} ঋণ গ্রহণে সম্মত এবং নির্ধারিত সূচি অনুযায়ী পরিশোধ করব। আমি, <b>${esc(g.name || '__________')}</b>${g.nid ? `, জাতীয় পরিচয়পত্র নং <b>${esc(g.nid)}</b>` : ''}, এই ঋণের জামিনদার হলাম এবং উপরের শর্ত মেনে নিলাম।`
      : `I, <b>${esc(b.name)}</b>, agree to take the loan of ${money(v.principal)} on the conditions above and to repay it as scheduled. I, <b>${esc(g.name || '__________')}</b>${g.nid ? `, National ID <b>${esc(g.nid)}</b>` : ''}, stand guarantor for this loan and accept the conditions above.`}</p>
    <div class="sign4">
      ${sig(T('Borrower signature', 'ঋণগ্রহীতার স্বাক্ষর'), b.name, `${b.code || ''}   ${dateLine}`)}
      ${sig(T('Guarantor signature', 'জামিনদারের স্বাক্ষর'), g.name, `${T('NID', 'এনআইডি')}: ${g.nid || '________________'}   ${dateLine}`)}
      ${sig(T('Witness (name, NID, signature)', 'সাক্ষী (নাম, এনআইডি, স্বাক্ষর)'), '', dateLine)}
      ${sig(T('Authorized by (Fund)', 'অনুমোদনকারী (ফান্ড)'), op.name, op.role || '')}
    </div></div>
    <style>.vt td{padding:5px 9px}.vt td.k{width:36%;color:#475569;font-weight:700;background:#f8fafc}.vt{page-break-inside:avoid}
      ol.cl{margin:6px 2px 0 18px;padding:0;line-height:1.6}ol.cl li{margin-bottom:3px;padding-left:2px}
      .sign4{display:grid;grid-template-columns:1fr 1fr;gap:20px 26px;margin-top:20mm;page-break-inside:avoid}.sig2 .line{border-top:1.3px solid #111827;margin-bottom:6px;height:0}
      .sig2 .cap{font-weight:800;font-size:10.5px}.sig2 .nm{margin-top:4px}.sig2 .rl{color:#4b5563;font-size:9px;margin-top:2px}</style>`;
  return pageHtml(inner, false, 'Loan consent paper');
}
