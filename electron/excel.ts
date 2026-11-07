/**
 * Excel import/export for members and their payment history (main process).
 *
 * Template workbook (BondhuFund_Member_Import_Template.xlsx):
 *   1. "Instructions"     – how to fill, in English and Bangla
 *   2. "Members"          – one row per member
 *   3. "Payment History"  – ledger grid: one row per member, one column per month (YYYY-MM),
 *                           cell = amount paid for that month (or P/✓ = paid in full)
 *
 * Rows whose Member Code starts with "EX-" are examples and are always ignored.
 */
import ExcelJS from 'exceljs';

export interface RawMember {
  row: number;
  code: string;
  name: string;
  name_bn: string;
  nid: string;
  phone: string;
  email: string;
  designation: string;
  status: string;
  monthly_due: number | null;
  join_date: string | null;
  opening_balance: number | null;
  notes: string;
  problems: string[];
}

export interface RawPayment {
  row: number;
  cell: string;
  code: string;
  nid: string;
  name: string;
  month: string;
  /** null = "paid in full" marker (P/✓/Paid) → monthly due */
  amount: number | null;
  problems: string[];
}

export interface ParsedWorkbook {
  members: RawMember[];
  payments: RawPayment[];
  examplesSkipped: number;
  sheetWarnings: string[];
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------
const BN_DIGITS: Record<string, string> = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
const ascii = (s: string) => s.replace(/[০-৯]/g, d => BN_DIGITS[d] || d);
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('formula' in o || 'sharedFormula' in o) return 'result' in o ? cellValue(o.result) : null;   // formula (empty if never calculated)
    if ('result' in o) return cellValue(o.result);
    if ('richText' in o) return o.richText.map((r: any) => r.text).join('');
    if ('text' in o) return o.text;                           // hyperlink
    if ('error' in o) return null;
  }
  if (typeof v === 'string' && /^\s*(n\/?a|-{1,2}|—)\s*$/i.test(v)) return null;   // exported blanks read back as empty
  return v;
}

function text(v: ExcelJS.CellValue): string {
  const x = cellValue(v);
  if (x === null) return '';
  if (x instanceof Date) return isoOf(utcToLocalDate(x));
  return String(x).trim();
}

/** A National ID cell. Excel keeps only 15 significant digits of a number, so a 16/17-digit NID typed into a General cell is already damaged. */
function nidCell(v: ExcelJS.CellValue, problems: string[]): string {
  const x = cellValue(v);
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x) || Math.abs(x) >= 1e15) {
      problems.push('NID was stored as a number, so Excel changed its last digits. Format the NID cells as Text (or type an apostrophe first) and enter it again.');
      return '';
    }
    return String(x);
  }
  return ascii(text(v));
}

/** ExcelJS returns dates as UTC midnight; convert to the calendar date the user typed. */
function utcToLocalDate(d: Date) {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function num(v: ExcelJS.CellValue): number | null {
  const x = cellValue(v);
  if (x === null || x === '') return null;
  if (typeof x === 'number') return isFinite(x) ? x : NaN;
  const s = ascii(String(x)).replace(/[,\s]|tk|taka|৳|bdt|টাকা/gi, '');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

/** Accepts Date cells, Excel serials, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, '05 Jun 2024', Bangla digits. */
export function parseDate(v: ExcelJS.CellValue): string | null | 'invalid' {
  const x = cellValue(v);
  if (x === null || x === '') return null;
  if (x instanceof Date) return isoOf(utcToLocalDate(x));
  if (typeof x === 'number') {                                 // Excel serial date
    if (x < 20000 || x > 80000) return 'invalid';
    return isoOf(utcToLocalDate(new Date(Math.round((x - 25569) * 864e5))));
  }
  const s = ascii(String(x).trim());
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);       // day first (Bangladesh)
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s,-]+(\d{4})$/);
  if (m) { const i = EN_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (i >= 0) return valid(+m[3], i + 1, +m[1]); }
  return 'invalid';
}

