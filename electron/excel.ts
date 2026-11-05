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
    if ('result' in o) return cellValue(o.result);            // formula
    if ('richText' in o) return o.richText.map((r: any) => r.text).join('');
    if ('text' in o) return o.text;                           // hyperlink
    if ('error' in o) return null;
  }
  return v;
}

function text(v: ExcelJS.CellValue): string {
  const x = cellValue(v);
  if (x === null) return '';
  if (x instanceof Date) return isoOf(utcToLocalDate(x));
  return String(x).trim();
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
    const due = num(get('monthly_due'));
    const ob = num(get('opening_balance'));
    const jd = parseDate(get('join_date'));
    if (Number.isNaN(due)) problems.push('Monthly due is not a number');
    if (Number.isNaN(ob)) problems.push('Opening balance is not a number');
    if (jd === 'invalid') problems.push('Join date is not a valid date (use DD/MM/YYYY)');
    out.members.push({
      row: r, code, name, name_bn: text(get('name_bn')), phone: ascii(text(get('phone'))), email: text(get('email')),
      designation: text(get('designation')), status: text(get('status')),
      monthly_due: Number.isNaN(due) ? null : due, join_date: jd === 'invalid' ? null : jd,
      opening_balance: Number.isNaN(ob) ? null : ob, notes: text(get('notes')), problems,
    });
  }

  // ---- Payment history (optional) --------------------------------------------------
  const ps = findSheet(wb, /payment|history|ledger|collection|পেমেন্ট|আদায়/i);
  if (ps) {
    const PAY_FIELDS: Array<[string, RegExp]> = [['code', /member\s*(code|id)|^code$|সদস্য\s*(কোড|আইডি)/i], ['name', /name|নাম/i]];
    const pr = findHeaderRow(ps, PAY_FIELDS, ['code', 'name'], true);
    if (!pr) {
      out.sheetWarnings.push(`"${ps.name}" sheet: no "Member Code" or "Name" header found — payment history was not read.`);
    } else {
      const header = ps.getRow(pr);
      const pm = headerMap(header, PAY_FIELDS);
      const monthCols: Array<{ col: number; month: string }> = [];
      header.eachCell({ includeEmpty: false }, (cell, col) => {
        if (col === pm.code || col === pm.name) return;
        const mk = parseMonth(cell.value);
        if (mk) monthCols.push({ col, month: mk });
        else if (text(cell.value)) out.sheetWarnings.push(`"${ps.name}" column ${colLetter(col)} header "${text(cell.value)}" is not a month (use YYYY-MM) — ignored.`);
      });
      if (!monthCols.length) out.sheetWarnings.push(`"${ps.name}" sheet has no month columns (headers like 2024-01) — payment history was not read.`);
      for (let r = pr + 1; r <= ps.rowCount; r++) {
        const row = ps.getRow(r);
        const code = pm.code ? text(row.getCell(pm.code).value) : '';
        const name = pm.name ? text(row.getCell(pm.name).value) : '';
        if (!code && !name) continue;
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
          out.payments.push({ row: r, cell: `${colLetter(col)}${r}`, code, name, month, amount, problems });
        }
      }
    }
  }
  return out;
}

function findHeaderRow(ws: ExcelJS.Worksheet, fields: Array<[string, RegExp]>, required: string[], anyOf = false): number | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const m = headerMap(ws.getRow(r), fields);
    const ok = anyOf ? required.some(k => m[k]) : required.every(k => m[k]);
    if (ok) return r;
  }
  return null;
}

