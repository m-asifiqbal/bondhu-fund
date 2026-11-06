/** Member statements: Excel workbook and print-quality PDF (HTML) builders. Pure functions — no database or window access. */
import ExcelJS from 'exceljs';

export interface StatementRow {
  payment_month: string; due_date: string; monthly_due: number; status: string;
  payment_date?: string | null; payment_method?: string | null; trx_id?: string | null;
  contribution_amount?: number | null; late_fee?: number | null; total_amount?: number | null; note?: string | null;
}
export interface Statement {
  member: { id: number; member_code: string; name: string; name_bn?: string | null; phone?: string; status: string; join_date: string; monthly_due: number; opening_balance: number; designation?: string };
  rows: StatementRow[];                         // oldest first
  totals: { opening: number; contributions: number; lateFees: number; received: number; paidMonths: number; overdueMonths: number; overdueAmount: number; pendingMonths: number };
  settlement: null | { settlement_date: string; principal: number; profit_share: number; total_paid: number; payment_method: string; trx_id?: string | null; note?: string | null };
}
export interface StatementsData { orgName: string; currency: string; generatedOn: string; statements: Statement[] }

const BRAND = 'FF0F6B50';
const money = (n: unknown) => Number(n) || 0;
const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y) return String(iso);
  return `${String(d).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
const fmtMonth = (mk: string) => {
  const [y, m] = mk.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
const dateCell = (iso?: string | null) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, d)) : null;
};

// ---------------------------------------------------------------- Excel
function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

export async function buildStatementsXlsx(d: StatementsData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.orgName;
  const single = d.statements.length === 1;

  if (single) {
    const st = d.statements[0], m = st.member;
    const ws = wb.addWorksheet('Statement', { views: [{ state: 'frozen', ySplit: 9 }] });
    ws.columns = [{ width: 17 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }];
    ws.mergeCells('A1:J1'); ws.getCell('A1').value = `${d.orgName} — Member statement`; ws.getCell('A1').font = { bold: true, size: 15, color: { argb: BRAND } };
    ws.getCell('A2').value = 'Member'; ws.getCell('B2').value = `${m.name}${m.name_bn ? ` (${m.name_bn})` : ''}`;
    ws.getCell('F2').value = 'Code'; ws.getCell('G2').value = m.member_code;
    ws.getCell('A3').value = 'Status'; ws.getCell('B3').value = m.status;
    ws.getCell('F3').value = 'Joined'; ws.getCell('G3').value = dateCell(m.join_date); ws.getCell('G3').numFmt = 'dd/mm/yyyy';
    ws.getCell('A4').value = 'Monthly due'; ws.getCell('B4').value = money(m.monthly_due);
    ws.getCell('F4').value = 'Generated'; ws.getCell('G4').value = dateCell(d.generatedOn); ws.getCell('G4').numFmt = 'dd/mm/yyyy';
    ws.getCell('A5').value = 'Opening balance'; ws.getCell('B5').value = money(st.totals.opening);
    ws.getCell('D5').value = 'Contributions paid'; ws.getCell('E5').value = money(st.totals.contributions);
    ws.getCell('F5').value = 'Late fees paid'; ws.getCell('G5').value = money(st.totals.lateFees);
    ws.getCell('A6').value = 'Total contributed'; ws.getCell('B6').value = money(st.totals.opening) + money(st.totals.contributions);
    ws.getCell('D6').value = 'Overdue months'; ws.getCell('E6').value = st.totals.overdueMonths;
    ws.getCell('F6').value = 'Overdue amount'; ws.getCell('G6').value = money(st.totals.overdueAmount);
    if (st.settlement) {
      ws.getCell('A7').value = 'Settled'; ws.getCell('B7').value = dateCell(st.settlement.settlement_date); ws.getCell('B7').numFmt = 'dd/mm/yyyy';
      ws.getCell('D7').value = 'Paid out'; ws.getCell('E7').value = money(st.settlement.total_paid);
      ws.getCell('F7').value = `via ${st.settlement.payment_method}`;
    }
    for (const a of ['A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'D5', 'D6', 'D7', 'F2', 'F3', 'F4', 'F5', 'F6']) ws.getCell(a).font = { bold: true, color: { argb: 'FF475569' } };
    const hr = ws.getRow(9);
    hr.values = ['No.', 'Month', 'Due date', 'Paid on', 'Method', 'Reference', 'Contribution', 'Late fee', 'Total', 'Status'];
    styleHeader(hr);
    st.rows.forEach((r, idx) => {
      const row = ws.addRow([idx + 1, fmtMonth(r.payment_month), dateCell(r.due_date), dateCell(r.payment_date), r.payment_method || '', r.trx_id || '',
        r.status === 'Paid' ? money(r.contribution_amount) : null, r.status === 'Paid' ? money(r.late_fee) : null, r.status === 'Paid' ? money(r.total_amount) : null, r.status]);
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(3).numFmt = row.getCell(4).numFmt = 'dd/mm/yyyy';
      [7, 8, 9].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
      const c = row.getCell(10);
      c.font = { bold: true, color: { argb: r.status === 'Paid' ? 'FF047857' : r.status === 'Overdue' ? 'FFBE123C' : 'FFB45309' } };
    });
    const tot = ws.addRow(['Total', '', '', '', '', '', money(st.totals.contributions), money(st.totals.lateFees), money(st.totals.received), '']);
    tot.font = { bold: true }; [7, 8, 9].forEach(i => { tot.getCell(i).numFmt = '#,##0'; });
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  // all members: one summary row per member + every statement line in one flat sheet (filterable)
  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  sum.columns = [
    { header: 'Member Code', key: 'code', width: 14 }, { header: 'Name', key: 'name', width: 26 }, { header: 'Name (Bangla)', key: 'bn', width: 22 },
    { header: 'Status', key: 'status', width: 11 }, { header: 'Joined', key: 'joined', width: 13 }, { header: 'Monthly due', key: 'due', width: 13 },
    { header: 'Opening balance', key: 'opening', width: 15 }, { header: 'Contributions paid', key: 'contrib', width: 17 }, { header: 'Total contributed', key: 'total', width: 17 },
    { header: 'Late fees paid', key: 'late', width: 14 }, { header: 'Paid months', key: 'pm', width: 12 }, { header: 'Overdue months', key: 'om', width: 14 },
    { header: 'Overdue amount', key: 'oa', width: 15 }, { header: 'Settled on', key: 'sd', width: 13 }, { header: 'Paid out', key: 'po', width: 13 },
  ];
  styleHeader(sum.getRow(1));
  for (const st of d.statements) {
    const m = st.member;
    const r = sum.addRow({ code: m.member_code, name: m.name, bn: m.name_bn || '', status: m.status, joined: dateCell(m.join_date), due: money(m.monthly_due),
      opening: money(st.totals.opening), contrib: money(st.totals.contributions), total: money(st.totals.opening) + money(st.totals.contributions), late: money(st.totals.lateFees),
      pm: st.totals.paidMonths, om: st.totals.overdueMonths, oa: money(st.totals.overdueAmount), sd: dateCell(st.settlement?.settlement_date), po: st.settlement ? money(st.settlement.total_paid) : null });
    r.getCell('joined').numFmt = r.getCell('sd').numFmt = 'dd/mm/yyyy';
    ['due', 'opening', 'contrib', 'total', 'late', 'oa', 'po'].forEach(k => { r.getCell(k).numFmt = '#,##0'; });
  }
  const t = sum.addRow({ code: 'Total', opening: d.statements.reduce((s, x) => s + money(x.totals.opening), 0), contrib: d.statements.reduce((s, x) => s + money(x.totals.contributions), 0),
    total: d.statements.reduce((s, x) => s + money(x.totals.opening) + money(x.totals.contributions), 0), late: d.statements.reduce((s, x) => s + money(x.totals.lateFees), 0),
    oa: d.statements.reduce((s, x) => s + money(x.totals.overdueAmount), 0) });
  t.font = { bold: true }; ['opening', 'contrib', 'total', 'late', 'oa'].forEach(k => { t.getCell(k).numFmt = '#,##0'; });

  const all = wb.addWorksheet('All statements', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  all.columns = [
    { header: 'Member Code', width: 14 }, { header: 'Name', width: 26 }, { header: 'Month', width: 11 }, { header: 'Due date', width: 13 }, { header: 'Paid on', width: 13 },
    { header: 'Method', width: 15 }, { header: 'Reference', width: 16 }, { header: 'Contribution', width: 13 }, { header: 'Late fee', width: 10 }, { header: 'Total', width: 12 }, { header: 'Status', width: 10 },
  ];
  styleHeader(all.getRow(1));
  for (const st of d.statements) for (const r of st.rows) {
    const row = all.addRow([st.member.member_code, st.member.name, fmtMonth(r.payment_month), dateCell(r.due_date), dateCell(r.payment_date), r.payment_method || '', r.trx_id || '',
      r.status === 'Paid' ? money(r.contribution_amount) : null, r.status === 'Paid' ? money(r.late_fee) : null, r.status === 'Paid' ? money(r.total_amount) : null, r.status]);
    row.getCell(4).numFmt = row.getCell(5).numFmt = 'dd/mm/yyyy';
    [8, 9, 10].forEach(i => { row.getCell(i).numFmt = '#,##0'; });
  }
  all.autoFilter = { from: 'A1', to: 'K1' };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------- PDF (HTML)
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('en-US');

export function buildStatementsHtml(d: StatementsData): string {
  const cur = d.currency || 'TK';
  const sections = d.statements.map((st, idx) => {
    const m = st.member, t = st.totals;
    const rows = st.rows.map((r, idx) => {
      const paid = r.status === 'Paid';
      return `<tr class="${r.status.toLowerCase()}"><td class="c">${idx + 1}</td><td>${esc(fmtMonth(r.payment_month))}</td><td>${esc(fmtDate(r.due_date))}</td><td>${paid ? esc(fmtDate(r.payment_date)) : '—'}</td>
        <td>${paid ? esc(r.payment_method || '') : ''}${paid && r.trx_id ? `<div class="sub">${esc(r.trx_id)}</div>` : ''}</td>
        <td class="n">${paid ? num(r.contribution_amount) : ''}</td><td class="n">${paid && money(r.late_fee) ? num(r.late_fee) : ''}</td><td class="n b">${paid ? num(r.total_amount) : ''}</td>
        <td><span class="pill ${r.status.toLowerCase()}">${esc(r.status)}</span></td></tr>`;
    }).join('');
    const settle = st.settlement ? `<div class="settle"><b>Settled on ${esc(fmtDate(st.settlement.settlement_date))}</b> · paid out ${cur} ${num(st.settlement.total_paid)}
        (own money ${num(st.settlement.principal)} + benefit share ${num(st.settlement.profit_share)}) via ${esc(st.settlement.payment_method)}${st.settlement.trx_id ? ` · ${esc(st.settlement.trx_id)}` : ''}</div>` : '';
    return `<section class="${idx < d.statements.length - 1 ? 'brk' : ''}">
      <header><div><div class="org">${esc(d.orgName)}</div><div class="doc">Member statement</div></div><div class="gen">Generated ${esc(fmtDate(d.generatedOn))}</div></header>
      <div class="who"><div><div class="name">${esc(m.name)}${m.name_bn ? ` <span class="bn">${esc(m.name_bn)}</span>` : ''}</div>
        <div class="meta">${esc(m.member_code)} · ${esc(m.status)} · Joined ${esc(fmtDate(m.join_date))} · Monthly due ${cur} ${num(m.monthly_due)}</div></div></div>
      <div class="cards">
        <div><span>Opening balance</span><b>${cur} ${num(t.opening)}</b></div><div><span>Contributions paid</span><b>${cur} ${num(t.contributions)}</b></div>
        <div><span>Total contributed</span><b class="g">${cur} ${num(t.opening + t.contributions)}</b></div><div><span>Late fees paid</span><b>${cur} ${num(t.lateFees)}</b></div>
        <div><span>Overdue</span><b class="${t.overdueMonths ? 'r' : ''}">${t.overdueMonths} mo · ${cur} ${num(t.overdueAmount)}</b></div></div>
      ${settle}
      <table><thead><tr><th class="c">No.</th><th>Month</th><th>Due date</th><th>Paid on</th><th>Method / ref</th><th class="n">Contribution</th><th class="n">Late fee</th><th class="n">Total</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty">No months due yet.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5">Total</td><td class="n">${num(t.contributions)}</td><td class="n">${num(t.lateFees)}</td><td class="n">${num(t.received)}</td><td></td></tr></tfoot></table>
    </section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Member statements</title><style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; } body { font-family: "Segoe UI", "Nirmala UI", Arial, sans-serif; color: #0f172a; font-size: 10.5px; margin: 0; }
    section.brk { page-break-after: always; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f6b50; padding-bottom: 8px; }
    .org { font-size: 16px; font-weight: 800; color: #0f6b50; } .doc { font-size: 11px; color: #475569; font-weight: 600; } .gen { color: #64748b; font-size: 10px; }
    .who { margin: 12px 0 8px; } .name { font-size: 17px; font-weight: 800; } .bn { font-weight: 600; color: #334155; } .meta { color: #475569; margin-top: 2px; }
    .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 10px 0; }
    .cards div { border: 1px solid #cbd5e1; border-radius: 7px; padding: 6px 8px; } .cards span { display: block; color: #64748b; font-size: 9px; } .cards b { font-size: 11.5px; } .g { color: #047857; } .r { color: #be123c; }
    .settle { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 7px; padding: 7px 10px; margin-bottom: 10px; color: #78350f; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
    th { background: #0f6b50; color: #fff; text-align: left; padding: 6px 7px; font-size: 9.5px; } td { padding: 5px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .c { text-align: center; color: #94a3b8; width: 26px; } .n { text-align: right; font-variant-numeric: tabular-nums; } .b { font-weight: 700; } .sub { color: #94a3b8; font-size: 9px; } .empty { text-align: center; color: #94a3b8; padding: 14px; }
    tfoot td { font-weight: 800; border-top: 2px solid #0f6b50; border-bottom: none; background: #f1f5f9; }
    .pill { padding: 1px 7px; border-radius: 99px; font-weight: 700; font-size: 9px; } .pill.paid { background: #d1fae5; color: #047857; } .pill.overdue { background: #ffe4e6; color: #be123c; } .pill.pending { background: #fef3c7; color: #b45309; }
  </style></head><body>${sections}</body></html>`;
}