function valid(y: number, mo: number, d: number): string | 'invalid' {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || y < 1950 || y > 2100) return 'invalid';
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Month header: Date cell, 'YYYY-MM', 'MM/YYYY', 'Jan 2024', 'Jan-24', 'জানুয়ারি ২০২৪'. */
export function parseMonth(v: ExcelJS.CellValue): string | null {
  const x = cellValue(v);
  if (x === null || x === '') return null;
  if (x instanceof Date) { const d = utcToLocalDate(x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  if (typeof x === 'number' && x > 20000 && x < 80000) {
    const d = utcToLocalDate(new Date(Math.round((x - 25569) * 864e5)));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  let s = ascii(String(x).trim());
  for (let i = 0; i < 12; i++) if (s.includes(BN_MONTHS[i])) s = s.replace(BN_MONTHS[i], EN_MONTHS[i]);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^([A-Za-z]+)[\s,'-]+(\d{2}|\d{4})$/);
  if (m) {
    const i = EN_MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${pad(i + 1)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Header matching (English or Bangla, with or without "*")
// ---------------------------------------------------------------------------
const MEMBER_FIELDS: Array<[keyof RawMember, RegExp]> = [
  ['nid', /\bnid\b|national\s*id|জাতীয়\s*পরিচয়|এনআইডি/i],
  ['code', /member\s*(code|id)|^code$|সদস্য\s*(কোড|আইডি)/i],
  ['name_bn', /name\s*\(?\s*bangla|bangla\s*name|বাংলা(য়)?\s*নাম|নাম\s*\(বাংলা/i],
  ['name', /^\s*(full\s*)?name|^নাম|সদস্যের নাম/i],
  ['phone', /phone|mobile|মোবাইল|ফোন/i],
  ['email', /e-?mail|ইমেইল/i],
  ['designation', /designation|position|পদবি/i],
  ['status', /status|অবস্থা/i],
  ['monthly_due', /monthly\s*due|monthly\s*amount|due\s*amount|মাসিক\s*চাঁদা/i],
  ['join_date', /join|যোগদান/i],
  ['opening_balance', /opening|paid\s*before|previous\s*total|পূর্ববর্তী|আগের\s*মোট|প্রারম্ভিক/i],
  ['notes', /note|remarks|মন্তব্য|নোট/i],
];

function headerMap(row: ExcelJS.Row, fields: Array<[string, RegExp]>) {
  const map: Record<string, number> = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = text(cell.value).replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [key, re] of fields) {
      if (map[key] === undefined && re.test(h)) { map[key] = col; break; }
    }
  });
  return map;
}

function findSheet(wb: ExcelJS.Workbook, re: RegExp) {
  return wb.worksheets.find(ws => re.test(ws.name));
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    throw new Error('This file could not be read as an Excel workbook (.xlsx). If it is an old .xls file, open it in Excel and "Save As" .xlsx.');
  }
  const out: ParsedWorkbook = { members: [], payments: [], examplesSkipped: 0, sheetWarnings: [] };

  // ---- Members -----------------------------------------------------------------
  const ms = findSheet(wb, /member|সদস্য/i) || wb.worksheets.find(ws => !/instruction|নির্দেশ|payment|history|পেমেন্ট|ledger/i.test(ws.name));
  if (!ms) throw new Error('No "Members" sheet found. Please use the template.');
  const hdrRow = findHeaderRow(ms, MEMBER_FIELDS as any, ['name']);
  if (!hdrRow) throw new Error(`The "${ms.name}" sheet has no "Name" column header. Please use the template.`);
  const hm = headerMap(ms.getRow(hdrRow), MEMBER_FIELDS as any);

  for (let r = hdrRow + 1; r <= ms.rowCount; r++) {
    const row = ms.getRow(r);
    const get = (k: string) => (hm[k] ? row.getCell(hm[k]).value : null);
    const code = text(get('code'));
    const name = text(get('name'));
    if (!name && !code && !text(get('phone'))) continue;          // blank row
    if (/^EX-/i.test(code)) { out.examplesSkipped++; continue; }
    const problems: string[] = [];
    const nid = nidCell(get('nid') as ExcelJS.CellValue, problems);
    const due = num(get('monthly_due'));
    const ob = num(get('opening_balance'));
    const jd = parseDate(get('join_date'));
    if (Number.isNaN(due)) problems.push('Monthly due is not a number');
    if (Number.isNaN(ob)) problems.push('Opening balance is not a number');
    if (jd === 'invalid') problems.push('Join date is not a valid date (use DD/MM/YYYY)');
    out.members.push({
      row: r, code, name, name_bn: text(get('name_bn')), nid, phone: ascii(text(get('phone'))), email: text(get('email')),
      designation: text(get('designation')), status: text(get('status')),
      monthly_due: Number.isNaN(due) ? null : due, join_date: jd === 'invalid' ? null : jd,
      opening_balance: Number.isNaN(ob) ? null : ob, notes: text(get('notes')), problems,
    });
  }

  // ---- Payment history (optional) --------------------------------------------------
  const ps = findSheet(wb, /payment|history|ledger|collection|পেমেন্ট|আদায়/i);
  if (ps) {
    const PAY_FIELDS: Array<[string, RegExp]> = [['code', /member\s*(code|id)|^code$|সদস্য\s*(কোড|আইডি)/i], ['nid', /\bnid\b|national\s*id|জাতীয়\s*পরিচয়|এনআইডি/i], ['name', /^\s*(full\s*)?name|^নাম|সদস্যের নাম/i]];
    const pr = findHeaderRow(ps, PAY_FIELDS, ['code', 'name'], true);
    if (!pr) {
      out.sheetWarnings.push(`"${ps.name}" sheet: no "Member Code" or "Name" header found — payment history was not read.`);
    } else {
      const header = ps.getRow(pr);
      const pm = headerMap(header, PAY_FIELDS);
      const monthCols: Array<{ col: number; month: string }> = [];
      header.eachCell({ includeEmpty: false }, (cell, col) => {
        if (col === pm.code || col === pm.name || col === pm.nid) return;
        if (HELPER_HEADER.test(text(cell.value))) return;           // calculated helper columns (Total paid, Ready?)
        const mk = parseMonth(cell.value);
        if (mk) monthCols.push({ col, month: mk });
        else if (text(cell.value)) out.sheetWarnings.push(`"${ps.name}" column ${colLetter(col)} header "${text(cell.value)}" is not a month (use YYYY-MM) — ignored.`);
      });
      if (!monthCols.length) out.sheetWarnings.push(`"${ps.name}" sheet has no month columns (headers like 2024-01) — payment history was not read.`);
      for (let r = pr + 1; r <= ps.rowCount; r++) {
        const row = ps.getRow(r);
        const code = pm.code ? text(row.getCell(pm.code).value) : '';
        const name = pm.name ? text(row.getCell(pm.name).value) : '';
        const pnid = pm.nid ? ascii(text(row.getCell(pm.nid).value)) : '';
        if (!code && !name && !pnid) {
          // amounts typed on a row that says who they belong to nobody → say so instead of dropping them silently
          if (monthCols.some(({ col }) => text(row.getCell(col).value))) out.sheetWarnings.push(`"${ps.name}" row ${r} has amounts but no member name — it was not imported.`);
          continue;
        }
        if (/^EX-/i.test(code)) { out.examplesSkipped++; continue; }
        for (const { col, month } of monthCols) {
          const raw = row.getCell(col).value;
          const t = text(raw);
          if (!t) continue;
          const problems: string[] = [];
          let amount: number | null;
          if (/^(p|y|yes|paid|✓|✔|x|পরিশোধিত|হ্যাঁ)$/i.test(t)) amount = null;
          else {
            const n = num(raw);
            if (n === null) continue;
            if (Number.isNaN(n)) { problems.push(`"${t}" is not an amount`); amount = 0; }
            else if (n === 0) continue;                         // 0 = not paid
            else if (n < 0) { problems.push('Negative amount'); amount = n; }
            else amount = n;
          }
          out.payments.push({ row: r, cell: `${colLetter(col)}${r}`, code, nid: pnid, name, month, amount, problems });
        }
      }
    }
  }
  return out;
}

/** The header row is the one (within the first 15) that matches the most known columns — banners and hints above it can't win. */
function findHeaderRow(ws: ExcelJS.Worksheet, fields: Array<[string, RegExp]>, required: string[], anyOf = false): number | null {
  let best: number | null = null, bestScore = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const m = headerMap(ws.getRow(r), fields);
    const ok = anyOf ? required.some(k => m[k]) : required.every(k => m[k]);
    const score = Object.keys(m).length;
    if (ok && score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

const HELPER_HEADER = /^\s*(total|মোট|ready|প্রস্তুত|check|যাচাই)/i;

function colLetter(c: number) {
  let s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

// ---------------------------------------------------------------------------
// Workbook layout (template and export share it, so a file exported from the app can be corrected and imported back)
//
//   Start Here       – a one-page guide (English + Bangla)
//   Members          – banner, hint, legend, header on row 4, data from row 5
//   Payment History  – Name (pick from a list) · Code · NID · Total · one column per month
// ---------------------------------------------------------------------------
const BRAND = 'FF0F4A3C', BRAND_MID = 'FF1B7F5F', BRAND_LIGHT = 'FFE6F3EE', MINT = 'FFF1F8F4', AMBER = 'FFFFF1C2', AMBER_DEEP = 'FF8A5A00',
  GREY = 'FF64748B', GREY_LIGHT = 'FFEEF2F6', RED_LIGHT = 'FFFDE2E2', RED = 'FFB42318', WHITE = 'FFFFFFFF', INK = 'FF1F2937';
const FIRST_ROW = 5;            // first data row on Members and Payment History
const ROWS = 500;               // data rows prepared with formatting and checks
/** Last prepared row: 500 for the template, more when an export holds more members. */
const lastRowFor = (count: number) => Math.max(FIRST_ROW + ROWS - 1, FIRST_ROW + count + 99);
const MONTHS_SHOWN = 24;

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });
const bnFont = { name: 'Nirmala UI' };

/** Conditional formats need a unique priority each; they are numbered in the order they are added (first added wins a clash). */
const cfPriority = new WeakMap<ExcelJS.Worksheet, number>();
function addCF(ws: ExcelJS.Worksheet, def: { ref: string; rules: any[] }) {
  let p = cfPriority.get(ws) ?? 1;
  ws.addConditionalFormatting({ ref: def.ref, rules: def.rules.map(r => ({ ...r, priority: p++ })) });
  cfPriority.set(ws, p);
}

/** 10, 13 or 17 digits (Bangla digits, spaces and dashes are accepted by the importer too). */
function nidLooksValid(s: unknown): boolean {
  const v = ascii(String(s ?? '')).replace(/[\s-]/g, '');
  return /^\d+$/.test(v) && [10, 13, 17].includes(v.length);
}

function banner(ws: ExcelJS.Worksheet, lastCol: string, title: string, hint: string) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { size: 18, bold: true, color: { argb: WHITE } };
  t.fill = solid(BRAND);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 36;
  ws.mergeCells(`A2:${lastCol}2`);
  const h = ws.getCell('A2');
  h.value = hint;
  h.font = { size: 10.5, color: { argb: INK } };
  h.fill = solid(BRAND_LIGHT);
  h.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  ws.getRow(2).height = 34;
}

function legend(ws: ExcelJS.Worksheet, cells: Array<[string, string, string, string]>) {
  ws.getRow(3).height = 22;
  for (const [addr, label, fill, font] of cells) {
    const c = ws.getCell(addr);
    c.value = label;
    c.fill = solid(fill);
    c.font = { size: 10, bold: true, color: { argb: font } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = { top: thin('FFD0DAD5'), bottom: thin('FFD0DAD5'), left: thin('FFD0DAD5'), right: thin('FFD0DAD5') };
  }
}

function headerCell(c: ExcelJS.Cell, kind: 'required' | 'optional' | 'auto') {
  c.font = { bold: true, size: 11, color: { argb: kind === 'required' ? BRAND : kind === 'auto' ? GREY : WHITE } };
  c.fill = solid(kind === 'required' ? AMBER : kind === 'auto' ? GREY_LIGHT : BRAND_MID);
  c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  c.border = { top: thin(BRAND), bottom: { style: 'medium', color: { argb: BRAND } }, left: thin('FFFFFFFF'), right: thin('FFFFFFFF') };
}

const MEMBER_COLS: Array<{ key: string; header: string; width: number; kind: 'required' | 'optional' | 'auto' }> = [
  { key: 'code', header: 'Member Code\nসদস্য কোড', width: 15, kind: 'optional' },
  { key: 'name', header: 'Name *\nনাম', width: 28, kind: 'required' },
  { key: 'name_bn', header: 'Name (Bangla)\nবাংলায় নাম', width: 24, kind: 'optional' },
  { key: 'nid', header: 'National ID (NID) *\nজাতীয় পরিচয়পত্র নম্বর', width: 26, kind: 'required' },
  { key: 'phone', header: 'Phone\nমোবাইল', width: 16, kind: 'optional' },
  { key: 'email', header: 'Email\nইমেইল', width: 26, kind: 'optional' },
  { key: 'designation', header: 'Designation\nপদবি', width: 18, kind: 'optional' },
  { key: 'status', header: 'Status\nঅবস্থা', width: 12, kind: 'optional' },
  { key: 'monthly_due', header: 'Monthly Due\nমাসিক চাঁদা', width: 14, kind: 'optional' },
  { key: 'join_date', header: 'Join Date *\nযোগদানের তারিখ', width: 17, kind: 'required' },
  { key: 'opening_balance', header: 'Opening Balance\nআগের মোট পরিশোধ', width: 18, kind: 'optional' },
  { key: 'notes', header: 'Notes\nমন্তব্য', width: 30, kind: 'optional' },
  { key: 'ready', header: 'Ready?\nপ্রস্তুত?', width: 12, kind: 'auto' },
];
const LAST_COL = 'M';

type MemberRow = { code?: string; name: string; name_bn?: string; nid?: string; phone?: string; email?: string; designation?: string; status?: string;
  monthly_due?: number | null; join_date?: string | Date | null; opening_balance?: number | null; notes?: string };

function utcDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  const [y, m, d] = String(iso).split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, d || 1)) : null;
}

function buildMembersSheet(wb: ExcelJS.Workbook, rows: MemberRow[], opts: { example: boolean; defaultDue: number }) {
  const LAST_ROW = lastRowFor(rows.length);
  const ws = wb.addWorksheet('Members', {
    properties: { tabColor: { argb: 'FF2A78D6' }, defaultRowHeight: 22 },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = MEMBER_COLS.map(c => ({ key: c.key, width: c.width }));
  banner(ws, LAST_COL, 'Members   ·   সদস্য তালিকা',
    'Type one member per row, starting on row 5. Yellow headers must be filled; the grey "Ready?" column checks each row for you. Rows starting with EX- are examples and are ignored.   ·   প্রতি সারিতে একজন করে লিখুন (৫ নম্বর সারি থেকে)। হলুদ শিরোনামের ঘর আবশ্যক।');
  legend(ws, [
    ['A3', 'Optional', BRAND_MID, WHITE], ['B3', 'Required *', AMBER, BRAND], ['C3', 'Automatic', GREY_LIGHT, GREY], ['D3', 'Wrong / duplicate', RED_LIGHT, RED],
  ]);
  const hr = ws.getRow(4);
  hr.height = 44;
  MEMBER_COLS.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.header; headerCell(cell, c.kind); });

  // data rows: text formats, row height, borders
  const idx = (k: string) => MEMBER_COLS.findIndex(c => c.key === k) + 1;
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    const row = ws.getRow(r);
    row.height = 22;
    for (const k of ['code', 'nid', 'phone']) row.getCell(idx(k)).numFmt = '@';
    row.getCell(idx('monthly_due')).numFmt = '#,##0';
    row.getCell(idx('opening_balance')).numFmt = '#,##0';
    row.getCell(idx('join_date')).numFmt = 'dd/mm/yyyy';
    for (let c = 1; c <= MEMBER_COLS.length; c++) {
      const cell = row.getCell(c);
      cell.border = { bottom: thin('FFE2E8F0'), right: thin('FFE2E8F0') };
      cell.alignment = { vertical: 'middle', horizontal: [idx('monthly_due'), idx('opening_balance')].includes(c) ? 'right' : [idx('join_date'), idx('status'), idx('ready'), idx('nid'), idx('code')].includes(c) ? 'center' : 'left' };
    }
    const ready = row.getCell(idx('ready'));
    const f = `IF(COUNTA(A${r}:L${r})=0,"",IF(AND(B${r}<>"",J${r}<>"",ISNUMBER(--D${r}),OR(LEN(D${r})=10,LEN(D${r})=13,LEN(D${r})=17),SUMPRODUCT(--($D$${FIRST_ROW}:$D$${LAST_ROW}=D${r}))=1),"✓ Ready","⚠ Check"))`;
    ready.value = { formula: f, result: '' } as ExcelJS.CellFormulaValue;
    ready.font = { bold: true, color: { argb: GREY } };
  }

  // sample / real rows
  rows.forEach((m, i) => {
    const row = ws.getRow(FIRST_ROW + i);
    const set = (k: string, v: any) => { if (v !== undefined && v !== null && v !== '') row.getCell(idx(k)).value = v; };
    set('code', m.code); set('name', m.name); set('name_bn', m.name_bn); set('nid', m.nid ? String(m.nid) : ''); set('phone', m.phone); set('email', m.email);
    set('designation', m.designation); set('status', m.status); set('monthly_due', m.monthly_due); set('join_date', utcDate(m.join_date));
    set('opening_balance', m.opening_balance); set('notes', m.notes);
    const ok = !!m.name && !!m.join_date && nidLooksValid(m.nid);
    row.getCell(idx('ready')).value = { formula: (row.getCell(idx('ready')).value as ExcelJS.CellFormulaValue).formula, result: ok ? '✓ Ready' : '⚠ Check' } as ExcelJS.CellFormulaValue;
    if (opts.example) for (let c = 1; c < idx('ready'); c++) row.getCell(c).font = { italic: true, color: { argb: GREY } };
  });
  ws.getRow(4).getCell(idx('nid')).note = 'Type the National ID as plain digits: 10, 13 or 17 digits, one per person. The column is already formatted as Text so Excel keeps every digit.';

  // ---- checks while typing
  const rng = (col: string) => `${col}${FIRST_ROW}:${col}${LAST_ROW}`;
  const dv = (ws as any).dataValidations;
  dv.add(rng('D'), { type: 'custom', allowBlank: true, formulae: [`AND(ISNUMBER(--D${FIRST_ROW}),OR(LEN(D${FIRST_ROW})=10,LEN(D${FIRST_ROW})=13,LEN(D${FIRST_ROW})=17),SUMPRODUCT(--($D$${FIRST_ROW}:$D$${LAST_ROW}=D${FIRST_ROW}))=1)`],
    showInputMessage: true, promptTitle: 'National ID (NID)', prompt: 'Digits only: 10, 13 or 17 digits. Each person has a different NID.',
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Check this NID', error: 'An NID has 10, 13 or 17 digits and cannot be used twice. Keep it anyway?' });
  dv.add(rng('A'), { type: 'custom', allowBlank: true, formulae: [`SUMPRODUCT(--($A$${FIRST_ROW}:$A$${LAST_ROW}=A${FIRST_ROW}))=1`],
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Member code', error: 'This member code is already used on another row.' });
  dv.add(rng('F'), { type: 'custom', allowBlank: true, formulae: [`ISNUMBER(FIND("@",F${FIRST_ROW}))`], showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Email', error: 'This does not look like an email address. Keep it anyway?' });
  dv.add(rng('G'), { type: 'list', allowBlank: true, formulae: ['"Member,President,Vice President,General Secretary,Treasurer,Executive Member,Advisor"'],
    showErrorMessage: true, errorStyle: 'information', errorTitle: 'Designation', error: 'Not in the list — fine, it will be imported as typed.' });
  dv.add(rng('H'), { type: 'list', allowBlank: true, formulae: ['"Active,Inactive"'], showErrorMessage: true, errorTitle: 'Status', error: 'Choose Active or Inactive.' });
  dv.add(rng('I'), { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Monthly due', error: 'Enter an amount, 0 or more. Leave empty to use the default.' });
  dv.add(rng('J'), { type: 'date', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [new Date(Date.UTC(1990, 0, 1))],
    showInputMessage: true, promptTitle: 'Join date', prompt: 'Day/Month/Year, e.g. 15/01/2024. Dues are counted from this month.',
    showErrorMessage: true, errorTitle: 'Join date', error: 'Enter a real date like 15/01/2024.' });
  dv.add(rng('K'), { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Opening balance', error: 'Enter an amount, 0 or more.' });

  // ---- look: banded rows, wrong NIDs, missing required cells, ready flag
  const cf = (ref: string, formula: string, style: Partial<ExcelJS.Style>) =>
    addCF(ws, { ref, rules: [{ type: 'expression', formulae: [formula], style }] });
  const fillOf = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb } });
  cf(`D${FIRST_ROW}:D${LAST_ROW}`, `AND($D${FIRST_ROW}<>"",OR(NOT(ISNUMBER(--$D${FIRST_ROW})),AND(LEN($D${FIRST_ROW})<>10,LEN($D${FIRST_ROW})<>13,LEN($D${FIRST_ROW})<>17),SUMPRODUCT(--($D$${FIRST_ROW}:$D$${LAST_ROW}=$D${FIRST_ROW}))>1))`,
    { fill: fillOf(RED_LIGHT), font: { color: { argb: RED }, bold: true } });
  cf(`A${FIRST_ROW}:A${LAST_ROW}`, `AND($A${FIRST_ROW}<>"",SUMPRODUCT(--($A$${FIRST_ROW}:$A$${LAST_ROW}=$A${FIRST_ROW}))>1)`, { fill: fillOf(RED_LIGHT), font: { color: { argb: RED }, bold: true } });
  for (const col of ['B', 'D', 'J']) cf(`${col}${FIRST_ROW}:${col}${LAST_ROW}`, `AND(COUNTA($A${FIRST_ROW}:$L${FIRST_ROW})>0,${col}${FIRST_ROW}="")`, { fill: fillOf(AMBER) });
  cf(`M${FIRST_ROW}:M${LAST_ROW}`, `LEFT($M${FIRST_ROW},1)="✓"`, { fill: fillOf('FFD9F2E6'), font: { color: { argb: BRAND_MID }, bold: true } });
  cf(`M${FIRST_ROW}:M${LAST_ROW}`, `LEFT($M${FIRST_ROW},1)="⚠"`, { fill: fillOf(AMBER), font: { color: { argb: AMBER_DEEP }, bold: true } });
  cf(`A${FIRST_ROW}:L${LAST_ROW}`, 'MOD(ROW(),2)=0', { fill: fillOf(MINT) });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: LAST_ROW, column: MEMBER_COLS.length } };
  return ws;
}

function buildHistorySheet(wb: ExcelJS.Workbook, months: string[], people: Array<{ name: string; code: string; nid: string; paid: Record<string, number | 'P'> }>, opts: { example: boolean; staticIds: boolean }) {
  const LAST_ROW = lastRowFor(people.length);
  const ws = wb.addWorksheet('Payment History', {
    properties: { tabColor: { argb: 'FF1BAF7A' }, defaultRowHeight: 22 },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const MC = 5;                                           // first month column (E)
  const lastMonthCol = MC + months.length - 1;
  const lastLetter = colLetter(lastMonthCol);
  ws.columns = [{ key: 'name', width: 28 }, { key: 'code', width: 15 }, { key: 'nid', width: 24 }, { key: 'total', width: 14 }, ...months.map(m => ({ key: m, width: 11 }))];
  banner(ws, lastLetter, 'Payment History   ·   আজ পর্যন্ত আদায়',
    'Pick each member from the drop-down in the first column (or type the name exactly as on the Members sheet). The code and NID fill in by themselves. Then type the amount paid in each month, or P for "paid in full". Leave a month empty (or 0) if nothing was paid.   ·   প্রথম ঘরে তালিকা থেকে সদস্য বেছে নিন, তারপর প্রতি মাসে পরিশোধিত টাকা (বা P) লিখুন।');
  legend(ws, [['A3', 'Pick from list', AMBER, BRAND], ['B3', 'Automatic', GREY_LIGHT, GREY], ['C3', 'Automatic', GREY_LIGHT, GREY], ['D3', 'Automatic', GREY_LIGHT, GREY], ['E3', 'Amount or P', BRAND_MID, WHITE]]);
  // year band over the months
  let start = 0;
  for (let i = 1; i <= months.length; i++) {
    if (i === months.length || months[i].slice(0, 4) !== months[start].slice(0, 4)) {
      const a = colLetter(MC + start), b = colLetter(MC + i - 1);
      if (i - 1 > start) ws.mergeCells(`${a}3:${b}3`);
      const c = ws.getCell(`${a}3`);
      c.value = months[start].slice(0, 4);
      c.font = { bold: true, color: { argb: WHITE } };
      c.fill = solid(start % 2 === 0 ? BRAND_MID : BRAND);
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      start = i;
    }
  }
  const hr = ws.getRow(4);
  hr.height = 44;
  const heads: Array<[string, 'required' | 'optional' | 'auto']> = [['Name *\nনাম', 'required'], ['Member Code\nসদস্য কোড', 'auto'], ['National ID (NID)\nজাতীয় পরিচয়পত্র নম্বর', 'auto'], ['Total paid\nমোট পরিশোধ', 'auto']];
  heads.forEach(([h, k], i) => { const c = hr.getCell(i + 1); c.value = h; headerCell(c, k); });
  months.forEach((m, i) => { const c = hr.getCell(MC + i); c.value = m; c.numFmt = '@'; headerCell(c, 'optional'); });

  const L = (c: number) => colLetter(c);
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    const row = ws.getRow(r);
    row.height = 22;
    const p = people[r - FIRST_ROW];
    row.getCell(1).numFmt = '@'; row.getCell(2).numFmt = '@'; row.getCell(3).numFmt = '@';
    if (opts.staticIds && p) { row.getCell(2).value = p.code; row.getCell(3).value = p.nid; }
    else {
      row.getCell(2).value = { formula: `IF($A${r}="","",IFERROR(INDEX(Members!$A$${FIRST_ROW}:$A$${LAST_ROW},MATCH($A${r},Members!$B$${FIRST_ROW}:$B$${LAST_ROW},0))&"",""))`, result: p?.code ?? '' } as ExcelJS.CellFormulaValue;
      row.getCell(3).value = { formula: `IF($A${r}="","",IFERROR(INDEX(Members!$D$${FIRST_ROW}:$D$${LAST_ROW},MATCH($A${r},Members!$B$${FIRST_ROW}:$B$${LAST_ROW},0))&"",""))`, result: p?.nid ?? '' } as ExcelJS.CellFormulaValue;
    }
    if (p) row.getCell(1).value = p.name;
    const total = p ? Object.values(p.paid).reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0) : '';
    row.getCell(4).value = { formula: `IF($A${r}="","",SUM(${L(MC)}${r}:BZ${r}))`, result: total } as ExcelJS.CellFormulaValue;
    row.getCell(4).numFmt = '#,##0';
    row.getCell(4).font = { bold: true, color: { argb: BRAND } };
    for (const c of [2, 3]) row.getCell(c).font = { color: { argb: GREY } };
    months.forEach((m, i) => {
      const cell = row.getCell(MC + i);
      cell.numFmt = '#,##0';
      if (p && p.paid[m] !== undefined) cell.value = p.paid[m] as any;
    });
    for (let c = 1; c <= lastMonthCol; c++) {
      const cell = row.getCell(c);
      cell.border = { bottom: thin('FFE2E8F0'), right: thin('FFE2E8F0') };
      cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : c === 4 || c >= MC ? 'right' : 'center' };
    }
    if (opts.example && p) { for (let c = 1; c <= lastMonthCol; c++) if (c !== 4) row.getCell(c).font = { italic: true, color: { argb: GREY } }; }
  }
  // drop-down of the members already typed on the Members sheet (blank rows skipped)
  (ws as any).dataValidations.add(`A${FIRST_ROW}:A${LAST_ROW}`, { type: 'list', allowBlank: true,
    formulae: [`OFFSET(Members!$B$${FIRST_ROW},0,0,MAX(1,COUNTA(Members!$B$${FIRST_ROW}:$B$${LAST_ROW})),1)`],
    showInputMessage: true, promptTitle: 'Member', prompt: 'Pick the member from the list, or type the name exactly as on the Members sheet.',
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Member not found', error: 'This name is not on the Members sheet. Keep it anyway?' });
  (ws as any).dataValidations.add(`${L(MC)}${FIRST_ROW}:${lastLetter}${LAST_ROW}`, { type: 'custom', allowBlank: true,
    formulae: [`OR(ISNUMBER(${L(MC)}${FIRST_ROW}),UPPER(${L(MC)}${FIRST_ROW})="P")`], showErrorMessage: true, errorTitle: 'Amount', error: 'Type the amount paid (a number), or P for paid in full.' });
  const fillOf = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb } });
  const monthRef = `${L(MC)}${FIRST_ROW}:${lastLetter}${LAST_ROW}`;
  addCF(ws, { ref: monthRef, rules: [
    { type: 'expression', formulae: [`AND(ISNUMBER(${L(MC)}${FIRST_ROW}),${L(MC)}${FIRST_ROW}>0)`], style: { fill: fillOf('FFD9F2E6'), font: { color: { argb: BRAND }, bold: true } } },
    { type: 'expression', formulae: [`UPPER(${L(MC)}${FIRST_ROW})="P"`], style: { fill: fillOf('FFC6EBD8'), font: { color: { argb: BRAND_MID }, bold: true } } },
  ] });
  addCF(ws, { ref: `A${FIRST_ROW}:A${LAST_ROW}`, rules: [{ type: 'expression',
    formulae: [`AND($A${FIRST_ROW}<>"",COUNTIF($A$${FIRST_ROW}:$A$${LAST_ROW},$A${FIRST_ROW})>1)`], style: { fill: fillOf(RED_LIGHT), font: { color: { argb: RED }, bold: true } }, }] });
  addCF(ws, { ref: `A${FIRST_ROW}:${lastLetter}${LAST_ROW}`, rules: [{ type: 'expression', formulae: ['MOD(ROW(),2)=0'], style: { fill: fillOf(MINT) } }] });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: LAST_ROW, column: lastMonthCol } };
  return ws;
}

function monthsEndingAt(currentMonth: string, count: number): string[] {
  const [cy, cm] = currentMonth.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) { const d = new Date(cy, cm - 1 - i, 1); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
  return out;
}

export async function buildTemplate(opts: { orgName: string; defaultDue: number; dueDay: number; currentMonth: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bondhu Fund';
  wb.created = new Date();
  const { defaultDue, dueDay, currentMonth } = opts;
  const months = monthsEndingAt(currentMonth, MONTHS_SHOWN);
  const back = (n: number) => months[months.length - 1 - n];
  const join = (monthsAgo: number) => `${back(monthsAgo)}-01`;

  buildGuideSheet(wb, opts);
  buildMembersSheet(wb, [
    { code: 'EX-0001', name: 'Example: Rahim Uddin', name_bn: 'রহিম উদ্দিন', nid: '1990123456789', phone: '01711-000001', designation: 'Member', status: 'Active', monthly_due: defaultDue, join_date: join(11), opening_balance: 0, notes: 'Example (history typed month by month on Payment History) — delete me' },
    { code: 'EX-0002', name: 'Example: Karima Begum', name_bn: 'করিমা বেগম', nid: '19901234567890123', phone: '01811-000002', designation: 'Treasurer', status: 'Active', monthly_due: defaultDue, join_date: join(2), opening_balance: defaultDue * 24, notes: 'Example (only a total: opening balance) — delete me' },
    { code: 'EX-0003', name: 'Example: Jamal Hossain', nid: '1234567890', designation: 'Member', status: 'Active', monthly_due: defaultDue, join_date: join(8), opening_balance: 0, notes: 'Example — delete me' },
  ], { example: true, defaultDue });
  const paid1: Record<string, number | 'P'> = {};
  months.forEach((m, i) => { if (i >= 12 && i !== 16) paid1[m] = i % 3 === 0 ? 'P' : defaultDue; });
  const paid2: Record<string, number | 'P'> = {};
  months.slice(-2).forEach(m => { paid2[m] = defaultDue; });
  buildHistorySheet(wb, months, [
    { name: 'Example: Rahim Uddin', code: 'EX-0001', nid: '1990123456789', paid: paid1 },
    { name: 'Example: Karima Begum', code: 'EX-0002', nid: '19901234567890123', paid: paid2 },
  ], { example: true, staticIds: false });
  wb.views = [{ x: 0, y: 0, width: 24000, height: 14000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function buildGuideSheet(wb: ExcelJS.Workbook, opts: { orgName: string; defaultDue: number; dueDay: number }) {
  const ws = wb.addWorksheet('Start Here', { properties: { tabColor: { argb: BRAND } }, views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = [{ width: 3 }, { width: 22 }, { width: 14 }, { width: 58 }, { width: 58 }];
  ws.mergeCells('B2:E2');
  const t = ws.getCell('B2');
  t.value = `${opts.orgName || 'Bondhu Fund'} — member data entry`;
  t.font = { size: 22, bold: true, color: { argb: WHITE } };
  t.fill = solid(BRAND);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 46;
  ws.mergeCells('B3:E3');
  const sub = ws.getCell('B3');
  sub.value = 'সদস্য তথ্য এন্ট্রি ফাইল  ·  Fill this workbook in Excel, then bring it into the app in one click.';
  sub.font = { size: 11, color: { argb: INK } };
  sub.fill = solid(BRAND_LIGHT);
  sub.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 26;

  let r = 5;
  const section = (en: string, bn: string) => {
    ws.mergeCells(`B${r}:E${r}`);
    const c = ws.getCell(`B${r}`);
    c.value = `${en}   ·   ${bn}`;
    c.font = { size: 13, bold: true, color: { argb: BRAND } };
    c.border = { bottom: { style: 'medium', color: { argb: BRAND_MID } } };
    ws.getRow(r).height = 26;
    r++;
  };
  const wrap = (c: ExcelJS.Cell) => { c.alignment = { wrapText: true, vertical: 'top' }; };

  section('How to fill it in 4 steps', '৪টি ধাপে পূরণ করুন');
  const steps: Array<[string, string, string]> = [
    ['1', 'Open the “Members” sheet and type one member per row, from row 5. The yellow headers (Name, National ID, Join Date) are required. The grey “Ready?” column tells you if a row is complete.', '“Members” শিটে ৫ নম্বর সারি থেকে প্রতি সারিতে একজন সদস্য লিখুন। হলুদ শিরোনামগুলো (নাম, জাতীয় পরিচয়পত্র, যোগদানের তারিখ) আবশ্যক।'],
    ['2', 'Open “Payment History” and pick each member from the drop-down. Their code and NID appear by themselves. Type the amount paid in each month, or P for “paid in full”. Leave empty if nothing was paid.', '“Payment History” শিটে তালিকা থেকে সদস্য বেছে নিন; কোড ও এনআইডি নিজে থেকেই আসবে। প্রতি মাসে পরিশোধিত টাকা (বা P) লিখুন।'],
    ['3', 'Delete the grey example rows (they start with EX-). If you leave them, the app ignores them anyway. Save the file.', 'ধূসর উদাহরণ সারিগুলো (EX- দিয়ে শুরু) মুছে ফেলুন — রেখে দিলেও অ্যাপ এগুলো বাদ দেবে। ফাইলটি সেভ করুন।'],
    ['4', 'In the app: Members → Import from Excel → choose this file → check the preview → Import. Nothing is saved until you press Import.', 'অ্যাপে: সদস্য → Excel থেকে ইমপোর্ট → ফাইল বেছে নিন → প্রিভিউ দেখুন → ইমপোর্ট। ইমপোর্ট চাপার আগে কিছুই সংরক্ষিত হয় না।'],
  ];
  for (const [n, en, bn] of steps) {
    const num = ws.getCell(`B${r}`);
    num.value = Number(n);
    num.font = { size: 16, bold: true, color: { argb: WHITE } };
    num.fill = solid(BRAND_MID);
    num.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(`C${r}:D${r}`);
    ws.getCell(`C${r}`).value = en;
    ws.getCell(`E${r}`).value = bn;
    wrap(ws.getCell(`C${r}`)); wrap(ws.getCell(`E${r}`));
    ws.getCell(`E${r}`).font = bnFont;
    ws.getRow(r).height = Math.max(46, Math.ceil(en.length / 78) * 17 + 6);
    r++;
  }
  r++;

  section('National ID (NID) rules', 'জাতীয় পরিচয়পত্র (এনআইডি) নিয়ম');
  const nidRules: Array<[string, string]> = [
    ['Every member needs an NID — 10, 13 or 17 digits, digits only (Bangla digits are fine). No two members can share one.', 'প্রতিটি সদস্যের এনআইডি আবশ্যক — ১০, ১৩ বা ১৭ অঙ্ক, শুধু অঙ্ক। দুজনের এনআইডি এক হতে পারবে না।'],
    ['The NID column is already formatted as Text, so Excel keeps every digit. If you paste from another file, use Paste → Values, or the last digits of a 17-digit NID can be turned into zeros.', 'এনআইডি কলাম আগে থেকেই টেক্সট ফরম্যাটে আছে। অন্য ফাইল থেকে পেস্ট করলে Paste → Values ব্যবহার করুন, নইলে ১৭ অঙ্কের শেষ অঙ্কগুলো শূন্য হয়ে যেতে পারে।'],
    ['A red NID cell means it is the wrong length, has letters, or is used twice. The app also checks again when you import.', 'লাল এনআইডি ঘর মানে দৈর্ঘ্য ভুল, অক্ষর আছে অথবা দুইবার ব্যবহৃত। ইমপোর্টের সময় অ্যাপও আবার যাচাই করে।'],
  ];
  for (const [en, bn] of nidRules) {
    ws.getCell(`B${r}`).value = '●'; ws.getCell(`B${r}`).alignment = { horizontal: 'center', vertical: 'top' }; ws.getCell(`B${r}`).font = { color: { argb: BRAND_MID } };
    ws.mergeCells(`C${r}:D${r}`);
    ws.getCell(`C${r}`).value = en; ws.getCell(`E${r}`).value = bn; ws.getCell(`E${r}`).font = bnFont;
    wrap(ws.getCell(`C${r}`)); wrap(ws.getCell(`E${r}`));
    ws.getRow(r).height = Math.max(34, Math.ceil(en.length / 78) * 17 + 4);
    r++;
  }
  r++;

  section('Money paid so far — two ways', 'আজ পর্যন্ত পরিশোধ — দুটি পদ্ধতি');
  const ways: Array<[string, string, string]> = [
    ['A', 'Month by month (best): type the amount for each month on “Payment History”. Statements and reports are then exact.', 'ক) মাসভিত্তিক (সবচেয়ে ভালো): “Payment History” শিটে প্রতি মাসের টাকা লিখুন।'],
    ['B', 'Only a total: put the total paid so far in “Opening Balance” and set “Join Date” to the first month you will track in the app.', 'খ) শুধু মোট: “Opening Balance”-এ আজ পর্যন্ত মোট পরিশোধ লিখুন এবং “Join Date” দিন অ্যাপে হিসাব শুরুর মাস।'],
    ['!', 'Do not use both for the same months — the money would be counted twice.', 'একই মাসের জন্য দুটো পদ্ধতি একসাথে ব্যবহার করবেন না — টাকা দুবার গণনা হবে।'],
  ];
  for (const [k, en, bn] of ways) {
    const c = ws.getCell(`B${r}`);
    c.value = k; c.font = { bold: true, size: 13, color: { argb: k === '!' ? RED : BRAND_MID } }; c.alignment = { horizontal: 'center', vertical: 'top' };
    ws.mergeCells(`C${r}:D${r}`);
    ws.getCell(`C${r}`).value = en; ws.getCell(`E${r}`).value = bn; ws.getCell(`E${r}`).font = bnFont;
    wrap(ws.getCell(`C${r}`)); wrap(ws.getCell(`E${r}`));
    ws.getRow(r).height = Math.max(34, Math.ceil(en.length / 78) * 17 + 4);
    r++;
  }
  r++;

  section('What goes in each column (Members sheet)', 'কোন কলামে কী লিখবেন');
  const head = ws.getRow(r);
  ['Column', 'Required?', 'What to type', 'বাংলা নির্দেশনা'].forEach((h, i) => {
    const c = head.getCell(2 + i);
    c.value = h; c.font = { bold: true, color: { argb: WHITE } }; c.fill = solid(BRAND_MID); c.alignment = { vertical: 'middle', horizontal: i === 1 ? 'center' : 'left', indent: 1 };
  });
  head.height = 24;
  r++;
  const dict: Array<[string, string, string, string]> = [
    ['Member Code', 'Optional', 'e.g. BF-0012. Leave empty and the app makes one. If the code is already in the app, that member is matched (updated or skipped — you choose at import).', 'ঐচ্ছিক। ফাঁকা রাখলে অ্যাপ নিজেই তৈরি করবে।'],
    ['Name *', 'Required', 'Full name in English.', 'পূর্ণ নাম (ইংরেজিতে)।'],
    ['Name (Bangla)', 'Optional', 'Shown when the app is in Bangla.', 'বাংলায় নাম — অ্যাপ বাংলায় থাকলে দেখাবে।'],
    ['National ID (NID) *', 'Required', '10, 13 or 17 digits. Used to recognise the person, so re-importing the same file never creates a duplicate.', 'এনআইডি — ১০, ১৩ বা ১৭ অঙ্ক। এর মাধ্যমে একই ব্যক্তিকে চেনা যায়।'],
    ['Phone / Email', 'Optional', 'Mobile number, e-mail address.', 'মোবাইল নম্বর, ইমেইল।'],
    ['Designation', 'Optional', 'Pick from the list or type your own (Member, President, Treasurer …).', 'তালিকা থেকে বাছুন বা নিজে লিখুন।'],
    ['Status', 'Optional', 'Active (default). New members must be Active — use Settle in the app when someone leaves.', 'Active (ডিফল্ট)। নতুন সদস্য Active হতে হবে।'],
    ['Monthly Due', 'Optional', `Amount owed each month. Empty = the app default (${opts.defaultDue}). The due day is the ${opts.dueDay}th of each month.`, `প্রতি মাসের চাঁদা। ফাঁকা = ডিফল্ট (${opts.defaultDue})।`],
    ['Join Date *', 'Required', 'Day/Month/Year, e.g. 15/01/2024. Dues are counted from this month.', 'দিন/মাস/বছর। এই মাস থেকে চাঁদা গণনা শুরু।'],
    ['Opening Balance', 'Optional', 'Method B only: total paid before the app. Leave 0 if you type the months on Payment History.', 'শুধু পদ্ধতি খ: অ্যাপের আগে মোট পরিশোধ।'],
    ['Notes', 'Optional', 'Anything else.', 'মন্তব্য।'],
  ];
  dict.forEach(([c, req, en, bn], i) => {
    const row = ws.getRow(r);
    row.getCell(2).value = c; row.getCell(2).font = { bold: true };
    row.getCell(3).value = req; row.getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
    row.getCell(3).font = { bold: true, color: { argb: req === 'Required' ? AMBER_DEEP : GREY } };
    row.getCell(4).value = en; row.getCell(5).value = bn; row.getCell(5).font = bnFont;
    for (const k of [2, 4, 5]) row.getCell(k).alignment = { wrapText: true, vertical: 'top', indent: k === 2 ? 1 : 0 };
    for (let k = 2; k <= 5; k++) { row.getCell(k).border = { bottom: thin('FFE2E8F0') }; if (i % 2 === 1) row.getCell(k).fill = solid(MINT); }
    row.height = Math.max(22, Math.ceil(en.length / 62) * 17 + 4);
    r++;
  });
  r++;
  section('Colours', 'রঙের অর্থ');
  const colours: Array<[string, string, string, string]> = [
    ['Yellow header', AMBER, BRAND, 'Required column'], ['Green header', BRAND_MID, WHITE, 'Optional column'], ['Grey header', GREY_LIGHT, GREY, 'Filled in automatically — do not type'],
    ['Red cell', RED_LIGHT, RED, 'Wrong or duplicate NID / code'], ['Yellow cell', AMBER, AMBER_DEEP, 'A required cell is still empty'],
  ];
  for (const [label, fill, font, meaning] of colours) {
    const c = ws.getCell(`B${r}`);
    c.value = label; c.fill = solid(fill); c.font = { bold: true, color: { argb: font } }; c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: thin('FFD0DAD5'), bottom: thin('FFD0DAD5'), left: thin('FFD0DAD5'), right: thin('FFD0DAD5') };
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value = meaning;
    ws.getRow(r).height = 22;
    r++;
  }
}

/** Export current members in the same layout (for round-tripping corrections). */
export async function buildMembersExport(members: any[], payments: Array<{ member_code: string; payment_month: string; contribution_amount: number }>, months: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bondhu Fund';
  wb.created = new Date();
  const shown = months.length ? months : monthsEndingAt(isoOf(new Date()).slice(0, 7), 12);
  buildMembersSheet(wb, members.map(m => ({ code: m.member_code, name: m.name, name_bn: m.name_bn || '', nid: m.nid || '', phone: m.phone || '', email: m.email || '',
    designation: m.designation || '', status: m.status || 'Active', monthly_due: m.monthly_due, join_date: m.join_date, opening_balance: m.opening_balance, notes: m.notes || '' })),
    { example: false, defaultDue: 0 });
  const byMember = new Map<string, Record<string, number>>();
  for (const p of payments) {
    if (!byMember.has(p.member_code)) byMember.set(p.member_code, {});
    byMember.get(p.member_code)![p.payment_month] = p.contribution_amount;
  }
  buildHistorySheet(wb, shown, members.map(m => ({ name: m.name, code: m.member_code, nid: m.nid || '', paid: byMember.get(m.member_code) || {} })), { example: false, staticIds: true });
  wb.views = [{ x: 0, y: 0, width: 24000, height: 14000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