function colLetter(c: number) {
  let s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------
const BRAND = 'FF0F4A3C', BRAND_LIGHT = 'FFE6F3EE', AMBER = 'FFFFF4D6', GREY = 'FF64748B';

export async function buildTemplate(opts: { orgName: string; defaultDue: number; dueDay: number; currentMonth: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bondhu Fund';
  wb.created = new Date();
  const { defaultDue, dueDay, currentMonth } = opts;
  const months: string[] = [];
  const [cy, cm] = currentMonth.split('-').map(Number);
  for (let i = 11; i >= 0; i--) { const d = new Date(cy, cm - 1 - i, 1); months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
  // ExcelJS writes Date as UTC: build UTC midnight so the sheet shows the intended calendar day in any timezone.
  const exJoin = (offset: number) => { const d = new Date(cy, cm - 1 - offset, 1); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)); };

  // ---- Instructions --------------------------------------------------------------
  const ins = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: BRAND } }, views: [{ showGridLines: false }] });
  ins.columns = [{ width: 4 }, { width: 30 }, { width: 62 }, { width: 62 }];
  const title = ins.getCell('B2');
  title.value = `${opts.orgName || 'Bondhu Fund'} — Member import template`;
  title.font = { size: 18, bold: true, color: { argb: BRAND } };
  ins.getCell('B3').value = 'সদস্য ইমপোর্ট টেমপ্লেট — Fill the "Members" sheet (required) and, if you have it, the "Payment History" sheet.';
  ins.getCell('B3').font = { color: { argb: GREY } };

  const steps: Array<[string, string, string]> = [
    ['1', 'Fill the Members sheet: one row per member. Columns marked * are required.', 'Members শিটে প্রতি সারিতে একজন সদস্য লিখুন। * চিহ্নিত কলাম আবশ্যক।'],
    ['2', 'Delete or overwrite the example rows (Member Code starting with EX-). Example rows are ignored anyway.', 'উদাহরণ সারিগুলো (EX- দিয়ে শুরু কোড) মুছে ফেলুন বা ওপরে লিখুন — এগুলো এমনিতেও বাদ যায়।'],
    ['3', 'Till-date collections — choose ONE way per member:', 'আজ পর্যন্ত আদায় — প্রতি সদস্যের জন্য যেকোনো একটি পদ্ধতি বেছে নিন:'],
    ['', 'A) Month by month (best): in "Payment History" put the amount paid under each month (or P = paid in full). Arrears, statements and reports will then be exact.', 'ক) মাসভিত্তিক (সবচেয়ে ভালো): "Payment History" শিটে প্রতি মাসের ঘরে পরিশোধিত টাকা লিখুন (বা P = পূর্ণ পরিশোধ)।'],
    ['', 'B) Only a total: put the total paid so far in "Opening Balance" and set "Join Date" to the first month you will track in the app. Months before that will not be counted as dues.', 'খ) শুধু মোট: "Opening Balance" কলামে আজ পর্যন্ত মোট পরিশোধ লিখুন এবং "Join Date" দিন অ্যাপে হিসাব শুরুর মাস।'],
    ['', 'Do not use both for the same months, or the money will be counted twice.', 'একই মাসের জন্য দুটো পদ্ধতি একসাথে ব্যবহার করবেন না — টাকা দুবার গণনা হবে।'],
    ['4', 'Dates: DD/MM/YYYY (e.g. 15/01/2024). Months in Payment History headers: YYYY-MM (e.g. 2024-01). Add more month columns if you need to.', 'তারিখ: দিন/মাস/বছর। Payment History-র মাসের শিরোনাম: YYYY-MM (যেমন 2024-01)। প্রয়োজনে আরও মাসের কলাম যোগ করুন।'],
    ['5', 'Unpaid months: leave the cell empty or 0. They will show as Overdue (after the due day) in the app.', 'অপরিশোধিত মাস: ঘর ফাঁকা বা 0 রাখুন — অ্যাপে মেয়াদোত্তীর্ণ দেখাবে।'],
    ['6', 'In the app: Members → Import from Excel → choose this file → check the preview → Import.', 'অ্যাপে: সদস্য → Excel থেকে ইমপোর্ট → ফাইল নির্বাচন → প্রিভিউ যাচাই → ইমপোর্ট।'],
  ];
  let r = 5;
  for (const [n, en, bn] of steps) {
    ins.getCell(`B${r}`).value = n ? `Step ${n}` : '';
    ins.getCell(`B${r}`).font = { bold: true, color: { argb: BRAND } };
    ins.getCell(`C${r}`).value = en;
    ins.getCell(`D${r}`).value = bn;
    for (const c of ['C', 'D']) ins.getCell(`${c}${r}`).alignment = { wrapText: true, vertical: 'top' };
    ins.getRow(r).height = Math.max(20, Math.ceil(Math.max(en.length, bn.length * 1.2) / 62) * 16);
    r++;
  }

  r += 1;
  const fieldsHeader = ins.getRow(r);
  fieldsHeader.values = ['', 'Column', 'What to enter', 'বাংলা নির্দেশনা'];
  fieldsHeader.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }; });
  r++;
  const dict: Array<[string, string, string]> = [
    ['Member Code', 'Optional. e.g. BF-0012. Leave empty to auto-generate. If the code already exists in the app, that member is updated (or skipped — you choose when importing).', 'ঐচ্ছিক। ফাঁকা রাখলে স্বয়ংক্রিয়ভাবে তৈরি হবে।'],
    ['Name *', 'Full name in English.', 'পূর্ণ নাম (ইংরেজিতে)। আবশ্যক।'],
    ['Name (Bangla)', 'Optional. Shown when the app is in Bangla.', 'ঐচ্ছিক — বাংলায় নাম।'],
    ['Phone', 'Mobile number, e.g. 01711-234567.', 'মোবাইল নম্বর।'],
    ['Email', 'Optional.', 'ঐচ্ছিক।'],
    ['Designation', 'e.g. Member, President, Treasurer.', 'যেমন: সদস্য, সভাপতি, কোষাধ্যক্ষ।'],
    ['Status', 'Active or Inactive (default Active). Inactive members owe no new dues.', 'Active বা Inactive (ডিফল্ট Active)।'],
    ['Monthly Due', `Amount owed each month. Empty = app default (${defaultDue}).`, `প্রতি মাসের চাঁদা। ফাঁকা = ডিফল্ট (${defaultDue})।`],
    ['Join Date *', `DD/MM/YYYY. Dues are counted from this month. Due day is the ${dueDay}th of each month.`, `দিন/মাস/বছর। এই মাস থেকে চাঁদা গণনা শুরু।`],
    ['Opening Balance', 'Total paid BEFORE the months listed in Payment History (method B). Leave 0 if you use method A for all months.', 'Payment History-র আগের মোট পরিশোধ (পদ্ধতি খ)।'],
    ['Notes', 'Anything else.', 'মন্তব্য।'],
  ];
  for (const [c, en, bn] of dict) {
    const row = ins.getRow(r);
    row.values = ['', c, en, bn];
    row.getCell(2).font = { bold: true };
    [3, 4].forEach(i => (row.getCell(i).alignment = { wrapText: true, vertical: 'top' }));
    row.height = Math.max(18, Math.ceil(en.length / 62) * 16);
    r++;
  }

  // ---- Members --------------------------------------------------------------------
  const ms = wb.addWorksheet('Members', { properties: { tabColor: { argb: 'FF2A78D6' } }, views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ms.columns = [
    { header: 'Member Code\nসদস্য কোড', key: 'code', width: 16 },
    { header: 'Name *\nনাম', key: 'name', width: 26 },
    { header: 'Name (Bangla)\nবাংলায় নাম', key: 'name_bn', width: 24 },
    { header: 'Phone\nমোবাইল', key: 'phone', width: 16 },
    { header: 'Email\nইমেইল', key: 'email', width: 26 },
    { header: 'Designation\nপদবি', key: 'designation', width: 16 },
    { header: 'Status\nঅবস্থা', key: 'status', width: 12 },
    { header: 'Monthly Due\nমাসিক চাঁদা', key: 'monthly_due', width: 14 },
    { header: 'Join Date *\nযোগদানের তারিখ', key: 'join_date', width: 16 },
    { header: 'Opening Balance\nআগের মোট পরিশোধ', key: 'opening_balance', width: 18 },
    { header: 'Notes\nমন্তব্য', key: 'notes', width: 30 },
  ];
  styleHeader(ms.getRow(1));
  const examples = [
    { code: 'EX-0001', name: 'Example: Rahim Uddin', name_bn: 'রহিম উদ্দিন', phone: '01711-000001', email: '', designation: 'Member', status: 'Active', monthly_due: defaultDue, join_date: exJoin(11), opening_balance: 0, notes: 'Example row (method A: history in Payment History) — delete me' },
    { code: 'EX-0002', name: 'Example: Karima Begum', name_bn: 'করিমা বেগম', phone: '01811-000002', email: '', designation: 'Treasurer', status: 'Active', monthly_due: defaultDue, join_date: exJoin(2), opening_balance: defaultDue * 24, notes: 'Example row (method B: total paid before = opening balance) — delete me' },
    { code: 'EX-0003', name: 'Example: Jamal Hossain', name_bn: '', phone: '', email: '', designation: 'Member', status: 'Inactive', monthly_due: defaultDue, join_date: exJoin(8), opening_balance: 0, notes: 'Example row — delete me' },
  ];
  for (const e of examples) {
    const row = ms.addRow({ ...e, join_date: e.join_date });
    row.font = { italic: true, color: { argb: GREY } };
  }
  ms.getColumn('join_date').numFmt = 'dd/mm/yyyy';
  ms.getColumn('monthly_due').numFmt = '#,##0';
  ms.getColumn('opening_balance').numFmt = '#,##0';
  ms.getColumn('phone').numFmt = '@';
  for (let i = 2; i <= 1000; i++) {
    ms.getCell(`G${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Active,Inactive"'], showErrorMessage: true, errorTitle: 'Status', error: 'Choose Active or Inactive' };
    ms.getCell(`I${i}`).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(1990, 0, 1)], showErrorMessage: true, errorTitle: 'Join date', error: 'Enter a date like 15/01/2024' };
    ms.getCell(`H${i}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Enter a positive amount' };
    ms.getCell(`J${i}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Enter a positive amount' };
  }
  ms.autoFilter = { from: 'A1', to: 'K1' };

  // ---- Payment history -------------------------------------------------------------------
  const ps = wb.addWorksheet('Payment History', { properties: { tabColor: { argb: 'FF1BAF7A' } }, views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ps.columns = [
    { header: 'Member Code\nসদস্য কোড', key: 'code', width: 16 },
    { header: 'Name\nনাম', key: 'name', width: 26 },
    ...months.map(m => ({ header: m, key: m, width: 11 })),
  ];
  styleHeader(ps.getRow(1));
  // Month headers must stay TEXT so Excel doesn't turn them into dates in some locales
  months.forEach((m, i) => { const c = ps.getRow(1).getCell(3 + i); c.value = m; c.numFmt = '@'; });
  const ex1: Record<string, any> = { code: 'EX-0001', name: 'Example: Rahim Uddin' };
  months.forEach((m, i) => { ex1[m] = i === 4 ? '' : i % 3 === 0 ? 'P' : defaultDue; });
  const ex2: Record<string, any> = { code: 'EX-0002', name: 'Example: Karima Begum' };
  months.slice(-2).forEach(m => { ex2[m] = defaultDue; });
  for (const e of [ex1, ex2]) ps.addRow(e).font = { italic: true, color: { argb: GREY } };
  for (let c = 3; c < 3 + months.length; c++) ps.getColumn(c).numFmt = '#,##0';
  const note = ps.getCell(`A${6}`);
  note.value = 'Enter the amount paid for each month (or P = paid in full). Empty / 0 = not paid. Add more month columns (YYYY-MM) on the right or before the first month if needed.';
  note.font = { italic: true, color: { argb: GREY } };
  ps.getCell('A7').value = 'প্রতি মাসের ঘরে পরিশোধিত টাকা লিখুন (বা P = পূর্ণ পরিশোধ)। ফাঁকা/0 = অপরিশোধিত। প্রয়োজনে আরও মাসের কলাম (YYYY-MM) যোগ করুন।';
  ps.getCell('A7').font = { italic: true, color: { argb: GREY } };

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 34;
  row.eachCell(c => {
    const required = /\*/.test(String(c.value));
    c.font = { bold: true, color: { argb: required ? 'FF0F4A3C' : 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? AMBER : BRAND } };
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = { bottom: { style: 'thin', color: { argb: BRAND } } };
  });
}

/** Optional: export current members in the same layout (for round-tripping corrections). */
export async function buildMembersExport(members: any[], payments: Array<{ member_code: string; payment_month: string; contribution_amount: number }>, months: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ms = wb.addWorksheet('Members', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ms.columns = [
    { header: 'Member Code\nসদস্য কোড', key: 'member_code', width: 16 }, { header: 'Name *\nনাম', key: 'name', width: 26 },
    { header: 'Name (Bangla)\nবাংলায় নাম', key: 'name_bn', width: 24 }, { header: 'Phone\nমোবাইল', key: 'phone', width: 16 },
    { header: 'Email\nইমেইল', key: 'email', width: 26 }, { header: 'Designation\nপদবি', key: 'designation', width: 16 },
    { header: 'Status\nঅবস্থা', key: 'status', width: 12 }, { header: 'Monthly Due\nমাসিক চাঁদা', key: 'monthly_due', width: 14 },
    { header: 'Join Date *\nযোগদানের তারিখ', key: 'join_date', width: 16 }, { header: 'Opening Balance\nআগের মোট পরিশোধ', key: 'opening_balance', width: 18 },
    { header: 'Notes\nমন্তব্য', key: 'notes', width: 30 },
  ];
  styleHeader(ms.getRow(1));
  for (const m of members) {
    const [y, mo, d] = String(m.join_date || '').split('-').map(Number);
    ms.addRow({ ...m, join_date: y ? new Date(Date.UTC(y, mo - 1, d)) : null });
  }
  ms.getColumn('join_date').numFmt = 'dd/mm/yyyy';
  const ps = wb.addWorksheet('Payment History', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ps.columns = [{ header: 'Member Code\nসদস্য কোড', key: 'code', width: 16 }, { header: 'Name\nনাম', key: 'name', width: 26 }, ...months.map(m => ({ header: m, key: m, width: 11 }))];
  styleHeader(ps.getRow(1));
  const byMember = new Map<string, Record<string, number>>();
  for (const p of payments) {
    if (!byMember.has(p.member_code)) byMember.set(p.member_code, {});
    byMember.get(p.member_code)![p.payment_month] = p.contribution_amount;
  }
  for (const m of members) ps.addRow({ code: m.member_code, name: m.name, ...(byMember.get(m.member_code) || {}) });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
