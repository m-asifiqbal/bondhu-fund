/** Member statements: Excel workbook and print-quality PDF (HTML) builders, on top of the shared export engine. */
import ExcelJS from 'exceljs';
import { NA, L, esc, fmtDate, fontFor, isBlank, dateCell, signatureHtml, pageHtml, styleHeaderRow, addTitleBlock, addSignatureRows, pageSetup, type Operator, type Lang } from './exporter';

export interface StatementRow {
  payment_month: string; due_date: string; monthly_due: number; status: string;
  payment_date?: string | null; payment_method?: string | null; trx_id?: string | null;
  contribution_amount?: number | null; late_fee?: number | null; total_amount?: number | null; note?: string | null;
}
export interface Statement {
  member: { id: number; member_code: string; name: string; name_bn?: string | null; nid?: string | null; phone?: string; status: string; join_date: string; monthly_due: number; opening_balance: number; designation?: string };
  rows: StatementRow[];                         // oldest first
  totals: { opening: number; contributions: number; lateFees: number; received: number; paidMonths: number; overdueMonths: number; overdueAmount: number; pendingMonths: number };
  settlement: null | { settlement_date: string; principal: number; profit_share: number; total_paid: number; payment_method: string; trx_id?: string | null; note?: string | null };
}
export interface StatementsData { orgName: string; currency: string; generatedOn: string; statements: Statement[] }

const BRAND = 'FF0F6B50';
const money = (n: unknown) => Number(n) || 0;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (mk: string) => { const [y, m] = String(mk).split('-').map(Number); return y ? `${MONTHS[m - 1]} ${y}` : NA; };
const text = (v: unknown) => (isBlank(v) ? NA : String(v));
const memberLabel = (m: Statement['member']) => `${m.name}${m.name_bn ? ` (${m.name_bn})` : ''}`;

// ---------------------------------------------------------------- Excel
function setText(ws: ExcelJS.Worksheet, r: number, c: number, v: unknown, bold = false) {
  const cell = ws.getCell(r, c); const t = text(v);
  cell.value = t; cell.font = { name: fontFor(t), bold, color: t === NA ? { argb: 'FF94A3B8' } : undefined };
  return cell;
}

export async function buildStatementsXlsx(d: StatementsData, op: Operator, lang: Lang = 'en'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = op.name || d.orgName;
  const single = d.statements.length === 1;

  if (single) {
    const st = d.statements[0], m = st.member;
    const ws = wb.addWorksheet('Statement', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 7 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }];
    let r = addTitleBlock(ws, { orgName: d.orgName, title: lang === 'bn' ? 'সদস্য স্টেটমেন্ট' : 'Member statement', generatedOn: d.generatedOn, lang,
      meta: [], subtitle: `${memberLabel(m)} · ${m.member_code}` }, op, 10);
    const info: Array<[string, any, boolean?]> = [
      ['Member', memberLabel(m)], ['Code', m.member_code], ['National ID (NID)', m.nid], ['Status', m.status], ['Joined', fmtDate(m.join_date)], ['Monthly due', money(m.monthly_due)], ['Designation', m.designation],
      ['Opening balance', money(st.totals.opening)], ['Contributions paid', money(st.totals.contributions)], ['Total contributed', money(st.totals.opening) + money(st.totals.contributions)],
      ['Late fees paid', money(st.totals.lateFees)], ['Overdue months', st.totals.overdueMonths], ['Overdue amount', money(st.totals.overdueAmount)],
    ];
    if (st.settlement) info.push(['Settled on', fmtDate(st.settlement.settlement_date)], ['Paid out', money(st.settlement.total_paid)], ['Paid through', st.settlement.payment_method]);
    info.forEach(([k, v], i) => {
      const row = r + Math.floor(i / 3), col = (i % 3) * 3 + 1;
      ws.getCell(row, col).value = k; ws.getCell(row, col).font = { bold: true, color: { argb: 'FF475569' }, name: 'Segoe UI' };
      ws.mergeCells(row, col + 1, row, col + 2);
      const c = setText(ws, row, col + 1, v, true); if (typeof v === 'number') c.numFmt = '#,##0';
    });
    r += Math.ceil(info.length / 3) + 1;
    const hr = ws.getRow(r);
    hr.values = ['No.', 'Month', 'Due date', 'Paid on', 'Method', 'Reference', 'Contribution', 'Late fee', 'Total', 'Status'];
    styleHeaderRow(hr);
    const headerRow = r++;
    st.rows.forEach((x, idx) => {
      const paid = x.status === 'Paid';
      const row = ws.getRow(r++);
      const put = (c: number, v: any, fmt?: string, align?: 'center' | 'right') => {
        const cell = row.getCell(c);
        if (isBlank(v)) { cell.value = NA; cell.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI' }; cell.alignment = { horizontal: 'center' }; }
        else { cell.value = v; cell.font = { name: fontFor(v) }; if (fmt) cell.numFmt = fmt; if (align) cell.alignment = { horizontal: align }; }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
        if (idx % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      };
      put(1, idx + 1, undefined, 'center'); put(2, fmtMonth(x.payment_month)); put(3, dateCell(x.due_date), 'dd/mm/yyyy', 'center');
      put(4, paid ? dateCell(x.payment_date) : null, 'dd/mm/yyyy', 'center'); put(5, paid ? x.payment_method : null); put(6, paid ? x.trx_id : null);
      put(7, paid ? money(x.contribution_amount) : null, '#,##0', 'right'); put(8, paid ? money(x.late_fee) : null, '#,##0', 'right'); put(9, paid ? money(x.total_amount) : null, '#,##0', 'right');
      put(10, x.status, undefined, 'center');
      row.getCell(10).font = { bold: true, name: 'Segoe UI', color: { argb: paid ? 'FF047857' : x.status === 'Overdue' ? 'FFBE123C' : 'FFB45309' } };
    });
    const tot = ws.getRow(r++);
    const vals: any[] = ['', 'Total', '', '', '', '', money(st.totals.contributions), money(st.totals.lateFees), money(st.totals.received), ''];
    vals.forEach((v, i) => { const c = tot.getCell(i + 1); c.value = v === '' ? null : v; c.font = { bold: true, name: 'Segoe UI' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; c.border = { top: { style: 'medium', color: { argb: BRAND } } }; if (typeof v === 'number') { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; } });
    if (st.settlement && st.settlement.note) { r++; ws.mergeCells(r, 1, r, 10); setText(ws, r, 1, `Settlement note: ${st.settlement.note}`); r++; }
    addSignatureRows(ws, r, 10, op, memberLabel(m), lang);
    ws.views = [{ showGridLines: false, state: 'frozen', ySplit: headerRow }];
    pageSetup(ws, true, headerRow);
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  // ---- all members: summary sheet + every statement line in one flat sheet
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  const cols = ['Member Code', 'Name', 'Name (Bangla)', 'NID', 'Status', 'Joined', 'Monthly due', 'Opening balance', 'Contributions paid', 'Total contributed', 'Late fees paid', 'Paid months', 'Overdue months', 'Overdue amount', 'Settled on', 'Paid out'];
  const widths = [13, 26, 22, 20, 10, 13, 12, 14, 16, 16, 13, 11, 13, 14, 13, 13];
  widths.forEach((w, i) => { sum.getColumn(i + 1).width = w; });
  let r = addTitleBlock(sum, { orgName: d.orgName, title: lang === 'bn' ? 'সব সদস্যের স্টেটমেন্ট — সারসংক্ষেপ' : 'All member statements — summary', generatedOn: d.generatedOn, lang, meta: [['Members', String(d.statements.length)]] }, op, cols.length);
  const sh = sum.getRow(r); cols.forEach((c, i) => { sh.getCell(i + 1).value = c; }); styleHeaderRow(sh);
  const sumHeader = r++;
  const money0 = new Set([5, 6, 7, 8, 9, 12, 14]); // 1-based columns that hold money
  d.statements.forEach((st, idx) => {
    const m = st.member; const row = sum.getRow(r++);
    const vals: any[] = [m.member_code, m.name, m.name_bn, m.nid, m.status, dateCell(m.join_date), money(m.monthly_due), money(st.totals.opening), money(st.totals.contributions), money(st.totals.opening) + money(st.totals.contributions), money(st.totals.lateFees), st.totals.paidMonths, st.totals.overdueMonths, money(st.totals.overdueAmount), st.settlement ? dateCell(st.settlement.settlement_date) : null, st.settlement ? money(st.settlement.total_paid) : null];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      if (isBlank(v)) { c.value = NA; c.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI' }; c.alignment = { horizontal: 'center' }; }
      else { c.value = v; c.font = { name: fontFor(v) }; if (v instanceof Date) { c.numFmt = 'dd/mm/yyyy'; c.alignment = { horizontal: 'center' }; } else if (typeof v === 'number') { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; } }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
      if (idx % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  });
  const trow = sum.getRow(r++);
  const sumOf = (f: (s: Statement) => number) => d.statements.reduce((a, s) => a + f(s), 0);
  const totals: Record<number, number> = { 8: sumOf(s => money(s.totals.opening)), 9: sumOf(s => money(s.totals.contributions)), 10: sumOf(s => money(s.totals.opening) + money(s.totals.contributions)), 11: sumOf(s => money(s.totals.lateFees)), 14: sumOf(s => money(s.totals.overdueAmount)), 16: sumOf(s => (s.settlement ? money(s.settlement.total_paid) : 0)) };
  for (let c = 1; c <= cols.length; c++) { const cell = trow.getCell(c); if (c === 1) cell.value = 'Total'; if (totals[c] !== undefined) { cell.value = totals[c]; cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; } cell.font = { bold: true, name: 'Segoe UI' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; cell.border = { top: { style: 'medium', color: { argb: BRAND } } }; }
  void money0;
  addSignatureRows(sum, r + 1, cols.length, op, undefined, lang);
  sum.views = [{ showGridLines: false, state: 'frozen', ySplit: sumHeader, xSplit: 2 }];
  pageSetup(sum, true, sumHeader);

  const all = wb.addWorksheet('All statements', { views: [{ showGridLines: false }] });
  const acols = ['No.', 'Member Code', 'Name', 'Month', 'Due date', 'Paid on', 'Method', 'Reference', 'Contribution', 'Late fee', 'Total', 'Status'];
  [6, 13, 26, 11, 13, 13, 15, 16, 13, 10, 12, 10].forEach((w, i) => { all.getColumn(i + 1).width = w; });
  let ar = addTitleBlock(all, { orgName: d.orgName, title: lang === 'bn' ? 'সব স্টেটমেন্টের লাইন' : 'All statement lines', generatedOn: d.generatedOn, lang }, op, acols.length);
  const ah = all.getRow(ar); acols.forEach((c, i) => { ah.getCell(i + 1).value = c; }); styleHeaderRow(ah);
  const allHeader = ar++;
  let n = 0;
  for (const st of d.statements) for (const x of st.rows) {
    const paid = x.status === 'Paid'; const row = all.getRow(ar++); n++;
    const vals: any[] = [n, st.member.member_code, st.member.name, fmtMonth(x.payment_month), dateCell(x.due_date), paid ? dateCell(x.payment_date) : null, paid ? x.payment_method : null, paid ? x.trx_id : null, paid ? money(x.contribution_amount) : null, paid ? money(x.late_fee) : null, paid ? money(x.total_amount) : null, x.status];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      if (isBlank(v)) { c.value = NA; c.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI' }; c.alignment = { horizontal: 'center' }; }
      else { c.value = v; c.font = { name: fontFor(v) }; if (v instanceof Date) { c.numFmt = 'dd/mm/yyyy'; c.alignment = { horizontal: 'center' }; } else if (typeof v === 'number') { c.numFmt = '#,##0'; c.alignment = { horizontal: i === 0 ? 'center' : 'right' }; } }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
      if (n % 2 === 0) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  }
  all.autoFilter = { from: { row: allHeader, column: 1 }, to: { row: allHeader, column: acols.length } };
  addSignatureRows(all, ar + 1, acols.length, op, undefined, lang);
  all.views = [{ showGridLines: false, state: 'frozen', ySplit: allHeader, xSplit: 3 }];
  pageSetup(all, true, allHeader);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------- PDF (HTML)
const num = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('en-US');

export function buildStatementsHtml(d: StatementsData, op: Operator, lang: Lang = 'en'): string {
  const cur = d.currency || 'TK';
  const sections = d.statements.map((st, idx) => {
    const m = st.member, t = st.totals;
    const cell = (v: unknown, numeric = false) => { const x = isBlank(v) ? NA : String(v); return `<td class="${numeric ? 'n ' : ''}${x === NA ? 'na' : ''}">${esc(x)}</td>`; };
    const rows = st.rows.map((r, i) => {
      const paid = r.status === 'Paid';
      return `<tr><td class="c na">${i + 1}</td><td>${esc(fmtMonth(r.payment_month))}</td>${cell(fmtDate(r.due_date))}${cell(paid ? fmtDate(r.payment_date) : null)}
        ${cell(paid ? r.payment_method : null)}${cell(paid ? r.trx_id : null)}${cell(paid ? num(r.contribution_amount) : null, true)}${cell(paid ? num(r.late_fee) : null, true)}${cell(paid ? num(r.total_amount) : null, true)}
        <td><span class="pill ${r.status.toLowerCase()}">${esc(r.status)}</span></td></tr>`;
    }).join('');
    const settle = st.settlement ? `<div class="note"><b>Settled on ${esc(fmtDate(st.settlement.settlement_date))}</b> · paid out ${cur} ${num(st.settlement.total_paid)}
        (own money ${num(st.settlement.principal)} + benefit share ${num(st.settlement.profit_share)}) via ${esc(text(st.settlement.payment_method))} · ref ${esc(text(st.settlement.trx_id))}</div>` : '';
    return `<div class="page ${idx < d.statements.length - 1 ? 'brk' : ''}">
      <div class="band"><div><div class="org">${esc(d.orgName)}</div><div class="doc">${lang === 'bn' ? 'সদস্য স্টেটমেন্ট' : 'Member statement'}</div></div>
        <div class="gen">${esc(L(lang, 'generated'))}: ${esc(fmtDate(d.generatedOn))}<br/>${esc(L(lang, 'by'))}: ${esc(op.name || NA)}</div></div>
      <div style="margin:14px 0 4px"><div class="mname">${esc(m.name)}${m.name_bn ? ` <span>${esc(m.name_bn)}</span>` : ''}</div>
        <div class="meta"><span>${esc(m.member_code)}</span><span>NID <b class="${isBlank(m.nid) ? 'na' : ''}">${esc(text(m.nid))}</b></span><span>${esc(m.status)}</span><span>Joined <b>${esc(fmtDate(m.join_date))}</b></span><span>Monthly due <b>${cur} ${num(m.monthly_due)}</b></span><span>Phone <b class="${isBlank(m.phone) ? 'na' : ''}">${esc(text(m.phone))}</b></span></div></div>
      <div class="cards">
        <div><span>Opening balance</span><b>${cur} ${num(t.opening)}</b></div><div><span>Contributions paid</span><b>${cur} ${num(t.contributions)}</b></div>
        <div><span>Total contributed</span><b>${cur} ${num(t.opening + t.contributions)}</b></div><div><span>Late fees paid</span><b>${cur} ${num(t.lateFees)}</b></div>
        <div><span>Overdue</span><b>${t.overdueMonths} mo · ${cur} ${num(t.overdueAmount)}</b></div></div>
      ${settle}
      <table><thead><tr><th class="c">No.</th><th>Month</th><th>Due date</th><th>Paid on</th><th>Method</th><th>Reference</th><th class="n">Contribution</th><th class="n">Late fee</th><th class="n">Total</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10" class="empty">${esc(NA)}</td></tr>`}</tbody>
        <tfoot><tr><td colspan="6">${esc(L(lang, 'total'))}</td><td class="n">${num(t.contributions)}</td><td class="n">${num(t.lateFees)}</td><td class="n">${num(t.received)}</td><td></td></tr></tfoot></table>
      <div class="grow"></div>${signatureHtml(op, memberLabel(m), lang)}</div>`;
  }).join('');
  return pageHtml(sections, true, 'Member statements');
}
