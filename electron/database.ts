/**
 * Bondhu Fund — database service (Electron main process).
 *
 * SQLite runs here via sql.js (pure WASM, no native build), so the renderer never
 * holds the database and never ships the whole file over IPC on every write.
 *
 * Storage conventions (schema v1+):
 *   - dates  : 'YYYY-MM-DD'   (ISO, sortable, comparable in SQL)
 *   - months : 'YYYY-MM'
 *   - a collection row exists ONLY for a real payment; Pending/Overdue are derived
 *     from members x months x due day, so dues never need to be "generated".
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type { ParsedWorkbook } from './excel';
import { buildPlan, validateTerms, compareTerms, COMMON_TERMS, allocatePayment, scheduleState, addMonthsKeepDay, daysBetween, LOAN_METHODS, type LoanTerms, type LoanMethod } from './loans';

export const SCHEMA_VERSION = 9;

let SQL: SqlJsStatic;
let db: Database;
let dbPath = '';
let saveTimer: NodeJS.Timeout | null = null;
let dirty = false;
let actor = 'System';

type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------
function all(sql: string, params: any[] = []): Row[] {
  const st = db.prepare(sql);
  try {
    st.bind(params.map(p => (p === undefined ? null : p)));
    const out: Row[] = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}
const get = (sql: string, params: any[] = []): Row | undefined => all(sql, params)[0];
// NB: sql.js runs only the FIRST statement when params are passed, so multi-statement SQL must go without params.
const run = (sql: string, params: any[] = []) =>
  params.length ? db.run(sql, params.map(p => (p === undefined ? null : p))) : db.run(sql);
const num = (sql: string, params: any[] = []): number => {
  const r = get(sql, params);
  return r ? Number(Object.values(r)[0]) || 0 : 0;
};
const lastId = () => num('SELECT last_insert_rowid()');
const tableExists = (name: string) => !!get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [name]);

function tx<T>(fn: () => T): T {
  run('BEGIN');
  try {
    const r = fn();
    run('COMMIT');
    return r;
  } catch (e) {
    try { run('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

let changeHook: (() => void) | null = null;
/** Google sync wants to know when real data changed (not sign-ins or backup log lines). */
export function setChangeHook(fn: (() => void) | null) { changeHook = fn; }

let accessGate: ((username: string) => string | null) | null = null;
/** The software licence: while it returns a message for a username, that user cannot sign in or keep working (iqbal_labs is never asked). Nothing in the data is touched. */
export function setAccessGate(fn: ((username: string) => string | null) | null) { accessGate = fn; }

/** `noise`: the change is bookkeeping (a sign-in, a backup log line) and must not count as "data changed" for cloud sync. */
function mutated(noise = false) {
  dirty = true;
  if (!noise) { try { changeHook?.(); } catch { /* sync must never break a save */ } }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

let actorId: number | null = null;

function audit(action: string, entity: string, entityId: number | null, details = '') {
  run(`INSERT INTO audit_log (user_name, user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)`,
    [actor, actorId, action, entity, entityId, details]);
}

/** Adds a column if it is missing (idempotent migrations that work on fresh, v1 and prototype DBs). */
function addColumn(table: string, column: string, def: string) {
  if (!all(`PRAGMA table_info(${table})`).some(c => c.name === column)) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

/** Schema v2: profiles, sign-in ready columns (unused until sign-in is enabled), Bangla names, audit user id. */
function ensureV2Columns() {
  for (const [c, d] of [
    ['phone', 'TEXT'], ['designation', 'TEXT'], ['address', 'TEXT'], ['bio', 'TEXT'], ['avatar', 'TEXT'],
    ['password_hash', 'TEXT'], ['password_salt', 'TEXT'], ['must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
    ['failed_logins', 'INTEGER NOT NULL DEFAULT 0'], ['last_login_at', 'TEXT'], ['updated_at', 'TEXT'],
  ]) addColumn('users', c, d);
  addColumn('members', 'name_bn', 'TEXT');
  addColumn('users', 'full_name_bn', 'TEXT');
  addColumn('members', 'nid', 'TEXT');
  run("CREATE UNIQUE INDEX IF NOT EXISTS idx_members_nid ON members(nid) WHERE nid IS NOT NULL AND nid != ''");
  addColumn('master_data', 'name_bn', 'TEXT');
  for (const [, n, , bn] of DEFAULT_MASTER) run('UPDATE master_data SET name_bn = ? WHERE name = ? AND name_bn IS NULL', [bn, n]);
  addColumn('audit_log', 'user_id', 'INTEGER');
  run('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, id)');
}

/** Schema v6: structured guarantor details on personal loans (v5 only had a free-text name). */
function ensureLoanColumns() {
  for (const [c, d] of [
    ['guarantor_type', 'TEXT'], ['guarantor_member_id', 'INTEGER'], ['guarantor_name', 'TEXT'], ['guarantor_address', 'TEXT'],
    ['guarantor_nid', 'TEXT'], ['guarantor_phone', 'TEXT'], ['guarantor_relation', 'TEXT'],
    // schema v7: the signed consent paper that must exist before disbursement
    ['application_no', 'TEXT'], ['consent_status', 'TEXT'], ['consent_file', 'TEXT'], ['consent_name', 'TEXT'], ['consent_size', 'INTEGER'], ['consent_sha256', 'TEXT'], ['consent_uploaded_at', 'TEXT'],
  ]) addColumn('personal_loans', c, d);
  run('CREATE INDEX IF NOT EXISTS idx_loans_guarantor ON personal_loans(guarantor_member_id)');
}

/** Image data URLs (avatar/logo) are stored inline; keep them small. */
function checkImage(v: any, label: string) {
  if (v === undefined || v === null || v === '') return;
  if (typeof v !== 'string' || !/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(v)) fail(`${label} must be a PNG, JPG, WEBP or SVG image.`);
  if (v.length > 800_000) fail(`${label} is too large. Please use an image under 500 KB.`);
}

function fail(msg: string): never {
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIdx = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const currentMonthKey = () => todayISO().slice(0, 7);

/** Accepts 'YYYY-MM', 'YYYY-MM-DD', 'June 2024', 'Jun 2024'. */
export function toMonthKey(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^([A-Za-z]+)[\s,-]+(\d{4})$/);
  if (m && monthIdx(m[1]) >= 0) return `${m[2]}-${pad(monthIdx(m[1]) + 1)}`;
  return null;
}

/** Accepts ISO, 'DD/MM/YYYY', '05 Jun 2024', '05 June', 'June 5, 2024'. */
export function toISODate(v: any, fallbackYear?: number): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {   // a real calendar date only (2025-99-99 or 2025-02-30 are not dates)
    const y = +m[1], mo = +m[2], dd = +m[3], t = new Date(Date.UTC(y, mo - 1, dd));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === dd ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})?$/);
  if (m && monthIdx(m[2]) >= 0) {
    const y = m[3] ? +m[3] : fallbackYear;
    if (y) return `${y}-${pad(monthIdx(m[2]) + 1)}-${pad(+m[1])}`;
  }
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && monthIdx(m[1]) >= 0) return `${m[3]}-${pad(monthIdx(m[1]) + 1)}-${pad(+m[2])}`;
  const t = Date.parse(s);
  return isNaN(t) ? null : todayISO(new Date(t));
}

export function addMonths(key: string, n: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const daysInMonth = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const dueDateOf = (key: string, dueDay: number) => `${key}-${pad(Math.min(Math.max(1, dueDay), daysInMonth(key)))}`;
const monthEnd = (key: string) => `${key}-${pad(daysInMonth(key))}`;
const monthArg = (v: any) => toMonthKey(v) || currentMonthKey();

const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : p[0]?.[1] || '')).toUpperCase() || 'NA';
};

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL, email TEXT, role TEXT NOT NULL,
  avatar_initials TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS master_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, is_active INTEGER NOT NULL DEFAULT 1, UNIQUE(type, name COLLATE NOCASE));
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT, member_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL, phone TEXT, email TEXT, designation TEXT DEFAULT 'Member',
  status TEXT NOT NULL DEFAULT 'Active', monthly_due REAL NOT NULL DEFAULT 2000,
  join_date TEXT NOT NULL, avatar_initials TEXT NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  payment_month TEXT NOT NULL, payment_date TEXT NOT NULL,
  contribution_amount REAL NOT NULL DEFAULT 0, late_fee REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'Cash',
  trx_id TEXT, note TEXT, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(member_id, payment_month));
CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sector TEXT NOT NULL,
  purchase_date TEXT NOT NULL, invested_amount REAL NOT NULL, current_estimated_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Growing', review_date TEXT, location_details TEXT, notes TEXT,
  sold_date TEXT, sold_amount REAL, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, expense_date TEXT NOT NULL, payee TEXT, receipt_ref TEXT,
  status TEXT NOT NULL DEFAULT 'Verified', notes TEXT, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS investment_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id INTEGER NOT NULL REFERENCES investments(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('Profit','Loss')),
  amount REAL NOT NULL CHECK (amount > 0),
  entry_date TEXT NOT NULL, payment_method TEXT, reference TEXT, note TEXT, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS member_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL UNIQUE REFERENCES members(id),
  settlement_date TEXT NOT NULL,
  principal REAL NOT NULL,            -- opening balance + contributions (late fees are not refunded)
  calc_profit_share REAL NOT NULL DEFAULT 0,  -- what the system calculated
  profit_share REAL NOT NULL DEFAULT 0,       -- what was actually settled (negative = share of a loss)
  total_paid REAL NOT NULL CHECK (total_paid >= 0),
  payment_method TEXT NOT NULL, trx_id TEXT, note TEXT, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS personal_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_no TEXT NOT NULL UNIQUE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  principal REAL NOT NULL CHECK (principal > 0),
  method TEXT NOT NULL CHECK (method IN ('reducing','flat','free')),
  annual_rate REAL NOT NULL DEFAULT 0,
  term_months INTEGER NOT NULL CHECK (term_months >= 1),
  disbursed_date TEXT NOT NULL, first_due_date TEXT NOT NULL,
  installment REAL NOT NULL, total_interest REAL NOT NULL, total_payable REAL NOT NULL,   -- fixed when the loan is made
  payment_method TEXT, reference TEXT, purpose TEXT, guarantor TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Closed','Written off')),
  closed_date TEXT,
  written_off_amount REAL NOT NULL DEFAULT 0, written_off_date TEXT, written_off_reason TEXT,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS loan_schedule (
  loan_id INTEGER NOT NULL REFERENCES personal_loans(id) ON DELETE CASCADE,
  no INTEGER NOT NULL, due_date TEXT NOT NULL,
  principal REAL NOT NULL, interest REAL NOT NULL, total REAL NOT NULL,
  PRIMARY KEY (loan_id, no));
CREATE TABLE IF NOT EXISTS loan_repayments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES personal_loans(id) ON DELETE CASCADE,
  paid_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Installment' CHECK (kind IN ('Installment','Closure')),
  principal_paid REAL NOT NULL DEFAULT 0, interest_paid REAL NOT NULL DEFAULT 0, penalty_paid REAL NOT NULL DEFAULT 0,
  total_paid REAL NOT NULL CHECK (total_paid > 0),   -- = principal + interest + penalty
  payment_method TEXT, trx_id TEXT, note TEXT, created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS investment_reviews (            -- schema v9: what the committee decided at each review meeting
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  meeting_date TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('Hold','Watch','Sell','Other')),
  notes TEXT,
  value_before REAL NOT NULL, value_after REAL NOT NULL,   -- the estimated market value before and as agreed at the meeting
  status_after TEXT, next_review_date TEXT,
  attendees TEXT,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_invrev_inv ON investment_reviews(investment_id, meeting_date);
CREATE TABLE IF NOT EXISTS loan_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_no TEXT NOT NULL UNIQUE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  principal REAL NOT NULL, method TEXT NOT NULL, annual_rate REAL NOT NULL DEFAULT 0, term_months INTEGER NOT NULL,
  disbursed_date TEXT NOT NULL, first_due_date TEXT NOT NULL,
  installment REAL NOT NULL, total_interest REAL NOT NULL, total_payable REAL NOT NULL,   -- exactly what is printed on the consent paper
  payment_method TEXT, reference TEXT, purpose TEXT, notes TEXT, limit_note TEXT,
  guarantor TEXT, guarantor_type TEXT, guarantor_member_id INTEGER, guarantor_name TEXT, guarantor_address TEXT, guarantor_nid TEXT, guarantor_phone TEXT, guarantor_relation TEXT,
  consent_file TEXT, consent_name TEXT, consent_size INTEGER, consent_sha256 TEXT, consent_uploaded_at TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',           -- Draft → Activated (the loan exists). A draft never touches the books.
  loan_id INTEGER, created_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_loanapp_status ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_loans_member ON personal_loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON personal_loans(status);
CREATE INDEX IF NOT EXISTS idx_loanrep_loan ON loan_repayments(loan_id, id);
CREATE INDEX IF NOT EXISTS idx_loanrep_date ON loan_repayments(paid_date);
CREATE INDEX IF NOT EXISTS idx_ret_inv ON investment_returns(investment_id);
CREATE INDEX IF NOT EXISTS idx_ret_date ON investment_returns(entry_date);
CREATE TABLE IF NOT EXISTS backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL, backup_type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now','localtime')),
  user_name TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, details TEXT);

CREATE INDEX IF NOT EXISTS idx_members_status_join ON members(status, join_date);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
CREATE INDEX IF NOT EXISTS idx_coll_month ON collections(payment_month);
CREATE INDEX IF NOT EXISTS idx_coll_date ON collections(payment_date);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_exp_cat ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_inv_status ON investments(status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`;

const DEFAULT_SETTINGS: Record<string, string> = {
  organization_name: 'Bondhu Fund',
  currency_symbol: 'TK',
  default_monthly_due: '2000',
  monthly_due_day: '10',
  late_fee_amount: '300',
  hijri_adjust_days: '0',
  fiscal_year_start_month: '7',
  last_backup_date: 'Never',
  active_user_id: '1',
  auto_backup_enabled: '1',
  auto_backup_keep: '14',
  organization_name_bn: '',
  org_logo: '',
  // personal-loan policy (suggestions on the loan form; Admin can change them)
  loan_default_rate: '12',
  loan_default_method: 'reducing',
  loan_max_multiple: '0',     // 0 = no limit; otherwise a member's loans may not exceed this × their savings without a written reason
  loan_late_fee: '0',         // suggested penalty per installment paid late (0 = none)
  loan_consent_required: '1', // 1 = a loan is a draft until its signed consent paper is uploaded; 0 = loans are disbursed immediately
};

const DEFAULT_MASTER: Array<[string, string, string, string]> = [
  ['expense_category', 'Meetup & Events', 'Annual and monthly gatherings', 'সভা ও অনুষ্ঠান'],
  ['expense_category', 'Office & Supplies', 'Stationery, printing', 'অফিস ও সরঞ্জাম'],
  ['expense_category', 'Legal & Documentation', 'Deeds, mutation, lawyer fees', 'আইনি ও দলিলপত্র'],
  ['expense_category', 'Bank Charges', 'Transfer and account fees', 'ব্যাংক চার্জ'],
  ['expense_category', 'Maintenance', 'Property upkeep', 'রক্ষণাবেক্ষণ'],
  ['expense_category', 'Emergency Support', 'Member welfare support', 'জরুরি সহায়তা'],
  ['investment_sector', 'Land', 'Land purchase', 'জমি'],
  ['investment_sector', 'Flat', 'Residential or commercial flat', 'ফ্ল্যাট'],
  ['investment_sector', 'Plot', 'Residential plot', 'প্লট'],
  ['investment_sector', 'Fixed Deposit', 'Bank FDR / savings certificate', 'স্থায়ী আমানত (এফডিআর)'],
  ['investment_sector', 'Business Assets', 'Machinery, vehicles, shared assets', 'ব্যবসায়িক সম্পদ'],
  ['payment_method', 'Cash', '', 'নগদ'],
  ['payment_method', 'Bank transfer', '', 'ব্যাংক ট্রান্সফার'],
  ['payment_method', 'bKash', '', 'বিকাশ'],
  ['payment_method', 'Nagad', '', 'নগদ (মোবাইল)'],
  ['payment_method', 'Rocket', '', 'রকেট'],
  ['payment_method', 'Cheque', '', 'চেক'],
];

function ensureDefaults() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?,?)', [k, v]);
  if (num('SELECT COUNT(*) FROM master_data') === 0) {
    for (const [t, n, d, bn] of DEFAULT_MASTER) run('INSERT OR IGNORE INTO master_data (type, name, description, name_bn) VALUES (?,?,?,?)', [t, n, d, bn]);
  }
  if (num('SELECT COUNT(*) FROM users') === 0) {
    run(`INSERT INTO users (username, full_name, email, role, avatar_initials) VALUES ('admin','Administrator','', 'Admin','AD')`);
  }
}

/** Upgrades any database (fresh, Gemini-era v0, or older backup) to SCHEMA_VERSION. */
function migrate(target: Database) {
  const prev = db;
  db = target;
  try {
    const version = num('PRAGMA user_version');
    if (version > SCHEMA_VERSION) {
      fail(`This backup was created by a newer version of Bondhu Fund (schema v${version}). Please update the app first.`);
    }
    if (version === 0) {
      if (tableExists('members')) migrateLegacyV0();
      else run(SCHEMA);
    }
    // future: if (version < 2) { ... }
    run(SCHEMA); // idempotent: creates any missing table/index
    ensureV2Columns();
    ensureLoanColumns();
    addColumn('users', 'permissions', 'TEXT');   // schema v8: the Super User's per-module access grants (JSON); NULL = the role's default
    ensureDefaults();
    ensureAccounts();
    run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    run('PRAGMA foreign_keys = ON');
  } finally {
    if (prev) db = prev;
  }
}

/** The prototype stored display strings ('June 2024', '05 Jun 2024') and placeholder Pending rows. */
function migrateLegacyV0() {
  const grab = (t: string) => (tableExists(t) ? all(`SELECT * FROM ${t}`) : []);
  const L = {
    settings: grab('app_settings'), users: grab('users'), master: grab('master_data'), members: grab('members'),
    collections: grab('collections'), investments: grab('investments'), expenses: grab('expenses'), backups: grab('backup_logs'),
  };
  run('PRAGMA foreign_keys = OFF');
  for (const t of ['collections', 'members', 'investments', 'expenses', 'master_data', 'users', 'backup_logs', 'app_settings', 'audit_log']) {
    run(`DROP TABLE IF EXISTS ${t}`);
  }
  run(SCHEMA);

  for (const s of L.settings) run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)', [s.key, s.value]);
  for (const u of L.users) {
    run(`INSERT OR IGNORE INTO users (id, username, full_name, email, role, avatar_initials, status, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [u.id, u.username, u.full_name, u.email, u.role, u.avatar_initials || initials(u.full_name || 'U'), u.status || 'Active', u.created_at]);
  }
  for (const m of L.master) {
    run('INSERT OR IGNORE INTO master_data (id, type, name, description, is_active) VALUES (?,?,?,?,?)',
      [m.id, m.type, m.name, m.description, m.is_active ?? 1]);
  }

  const paid = L.collections.filter(c => c.status === 'Paid' || Number(c.total_amount) > 0);
  const paidByMember = new Map<number, number>();
  for (const c of paid) paidByMember.set(c.member_id, (paidByMember.get(c.member_id) || 0) + (Number(c.contribution_amount) || 0));

  for (const m of L.members) {
    const opening = Math.max(0, (Number(m.total_contributed) || 0) - (paidByMember.get(m.id) || 0));
    run(`INSERT INTO members (id, member_code, name, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [m.id, m.member_code, m.name, m.phone, m.email, m.designation || 'Member', m.status || 'Active', Number(m.monthly_due) || 2000,
        toISODate(m.join_date) || '2023-01-01', m.avatar_initials || initials(m.name), opening, m.created_at]);
  }
  for (const c of paid) {
    const mk = toMonthKey(c.payment_month) || toISODate(c.payment_date)?.slice(0, 7) || currentMonthKey();
    const pd = toISODate(c.payment_date, +mk.slice(0, 4)) || dueDateOf(mk, 10);
    run(`INSERT INTO collections (member_id, payment_month, payment_date, contribution_amount, late_fee, total_amount, payment_method, trx_id, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(member_id, payment_month) DO UPDATE SET
           contribution_amount = contribution_amount + excluded.contribution_amount,
           late_fee = late_fee + excluded.late_fee, total_amount = total_amount + excluded.total_amount`,
      [c.member_id, mk, pd, Number(c.contribution_amount) || 0, Number(c.late_fee) || 0,
        Number(c.total_amount) || (Number(c.contribution_amount) || 0) + (Number(c.late_fee) || 0),
        c.payment_method || 'Cash', c.trx_id, c.note, c.created_at]);
  }
  for (const i of L.investments) {
    run(`INSERT INTO investments (id, name, sector, purchase_date, invested_amount, current_estimated_value, status, review_date, location_details, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [i.id, i.name, i.sector || i.sector_name || 'Other', toISODate(i.purchase_date) || todayISO(), Number(i.invested_amount) || 0,
        Number(i.current_estimated_value) || Number(i.invested_amount) || 0, i.status || 'Growing', toISODate(i.review_date),
        i.location_details, i.notes, i.created_at]);
  }
  for (const e of L.expenses) {
    run(`INSERT INTO expenses (id, title, category, amount, expense_date, payee, receipt_ref, status, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [e.id, e.title, e.category || e.category_name || 'Other', Number(e.amount) || 0, toISODate(e.expense_date) || todayISO(),
        e.payee, e.receipt_ref, e.status || 'Verified', e.notes, e.created_at]);
  }
  for (const b of L.backups) {
    run('INSERT INTO backup_logs (file_name, file_path, file_size, backup_type, created_at) VALUES (?,?,?,?,?)',
      [b.file_name, b.file_path, b.file_size || 0, b.backup_type || 'Manual', b.created_at]);
  }
  run(`INSERT INTO audit_log (user_name, action, entity, details) VALUES ('System','migrate','database','Upgraded prototype database to schema v1')`);
}

// ---------------------------------------------------------------------------
// Lifecycle (called from main.ts)
// ---------------------------------------------------------------------------
export async function openDatabase(file: string, wasmBinary: Buffer, fallbackFiles: string[] = []) {
  dbPath = file;
  SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });

  for (const candidate of [file, ...fallbackFiles]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const d = new SQL.Database(fs.readFileSync(candidate));
      if ((d.exec('PRAGMA quick_check')[0]?.values[0]?.[0]) !== 'ok') throw new Error('integrity check failed');
      migrate(d);
      db = d;
      if (candidate !== file) console.warn(`Primary database unreadable; recovered from ${candidate}`);
      flush();
      return;
    } catch (e) {
      console.error(`Could not open ${candidate}:`, e);
      if (candidate === file) {
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      }
    }
  }
  const fresh = new SQL.Database();
  migrate(fresh);
  db = fresh;
  flush();
}

/** Synchronously writes the database to disk (atomic temp-file + rename). */
export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!db || !dbPath) return;
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  try {
    fs.renameSync(tmp, dbPath);
  } catch {
    fs.copyFileSync(tmp, dbPath);
    fs.unlinkSync(tmp);
  }
  dirty = false;
  // sql.js export() resets pragmas on some builds; re-assert
  run('PRAGMA foreign_keys = ON');
}
export const isDirty = () => dirty;
export const exportBytes = (): Buffer => { flush(); return Buffer.from(db.export()); };

/** Validates + migrates a backup, then swaps it in. Throws with a readable message. */
export function replaceWith(bytes: Buffer) {
  if (bytes.length < 100 || bytes.subarray(0, 15).toString('ascii') !== 'SQLite format 3') {
    fail('The selected file is not a SQLite database.');
  }
  let candidate: Database;
  try {
    candidate = new SQL.Database(bytes);
  } catch {
    fail('The selected file is damaged and cannot be opened.');
  }
  const check = candidate.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
  if (check !== 'ok') { candidate.close(); fail(`Backup failed integrity check: ${check}`); }
  if (!candidate.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='members'`).length) {
    candidate.close();
    fail('This file is not a Bondhu Fund backup (members table missing).');
  }
  migrate(candidate);
  const old = db;
  db = candidate;
  old?.close();
  flush();
  try { changeHook?.(); } catch { /* ignore */ }   // the data is now different from whatever was last synced (cloud sync resets this after a pull)
}

export function setActor(name: string, id?: number | null) { actor = name || 'System'; actorId = id ?? null; }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function settingsMap(): Record<string, string> {
  const m: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM app_settings')) m[r.key] = r.value;
  return m;
}
const dueDay = () => Number(settingsMap().monthly_due_day) || 10;

function getAppSettings() {
  const s = settingsMap();
  return {
    organization_name: s.organization_name,
    currency_symbol: s.currency_symbol,
    default_monthly_due: Number(s.default_monthly_due),
    monthly_due_day: Number(s.monthly_due_day),
    late_fee_amount: Number(s.late_fee_amount),
    hijri_adjust_days: Number.isFinite(Number(s.hijri_adjust_days)) ? Number(s.hijri_adjust_days) : 0,
    fiscal_year_start_month: Number(s.fiscal_year_start_month),
    last_backup_date: s.last_backup_date,
    active_user_id: Number(s.active_user_id),
    auto_backup_enabled: s.auto_backup_enabled === '1',
    auto_backup_keep: Number(s.auto_backup_keep) || 14,
    organization_name_bn: s.organization_name_bn || '',
    org_logo: s.org_logo || '',
    loan_default_rate: Number(s.loan_default_rate) || 0,
    loan_default_method: (LOAN_METHODS as string[]).includes(s.loan_default_method) ? s.loan_default_method : 'reducing',
    loan_max_multiple: Number(s.loan_max_multiple) || 0,
    loan_late_fee: Number(s.loan_late_fee) || 0,
    loan_consent_required: s.loan_consent_required !== '0',
  };
}

function saveAppSettings(patch: Record<string, any>) {
  tx(() => {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      const val = typeof v === 'boolean' ? (v ? '1' : '0') : String(v ?? '');
      if (['default_monthly_due', 'late_fee_amount'].includes(k) && (isNaN(+val) || +val < 0)) fail(`${k} must be a positive number`);
      if (k === 'hijri_adjust_days' && !(Number.isInteger(+val) && +val >= -3 && +val <= 3)) fail('Hijri adjustment must be a whole number from -3 to 3');
      if (k === 'monthly_due_day' && (!(+val >= 1 && +val <= 28))) fail('Due day must be between 1 and 28');
      if (k === 'org_logo') checkImage(val, 'Logo');
      if (k === 'loan_default_rate' && !(Number.isFinite(+val) && +val >= 0 && +val <= 100)) fail('Default loan interest rate must be between 0 and 100 percent a year.');
      if (k === 'loan_default_method' && !(LOAN_METHODS as string[]).includes(val)) fail('Choose a valid default interest method.');
      if (k === 'loan_max_multiple' && !(Number.isFinite(+val) && +val >= 0 && +val <= 100)) fail('Loan limit must be 0 (no limit) or a positive multiple.');
      if (k === 'loan_late_fee' && !(Number.isFinite(+val) && +val >= 0)) fail('Loan late fee cannot be negative.');
      run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)', [k, val]);
    }
    audit('update', 'settings', null, Object.keys(patch || {}).join(', '));
  });
  mutated();
}

// ---------------------------------------------------------------------------
// Dues engine — one SQL fragment used by members, collections, overview, reports
// ---------------------------------------------------------------------------
/** Rows = every member who owes for `mk` (active & joined) plus anyone who actually paid. */
function duesForMonth(mk: string, today = todayISO()) {
  const due = dueDateOf(mk, dueDay());
  return {
    sql: `
      SELECT m.id AS member_id, m.member_code, m.name AS member_name, m.name_bn AS member_name_bn, m.phone AS member_phone,
             m.monthly_due, m.avatar_initials, m.nid AS member_nid,
             c.id AS payment_id, c.payment_date, COALESCE(c.contribution_amount,0) AS contribution_amount,
             COALESCE(c.late_fee,0) AS late_fee, COALESCE(c.total_amount,0) AS total_amount,
             c.payment_method, c.trx_id, c.note, c.created_at,
             ? AS payment_month, ? AS due_date,
             CASE WHEN c.id IS NOT NULL THEN 'Paid' WHEN ? > ? THEN 'Overdue' ELSE 'Pending' END AS status
      FROM members m
      LEFT JOIN collections c ON c.member_id = m.id AND c.payment_month = ?
      WHERE c.id IS NOT NULL OR (m.status = 'Active' AND substr(m.join_date,1,7) <= ?)`,
    params: [mk, due, today, due, mk, mk],
  };
}

function monthSummary(mk: string) {
  const d = duesForMonth(mk);
  const r = get(`
    SELECT COUNT(*) AS total,
      SUM(status='Paid') AS paid, SUM(status='Pending') AS pending, SUM(status='Overdue') AS overdue,
      SUM(monthly_due) AS expected,
      SUM(contribution_amount) AS collected, SUM(late_fee) AS late_fees, SUM(total_amount) AS received,
      SUM(CASE WHEN status!='Paid' THEN monthly_due ELSE 0 END) AS outstanding
    FROM (${d.sql})`, d.params) || {};
  const n = (k: string) => Number(r[k]) || 0;
  return {
    total: n('total'), paid: n('paid'), pending: n('pending'), overdue: n('overdue'),
    expected: n('expected'), collected: n('collected'), lateFees: n('late_fees'),
    received: n('received'), outstanding: n('outstanding'),
    rate: n('expected') > 0 ? +(100 * n('collected') / n('expected')).toFixed(1) : 0,
  };
}

/** Fund position as of a date (inclusive). Investments are a cash→asset transfer at cost. */
function fundPosition(asOf = todayISO()) {
  const opening = num('SELECT SUM(opening_balance) FROM members');
  const collected = num('SELECT SUM(total_amount) FROM collections WHERE payment_date <= ?', [asOf]);
  const expenses = num('SELECT SUM(amount) FROM expenses WHERE expense_date <= ?', [asOf]);
  const realized = num(`SELECT SUM(sold_amount - invested_amount) FROM investments WHERE status='Sold' AND sold_date <= ?`, [asOf]);
  const investedAtCost = num(`SELECT SUM(invested_amount) FROM investments WHERE purchase_date <= ? AND NOT (status='Sold' AND sold_date <= ?)`, [asOf, asOf]);
  // investment benefits received (+) and losses booked (-), and money paid out to settled members
  const returnsNet = num(`SELECT SUM(CASE entry_type WHEN 'Profit' THEN amount ELSE -amount END) FROM investment_returns WHERE entry_date <= ?`, [asOf]);
  const settlements = num('SELECT SUM(total_paid) FROM member_settlements WHERE settlement_date <= ?', [asOf]);
  // personal loans: lending is a cash → receivable transfer (net worth unchanged); interest and penalties are income;
  // a write-off is a loss. The unpaid principal is an asset held at cost, exactly like an investment.
  const loansLent = num('SELECT SUM(principal) FROM personal_loans WHERE disbursed_date <= ?', [asOf]);
  const loanPrincipalBack = num('SELECT SUM(principal_paid) FROM loan_repayments WHERE paid_date <= ?', [asOf]);
  const loanIncome = num('SELECT SUM(interest_paid + penalty_paid) FROM loan_repayments WHERE paid_date <= ?', [asOf]);
  const loanWrittenOff = num(`SELECT SUM(written_off_amount) FROM personal_loans WHERE status = 'Written off' AND written_off_date <= ?`, [asOf]);
  const loansOutstanding = r2(loansLent - loanPrincipalBack - loanWrittenOff);
  const fundBalance = opening + collected - expenses + realized + returnsNet - settlements + loanIncome - loanWrittenOff;
  return { opening, collected, expenses, realized, returnsNet, settlements, investedAtCost, loansOutstanding, loanIncome, loanWrittenOff, fundBalance, cashInHand: fundBalance - investedAtCost - loansOutstanding };
}

// ---------------------------------------------------------------------------
// Member settlement (exit payout) — principal + the member's share of investment benefit
// ---------------------------------------------------------------------------
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Share of investment benefit, from the date each benefit was earned.
 * Every benefit event (profit entry, loss entry, realised gain/loss on a sale, loan interest, a loan written off) is split between the members
 * who were still in the fund on that date, in proportion to each member's principal (opening balance + contributions paid up to that date).
 * A member only shares in events dated up to their settlement date.
 * Computed for all members in one pass, so the settlement of one member and the books-balance check use exactly the same arithmetic.
 *   own = the member being settled: counts as present up to `own.date` (instead of any settlement already recorded for him).
 *   unallocated = benefit that had nobody to be shared with (no member in the fund on that date): it stays in the fund.
 */
type BenefitEvent = { date: string; amount: number; label: string; borrower?: number };
function benefitEvents(settleDate: string): BenefitEvent[] {
  const events = [
    ...all(`SELECT r.entry_date AS date, CASE r.entry_type WHEN 'Profit' THEN r.amount ELSE -r.amount END AS amount, i.name AS label
            FROM investment_returns r JOIN investments i ON i.id = r.investment_id WHERE r.entry_date <= ?`, [settleDate]),
    ...all(`SELECT sold_date AS date, sold_amount - invested_amount AS amount, name AS label FROM investments
            WHERE status = 'Sold' AND sold_date IS NOT NULL AND sold_date <= ?`, [settleDate]),
    // loan interest earned by the fund is shared with members like any other benefit; a written-off loan is a shared loss
    ...all(`SELECT r.paid_date AS date, r.interest_paid AS amount, l.loan_no AS label FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id
            WHERE r.interest_paid > 0 AND r.paid_date <= ?`, [settleDate]),
    ...all(`SELECT written_off_date AS date, -written_off_amount AS amount, loan_no AS label, member_id AS borrower FROM personal_loans
            WHERE status = 'Written off' AND written_off_date IS NOT NULL AND written_off_date <= ?`, [settleDate]),
  ].map((e: any) => ({ date: String(e.date), amount: Number(e.amount) || 0, label: String(e.label), borrower: e.borrower ? Number(e.borrower) : undefined }));
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

function benefitAllocation(settleDate: string, own?: { id: number; date: string }) {
  const events = benefitEvents(settleDate);
  const members = all('SELECT id, opening_balance FROM members');
  const pays = new Map<number, Array<{ d: string; a: number }>>();
  for (const r of all('SELECT member_id, payment_date, contribution_amount FROM collections')) {
    if (!pays.has(r.member_id)) pays.set(r.member_id, []);
    pays.get(r.member_id)!.push({ d: String(r.payment_date), a: Number(r.contribution_amount) || 0 });
  }
  const settledOn = new Map<number, string>(all('SELECT member_id, settlement_date FROM member_settlements' + (own ? ' WHERE member_id != ?' : ''), own ? [own.id] : [])
    .map(r => [Number(r.member_id), String(r.settlement_date)]));
  if (own) settledOn.set(own.id, own.date);
  const principalAt = (id: number, opening: number, d: string) =>
    opening + (pays.get(id) || []).reduce((s, p) => s + (p.d <= d ? p.a : 0), 0);

  const total = new Map<number, number>();
  const lines = new Map<number, Array<{ date: string; label: string; amount: number; share: number }>>();
  let unallocated = 0;
  const give = (id: number, ev: BenefitEvent, share: number) => {
    total.set(id, (total.get(id) || 0) + share);
    if (Math.abs(share) >= 0.005) { if (!lines.has(id)) lines.set(id, []); lines.get(id)!.push({ date: ev.date, label: ev.label, amount: ev.amount, share: r2(share) }); }
  };
  for (const ev of events) {
    // A written-off loan is the borrower's own debt: their savings absorb it first; only what their savings cannot cover is shared by the other members.
    let bear = 0, rest = ev.amount;
    if (ev.borrower !== undefined) {
      const bm = members.find(m => Number(m.id) === ev.borrower);
      const bsd = settledOn.get(ev.borrower);
      const pb = bm && !(bsd !== undefined && bsd < ev.date) ? principalAt(ev.borrower, Number(bm.opening_balance) || 0, ev.date) : 0;
      bear = Math.min(-ev.amount, pb);
      rest = ev.amount + bear;                                   // still negative (or zero)
    }
    const eligible: Array<{ id: number; p: number }> = [];
    let all_ = 0;
    for (const m of members) {
      const sd = settledOn.get(Number(m.id));
      if (sd !== undefined && sd < ev.date) continue;          // already paid out before this benefit existed
      if (ev.borrower !== undefined && Number(m.id) === ev.borrower) continue;   // the borrower is charged separately
      const p = principalAt(Number(m.id), Number(m.opening_balance) || 0, ev.date);
      all_ += p;
      eligible.push({ id: Number(m.id), p });
    }
    if (ev.borrower !== undefined) give(ev.borrower, ev, -bear);
    const sharedAmount = ev.borrower !== undefined ? rest : ev.amount;
    if (all_ > 0) for (const e of eligible) give(e.id, ev, (sharedAmount * e.p) / all_);
    else unallocated += sharedAmount;
  }
  return { total, lines, unallocated };
}

function memberBenefitShare(memberId: number, settleDate: string) {
  const a = benefitAllocation(settleDate, { id: Number(memberId), date: settleDate });
  return { share: r2(a.total.get(Number(memberId)) || 0), lines: a.lines.get(Number(memberId)) || [] };
}

// ---------------------------------------------------------------------------
// Fines: late fees on contributions and penalties on loan installments, and the proof that the books balance
// ---------------------------------------------------------------------------
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/**
 * Every fine that was collected, one row each. A contribution late fee belongs to the payment (the month it was for, the day it was paid, the day
 * it was due, how many days late); a loan penalty belongs to a loan repayment. `flag` = 'on_time' when a fine was charged on a payment made by the due date.
 */
function fineRows(f: { start?: string | null; end?: string | null; memberId?: number; source?: string; search?: string }) {
  const dd = dueDay();
  const out: any[] = [];
  const like = f.search?.trim() ? `%${f.search.trim()}%` : null;
  if (f.source !== 'loan') {
    const w = ['c.late_fee > 0']; const p: any[] = [];
    if (f.start) { w.push('c.payment_date >= ?'); p.push(f.start); }
    if (f.end) { w.push('c.payment_date <= ?'); p.push(f.end); }
    if (f.memberId) { w.push('c.member_id = ?'); p.push(f.memberId); }
    if (like) { w.push('(m.name LIKE ? OR m.member_code LIKE ? OR c.trx_id LIKE ? OR c.note LIKE ? OR c.payment_month LIKE ?)'); p.push(like, like, like, like, like); }
    for (const r of all(`SELECT c.id, c.payment_date, c.payment_month, c.late_fee, c.contribution_amount, c.payment_method, c.trx_id, c.note, m.id AS member_id, m.member_code, m.name, m.name_bn
                         FROM collections c JOIN members m ON m.id = c.member_id WHERE ${w.join(' AND ')}`, p)) {
      const due = dueDateOf(String(r.payment_month), dd);
      const late = dayDiff(due, String(r.payment_date));
      out.push({ key: `c${r.id}`, source: 'contribution', id: r.id, date: r.payment_date, month: r.payment_month, due_date: due, days_late: Math.max(0, late), amount: r2(Number(r.late_fee)),
        base: r2(Number(r.contribution_amount)), method: r.payment_method, trx_id: r.trx_id || '', note: r.note || '', member_id: r.member_id, member_code: r.member_code, name: r.name, name_bn: r.name_bn,
        label: `Contribution ${r.payment_month}`, flag: late > 0 ? 'ok' : 'on_time' });
    }
  }
  if (f.source !== 'contribution') {
    const w = ['r.penalty_paid > 0']; const p: any[] = [];
    if (f.start) { w.push('r.paid_date >= ?'); p.push(f.start); }
    if (f.end) { w.push('r.paid_date <= ?'); p.push(f.end); }
    if (f.memberId) { w.push('l.member_id = ?'); p.push(f.memberId); }
    if (like) { w.push('(m.name LIKE ? OR m.member_code LIKE ? OR r.trx_id LIKE ? OR r.note LIKE ? OR l.loan_no LIKE ?)'); p.push(like, like, like, like, like); }
    for (const r of all(`SELECT r.id, r.paid_date, r.penalty_paid, r.total_paid, r.payment_method, r.trx_id, r.note, l.loan_no, m.id AS member_id, m.member_code, m.name, m.name_bn
                         FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id JOIN members m ON m.id = l.member_id WHERE ${w.join(' AND ')}`, p)) {
      out.push({ key: `l${r.id}`, source: 'loan', id: r.id, date: r.paid_date, month: String(r.paid_date).slice(0, 7), due_date: null, days_late: null, amount: r2(Number(r.penalty_paid)),
        base: r2(Number(r.total_paid) - Number(r.penalty_paid)), method: r.payment_method, trx_id: r.trx_id || '', note: r.note || '', member_id: r.member_id, member_code: r.member_code, name: r.name, name_bn: r.name_bn,
        label: `Loan ${r.loan_no} installment`, flag: 'ok' });
    }
  }
  return out;
}

const FINE_SORT: Record<string, (a: any, b: any) => number> = {
  newest: (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.key).localeCompare(String(a.key)),
  oldest: (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.key).localeCompare(String(b.key)),
  amount_high: (a, b) => b.amount - a.amount || String(b.date).localeCompare(String(a.date)),
  amount_low: (a, b) => a.amount - b.amount || String(b.date).localeCompare(String(a.date)),
  member: (a, b) => String(a.member_code).localeCompare(String(b.member_code), undefined, { numeric: true }) || String(b.date).localeCompare(String(a.date)),
  days_late: (a, b) => (b.days_late ?? -1) - (a.days_late ?? -1) || String(b.date).localeCompare(String(a.date)),
};

/** The Fines page: the register, the totals, who pays most, which payments were late without a fine, who is overdue now, and where the money sits. */
function getFineRegister(f: any = {}) {
  const start = toISODate(f.start_date) || null, end = toISODate(f.end_date) || null;
  const memberId = Number(f.member_id) || 0;
  const source = f.source === 'contribution' || f.source === 'loan' ? f.source : 'All';
  const rows = fineRows({ start, end, memberId, source: source === 'All' ? undefined : source, search: String(f.search || '') });
  rows.sort(FINE_SORT[f.sort_by] || FINE_SORT.newest);
  const sum = (xs: any[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
  const totals = { total: sum(rows), contribution: sum(rows.filter(x => x.source === 'contribution')), loan: sum(rows.filter(x => x.source === 'loan')), count: rows.length,
    members: new Set(rows.map(x => x.member_id)).size, onTime: rows.filter(x => x.flag === 'on_time').length, average: rows.length ? r2(sum(rows) / rows.length) : 0 };

  // overall figures (never filtered): what the fund has collected in fines in all, this month, this year
  const mk = todayISO().slice(0, 7), yr = mk.slice(0, 4);
  const pen = (where: string, p: any[] = []) => num(`SELECT SUM(penalty_paid) FROM loan_repayments WHERE penalty_paid > 0 AND ${where}`, p);
  const fee = (where: string, p: any[] = []) => num(`SELECT SUM(late_fee) FROM collections WHERE late_fee > 0 AND ${where}`, p);
  const overall = {
    contribution: r2(fee('1=1')), loan: r2(pen('1=1')), total: r2(fee('1=1') + pen('1=1')),
    thisMonth: r2(fee('substr(payment_date,1,7) = ?', [mk]) + pen('substr(paid_date,1,7) = ?', [mk])),
    thisYear: r2(fee('substr(payment_date,1,4) = ?', [yr]) + pen('substr(paid_date,1,4) = ?', [yr])),
    count: num('SELECT COUNT(*) FROM collections WHERE late_fee > 0') + num('SELECT COUNT(*) FROM loan_repayments WHERE penalty_paid > 0'),
    rate: Number(settingsMap().late_fee_amount) || 0, dueDay: dueDay(),
  };

  const byMonthMap = new Map<string, { month: string; contribution: number; loan: number; total: number; count: number }>();
  for (const x of rows) {
    const k = String(x.date).slice(0, 7);
    const b = byMonthMap.get(k) || { month: k, contribution: 0, loan: 0, total: 0, count: 0 };
    if (x.source === 'loan') b.loan += x.amount; else b.contribution += x.amount;
    b.total += x.amount; b.count++;
    byMonthMap.set(k, b);
  }
  const byMonth = [...byMonthMap.values()].sort((a, b) => b.month.localeCompare(a.month)).map(b => ({ ...b, contribution: r2(b.contribution), loan: r2(b.loan), total: r2(b.total) }));
  const byMemberMap = new Map<number, { member_id: number; member_code: string; name: string; name_bn: string | null; count: number; total: number; last_date: string }>();
  for (const x of rows) {
    const b = byMemberMap.get(x.member_id) || { member_id: x.member_id, member_code: x.member_code, name: x.name, name_bn: x.name_bn, count: 0, total: 0, last_date: '' };
    b.count++; b.total += x.amount; if (String(x.date) > b.last_date) b.last_date = String(x.date);
    byMemberMap.set(x.member_id, b);
  }
  const byMember = [...byMemberMap.values()].sort((a, b) => b.total - a.total || a.member_code.localeCompare(b.member_code, undefined, { numeric: true })).map(b => ({ ...b, total: r2(b.total) }));

  // payments made after the due date with no fine charged (a waiver, or a missed fine) — in the same date range / member
  const dd = dueDay(), rate = overall.rate;
  const lateNoFineAll: any[] = source === 'loan' ? [] : all(`SELECT c.id, c.payment_date, c.payment_month, c.contribution_amount, m.id AS member_id, m.member_code, m.name, m.name_bn
        FROM collections c JOIN members m ON m.id = c.member_id WHERE c.late_fee = 0 ${start ? 'AND c.payment_date >= ?' : ''} ${end ? 'AND c.payment_date <= ?' : ''} ${memberId ? 'AND c.member_id = ?' : ''}`,
    [...(start ? [start] : []), ...(end ? [end] : []), ...(memberId ? [memberId] : [])])
    .map((r: any) => { const due = dueDateOf(String(r.payment_month), dd); return { ...r, due_date: due, days_late: dayDiff(due, String(r.payment_date)) }; })
    .filter((r: any) => r.days_late > 0)
    .sort((a: any, b: any) => String(b.payment_date).localeCompare(String(a.payment_date)));
  const lateNoFine = { count: lateNoFineAll.length, potential: r2(lateNoFineAll.length * rate), rows: lateNoFineAll.slice(0, 500).map(r => ({ id: r.id, date: r.payment_date, month: r.payment_month, due_date: r.due_date, days_late: r.days_late, amount: r2(Number(r.contribution_amount)), member_id: r.member_id, member_code: r.member_code, name: r.name, name_bn: r.name_bn })) };

  // overdue right now: unpaid months already past their due date (a fine applies when they are paid)
  const paid = new Map<number, Set<string>>();
  for (const r of all('SELECT member_id, payment_month FROM collections')) { if (!paid.has(r.member_id)) paid.set(r.member_id, new Set()); paid.get(r.member_id)!.add(r.payment_month); }
  const today = todayISO();
  const overdueNow: any[] = [];
  for (const m of all(`SELECT id, member_code, name, name_bn, monthly_due, join_date FROM members WHERE status = 'Active'`)) {
    if (memberId && Number(m.id) !== memberId) continue;
    let months = 0;
    for (let k = String(m.join_date).slice(0, 7); k <= mk; k = addMonths(k, 1)) if (dueDateOf(k, dd) < today && !paid.get(m.id)?.has(k)) months++;
    if (months > 0) overdueNow.push({ member_id: m.id, member_code: m.member_code, name: m.name, name_bn: m.name_bn, months, owed: r2(months * (Number(m.monthly_due) || 0)), fine_if_paid_today: r2(months * rate) });
  }
  overdueNow.sort((a, b) => b.months - a.months || a.member_code.localeCompare(b.member_code, undefined, { numeric: true }));

  return { filters: { start_date: start, end_date: end, member_id: memberId || null, source }, rows, totals, overall, byMonth, byMember, lateNoFine,
    overdueNow: { count: overdueNow.length, potential: r2(overdueNow.reduce((s, x) => s + x.fine_if_paid_today, 0)), rows: overdueNow.slice(0, 500) }, books: getFundBooks() };
}

/**
 * The books-balance proof. Money is held by the fund; every member is owed their principal (opening balance + contributions) plus their share of the
 * benefit earned; what is left over belongs to the fund itself: the RESERVE. It must be explained, to the paisa, by
 *   fines + loan penalties − operating expenses − (settlements paid above what the books said was owed) + benefit that nobody could share.
 * The two sides are computed independently (the left from the cash and asset totals, the right from the member allocation), so an entry that one of
 * them misses shows up as a difference. Valued at cost, like the fund balance: unrealised gains are not part of it.
 */
function getFundBooks() {
  const today = todayISO();
  const pos = fundPosition(today);
  const alloc = benefitAllocation(today);
  const settled = new Map<number, any>(all('SELECT * FROM member_settlements').map(s => [Number(s.member_id), s]));
  const pays = new Map<number, number>();
  for (const r of all('SELECT member_id, SUM(contribution_amount) AS s FROM collections GROUP BY member_id')) pays.set(Number(r.member_id), Number(r.s) || 0);
  let owed = 0, settledEntitlement = 0, settlementPaid = 0;
  const drift: Array<{ member_code: string; name: string; stored: number; now: number }> = [];
  let members = 0;
  for (const m of all('SELECT id, member_code, name, opening_balance FROM members')) {
    const principal = (Number(m.opening_balance) || 0) + (pays.get(Number(m.id)) || 0);
    const entitled = principal + (alloc.total.get(Number(m.id)) || 0);
    const s = settled.get(Number(m.id));
    if (!s) { owed += entitled; members++; continue; }
    settledEntitlement += entitled;
    settlementPaid += Number(s.total_paid);
    // what the system calculated when the member was paid (not the amount actually paid, which the committee may have changed on purpose) against what the books give now
    const calcThen = Number(s.principal) + Number(s.calc_profit_share);
    if (Math.abs(entitled - calcThen) > 0.01) drift.push({ member_code: m.member_code, name: m.name, stored: r2(calcThen), now: r2(entitled) });
  }
  const fines = num('SELECT SUM(late_fee) FROM collections'), penalties = num('SELECT SUM(penalty_paid) FROM loan_repayments'), expenses = num('SELECT SUM(amount) FROM expenses');
  const settlementAdjustment = settlementPaid - settledEntitlement;      // > 0: paid out more than the books said was owed
  const reserve = pos.fundBalance - owed;
  const explained = fines + penalties - expenses - settlementAdjustment + alloc.unallocated;
  const residual = reserve - explained;
  return {
    fundBalance: r2(pos.fundBalance), cashInHand: r2(pos.cashInHand), owedToMembers: r2(owed), members, reserve: r2(reserve),
    parts: { fines: r2(fines), penalties: r2(penalties), expenses: r2(expenses), settlementAdjustment: r2(settlementAdjustment), unshared: r2(alloc.unallocated) },
    explained: r2(explained), residual: r2(residual), balanced: Math.abs(residual) < 0.05, drift,
  };
}

/** Everything the settlement dialog needs: contributions, calculated profit share, suggested payout, cash check. */
function previewMemberSettlement(memberId: number, settleDate?: string) {
  const m = get('SELECT * FROM members WHERE id = ?', [Number(memberId)]);
  if (!m) fail('Member not found.');
  const existing = get('SELECT * FROM member_settlements WHERE member_id = ?', [m.id]);
  const date = toISODate(settleDate) || existing?.settlement_date || todayISO();
  const contributions = num('SELECT SUM(contribution_amount) FROM collections WHERE member_id = ?', [m.id]);
  const lateFees = num('SELECT SUM(late_fee) FROM collections WHERE member_id = ?', [m.id]);
  const lastPayment = get('SELECT MAX(payment_date) d FROM collections WHERE member_id = ?', [m.id])?.d || null;
  const principal = r2(Number(m.opening_balance || 0) + contributions);
  const calc = memberBenefitShare(m.id, date);
  const pos = fundPosition('9999-12-31');
  return {
    member: { id: m.id, member_code: m.member_code, name: m.name, status: m.status, join_date: m.join_date },
    settlementDate: date, existing: existing || null, lastPaymentDate: lastPayment,
    openingBalance: Number(m.opening_balance || 0), contributions: r2(contributions), lateFeesKept: r2(lateFees),
    principal, profitShare: calc.share, lines: calc.lines,
    suggestedPayout: r2(Math.max(0, principal + calc.share)),
    cashInHand: r2(pos.cashInHand),
  };
}

/** Pays a member out and deactivates them — one atomic step. */
function settleMember(d: any) {
  const memberId = Number(d?.member_id);
  const m = get('SELECT * FROM members WHERE id = ?', [memberId]);
  if (!m) fail('Member not found.');
  if (get('SELECT 1 FROM member_settlements WHERE member_id = ?', [memberId])) fail('This member already has a settlement. Cancel it first (Admin) to redo it.');
  if (m.status !== 'Active') fail('Only an active member can be settled.');
  const openLoan = get(`SELECT l.loan_no, l.principal - COALESCE((SELECT SUM(principal_paid) FROM loan_repayments r WHERE r.loan_id = l.id),0) AS owed
                        FROM personal_loans l WHERE l.member_id = ? AND l.status = 'Active' LIMIT 1`, [memberId]);
  if (openLoan) fail(`This member still owes personal loan ${openLoan.loan_no} (TK ${r2(Number(openLoan.owed))} unpaid). Collect or write off the loan first, then settle.`);
  const guaranteeing = get(`SELECT loan_no FROM personal_loans WHERE guarantor_member_id = ? AND status = 'Active' LIMIT 1`, [memberId]);
  if (guaranteeing) fail(`This member is the guarantor of running loan ${guaranteeing.loan_no}. The loan must be repaid (or another arrangement made) before this member can be settled.`);
  const date = toISODate(d.settlement_date) || todayISO();
  if (date > todayISO()) fail('Settlement date cannot be in the future.');
  const prev = previewMemberSettlement(memberId, date);
  if (prev.lastPaymentDate && date < prev.lastPaymentDate) fail(`Settlement date cannot be before the member's last payment (${prev.lastPaymentDate}).`);
  if (date < String(m.join_date)) fail('Settlement date cannot be before the join date.');
  const lastSettle = get('SELECT MAX(settlement_date) d FROM member_settlements')?.d;
  if (lastSettle && date < String(lastSettle)) fail(`Settlement date cannot be earlier than the latest settlement (${lastSettle}), because that would change what was already paid out.`);
  const method = String(d.payment_method || '').trim();
  if (!method) fail('Choose the medium the money was paid through (cash, bank, bKash…).');
  const calc = prev.profitShare;
  const share = d.profit_share === undefined || d.profit_share === '' || d.profit_share === null ? calc : r2(Number(d.profit_share));
  if (!Number.isFinite(share)) fail('Profit share must be a number.');
  const note = String(d.note || '').trim();
  if (Math.abs(share - calc) > 0.009 && !note) fail('You changed the calculated profit share — please write the reason in the note.');
  const total = r2(prev.principal + share);
  if (total < 0) fail('The payout cannot be negative. The loss share is larger than the member\'s principal.');
  const id = tx(() => {
    run(`INSERT INTO member_settlements (member_id, settlement_date, principal, calc_profit_share, profit_share, total_paid, payment_method, trx_id, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [memberId, date, prev.principal, calc, share, total, method, String(d.trx_id || '').trim(), note, actor]);
    const sid = lastId();
    run(`UPDATE members SET status = 'Inactive', updated_at = datetime('now','localtime') WHERE id = ?`, [memberId]);
    audit('settle', 'member', memberId, `${m.member_code} paid ${total} (principal ${prev.principal}, share ${share}) via ${method} on ${date}`);
    return sid;
  });
  mutated();
  return id;
}

function getMemberSettlements() {
  return all(`SELECT s.*, m.member_code, m.name AS member_name, m.name_bn AS member_name_bn, m.avatar_initials
              FROM member_settlements s JOIN members m ON m.id = s.member_id ORDER BY s.settlement_date DESC, s.id DESC`);
}

/** Admin only: removes a settlement record (to correct a mistake). The member stays Inactive until reactivated. */
function cancelSettlement(memberId: number) {
  const s = get('SELECT s.*, m.member_code FROM member_settlements s JOIN members m ON m.id=s.member_id WHERE s.member_id = ?', [Number(memberId)]);
  if (!s) fail('No settlement found for this member.');
  tx(() => {
    run('DELETE FROM member_settlements WHERE member_id = ?', [Number(memberId)]);
    audit('void', 'settlement', Number(memberId), `${s.member_code} cancelled settlement of ${s.total_paid}`);
  });
  mutated();
}

// ---------------------------------------------------------------------------
// Investment returns (profit / loss entries)
// ---------------------------------------------------------------------------
function getInvestmentReturns(investmentId?: number, startDate?: string, endDate?: string) {
  const where: string[] = []; const params: any[] = [];
  if (investmentId) { where.push('r.investment_id = ?'); params.push(Number(investmentId)); }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('r.entry_date >= ?'); params.push(s); }
  if (e) { where.push('r.entry_date <= ?'); params.push(e); }
  return all(`SELECT r.*, i.name AS investment_name, i.sector FROM investment_returns r JOIN investments i ON i.id = r.investment_id
              ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.entry_date DESC, r.id DESC`, params);
}

function getReturnsSummary() {
  const row = get(`SELECT COALESCE(SUM(CASE entry_type WHEN 'Profit' THEN amount END),0) profit, COALESCE(SUM(CASE entry_type WHEN 'Loss' THEN amount END),0) loss,
                          COUNT(*) n FROM investment_returns`) || {};
  const byInv = all(`SELECT i.id, i.name, i.sector, i.invested_amount,
      COALESCE(SUM(CASE r.entry_type WHEN 'Profit' THEN r.amount END),0) profit, COALESCE(SUM(CASE r.entry_type WHEN 'Loss' THEN r.amount END),0) loss
      FROM investments i JOIN investment_returns r ON r.investment_id = i.id GROUP BY i.id ORDER BY (profit - loss) DESC`)
    .map(r => ({ ...r, net: r2(Number(r.profit) - Number(r.loss)) }));
  const year = String(todayISO()).slice(0, 4);
  const yr = get(`SELECT COALESCE(SUM(CASE entry_type WHEN 'Profit' THEN amount ELSE -amount END),0) v FROM investment_returns WHERE substr(entry_date,1,4) = ?`, [year]);
  return { profit: Number(row.profit) || 0, loss: Number(row.loss) || 0, net: r2((Number(row.profit) || 0) - (Number(row.loss) || 0)), entries: Number(row.n) || 0, yearNet: Number(yr?.v) || 0, byInvestment: byInv };
}

function validateReturn(d: any) {
  const inv = get('SELECT id, purchase_date FROM investments WHERE id = ?', [Number(d?.investment_id)]);
  if (!inv) fail('Please choose the investment this entry belongs to.');
  if (!['Profit', 'Loss'].includes(d.entry_type)) fail('Choose Profit or Loss.');
  const amount = Number(d.amount);
  if (!(amount > 0)) fail('Amount must be greater than zero.');
  const date = toISODate(d.entry_date) || todayISO();
  if (date > todayISO()) fail('Entry date cannot be in the future.');
  if (date < String(inv.purchase_date)) fail(`Entry date cannot be before the investment was made (${inv.purchase_date}).`);
  if (d.entry_type === 'Profit' && !String(d.payment_method || '').trim()) fail('Choose the medium the benefit was received through (cash, bank, bKash…).');
  // a back-dated entry would change what an already-settled member should have received
  const lateSettle = get('SELECT MAX(settlement_date) d FROM member_settlements')?.d;
  if (lateSettle && date <= lateSettle) fail(`A member was already settled on ${lateSettle}. Benefit or loss entries must be dated after the latest settlement.`);
  return { amount: r2(amount), date };
}

function addInvestmentReturn(d: any) {
  const v = validateReturn(d);
  const id = tx(() => {
    run(`INSERT INTO investment_returns (investment_id, entry_type, amount, entry_date, payment_method, reference, note, created_by) VALUES (?,?,?,?,?,?,?,?)`,
      [Number(d.investment_id), d.entry_type, v.amount, v.date, String(d.payment_method || '').trim(), String(d.reference || '').trim(), String(d.note || '').trim(), actor]);
    const nid = lastId();
    audit('create', 'investment_return', nid, `${d.entry_type} ${v.amount} on investment #${d.investment_id}`);
    return nid;
  });
  mutated();
  return id;
}

function deleteInvestmentReturn(id: number) {
  const r = get('SELECT * FROM investment_returns WHERE id = ?', [Number(id)]);
  if (!r) fail('Entry not found.');
  const settledAfter = get('SELECT 1 FROM member_settlements WHERE settlement_date >= ?', [r.entry_date]);
  if (settledAfter) fail('A member has already been settled on or after this entry\'s date, so it cannot be removed. Cancel that settlement first (Admin).');
  tx(() => { run('DELETE FROM investment_returns WHERE id = ?', [Number(id)]); audit('void', 'investment_return', Number(id), `${r.entry_type} ${r.amount}`); });
  mutated();
}

// ---------------------------------------------------------------------------
// Personal loans (fund → member). Schedule maths lives in loans.ts; this section stores, validates and books them.
//
// Books:   lending     cash −P, loans receivable +P            (net worth unchanged)
//          repayment   cash +(p+i+f), receivable −p, income +(i+f)
//          write-off   receivable −outstanding, loss −outstanding (cash unchanged)
// ---------------------------------------------------------------------------
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return todayISO(d); };

/** Cash the fund can lend as of `date`: the lower of its cash on that date and its cash today, so a back-dated loan can never overdraw money spent since. */
const lendableCash = (date: string) => r2(Math.min(fundPosition(date).cashInHand, fundPosition(todayISO()).cashInHand));

const memberSavings = (memberId: number) =>
  r2(num('SELECT opening_balance FROM members WHERE id = ?', [memberId]) + num('SELECT SUM(contribution_amount) FROM collections WHERE member_id = ?', [memberId]));

const loansOwedBy = (memberId: number) =>
  r2(num(`SELECT SUM(l.principal - COALESCE((SELECT SUM(principal_paid) FROM loan_repayments r WHERE r.loan_id = l.id), 0))
          FROM personal_loans l WHERE l.member_id = ? AND l.status = 'Active'`, [memberId]));

/** Loan interest and write-offs are shared with members at settlement, so they cannot be dated before a settlement that already paid members out. */
function assertAfterLastSettlement(date: string, what: string) {
  const last = get('SELECT MAX(settlement_date) d FROM member_settlements')?.d;
  if (last && date <= last) fail(`A member was already settled on ${last}. ${what} must be dated after the latest settlement.`);
}

const loanSchedule = (id: number) => all('SELECT no, due_date, principal, interest, total FROM loan_schedule WHERE loan_id = ? ORDER BY no', [Number(id)]);

/** Every loan with its member and everything derived from the schedule and repayments (as of `today`). */
function enrichLoans(where = '', params: any[] = [], today = todayISO()): Row[] {
  const loans = all(`SELECT l.*, m.member_code, m.name AS member_name, m.name_bn AS member_name_bn, m.avatar_initials, m.phone AS member_phone, m.status AS member_status,
                            g.member_code AS guarantor_member_code, g.name AS guarantor_member_name
                     FROM personal_loans l JOIN members m ON m.id = l.member_id LEFT JOIN members g ON g.id = l.guarantor_member_id ${where} ORDER BY l.id`, params);
  if (!loans.length) return [];
  const sched = new Map<number, Row[]>();
  for (const r of all('SELECT loan_id, no, due_date, principal, interest, total FROM loan_schedule ORDER BY loan_id, no')) {
    if (!sched.has(r.loan_id)) sched.set(r.loan_id, []);
    sched.get(r.loan_id)!.push(r);
  }
  const paid = new Map<number, Row>();
  for (const r of all(`SELECT loan_id, SUM(principal_paid) p, SUM(interest_paid) i, SUM(penalty_paid) f, SUM(total_paid) t,
        SUM(CASE WHEN kind = 'Installment' THEN principal_paid + interest_paid ELSE 0 END) s, COUNT(*) n, MAX(paid_date) last
        FROM loan_repayments GROUP BY loan_id`)) paid.set(r.loan_id, r);
  const in30 = addDaysISO(today, 30);
  return loans.map(l => {
    const rows = sched.get(l.id) || [];
    const p = paid.get(l.id) || {};
    const pp = Number(p.p) || 0, pi = Number(p.i) || 0, pf = Number(p.f) || 0, pt = Number(p.t) || 0, ps = Number(p.s) || 0;
    const open = l.status === 'Active';
    const st = scheduleState(rows as any, ps, today);
    const cumThrough = (pred: (x: Row) => boolean) => r2(rows.filter(pred).reduce((a, x) => a + Number(x.total), 0));
    const dueToDate = cumThrough(x => x.due_date < today);
    const due30 = open ? Math.max(0, r2(cumThrough(x => x.due_date <= in30) - ps - st.overdueAmount)) : 0;
    return {
      ...l,
      paid_principal: r2(pp), paid_interest: r2(pi), paid_penalty: r2(pf), total_paid: r2(pt), paid_schedule: r2(ps),
      outstanding_principal: open ? r2(Math.max(0, Number(l.principal) - pp)) : 0,
      remaining_interest: open ? Math.max(0, r2(Number(l.total_interest) - pi)) : 0,
      remaining_payable: open ? Math.max(0, r2(Number(l.total_payable) - ps)) : 0,
      installments_total: rows.length, installments_paid: st.paidCount,
      next_due_date: open ? st.nextDueDate : null, next_due_amount: open ? st.nextDueAmount : 0,
      overdue_count: open ? st.overdueCount : 0, overdue_amount: open ? st.overdueAmount : 0,
      days_overdue: open && st.firstOverdueDate ? Math.max(0, daysBetween(st.firstOverdueDate, today)) : 0,
      due_30: due30, due_to_date: open ? dueToDate : 0,
      last_payment_date: p.last || null, repayment_count: Number(p.n) || 0,
      derived_status: open ? (st.overdueCount > 0 ? 'Overdue' : 'Running') : l.status,
      progress_pct: Number(l.principal) > 0 ? Math.min(100, r2((100 * pp) / Number(l.principal))) : 0,
    };
  });
}

function loadLoan(id: number): Row {
  const l = enrichLoans('WHERE l.id = ?', [Number(id)])[0];
  if (!l) fail('Loan not found.');
  return l;
}

const LOAN_SORT: Record<string, (a: Row, b: Row) => number> = {
  newest: (a, b) => b.id - a.id,
  oldest: (a, b) => a.id - b.id,
  amount_high: (a, b) => b.principal - a.principal,
  amount_low: (a, b) => a.principal - b.principal,
  outstanding_high: (a, b) => b.outstanding_principal - a.outstanding_principal,
  overdue_high: (a, b) => b.overdue_amount - a.overdue_amount || b.days_overdue - a.days_overdue,
  due_soon: (a, b) => String(a.next_due_date || '9999').localeCompare(String(b.next_due_date || '9999')) || b.id - a.id,
  name_asc: (a, b) => String(a.member_name).localeCompare(String(b.member_name), undefined, { sensitivity: 'base' }) || b.id - a.id,
  progress_high: (a, b) => b.progress_pct - a.progress_pct,
};

/** Loan list. status: All | Open (running + overdue) | Running | Overdue | Closed | Written off. Dates filter the loan date. */
function getLoans(sortBy = 'newest', status = 'All', startDate?: string, endDate?: string, search = '', memberId?: number) {
  const where: string[] = []; const params: any[] = [];
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('l.disbursed_date >= ?'); params.push(s); }
  if (e) { where.push('l.disbursed_date <= ?'); params.push(e); }
  if (memberId) { where.push('l.member_id = ?'); params.push(Number(memberId)); }
  let list = enrichLoans(where.length ? 'WHERE ' + where.join(' AND ') : '', params);
  if (status && status !== 'All') list = list.filter(l => status === 'Open' ? ['Running', 'Overdue'].includes(l.derived_status) : l.derived_status === status);
  const q = String(search || '').trim().toLowerCase();
  if (q) list = list.filter(l => [l.loan_no, l.member_name, l.member_name_bn, l.member_code, l.member_phone, l.purpose, l.guarantor, l.guarantor_name, l.guarantor_member_name, l.guarantor_member_code, l.reference]
    .some(v => v && String(v).toLowerCase().includes(q)));
  return list.sort(LOAN_SORT[sortBy] || LOAN_SORT.newest);
}

/** Top-of-page numbers across all loans. */
function getLoanSummary() {
  const today = todayISO();
  const ls = enrichLoans('', [], today);
  const sum = (f: (l: Row) => number) => r2(ls.reduce((a, l) => a + (Number(f(l)) || 0), 0));
  const open = ls.filter(l => l.status === 'Active');
  const pos = fundPosition('9999-12-31');
  const dueToDate = sum(l => l.due_to_date), overdue = sum(l => l.overdue_amount);
  return {
    loans: ls.length,
    running: ls.filter(l => l.derived_status === 'Running').length,
    overdueLoans: ls.filter(l => l.derived_status === 'Overdue').length,
    closed: ls.filter(l => l.status === 'Closed').length,
    writtenOff: ls.filter(l => l.status === 'Written off').length,
    borrowers: new Set(open.map(l => l.member_id)).size,
    drafts: num(`SELECT COUNT(*) FROM loan_applications WHERE status = 'Draft'`),
    draftsAmount: num(`SELECT SUM(principal) FROM loan_applications WHERE status = 'Draft'`),
    totalLent: sum(l => l.principal),
    outstanding: sum(l => l.outstanding_principal),
    principalRepaid: sum(l => l.paid_principal),
    interestEarned: sum(l => l.paid_interest),
    penaltyEarned: sum(l => l.paid_penalty),
    interestExpected: sum(l => l.remaining_interest),
    totalCollected: sum(l => l.total_paid),
    overdueAmount: overdue,
    overduePrincipal: sum(l => (l.derived_status === 'Overdue' ? l.outstanding_principal : 0)),
    dueNext30: sum(l => l.due_30),
    writtenOffAmount: sum(l => (l.status === 'Written off' ? l.written_off_amount : 0)),
    onTrackPct: dueToDate > 0 ? r2(Math.max(0, 100 * (dueToDate - overdue) / dueToDate)) : 100,
    cashInHand: r2(pos.cashInHand),
    fundBalance: r2(pos.fundBalance),
    lentPctOfFund: pos.fundBalance > 0 ? r2(100 * pos.loansOutstanding / pos.fundBalance) : 0,
    avgRate: (() => { const w = open.filter(l => l.method !== 'free'); const tot = w.reduce((a, l) => a + l.outstanding_principal, 0);
      return tot > 0 ? r2(w.reduce((a, l) => a + l.annual_rate * l.outstanding_principal, 0) / tot) : 0; })(),
  };
}

// ---- Guarantor -----------------------------------------------------------------------------
export interface GuarantorInfo { type: 'member' | 'outsider' | 'legacy'; member_id?: number; name: string; name_bn?: string | null; code?: string; address: string; nid: string; phone: string; relation: string }

/** The guarantor of a stored loan, resolved for display and for the guarantee form. null = none recorded. */
function guarantorInfoOf(l: Row): GuarantorInfo | null {
  if (l.guarantor_type === 'member') {
    const g = get('SELECT member_code, name, name_bn, phone, nid FROM members WHERE id = ?', [l.guarantor_member_id]);
    return g ? { type: 'member', member_id: Number(l.guarantor_member_id), name: g.name, name_bn: g.name_bn, code: g.member_code, address: '', nid: g.nid || '', phone: g.phone || '', relation: l.guarantor_relation || '' } : null;
  }
  if (l.guarantor_type === 'outsider')
    return { type: 'outsider', name: l.guarantor_name || '', address: l.guarantor_address || '', nid: l.guarantor_nid || '', phone: l.guarantor_phone || '', relation: l.guarantor_relation || '' };
  if (String(l.guarantor || '').trim()) return { type: 'legacy', name: String(l.guarantor).trim(), address: '', nid: '', phone: '', relation: '' };
  return null;
}

/**
 * Validates the guarantor entered for a NEW loan (a guarantor is mandatory) and returns the columns to store.
 *   member   : an active fund member other than the borrower (pick from the list)
 *   outsider : full name, a real address, and a valid National ID that does not belong to any member
 * Throws a readable message on the first problem.
 */
function guarantorFrom(d: any, borrowerId: number) {
  const type = d?.guarantor_type;
  const relation = String(d?.guarantor_relation || '').trim().slice(0, 60);
  if (type === 'member') {
    const gid = Number(d.guarantor_member_id);
    if (!gid) fail('Choose the member who is the guarantor.');
    if (gid === Number(borrowerId)) fail('A borrower cannot be their own guarantor.');
    const g = get('SELECT id, member_code, name, status FROM members WHERE id = ?', [gid]);
    if (!g) fail('The guarantor member was not found.');
    if (g.status !== 'Active') fail(`${g.name} is not an active member, so cannot be a guarantor.`);
    return { cols: { guarantor_type: 'member', guarantor_member_id: gid, guarantor_name: null, guarantor_address: null, guarantor_nid: null, guarantor_phone: null, guarantor_relation: relation }, display: `${g.name} (${g.member_code})` };
  }
  if (type === 'outsider') {
    const name = String(d.guarantor_name || '').trim().replace(/\s+/g, ' ');
    const address = String(d.guarantor_address || '').trim().replace(/\s+/g, ' ');
    if (name.length < 3 || !/\p{L}{2,}/u.test(name) || name.length > 80) fail("Enter the guarantor's full name (at least 3 letters).");
    if (address.length < 10 || !/\p{L}{2,}/u.test(address) || address.length > 250) fail("Enter the guarantor's full address (house/road, area, district — at least 10 characters).");
    const nid = checkNid(d.guarantor_nid);
    if (!nid.ok) fail(`Guarantor NID: ${nid.error}`);
    const owner = get('SELECT member_code, name FROM members WHERE nid = ?', [nid.value]);
    if (owner) fail(`This NID belongs to member ${owner.name} (${owner.member_code}). Tick "Guarantor is a fund member" and choose them instead.`);
    const phone = String(d.guarantor_phone || '').replace(/[\s-]/g, '');
    if (phone && !/^\+?\d{7,15}$/.test(phone)) fail("The guarantor's phone number is not valid.");
    return { cols: { guarantor_type: 'outsider', guarantor_member_id: null, guarantor_name: name, guarantor_address: address, guarantor_nid: nid.value, guarantor_phone: phone, guarantor_relation: relation }, display: name };
  }
  fail('A guarantor is required. Choose a fund member, or enter an outside guarantor\'s details.');
}

/** One loan: terms, the full schedule with the state of every installment, repayments, and the borrower's other loans. */
function getLoan(id: number) {
  const l = loadLoan(id);
  const today = todayISO();
  const rows = loanSchedule(l.id);
  const st = scheduleState(rows as any, l.paid_schedule, today);
  let cum = 0, cumP = 0;
  const schedule = rows.map((r, i) => {
    const start = cum; cum = r2(cum + Number(r.total)); cumP = r2(cumP + Number(r.principal));
    let status: string = st.status[i];
    if (status !== 'Paid' && l.status === 'Closed') status = 'Waived';
    if (status !== 'Paid' && l.status === 'Written off') status = 'Written off';
    return { ...r, paid: Math.max(0, Math.min(Number(r.total), r2(l.paid_schedule - start))), status, balance_after: r2(Number(l.principal) - cumP) };
  });
  const repayments = all('SELECT * FROM loan_repayments WHERE loan_id = ? ORDER BY paid_date DESC, id DESC', [l.id]);
  const m = get('SELECT id, member_code, name, name_bn, avatar_initials, phone, nid, monthly_due, status FROM members WHERE id = ?', [l.member_id]) || {};
  return {
    loan: l, schedule, repayments, guarantor: guarantorInfoOf(l),
    latestRepaymentId: repayments.length ? Math.max(...repayments.map(r => Number(r.id))) : null,
    member: { ...m, savings: memberSavings(l.member_id), owed: loansOwedBy(l.member_id) },
    memberLoans: enrichLoans('WHERE l.member_id = ? AND l.id != ?', [l.member_id, l.id]),
  };
}

/** A date field in the loan code: empty = the default, anything else must be a real calendar date (never silently replaced by today). */
function loanDate(v: any, fallback: string | null, label: string): string | null {
  if (v === undefined || v === null || v === '') return fallback;
  const iso = toISODate(v);
  if (!iso) fail(`${label} is not a valid date.`);
  return iso;
}

/** Builds the terms from form input, filling the fund's default policy and the usual first-installment date. */
function loanTermsFrom(d: any): { terms: LoanTerms; disbursed: string } {
  const st = settingsMap();
  const disbursed = loanDate(d?.disbursed_date, todayISO(), 'The loan date')!;
  const method = (LOAN_METHODS as string[]).includes(d?.method) ? (d.method as LoanMethod) : (st.loan_default_method as LoanMethod);
  const rate = d?.annual_rate === undefined || d?.annual_rate === '' || d?.annual_rate === null ? Number(st.loan_default_rate) || 0 : Number(d.annual_rate);
  return {
    disbursed,
    terms: {
      principal: Number(d?.principal), method, annual_rate: method === 'free' ? 0 : rate, term_months: Number(d?.term_months),
      first_due_date: loanDate(d?.first_due_date, null, 'The first installment date') || addMonthsKeepDay(disbursed, 1), round_to_taka: d?.round_to_taka !== false,
    },
  };
}

/** Live calculator for the loan form: schedule, totals, the same loan over other terms, and policy warnings. Never throws. */
function previewLoan(d: any) {
  try {
    const { terms, disbursed } = loanTermsFrom(d);
    const err = validateTerms(terms);
    if (err) return { valid: false, error: err };
    const plan = buildPlan(terms);
    const { term_months, ...base } = terms;
    const options = compareTerms(base, [...COMMON_TERMS, term_months]);
    const warnings: Array<{ level: 'error' | 'warn' | 'info'; text: string }> = [];
    const cash = lendableCash(disbursed);
    // a draft moves no money, so a cash shortfall only warns (it is checked again when the draft is disbursed)
    if (terms.principal > cash + 0.005) warnings.push({ level: d?.draft ? 'warn' : 'error', text: `The fund can lend only TK ${Math.max(0, cash)} (its cash in hand).` });
    if (terms.first_due_date <= disbursed) warnings.push({ level: 'error', text: 'The first installment must be after the loan date.' });
    let member: any = null;
    const mid = Number(d?.member_id);
    if (mid) {
      const m = get('SELECT id, member_code, name, name_bn, nid, phone, status, monthly_due FROM members WHERE id = ?', [mid]);
      if (m) {
        const savings = memberSavings(mid), owed = loansOwedBy(mid);
        const mult = Number(settingsMap().loan_max_multiple) || 0;
        const limit = mult > 0 ? r2(mult * savings) : null;
        const overdue = enrichLoans('WHERE l.member_id = ?', [mid]).filter(l => l.derived_status === 'Overdue');
        member = { ...m, savings, owed, limit, multiple: mult, available: limit === null ? null : Math.max(0, r2(limit - owed)), overdueLoans: overdue.length };
        if (m.status !== 'Active') warnings.push({ level: 'error', text: `${m.name} is not an active member.` });
        if (limit !== null && terms.principal + owed > limit + 0.005)
          warnings.push({ level: 'warn', text: `Above the fund limit (${mult}× savings = TK ${limit}). A written approval reason is required.` });
        if (overdue.length) warnings.push({ level: 'warn', text: `${m.name} has ${overdue.length} overdue loan(s).` });
        else if (owed > 0) warnings.push({ level: 'info', text: `${m.name} already owes TK ${owed} on another loan.` });
        if (plan.installment > 0 && Number(m.monthly_due) > 0 && plan.installment > 4 * Number(m.monthly_due))
          warnings.push({ level: 'info', text: `The installment is more than 4× the member's monthly contribution; check it is affordable.` });
      }
    }
    return { valid: true, terms: { ...terms, disbursed_date: disbursed }, plan, options, warnings, cash, member, nextLoanNo: nextLoanNo(), nextAppNo: nextAppNo(), autoReference: `DISB-${nextLoanNo()}` };
  } catch (e: any) {
    return { valid: false, error: e?.message || 'Could not calculate this loan.' };
  }
}

/** Checks a guarantor with exactly the rules used when the loan is saved, so the form can show "ready" with no surprise at the end. Never throws. */
function previewGuarantor(d: any) {
  if (!d?.guarantor_type) return { ok: false, error: 'Choose a guarantor.', info: null };
  try {
    const g = guarantorFrom(d, Number(d.member_id) || 0);
    return { ok: true, error: '', info: guarantorInfoOf({ ...g.cols, guarantor: g.display }) };
  } catch (e: any) { return { ok: false, error: e?.message || 'Guarantor details are not valid.', info: null }; }
}

function nextLoanNo() {
  // never reuse a number that may already be printed on a paper or receipt, even if that loan was deleted
  const last = all('SELECT loan_no FROM personal_loans').reduce((mx, r) => Math.max(mx, Number(String(r.loan_no).replace(/\D/g, '')) || 0), num(`SELECT seq FROM sqlite_sequence WHERE name = 'personal_loans'`));
  return `PL-${pad4(last + 1)}`;
}

/** Signed consent paper required before a loan is disbursed (Admin can switch this off in the loan policy). */
const consentRequired = () => settingsMap().loan_consent_required !== '0';

/** Session may change data (everyone except a read-only Auditor). */
export function requireWriter() {
  const s = getSession();
  if (!s) fail('Please sign in.');
  if (s.user.role === 'Auditor') fail('Auditors have read-only access.');
}

/**
 * Everything that must be true to give — or draft — a loan, except the cash check and the consent paper.
 * Returns the cleaned values so the caller can store them.
 */
function prepareLoan(d: any) {
  const memberId = Number(d?.member_id);
  const m = get('SELECT * FROM members WHERE id = ?', [memberId]);
  if (!m) fail('Please choose the member who is taking the loan.');
  if (m.status !== 'Active') fail(`${m.name} is not an active member, so a loan cannot be given.`);
  const { terms, disbursed } = loanTermsFrom(d);
  const err = validateTerms(terms);
  if (err) fail(err);
  const today = todayISO();
  if (disbursed > today) fail('Loan date cannot be in the future.');
  if (disbursed < String(m.join_date)) fail(`Loan date cannot be before the member joined (${m.join_date}).`);
  if (terms.first_due_date <= disbursed) fail('The first installment must be after the loan date.');
  if (daysBetween(disbursed, terms.first_due_date) > 100) fail('The first installment should fall within about three months of the loan date.');
  const payMethod = String(d.payment_method || '').trim();
  if (!payMethod) fail('Choose how the money will be paid out (cash, bank, bKash…).');
  const mult = Number(settingsMap().loan_max_multiple) || 0;
  const limitNote = String(d.limit_note || '').trim();
  if (mult > 0) {
    const savings = memberSavings(memberId), owed = loansOwedBy(memberId);
    if (terms.principal + owed > mult * savings + 0.005 && !limitNote)
      fail(`With this loan ${m.name} would owe TK ${r2(terms.principal + owed)}, above the fund limit of ${mult}× savings (TK ${r2(mult * savings)}). Write the approval reason to continue.`);
  }
  const guar = guarantorFrom(d, memberId);
  const plan = buildPlan(terms);
  return { memberId, m, terms, disbursed, plan, guar, limitNote, payMethod, rawNotes: String(d.notes || '').trim(), reference: String(d.reference || '').trim(), purpose: String(d.purpose || '').trim() };
}

interface ConsentCarry { appId: number; appNo: string; consent: { file: string; name: string; size: number; sha256: string; at: string } | null }

/** Gives the loan: books the cash-out and creates the schedule, in one transaction (with `from`, also closes the draft it came from). */
function addLoanInternal(d: any, from: ConsentCarry | null) {
  const p = prepareLoan(d);
  const required = consentRequired();
  if (!from && required) fail('A signed consent paper is required before a loan is disbursed. Save the loan as a draft, print the consent paper, get it signed and upload it — the loan is then disbursed.');
  if (from && required && !from.consent) fail('Upload the signed consent paper first; the loan is disbursed after that.');
  const cash = lendableCash(p.disbursed);
  if (p.terms.principal > cash + 0.005) fail(`The fund can lend only TK ${Math.max(0, cash)} (its cash in hand on ${p.disbursed} and today), so it cannot lend TK ${r2(p.terms.principal)}.`);
  const notes = [p.rawNotes, p.limitNote ? `Over-limit approval: ${p.limitNote}` : ''].filter(Boolean).join(' | ');
  const { terms, plan, guar, m } = p;
  const id = tx(() => {
    const no = nextLoanNo();
    const c = guar.cols;
    const cs = from?.consent;
    run(`INSERT INTO personal_loans (loan_no, member_id, principal, method, annual_rate, term_months, disbursed_date, first_due_date, installment, total_interest, total_payable,
           payment_method, reference, purpose, guarantor, guarantor_type, guarantor_member_id, guarantor_name, guarantor_address, guarantor_nid, guarantor_phone, guarantor_relation,
           application_no, consent_status, consent_file, consent_name, consent_size, consent_sha256, consent_uploaded_at, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [no, p.memberId, r2(terms.principal), terms.method, terms.annual_rate, plan.rows.length, p.disbursed, terms.first_due_date, plan.installment, plan.totalInterest, plan.totalPayable,
        p.payMethod, p.reference || `DISB-${no}`, p.purpose, guar.display,
        c.guarantor_type, c.guarantor_member_id, c.guarantor_name, c.guarantor_address, c.guarantor_nid, c.guarantor_phone, c.guarantor_relation,
        from?.appNo ?? null, cs ? 'Signed' : 'Waived', cs?.file ?? null, cs?.name ?? null, cs?.size ?? null, cs?.sha256 ?? null, cs?.at ?? null, notes, actor]);
    const lid = lastId();
    for (const r of plan.rows) run('INSERT INTO loan_schedule (loan_id, no, due_date, principal, interest, total) VALUES (?,?,?,?,?,?)', [lid, r.no, r.due_date, r.principal, r.interest, r.total]);
    if (from) {
      run(`UPDATE loan_applications SET status = 'Activated', loan_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND status = 'Draft'`, [lid, from.appId]);
      if (db.getRowsModified() !== 1) throw new Error('This draft was already disbursed or removed.');
    }
    audit('create', 'loan', lid, `${no} ${m.member_code} TK ${r2(terms.principal)} · ${plan.rows.length} months · ${terms.method}${terms.method === 'free' ? '' : ` ${terms.annual_rate}%`} · guarantor ${guar.display}${c.guarantor_type === 'outsider' ? ' (outsider)' : ''}${from ? ` · disbursed from ${from.appNo} after the signed consent paper was uploaded` : ' · no consent paper required'}`);
    return lid;
  });
  mutated();
  return id;
}

/** Gives a loan directly. Allowed only when signed consent papers are switched off; otherwise use createLoanApplication. */
function addLoan(d: any) { return addLoanInternal(d, null); }

// ---- Loan drafts (applications): the loan is prepared and the consent paper printed, but NO money moves until the signed paper is uploaded ----
function nextAppNo() {
  const last = all('SELECT app_no FROM loan_applications').reduce((mx, r) => Math.max(mx, Number(String(r.app_no).replace(/\D/g, '')) || 0), num(`SELECT seq FROM sqlite_sequence WHERE name = 'loan_applications'`));
  return `LA-${pad4(last + 1)}`;
}

const APP_SELECT = `SELECT a.*, m.member_code, m.name AS member_name, m.name_bn AS member_name_bn, m.avatar_initials, m.phone AS member_phone,
  g.member_code AS guarantor_member_code, g.name AS guarantor_member_name
  FROM loan_applications a JOIN members m ON m.id = a.member_id LEFT JOIN members g ON g.id = a.guarantor_member_id`;

const withConsentFlags = (a: Row): Row => ({
  ...a, has_consent: !!a.consent_file, consent_file_exists: !!a.consent_file && fs.existsSync(String(a.consent_file)),
  age_days: Math.max(0, daysBetween(String(a.created_at || todayISO()).slice(0, 10), todayISO())),
});

function createLoanApplication(d: any) {
  if (!consentRequired()) fail('Signed consent papers are switched off in the loan policy, so loans are given directly.');
  const p = prepareLoan(d);
  const id = tx(() => {
    const no = nextAppNo();
    const c = p.guar.cols;
    run(`INSERT INTO loan_applications (app_no, member_id, principal, method, annual_rate, term_months, disbursed_date, first_due_date, installment, total_interest, total_payable,
           payment_method, reference, purpose, notes, limit_note, guarantor, guarantor_type, guarantor_member_id, guarantor_name, guarantor_address, guarantor_nid, guarantor_phone, guarantor_relation, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Draft',?)`,
      [no, p.memberId, r2(p.terms.principal), p.terms.method, p.terms.annual_rate, p.plan.rows.length, p.disbursed, p.terms.first_due_date, p.plan.installment, p.plan.totalInterest, p.plan.totalPayable,
        p.payMethod, p.reference, p.purpose, p.rawNotes, p.limitNote, p.guar.display,
        c.guarantor_type, c.guarantor_member_id, c.guarantor_name, c.guarantor_address, c.guarantor_nid, c.guarantor_phone, c.guarantor_relation, actor]);
    const aid = lastId();
    audit('create', 'loan_application', aid, `${no} ${p.m.member_code} TK ${r2(p.terms.principal)} · ${p.plan.rows.length} months · draft: waiting for the signed consent paper`);
    return aid;
  });
  mutated();
  return id;
}

function loadApplication(id: number): Row {
  const a = get(`${APP_SELECT} WHERE a.id = ?`, [Number(id)]);
  if (!a) fail('Loan draft not found.');
  return a;
}

/** Edit a draft. Changing anything the signed paper states (member, amount, rate, period, dates, guarantor) cancels the uploaded paper: the new terms must be signed again. */
function updateLoanApplication(id: number, d: any) {
  const a = loadApplication(id);
  if (a.status !== 'Draft') fail('Only a draft can be edited.');
  const p = prepareLoan(d);
  const c = p.guar.cols;
  const changed = Number(a.member_id) !== p.memberId || Math.abs(Number(a.principal) - r2(p.terms.principal)) > 0.004 || a.method !== p.terms.method
    || Math.abs(Number(a.annual_rate) - p.terms.annual_rate) > 0.0001 || Number(a.term_months) !== p.plan.rows.length || a.first_due_date !== p.terms.first_due_date
    || a.disbursed_date !== p.disbursed || (a.guarantor_type || null) !== c.guarantor_type || (a.guarantor_member_id ?? null) !== c.guarantor_member_id
    || (a.guarantor_name || null) !== c.guarantor_name || (a.guarantor_address || null) !== c.guarantor_address || (a.guarantor_nid || null) !== c.guarantor_nid;
  const dropPaper = changed && !!a.consent_file;
  tx(() => {
    run(`UPDATE loan_applications SET member_id=?, principal=?, method=?, annual_rate=?, term_months=?, disbursed_date=?, first_due_date=?, installment=?, total_interest=?, total_payable=?,
           payment_method=?, reference=?, purpose=?, notes=?, limit_note=?, guarantor=?, guarantor_type=?, guarantor_member_id=?, guarantor_name=?, guarantor_address=?, guarantor_nid=?, guarantor_phone=?, guarantor_relation=?
           ${dropPaper ? ', consent_file=NULL, consent_name=NULL, consent_size=NULL, consent_sha256=NULL, consent_uploaded_at=NULL' : ''}, updated_at = datetime('now','localtime') WHERE id = ?`,
      [p.memberId, r2(p.terms.principal), p.terms.method, p.terms.annual_rate, p.plan.rows.length, p.disbursed, p.terms.first_due_date, p.plan.installment, p.plan.totalInterest, p.plan.totalPayable,
        p.payMethod, p.reference, p.purpose, p.rawNotes, p.limitNote, p.guar.display,
        c.guarantor_type, c.guarantor_member_id, c.guarantor_name, c.guarantor_address, c.guarantor_nid, c.guarantor_phone, c.guarantor_relation, Number(id)]);
    audit('update', 'loan_application', Number(id), `${a.app_no}: edited${changed ? ' (terms changed)' : ''}${dropPaper ? ' — the uploaded signed paper was removed; the new terms must be signed again' : ''}`);
  });
  if (dropPaper) removeFileQuietly(a.consent_file);
  mutated();
  return { consentRemoved: dropPaper };
}

function removeFileQuietly(f: any) { try { if (f) fs.unlinkSync(String(f)); } catch { /* already gone */ } }

function deleteLoanApplication(id: number) {
  const a = loadApplication(id);
  if (a.status !== 'Draft') fail('Only a draft can be deleted.');
  tx(() => { run('DELETE FROM loan_applications WHERE id = ?', [Number(id)]); audit('delete', 'loan_application', Number(id), `${a.app_no} TK ${a.principal} draft removed`); });
  removeFileQuietly(a.consent_file);
  mutated();
}

function getLoanApplications(search = '', memberId?: number, startDate?: string, endDate?: string) {
  const where = [`a.status = 'Draft'`]; const params: any[] = [];
  if (memberId) { where.push('a.member_id = ?'); params.push(Number(memberId)); }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('a.disbursed_date >= ?'); params.push(s); }
  if (e) { where.push('a.disbursed_date <= ?'); params.push(e); }
  let list = all(`${APP_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.id DESC`, params).map(withConsentFlags);
  const q = String(search || '').trim().toLowerCase();
  if (q) list = list.filter(a => [a.app_no, a.member_name, a.member_name_bn, a.member_code, a.purpose, a.guarantor, a.guarantor_name, a.guarantor_member_name, a.guarantor_member_code]
    .some(v => v && String(v).toLowerCase().includes(q)));
  return list;
}

/** A draft with everything the details page needs: schedule, guarantor, checks. */
function getLoanApplication(id: number) {
  const a = withConsentFlags(loadApplication(id));
  const terms = { principal: Number(a.principal), method: a.method as LoanMethod, annual_rate: Number(a.annual_rate), term_months: Number(a.term_months), first_due_date: String(a.first_due_date) };
  const plan = buildPlan(terms);
  const warnings: Array<{ level: 'error' | 'warn' | 'info'; text: string }> = [];
  const today = todayISO();
  const cash = lendableCash(today);
  if (a.status === 'Draft') {
    if (terms.principal > cash + 0.005) warnings.push({ level: 'warn', text: `The fund can lend only TK ${Math.max(0, cash)} right now. The loan cannot be disbursed until there is enough cash.` });
    if (String(a.first_due_date) <= today) warnings.push({ level: 'error', text: `The first installment date (${a.first_due_date}) has passed. Edit the draft with new dates; the new paper must be signed again.` });
  }
  const m = get('SELECT id, member_code, name, name_bn, nid, phone, status FROM members WHERE id = ?', [a.member_id]) || {};
  return {
    application: a, guarantor: guarantorInfoOf(a), plan, warnings, consentRequired: consentRequired(),
    member: { ...m, savings: memberSavings(a.member_id), owed: loansOwedBy(a.member_id) },
  };
}

/** Disburse a draft: the member now has the loan, the money leaves the fund's cash. Needs the signed paper (unless the policy no longer requires it). */
function activateLoanApplication(d: any) {
  const a = loadApplication(d?.id);
  if (a.status !== 'Draft') fail('This draft has already been disbursed or removed.');
  const date = loanDate(d?.disbursed_date, todayISO(), 'The disbursement date')!;
  if (date > todayISO()) fail('Disbursement date cannot be in the future.');
  if (String(a.first_due_date) <= date) fail(`The first installment date (${a.first_due_date}) is not after the disbursement date. Edit the draft with new dates; the new paper must be signed again.`);
  // what is disbursed must be exactly what was printed on the paper
  const plan = buildPlan({ principal: Number(a.principal), method: a.method, annual_rate: Number(a.annual_rate), term_months: Number(a.term_months), first_due_date: String(a.first_due_date) });
  if (Math.abs(plan.totalPayable - Number(a.total_payable)) > 0.005 || Math.abs(plan.installment - Number(a.installment)) > 0.005)
    fail('The loan figures no longer match the consent paper. Edit the draft and get the new paper signed.');
  if (consentRequired() && !a.consent_file) fail('Upload the signed consent paper first.');
  if (a.consent_file && !fs.existsSync(String(a.consent_file))) fail('The uploaded consent paper file cannot be found on this computer. Upload it again.');
  return addLoanInternal({
    member_id: a.member_id, principal: a.principal, method: a.method, annual_rate: a.annual_rate, term_months: a.term_months, disbursed_date: date, first_due_date: a.first_due_date,
    payment_method: a.payment_method, reference: a.reference, purpose: a.purpose, notes: a.notes, limit_note: a.limit_note,
    guarantor_type: a.guarantor_type, guarantor_member_id: a.guarantor_member_id, guarantor_name: a.guarantor_name, guarantor_address: a.guarantor_address,
    guarantor_nid: a.guarantor_nid, guarantor_phone: a.guarantor_phone, guarantor_relation: a.guarantor_relation,
  }, { appId: Number(a.id), appNo: String(a.app_no), consent: a.consent_file ? { file: a.consent_file, name: a.consent_name, size: Number(a.consent_size), sha256: a.consent_sha256, at: a.consent_uploaded_at } : null });
}

/** Called by the main process after the user picked a signed-paper file and it was copied into the app's documents folder. */
export function attachConsentDocument(kind: 'application' | 'loan', id: number, info: { file: string; name: string; size: number; sha256: string }) {
  requireWriter();
  if (kind === 'application') {
    const a = loadApplication(id);
    if (a.status !== 'Draft') fail('The loan was already disbursed; attach the paper to the loan instead.');
    tx(() => {
      run(`UPDATE loan_applications SET consent_file=?, consent_name=?, consent_size=?, consent_sha256=?, consent_uploaded_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`, [info.file, info.name, info.size, info.sha256, Number(id)]);
      audit('upload', 'loan_application', Number(id), `${a.app_no}: signed consent paper "${info.name}" (${info.size} bytes, sha256 ${info.sha256.slice(0, 12)}…)`);
    });
    if (a.consent_file && a.consent_file !== info.file) removeFileQuietly(a.consent_file);
  } else {
    const l = get('SELECT id, loan_no, consent_file FROM personal_loans WHERE id = ?', [Number(id)]);
    if (!l) fail('Loan not found.');
    tx(() => {
      run(`UPDATE personal_loans SET consent_status='Signed', consent_file=?, consent_name=?, consent_size=?, consent_sha256=?, consent_uploaded_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`, [info.file, info.name, info.size, info.sha256, Number(id)]);
      audit('upload', 'loan', Number(id), `${l.loan_no}: signed consent paper "${info.name}" (${info.size} bytes, sha256 ${info.sha256.slice(0, 12)}…)`);
    });
    if (l.consent_file && l.consent_file !== info.file) removeFileQuietly(l.consent_file);
  }
  mutated();
}

/** Path of an uploaded paper (null when none or the file is gone). Used by the main process to open it. */
export function consentDocumentPath(kind: 'application' | 'loan', id: number): { file: string; name: string } | null {
  const r = kind === 'application' ? get('SELECT consent_file, consent_name FROM loan_applications WHERE id = ?', [Number(id)]) : get('SELECT consent_file, consent_name FROM personal_loans WHERE id = ?', [Number(id)]);
  return r?.consent_file && fs.existsSync(String(r.consent_file)) ? { file: String(r.consent_file), name: String(r.consent_name || 'consent') } : null;
}
export const refForConsent = (kind: 'application' | 'loan', id: number): string => {
  const r = kind === 'application' ? get('SELECT app_no AS n FROM loan_applications WHERE id = ?', [Number(id)]) : get('SELECT loan_no AS n FROM personal_loans WHERE id = ?', [Number(id)]);
  if (!r) fail(kind === 'application' ? 'Loan draft not found.' : 'Loan not found.');
  return String(r.n);
};

/** Descriptive fields only — money terms are fixed once a loan is given (delete and re-create to change them). */
function updateLoan(id: number, d: any) {
  const l = get('SELECT id, loan_no FROM personal_loans WHERE id = ?', [Number(id)]);
  if (!l) fail('Loan not found.');
  const f: Record<string, any> = { purpose: d?.purpose, notes: d?.notes, reference: d?.reference };   // the guarantor is fixed once the loan is given
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (!keys.length) return;
  tx(() => {
    run(`UPDATE personal_loans SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`, [...keys.map(k => String(f[k] ?? '').trim()), Number(id)]);
    audit('update', 'loan', Number(id), `${l.loan_no}: ${keys.join(', ')}`);
  });
  mutated();
}

/** Only a loan nobody has paid anything on can be deleted (to undo a mistake). */
function deleteLoan(id: number) {
  const l = get('SELECT * FROM personal_loans WHERE id = ?', [Number(id)]);
  if (!l) fail('Loan not found.');
  if (num('SELECT COUNT(*) FROM loan_repayments WHERE loan_id = ?', [l.id]) > 0) fail('This loan already has repayments. Remove them first (latest first), or close the loan instead.');
  if (l.status === 'Written off') fail('This loan was written off. Cancel the write-off first (Admin).');
  tx(() => { run('DELETE FROM loan_schedule WHERE loan_id = ?', [l.id]); run('DELETE FROM personal_loans WHERE id = ?', [l.id]); audit('delete', 'loan', l.id, `${l.loan_no} TK ${l.principal}`); });
  mutated();
}

/** What a payment on `loan` would do: split into principal and interest, which installments it completes, and the late fee to suggest. */
function repaymentQuote(l: Row, date: string, amount: number | undefined, kind: 'Installment' | 'Closure', interestOverride?: number) {
  const rows = loanSchedule(l.id);
  if (kind === 'Closure') {
    const dueInterest = r2(rows.filter(x => x.due_date <= date).reduce((a, x) => a + Number(x.interest), 0));
    const calcInterest = Math.max(0, r2(dueInterest - l.paid_interest));
    const principal = l.outstanding_principal;
    const interest = interestOverride === undefined || Number.isNaN(interestOverride) ? calcInterest : r2(interestOverride);
    return { kind, principal, interest, calcInterest, amount: r2(principal + interest), lines: [] as any[], completed: [] as number[], lateCompleted: 0, closes: true,
      waivedInterest: Math.max(0, r2(l.remaining_interest - interest)) };
  }
  const remaining = l.remaining_payable;
  let amt = amount === undefined || Number.isNaN(amount) ? l.next_due_amount : r2(amount);
  if (amt > remaining && amt - remaining <= 0.005) amt = remaining;
  const a = allocatePayment(rows as any, l.paid_schedule, Math.max(0, amt));
  const completed: number[] = [];
  let cum = 0, lateCompleted = 0;
  for (const r of rows) {
    cum = r2(cum + Number(r.total));
    if (cum > l.paid_schedule + 0.005 && cum <= l.paid_schedule + amt + 0.005) { completed.push(r.no); if (r.due_date < date) lateCompleted++; }
  }
  const closes = amt > 0 && l.paid_principal + a.principal >= Number(l.principal) - 0.005;
  let principal = a.principal, interest = a.interest;
  if (closes) { principal = r2(Number(l.principal) - l.paid_principal); interest = r2(amt - principal); }   // no cent is ever left over
  return { kind, principal, interest, calcInterest: interest, amount: amt, lines: a.lines, completed, lateCompleted, closes, waivedInterest: 0 };
}

function previewLoanRepayment(loanId: number, paidDate?: string, amount?: any, kind?: string, interest?: any) {
  const l = loadLoan(loanId);
  const date = toISODate(paidDate) || todayISO();
  const k = kind === 'Closure' ? 'Closure' : 'Installment';
  if (l.status !== 'Active') return { open: false, status: l.status };
  const amt = amount === undefined || amount === null || amount === '' ? undefined : Number(amount);
  const q = repaymentQuote(l, date, amt, k, interest === undefined || interest === null || interest === '' ? undefined : Number(interest));
  const lateFee = Number(settingsMap().loan_late_fee) || 0;
  return {
    open: true, loan_no: l.loan_no, date, ...q,
    suggestedPenalty: k === 'Closure' ? (l.overdue_count > 0 ? r2(lateFee * l.overdue_count) : 0) : r2(lateFee * q.lateCompleted),
    nextDueAmount: l.next_due_amount, nextDueDate: l.next_due_date, overdueAmount: l.overdue_amount, overdueCount: l.overdue_count,
    outstanding: l.outstanding_principal, remainingPayable: l.remaining_payable,
    outstandingAfter: r2(Math.max(0, l.outstanding_principal - q.principal)),
  };
}

function recordLoanRepayment(d: any) {
  const l = loadLoan(d?.loan_id);
  if (l.status !== 'Active') fail(`Loan ${l.loan_no} is ${l.status === 'Closed' ? 'already fully repaid' : 'written off'}, so no more repayments can be recorded.`);
  const today = todayISO();
  const date = loanDate(d.paid_date, today, 'The payment date')!;
  if (date > today) fail('Payment date cannot be in the future.');
  if (date < String(l.disbursed_date)) fail(`Payment date cannot be before the loan was given (${l.disbursed_date}).`);
  if (l.last_payment_date && date < l.last_payment_date) fail(`Payment date cannot be before the previous repayment (${l.last_payment_date}).`);
  const method = String(d.payment_method || '').trim();
  if (!method) fail('Choose how the money was received (cash, bank, bKash…).');
  const kind = d.kind === 'Closure' ? 'Closure' : 'Installment';
  const penalty = r2(Number(d.penalty) || 0);
  if (!Number.isFinite(penalty) || penalty < 0 || penalty > 1e9) fail('Penalty must be a normal amount of zero or more.');
  const note = String(d.note || '').trim();
  let q;
  if (kind === 'Closure') {
    const override = d.interest === undefined || d.interest === null || d.interest === '' ? undefined : Number(d.interest);
    if (override !== undefined && !(override >= 0 && override <= 1e9)) fail('Interest must be a normal amount of zero or more.');
    q = repaymentQuote(l, date, undefined, 'Closure', override);
    if (Math.abs(q.interest - q.calcInterest) > 0.009 && !note) fail('You changed the calculated interest — please write the reason in the note.');
  } else {
    const amt = Number(d.amount);
    if (!(amt > 0) || !Number.isFinite(amt) || amt > 1e9) fail('Enter the amount received (greater than zero).');
    if (amt > l.remaining_payable + 0.005) fail(`This is more than the loan still needs (TK ${l.remaining_payable}). To pay it all off early use "Close loan early".`);
    q = repaymentQuote(l, date, amt, 'Installment');
  }
  const total = r2(q.principal + q.interest + penalty);
  if (!(total > 0)) fail('Nothing to record: the amount is zero.');
  if (q.interest > 0) assertAfterLastSettlement(date, 'A repayment that includes interest');
  const id = tx(() => {
    run(`INSERT INTO loan_repayments (loan_id, paid_date, kind, principal_paid, interest_paid, penalty_paid, total_paid, payment_method, trx_id, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [l.id, date, kind, q.principal, q.interest, penalty, total, method, String(d.trx_id || '').trim(), note, actor]);
    const rid = lastId();
    // no transaction number typed: give the receipt its own unique one
    if (!String(d.trx_id || '').trim()) run('UPDATE loan_repayments SET trx_id = ? WHERE id = ?', [`RCPT-${l.loan_no}-${rid}`, rid]);
    if (q.closes) run(`UPDATE personal_loans SET status = 'Closed', closed_date = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [date, l.id]);
    audit(kind === 'Closure' ? 'close' : 'repayment', 'loan', l.id, `${l.loan_no} ${l.member_code} received ${total} (principal ${q.principal}, interest ${q.interest}, penalty ${penalty}) on ${date}${q.closes ? ' — loan fully repaid' : ''}`);
    return rid;
  });
  mutated();
  return id;
}

/** Removes the most recent repayment of a loan (to correct a mistake). */
function deleteLoanRepayment(id: number) {
  const r = get('SELECT r.*, l.loan_no, l.status AS loan_status FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id WHERE r.id = ?', [Number(id)]);
  if (!r) fail('Repayment not found.');
  if (r.loan_status === 'Written off') fail('This loan was written off. Cancel the write-off first (Admin).');
  if (num('SELECT MAX(id) FROM loan_repayments WHERE loan_id = ?', [r.loan_id]) !== Number(r.id)) fail('Only the most recent repayment of a loan can be removed. Remove the later ones first.');
  if (Number(r.interest_paid) > 0) assertAfterLastSettlement(String(r.paid_date), 'A repayment that included interest');
  if (get('SELECT 1 FROM member_settlements s JOIN personal_loans l ON l.member_id = s.member_id WHERE l.id = ?', [r.loan_id])) fail('The borrower has already been settled, so this repayment cannot be removed.');
  tx(() => {
    run('DELETE FROM loan_repayments WHERE id = ?', [Number(id)]);
    if (r.loan_status === 'Closed') run(`UPDATE personal_loans SET status = 'Active', closed_date = NULL, updated_at = datetime('now','localtime') WHERE id = ?`, [r.loan_id]);
    audit('void', 'loan_repayment', Number(id), `${r.loan_no} repayment ${r.total_paid} on ${r.paid_date}`);
  });
  mutated();
}

/** Admin: the borrower cannot pay. The unpaid principal becomes a loss shared by the members; unpaid interest is simply never booked. */
function writeOffLoan(d: any) {
  const l = loadLoan(d?.loan_id);
  if (l.status !== 'Active') fail('Only a running loan can be written off.');
  const date = loanDate(d.date, todayISO(), 'The write-off date')!;
  if (date > todayISO()) fail('Write-off date cannot be in the future.');
  if (date < String(l.disbursed_date) || (l.last_payment_date && date < l.last_payment_date)) fail('Write-off date cannot be before the loan or its last repayment.');
  const reason = String(d.reason || '').trim();
  if (!reason) fail('Write the reason for writing this loan off.');
  if (!(l.outstanding_principal > 0)) fail('Nothing is outstanding on this loan.');
  assertAfterLastSettlement(date, 'A write-off');
  tx(() => {
    run(`UPDATE personal_loans SET status = 'Written off', written_off_amount = ?, written_off_date = ?, written_off_reason = ?, closed_date = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [l.outstanding_principal, date, reason, date, l.id]);
    audit('write-off', 'loan', l.id, `${l.loan_no} ${l.member_code} TK ${l.outstanding_principal} written off: ${reason}`);
  });
  mutated();
}

function cancelLoanWriteOff(loanId: number) {
  const l = get('SELECT * FROM personal_loans WHERE id = ?', [Number(loanId)]);
  if (!l || l.status !== 'Written off') fail('This loan is not written off.');
  assertAfterLastSettlement(String(l.written_off_date), 'Cancelling a write-off');
  tx(() => {
    run(`UPDATE personal_loans SET status = 'Active', written_off_amount = 0, written_off_date = NULL, written_off_reason = NULL, closed_date = NULL, updated_at = datetime('now','localtime') WHERE id = ?`, [l.id]);
    audit('void', 'loan_writeoff', l.id, `${l.loan_no} write-off of ${l.written_off_amount} cancelled`);
  });
  mutated();
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
// ---- National ID (NID) -----------------------------------------------------------------
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Validates a National ID: Bangla or English digits, 10, 13 or 17 long (spaces and dashes ignored). Never throws. */
export function checkNid(raw: unknown): { ok: boolean; value: string; error: string } {
  const s = String(raw ?? '').replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))).replace(/[\s-]/g, '');
  if (!s) return { ok: false, value: '', error: 'National ID (NID) is required.' };
  if (!/^\d+$/.test(s)) return { ok: false, value: '', error: 'NID must contain digits only.' };
  if (![10, 13, 17].includes(s.length)) return { ok: false, value: '', error: 'NID must be 10, 13 or 17 digits.' };
  return { ok: true, value: s, error: '' };
}
function nidOrFail(raw: unknown, exceptId?: number): string {
  const c = checkNid(raw);
  if (!c.ok) fail(c.error);
  const dup = get('SELECT member_code, name FROM members WHERE nid = ?' + (exceptId ? ' AND id != ?' : ''), exceptId ? [(c as any).value, exceptId] : [(c as any).value]);
  if (dup) fail(`This NID already belongs to ${dup.member_code} ${dup.name}.`);
  return (c as any).value;
}

function getNextMemberCode(extra?: string[]) {
  const used = new Set<number>();
  for (const r of all('SELECT member_code FROM members')) {
    const n = parseInt(String(r.member_code).replace(/\D/g, ''), 10);
    if (!isNaN(n)) used.add(n);
  }
  for (const c of extra || []) { const n = parseInt(c.replace(/\D/g, ''), 10); if (!isNaN(n)) used.add(n); }
  let next = (Math.max(0, ...used) || 0) + 1;
  while (used.has(next)) next++;
  return `BF-${pad4(next)}`;
}
const pad4 = (n: number) => String(n).padStart(4, '0');

const MEMBER_SORT: Record<string, string> = {
  newest: 'id DESC', oldest: 'id ASC', name_asc: 'name COLLATE NOCASE ASC', name_desc: 'name COLLATE NOCASE DESC',
  due_high: 'monthly_due DESC', due_low: 'monthly_due ASC', contributed_high: 'total_contributed DESC',
  contributed_low: 'total_contributed ASC', code_asc: 'member_code ASC', join_desc: 'join_date DESC',
};

function getMembers(search = '', status = 'All', page = 1, limit = 10, month?: string, startDate?: string, endDate?: string, sortBy = 'newest') {
  const mk = monthArg(month);
  const due = dueDateOf(mk, dueDay());
  const base = `
    WITH paid AS (SELECT member_id, SUM(contribution_amount) s, MAX(payment_date) last FROM collections GROUP BY member_id),
         cur AS (SELECT member_id, id FROM collections WHERE payment_month = ?)
    SELECT m.id, m.member_code, m.name, m.phone, m.email, m.designation, m.status, m.monthly_due, m.join_date,
           m.avatar_initials, m.notes, m.opening_balance, m.name_bn, m.nid,
           m.opening_balance + COALESCE(p.s,0) AS total_contributed, p.last AS last_payment_date,
           CASE WHEN cur.id IS NOT NULL THEN 'Paid'
                WHEN m.status != 'Active' OR substr(m.join_date,1,7) > ? THEN NULL
                WHEN ? > ? THEN 'Overdue' ELSE 'Pending' END AS current_month_status
    FROM members m LEFT JOIN paid p ON p.member_id = m.id LEFT JOIN cur ON cur.member_id = m.id`;
  const baseParams = [mk, mk, todayISO(), due];

  const where: string[] = [];
  const params: any[] = [];
  if (search?.trim()) {
    where.push('(name LIKE ? OR name_bn LIKE ? OR phone LIKE ? OR member_code LIKE ? OR email LIKE ? OR nid LIKE ?)');
    const q = `%${search.trim()}%`;
    const qn = `%${search.trim().replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))).replace(/[\s-]/g, '')}%`;   // NID typed with Bangla digits or dashes
    params.push(q, q, q, q, q, qn);
  }
  if (status && status !== 'All') {
    if (status === 'Active' || status === 'Inactive') { where.push('status = ?'); params.push(status); }
    else { where.push('current_month_status = ?'); params.push(status); }
  }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('join_date >= ?'); params.push(s); }
  if (e) { where.push('join_date <= ?'); params.push(e); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const outer = `SELECT * FROM (${base}) ${whereSql}`;
  const total = num(`SELECT COUNT(*) FROM (${outer})`, [...baseParams, ...params]);
  const lim = Math.max(1, Math.min(Number(limit) || 10, 10000));
  const off = (Math.max(1, Number(page) || 1) - 1) * lim;
  const members = all(`${outer} ORDER BY ${MEMBER_SORT[sortBy] || MEMBER_SORT.newest} LIMIT ? OFFSET ?`, [...baseParams, ...params, lim, off]);

  const st = get(`SELECT COUNT(*) total, SUM(status='Active') active,
      SUM(current_month_status='Paid') paid, SUM(current_month_status='Pending') pending, SUM(current_month_status='Overdue') overdue
      FROM (${base})`, baseParams) || {};
  const stats = Object.fromEntries(['total', 'active', 'paid', 'pending', 'overdue'].map(k => [k, Number(st[k]) || 0]));
  return { members, total, stats };
}

function getAllMembersLite() {
  return all(`SELECT id, member_code, name, name_bn, phone, nid, monthly_due, status, avatar_initials FROM members ORDER BY name COLLATE NOCASE`);
}

function validateMember(d: any) {
  if (!d?.name?.trim()) fail('Member name is required.');
  if (d.monthly_due !== undefined && (isNaN(+d.monthly_due) || +d.monthly_due < 0)) fail('Monthly due must be a positive number.');
}

function addMember(d: any) {
  validateMember(d);
  const nid = nidOrFail(d.nid);
  const s = settingsMap();
  let code = d.member_code?.trim();
  if (!code || get('SELECT 1 FROM members WHERE member_code = ?', [code])) code = getNextMemberCode();
  const name = d.name.trim();
  const id = tx(() => {
    run(`INSERT INTO members (member_code, name, name_bn, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes, nid)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, name, d.name_bn?.trim() || null, d.phone?.trim() || '', d.email?.trim() || '', d.designation || 'Member', d.status || 'Active',
        d.monthly_due !== undefined && d.monthly_due !== '' ? Number(d.monthly_due) : Number(s.default_monthly_due),
        toISODate(d.join_date) || todayISO(), d.avatar_initials || initials(name),
        Number(d.opening_balance ?? d.total_contributed) || 0, d.notes || '', nid]);
    const newId = lastId();
    audit('create', 'member', newId, `${code} ${name}`);
    return newId;
  });
  mutated();
  return id;
}

function updateMember(id: number, d: any) {
  if (!get('SELECT 1 FROM members WHERE id = ?', [id])) fail('Member not found.');
  if (d.name !== undefined) validateMember(d);
  const fields: Record<string, any> = {
    name: d.name?.trim(), name_bn: d.name_bn !== undefined ? (String(d.name_bn).trim() || null) : undefined, phone: d.phone, email: d.email, designation: d.designation, status: d.status,
    monthly_due: d.monthly_due !== undefined ? Number(d.monthly_due) : undefined,
    join_date: d.join_date ? toISODate(d.join_date) : undefined, notes: d.notes,
    opening_balance: d.opening_balance !== undefined ? Number(d.opening_balance) : undefined,
    nid: d.nid !== undefined ? nidOrFail(d.nid, id) : undefined,
    avatar_initials: d.name ? initials(d.name) : undefined,
  };
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (!keys.length) return;
  const cur = get('SELECT status, opening_balance FROM members WHERE id = ?', [id]);
  const settled = !!get('SELECT 1 FROM member_settlements WHERE member_id = ?', [id]);
  if (d.status !== undefined && d.status !== cur.status) {
    if (!['Active', 'Inactive'].includes(d.status)) fail('Member status must be Active or Inactive.');
    if (d.status === 'Inactive') fail('A member cannot be made inactive directly. Use "Settle & deactivate" so the final payout is recorded first.');
    if (d.status === 'Active' && settled) fail('This member has been settled and paid out. An Admin must cancel the settlement before the member can be reactivated.');
  }
  if (settled && fields.opening_balance !== undefined && Math.abs(fields.opening_balance - Number(cur.opening_balance)) > 0.009)
    fail('The opening balance cannot be changed after the member has been settled.');
  tx(() => {
    run(`UPDATE members SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`,
      [...keys.map(k => fields[k]), id]);
    audit('update', 'member', id, keys.join(', '));
  });
  mutated();
}

function deleteMember(id: number) {
  const payments = num('SELECT COUNT(*) FROM collections WHERE member_id = ?', [id]);
  if (get('SELECT 1 FROM member_settlements WHERE member_id = ?', [id])) fail('This member has a settlement record, so the member cannot be deleted.');
  if (get(`SELECT 1 FROM loan_applications WHERE (member_id = ? OR guarantor_member_id = ?) AND status = 'Draft'`, [id, id])) fail('This member is named on a loan draft, so the member cannot be deleted. Delete the draft first.');
  if (get('SELECT 1 FROM personal_loans WHERE member_id = ? OR guarantor_member_id = ?', [id, id])) fail('This member has personal loan records (as borrower or guarantor), so the member cannot be deleted.');
  if (payments > 0) fail(`This member has ${payments} payment record(s). Settle the member so they become Inactive instead, so the fund history stays correct.`);
  tx(() => {
    const m = get('SELECT member_code, name FROM members WHERE id = ?', [id]);
    run('DELETE FROM members WHERE id = ?', [id]);
    audit('delete', 'member', id, m ? `${m.member_code} ${m.name}` : '');
  });
  mutated();
}

function getMemberHistory(memberId: number) {
  return all(`SELECT c.*, 'Paid' AS status, m.name AS member_name, m.member_code
              FROM collections c JOIN members m ON m.id = c.member_id
              WHERE c.member_id = ? ORDER BY c.payment_month DESC`, [memberId]);
}

/** Month-by-month statement since joining, including unpaid months. */
function getMemberStatement(memberId: number) {
  const m = get('SELECT * FROM members WHERE id = ?', [memberId]);
  if (!m) fail('Member not found.');
  const paid = new Map(all('SELECT * FROM collections WHERE member_id = ?', [memberId]).map(r => [r.payment_month, r]));
  const rows: Row[] = [];
  const end = currentMonthKey();
  const today = todayISO();
  const dd = dueDay();
  for (let mk = String(m.join_date).slice(0, 7); mk <= end; mk = addMonths(mk, 1)) {
    const p = paid.get(mk);
    const due = dueDateOf(mk, dd);
    rows.push({ payment_month: mk, due_date: due, monthly_due: m.monthly_due, ...(p || {}),
      status: p ? 'Paid' : today > due ? 'Overdue' : 'Pending' });
    if (rows.length > 600) break;
  }
  return { member: m, rows: rows.reverse() };
}

/** Everything needed to print / export member statements (one member, a list, or everyone). Oldest month first. */
export function getStatementsData(memberIds?: number[]) {
  const s = settingsMap();
  const ids = (memberIds || []).map(Number).filter(Boolean);
  const members = all(`SELECT id FROM members ${ids.length ? `WHERE id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY member_code COLLATE NOCASE`, ids);
  const statements = members.map(({ id }) => {
    const st = getMemberStatement(Number(id));
    const rows = [...st.rows].reverse();
    const paid = rows.filter(r => r.status === 'Paid');
    const overdue = rows.filter(r => r.status === 'Overdue');
    const contributions = paid.reduce((a, r) => a + (Number(r.contribution_amount) || 0), 0);
    const lateFees = paid.reduce((a, r) => a + (Number(r.late_fee) || 0), 0);
    const settlement = get('SELECT settlement_date, principal, profit_share, total_paid, payment_method, trx_id, note FROM member_settlements WHERE member_id = ?', [Number(id)]);
    return {
      member: st.member, rows,
      totals: {
        opening: Number(st.member.opening_balance) || 0, contributions, lateFees, received: contributions + lateFees, paidMonths: paid.length,
        overdueMonths: overdue.length, overdueAmount: overdue.reduce((a, r) => a + (Number(r.monthly_due) || 0), 0), pendingMonths: rows.filter(r => r.status === 'Pending').length,
      },
      settlement: settlement || null,
    };
  });
  return { orgName: s.organization_name || 'Bondhu Fund', currency: s.currency_symbol || 'TK', generatedOn: todayISO(), statements };
}

function bulkAddMembers(list: any[]) {
  const s = settingsMap();
  const batch: string[] = [];
  // every person needs a valid, unique NID: check the whole list first so nothing is half-imported
  const nids = new Map<string, number>();
  (list || []).forEach((m, i) => {
    if (!String(m?.name || '').trim()) return;
    const c = checkNid(m?.nid);
    if (!c.ok) fail(`Row ${i + 1} (${String(m.name).trim()}): ${c.error}`);
    const v = (c as any).value as string;
    if (nids.has(v)) fail(`Row ${i + 1}: NID ${v} is also used in row ${nids.get(v)}.`);
    nids.set(v, i + 1);
    const dup = get('SELECT member_code, name FROM members WHERE nid = ?', [v]);
    if (dup) fail(`Row ${i + 1}: NID ${v} already belongs to ${dup.member_code} ${dup.name}.`);
  });
  const count = tx(() => {
    let c = 0;
    for (const m of list || []) {
      const name = String(m?.name || '').trim();
      if (!name) continue;
      const code = getNextMemberCode(batch);
      batch.push(code);
      run(`INSERT INTO members (member_code, name, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes, nid)
           VALUES (?,?,?,?,?,'Active',?,?,?,?,?,?)`,
        [code, name, String(m.phone || '').trim(), String(m.email || '').trim(), String(m.designation || 'Member').trim(),
          Number(m.monthly_due) || Number(s.default_monthly_due), toISODate(m.join_date) || todayISO(), initials(name),
          Number(m.opening_balance) || 0, String(m.notes || ''), (checkNid(m.nid) as any).value]);
      c++;
    }
    audit('import', 'member', null, `${c} members imported`);
    return c;
  });
  mutated();
  return count;
}

// ---------------------------------------------------------------------------
// Excel import (members + till-date payment history)
// ---------------------------------------------------------------------------
type Level = 'ok' | 'warning' | 'error';
export interface ImportOptions { existing?: 'skip' | 'update'; payment_method?: string }

/**
 * Validates a parsed workbook against the database and produces a deterministic plan.
 * Used for both the preview and the commit, so what the user previews is exactly what is imported.
 */
function planImport(p: ParsedWorkbook, opts: ImportOptions = {}) {
  const existingMode = opts.existing === 'update' ? 'update' : 'skip';
  const s = settingsMap();
  const today = todayISO();
  const curM = currentMonthKey();
  const defDue = Number(s.default_monthly_due) || 0;
  const dbMembers = all('SELECT id, member_code, name, monthly_due, join_date, status, opening_balance, nid FROM members');
  const dbByNid = new Map<string, any>(dbMembers.filter(x => x.nid).map(x => [String(x.nid), x] as [string, any]));
  const seenNid = new Map<string, number>();
  const dbByCode = new Map(dbMembers.map(m => [String(m.member_code).toLowerCase(), m]));
  const dbByName = new Map<string, Row[]>();
  for (const m of dbMembers) {
    const k = String(m.name).trim().toLowerCase();
    dbByName.set(k, [...(dbByName.get(k) || []), m]);
  }

  // ---- members ----
  const seenCodes = new Map<string, number>();
  const reservedCodes = p.members.map(m => m.code).filter(Boolean);
  const members = p.members.map(m => {
    const msgs: Array<{ level: Level; text: string }> = m.problems.map(t => ({ level: 'error' as Level, text: t }));
    const name = m.name.trim();
    if (!name) msgs.push({ level: 'error', text: 'Name is required' });
    const statusRaw = m.status.trim().toLowerCase();
    const status = !statusRaw || /^(active|সক্রিয়)$/.test(statusRaw) ? 'Active' : /^(inactive|নিষ্ক্রিয়)$/.test(statusRaw) ? 'Inactive' : null;
    if (!status) msgs.push({ level: 'error', text: `Status "${m.status}" must be Active or Inactive` });
    if (m.monthly_due !== null && m.monthly_due < 0) msgs.push({ level: 'error', text: 'Monthly due cannot be negative' });
    if (m.opening_balance !== null && m.opening_balance < 0) msgs.push({ level: 'error', text: 'Opening balance cannot be negative' });
    if (m.join_date && m.join_date > today) msgs.push({ level: 'error', text: 'Join date is in the future' });
    if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) msgs.push({ level: 'warning', text: 'Email looks invalid' });

    let code = m.code.trim();
    const key = code.toLowerCase();
    if (code) {
      if (seenCodes.has(key)) msgs.push({ level: 'error', text: `Member code ${code} appears twice in the file (row ${seenCodes.get(key)})` });
      else seenCodes.set(key, m.row);
    }
    let existing = code ? dbByCode.get(key) : undefined;
    const nidCheck = checkNid(m.nid);
    if (!existing && !code && nidCheck.ok && dbByNid.has(nidCheck.value)) {
      existing = dbByNid.get(nidCheck.value);
      code = String(existing.member_code);
      msgs.push({ level: 'warning', text: `No member code — matched existing member ${code} ${existing.name} by NID${String(existing.name).trim().toLowerCase() === name.toLowerCase() ? '' : ' (the name in the sheet is different)'}` });
    }
    // No code: re-importing the same sheet must not duplicate people → match a unique exact name already in the app
    if (!existing && !code && name) {
      const same = dbByName.get(name.toLowerCase()) || [];
      if (same.length === 1) {
        existing = same[0];
        code = String(existing.member_code);
        msgs.push({ level: 'warning', text: `No member code — matched existing member ${code} by name` });
      } else if (same.length > 1) {
        msgs.push({ level: 'error', text: `No member code and ${same.length} members named "${name}" exist — add the Member Code` });
      }
    }
    const action: 'new' | 'update' | 'skip' = existing ? (existingMode === 'update' ? 'update' : 'skip') : 'new';
    if (existing && action === 'skip') msgs.push({ level: 'warning', text: `${code} already exists — details not changed (choose "Update existing members" to apply changes)` });
    if (!existing && !code) { code = getNextMemberCode(reservedCodes); reservedCodes.push(code); }
    // National ID: required for every new member; checked for format and for duplicates (in the app and in the file)
    let nid = '';
    {
      const c = nidCheck;
      if (c.ok) {
        nid = c.value;
        const other = dbByNid.get(nid);
        if (other && (!existing || Number(other.id) !== Number(existing.id))) msgs.push({ level: 'error', text: `NID already belongs to ${other.member_code} ${other.name}` });
        if (seenNid.has(nid)) msgs.push({ level: 'error', text: `NID appears twice in the file (row ${seenNid.get(nid)})` });
        else seenNid.set(nid, m.row);
      } else if (!existing || String(m.nid || '').trim()) {
        msgs.push({ level: 'error', text: c.error });
      }
    }
    // an exit must go through a recorded settlement — an import may not deactivate / reactivate / re-base anyone
    if (!existing && status === 'Inactive') msgs.push({ level: 'error', text: 'New members must be imported as Active. Use Settle & deactivate in the app when someone leaves.' });
    if (existing && action === 'update') {
      const settled = !!get('SELECT 1 FROM member_settlements WHERE member_id = ?', [Number(existing.id)]);
      if (statusRaw && status && status !== existing.status) {
        msgs.push({ level: 'error', text: status === 'Inactive' ? 'A member cannot be made inactive by import. Use Settle & deactivate in the app.' : settled ? 'This member was settled; an Admin must cancel the settlement before reactivating.' : 'Status change not allowed here.' });
      }
      if (settled && m.opening_balance !== null && Math.abs(m.opening_balance - Number(existing.opening_balance)) > 0.009) msgs.push({ level: 'error', text: 'Opening balance cannot change after settlement' });
    }
    const level: Level = msgs.some(x => x.level === 'error') ? 'error' : msgs.length ? 'warning' : 'ok';
    return {
      row: m.row, code, name, name_bn: m.name_bn, nid, phone: m.phone, email: m.email, designation: m.designation || 'Member',
      status: status || 'Active', monthly_due: m.monthly_due ?? (existing ? Number(existing.monthly_due) : defDue),
      join_date: m.join_date, opening_balance: m.opening_balance ?? 0, notes: m.notes,
      existingId: existing ? Number(existing.id) : null, action: level === 'error' ? 'error' as const : action, level, messages: msgs,
      payments: 0, paidTotal: 0, autoGeneratedCode: !m.code.trim() && !existing,
    };
  });
  // First occurrence wins: a later duplicate-code row (an error) must not capture the valid member's payments.
  const fileByCode = new Map<string, (typeof members)[number]>();
  for (const m of members) if (m.code && !fileByCode.has(m.code.toLowerCase())) fileByCode.set(m.code.toLowerCase(), m);
  const fileByNid = new Map<string, (typeof members)[number]>();
  for (const m of members) if (m.nid && !fileByNid.has(m.nid)) fileByNid.set(m.nid, m);
  const fileByName = new Map<string, typeof members>();
  for (const m of members) { const k = m.name.toLowerCase(); fileByName.set(k, [...(fileByName.get(k) || []), m]); }

  // ---- payments ----
  const existingPaid = new Set(all('SELECT member_id, payment_month FROM collections').map(r => `${r.member_id}|${r.payment_month}`));
  const seenPay = new Map<string, string>();
  const payments = p.payments.map(x => {
    const msgs: Array<{ level: Level; text: string }> = x.problems.map(t => ({ level: 'error' as Level, text: t }));
    // resolve member: code first (file, then DB), then unique exact name
    let fileM = x.code ? fileByCode.get(x.code.toLowerCase()) : undefined;
    let dbM = !fileM && x.code ? dbByCode.get(x.code.toLowerCase()) : undefined;
    const xnid = checkNid(x.nid);
    if (!fileM && !dbM && !x.code && xnid.ok) {
      fileM = fileByNid.get(xnid.value);
      if (!fileM) dbM = dbByNid.get(xnid.value);
    }
    if (!fileM && !dbM && !x.code && x.name) {
      const k = x.name.trim().toLowerCase();
      const fm = fileByName.get(k) || [];
      // an app member already represented by a sheet row (matched by code or name) is the same person, not a second one
      const dm = (dbByName.get(k) || []).filter(d => !fm.some(f => f.existingId === Number(d.id)));
      if (fm.length + dm.length > 1) msgs.push({ level: 'error', text: `More than one member is named "${x.name}" — add the Member Code` });
      else { fileM = fm[0]; dbM = dm[0]; }
    }
    if (!fileM && !dbM) msgs.push({ level: 'error', text: `Member ${x.code || x.name || x.nid} not found in the Members sheet or the app` });
    if (fileM && fileM.action === 'error') msgs.push({ level: 'error', text: `Member row ${fileM.row} has errors` });
    if (x.month > curM) msgs.push({ level: 'error', text: `${x.month} is in the future` });

    const memberId = fileM?.existingId ?? (dbM ? Number(dbM.id) : null);
    const due = fileM ? fileM.monthly_due : dbM ? Number(dbM.monthly_due) : defDue;
    const amount = x.amount === null ? due : x.amount;
    if (!(amount > 0) && !msgs.some(m => m.level === 'error')) msgs.push({ level: 'error', text: 'Amount must be greater than zero' });
    const key = `${(fileM?.code || dbM?.member_code || x.code || x.name).toLowerCase()}|${x.month}`;
    if (seenPay.has(key)) msgs.push({ level: 'error', text: `Duplicate: ${x.month} for this member already in cell ${seenPay.get(key)}` });
    else seenPay.set(key, x.cell);

    let action: 'new' | 'exists' | 'error' = 'new';
    if (msgs.some(m => m.level === 'error')) action = 'error';
    else if (memberId && existingPaid.has(`${memberId}|${x.month}`)) {
      action = 'exists';
      msgs.push({ level: 'warning', text: `A payment for ${x.month} is already recorded in the app — kept as is` });
    } else if (fileM && fileM.action === 'skip') {
      // member skipped but exists in DB: payments still imported against the existing member
    }
    if (action === 'new' && fileM) { fileM.payments++; fileM.paidTotal += amount; }
    return { row: x.row, cell: x.cell, code: fileM?.code || dbM?.member_code || x.code, name: fileM?.name || dbM?.name || x.name,
      month: x.month, amount, fullMarker: x.amount === null, action, level: (action === 'error' ? 'error' : msgs.length ? 'warning' : 'ok') as Level,
      messages: msgs, memberId, fileMemberRow: fileM?.row ?? null };
  });

  // join date: missing → earliest payment month or today; payments before join → move join earlier
  for (const m of members) {
    if (m.action === 'error') continue;
    const months = payments.filter(x => x.fileMemberRow === m.row && x.action === 'new').map(x => x.month).sort();
    if (!m.join_date) {
      m.join_date = months.length ? `${months[0]}-01` : today;
      m.messages.push({ level: 'warning', text: `Join date missing — using ${m.join_date}` });
    } else if (months.length && months[0] < m.join_date.slice(0, 7)) {
      m.messages.push({ level: 'warning', text: `Payments start ${months[0]}, before the join date — join date set to ${months[0]}-01` });
      m.join_date = `${months[0]}-01`;
    }
    if (m.level === 'ok' && m.messages.length) m.level = 'warning';
  }

  const ok = <T extends { action: string }>(xs: T[], a: string) => xs.filter(x => x.action === a).length;
  const newPays = payments.filter(x => x.action === 'new');
  return {
    members, payments,
    summary: {
      membersInFile: members.length, newMembers: ok(members, 'new'), updatedMembers: ok(members, 'update'),
      skippedMembers: ok(members, 'skip'), memberErrors: ok(members, 'error'),
      paymentsInFile: payments.length, newPayments: newPays.length, existingPayments: ok(payments, 'exists'), paymentErrors: ok(payments, 'error'),
      paymentTotal: newPays.reduce((a, x) => a + x.amount, 0),
      openingTotal: members.filter(m => m.action === 'new' || m.action === 'update').reduce((a, m) => a + (m.opening_balance || 0), 0),
      monthRange: newPays.length ? [newPays.map(x => x.month).sort()[0], newPays.map(x => x.month).sort().slice(-1)[0]] : null,
      examplesSkipped: p.examplesSkipped,
    },
    sheetWarnings: p.sheetWarnings,
  };
}

export function previewMemberImport(p: ParsedWorkbook, opts: ImportOptions = {}) {
  const plan = planImport(p, opts);
  // keep the payload small for the renderer: members in full, payments only when they need attention
  return { ...plan, payments: plan.payments.filter(x => x.level !== 'ok').slice(0, 500) };
}

export function commitMemberImport(p: ParsedWorkbook, opts: ImportOptions = {}) {
  const plan = planImport(p, opts);
  const method = opts.payment_method || 'Cash';
  const dd = dueDay();
  const today = todayISO();
  const result = tx(() => {
    const idByRow = new Map<number, number>();
    let created = 0, updated = 0, paymentsAdded = 0, amount = 0;
    for (const m of plan.members) {
      if (m.action === 'new') {
        run(`INSERT INTO members (member_code, name, name_bn, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes, nid)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [m.code, m.name, m.name_bn || null, m.phone, m.email, m.designation, m.status, m.monthly_due, m.join_date, initials(m.name), m.opening_balance, m.notes, m.nid || null]);
        idByRow.set(m.row, lastId());
        created++;
      } else if (m.action === 'update' && m.existingId) {
        run(`UPDATE members SET nid = COALESCE(NULLIF(?, ''), nid), name = ?, name_bn = COALESCE(NULLIF(?, ''), name_bn), phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email),
               designation = ?, status = ?, monthly_due = ?, join_date = ?, avatar_initials = ?, opening_balance = ?, notes = COALESCE(NULLIF(?, ''), notes),
               updated_at = datetime('now','localtime') WHERE id = ?`,
          [m.nid, m.name, m.name_bn, m.phone, m.email, m.designation, m.status, m.monthly_due, m.join_date, initials(m.name), m.opening_balance, m.notes, m.existingId]);
        idByRow.set(m.row, m.existingId);
        updated++;
      } else if (m.action === 'skip' && m.existingId) {
        idByRow.set(m.row, m.existingId);
      }
    }
    for (const x of plan.payments) {
      if (x.action !== 'new') continue;
      const memberId = x.fileMemberRow !== null ? idByRow.get(x.fileMemberRow) : x.memberId;
      if (!memberId) continue;
      let pd = dueDateOf(x.month, dd);
      if (pd > today) pd = today;
      run(`INSERT OR IGNORE INTO collections (member_id, payment_month, payment_date, contribution_amount, late_fee, total_amount, payment_method, trx_id, note, created_by)
           VALUES (?,?,?,?,0,?,?,?,?,?)`,
        [memberId, x.month, pd, x.amount, x.amount, method, '', 'Imported from Excel', actor]);
      paymentsAdded++;
      amount += x.amount;
    }
    audit('import', 'member', null, `Excel import: ${created} new, ${updated} updated members; ${paymentsAdded} payments (${amount})`);
    return { created, updated, skipped: plan.summary.skippedMembers, errors: plan.summary.memberErrors + plan.summary.paymentErrors, paymentsAdded, amount };
  });
  mutated();
  return result;
}

/** Members + payment grid for "Export to Excel" (same layout as the import template). */
export function exportMembersData() {
  const members = all(`SELECT member_code, name, name_bn, nid, phone, email, designation, status, monthly_due, join_date, opening_balance, notes FROM members ORDER BY member_code`);
  const payments = all(`SELECT m.member_code, c.payment_month, c.contribution_amount FROM collections c JOIN members m ON m.id = c.member_id`) as
    Array<{ member_code: string; payment_month: string; contribution_amount: number }>;
  const first = all('SELECT MIN(payment_month) AS f FROM collections')[0]?.f || currentMonthKey();
  const months: string[] = [];
  for (let k = first; k <= currentMonthKey() && months.length < 240; k = addMonths(k, 1)) months.push(k);
  return { members, payments, months };
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
const COLL_SORT: Record<string, string> = {
  newest: 'COALESCE(payment_date, \'\') DESC, member_name', oldest: 'COALESCE(payment_date, \'9999\') ASC, member_name',
  name_asc: 'member_name COLLATE NOCASE ASC', name_desc: 'member_name COLLATE NOCASE DESC',
  amount_high: 'total_amount DESC', amount_low: 'total_amount ASC', date_desc: 'payment_date DESC', date_asc: 'payment_date ASC',
  status: "CASE status WHEN 'Overdue' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END, member_name",
};

function getCollections(month?: string, statusTab = 'All', startDate?: string, endDate?: string, search = '', sortBy = 'newest') {
  let src: { sql: string; params: any[] };
  if (month === 'All') {
    src = {
      sql: `SELECT c.member_id, m.member_code, m.name AS member_name, m.name_bn AS member_name_bn, m.phone AS member_phone, m.monthly_due, m.avatar_initials,
                   c.id AS payment_id, c.payment_date, c.contribution_amount, c.late_fee, c.total_amount, c.payment_method,
                   c.trx_id, c.note, c.created_at, c.payment_month, NULL AS due_date, 'Paid' AS status
            FROM collections c JOIN members m ON m.id = c.member_id`,
      params: [],
    };
  } else {
    src = duesForMonth(monthArg(month));
  }
  const where: string[] = [];
  const params: any[] = [];
  if (statusTab && statusTab !== 'All') { where.push('status = ?'); params.push(statusTab); }
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    where.push('(member_name LIKE ? OR member_code LIKE ? OR trx_id LIKE ? OR member_phone LIKE ? OR member_nid LIKE ?)');
    params.push(q, q, q, q, q);
  }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('payment_date >= ?'); params.push(s); }
  if (e) { where.push('payment_date <= ?'); params.push(e); }

  const records = all(`SELECT *, COALESCE(payment_id, -member_id) AS id FROM (${src.sql})
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY ${COLL_SORT[sortBy] || COLL_SORT.newest}`, [...src.params, ...params]);

  const stats = {
    totalMembers: records.length,
    paidCount: records.filter(r => r.status === 'Paid').length,
    pendingCount: records.filter(r => r.status === 'Pending').length,
    overdueCount: records.filter(r => r.status === 'Overdue').length,
    collectedAmount: records.reduce((a, r) => a + (r.contribution_amount || 0), 0),
    lateFeeAmount: records.reduce((a, r) => a + (r.late_fee || 0), 0),
    expectedAmount: records.reduce((a, r) => a + (r.monthly_due || 0), 0),
    outstandingAmount: records.filter(r => r.status !== 'Paid').reduce((a, r) => a + (r.monthly_due || 0), 0),
    percentage: '0',
  };
  stats.percentage = stats.expectedAmount > 0 ? ((stats.collectedAmount / stats.expectedAmount) * 100).toFixed(1) : '0';
  return { records, stats };
}

function recordPayment(d: any) {
  const memberId = Number(d?.member_id);
  const member = get('SELECT id, name, member_code, monthly_due, status FROM members WHERE id = ?', [memberId]);
  if (!member) fail('Please select a valid member.');
  if (member.status !== 'Active') fail(`${member.name} is inactive. Payments can only be recorded for active members.`);
  const mk = toMonthKey(d.payment_month);
  if (!mk) fail('Please select the month this payment is for.');
  const contribution = Number(d.contribution_amount);
  const lateFee = Number(d.late_fee) || 0;
  if (!(contribution > 0)) fail('Contribution amount must be greater than zero.');
  if (lateFee < 0) fail('Late fee cannot be negative.');
  const payDate = toISODate(d.payment_date) || todayISO();
  if (payDate > todayISO()) fail('Payment date cannot be in the future.');

  const id = tx(() => {
    run(`INSERT INTO collections (member_id, payment_month, payment_date, contribution_amount, late_fee, total_amount, payment_method, trx_id, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(member_id, payment_month) DO UPDATE SET
           payment_date = excluded.payment_date, contribution_amount = excluded.contribution_amount,
           late_fee = excluded.late_fee, total_amount = excluded.total_amount, payment_method = excluded.payment_method,
           trx_id = excluded.trx_id, note = excluded.note`,
      [memberId, mk, payDate, contribution, lateFee, contribution + lateFee, d.payment_method || 'Cash', d.trx_id || '', d.note || '', actor]);
    const pid = num('SELECT id FROM collections WHERE member_id = ? AND payment_month = ?', [memberId, mk]);
    audit('payment', 'collection', pid, `${member.member_code} ${mk} ${contribution + lateFee}`);
    return pid;
  });
  mutated();
  return id;
}

function deletePayment(id: number) {
  const p = get('SELECT c.*, m.member_code FROM collections c JOIN members m ON m.id=c.member_id WHERE c.id = ?', [id]);
  if (!p) fail('Payment not found.');
  if (get('SELECT 1 FROM member_settlements WHERE member_id = ?', [p.member_id])) fail('This member has been settled, so their payments can no longer be changed.');
  tx(() => {
    run('DELETE FROM collections WHERE id = ?', [id]);
    audit('void', 'collection', id, `${p.member_code} ${p.payment_month} ${p.total_amount}`);
  });
  mutated();
}

/** Suggested late fee for a member/month if paid on `payDate`. */
function suggestLateFee(month: string, payDate?: string) {
  const mk = monthArg(month);
  const pd = toISODate(payDate) || todayISO();
  return pd > dueDateOf(mk, dueDay()) ? Number(settingsMap().late_fee_amount) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------
const INV_SORT: Record<string, string> = {
  newest: 'id DESC', oldest: 'id ASC', name_asc: 'name COLLATE NOCASE ASC', val_high: 'current_estimated_value DESC',
  val_low: 'current_estimated_value ASC', gain_high: 'gain_loss DESC', gain_low: 'gain_loss ASC', date_desc: 'purchase_date DESC',
};

function getInvestments(sortBy = 'newest', status = 'All', startDate?: string, endDate?: string, search = '') {
  const where: string[] = [];
  const params: any[] = [];
  if (status && status !== 'All') { where.push('status = ?'); params.push(status); }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('purchase_date >= ?'); params.push(s); }
  if (e) { where.push('purchase_date <= ?'); params.push(e); }
  if (search?.trim()) { const q = `%${search.trim()}%`; where.push('(name LIKE ? OR sector LIKE ? OR location_details LIKE ?)'); params.push(q, q, q); }
  return all(`SELECT *, (CASE WHEN status='Sold' THEN COALESCE(sold_amount,0) ELSE current_estimated_value END) - invested_amount AS gain_loss,
                     (SELECT meeting_date FROM investment_reviews r WHERE r.investment_id = investments.id ORDER BY meeting_date DESC, id DESC LIMIT 1) AS last_review_date,
                     (SELECT decision FROM investment_reviews r WHERE r.investment_id = investments.id ORDER BY meeting_date DESC, id DESC LIMIT 1) AS last_review_decision
              FROM investments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
              ORDER BY ${INV_SORT[sortBy] || INV_SORT.newest}`, params);
}

function validateInvestment(d: any) {
  if (!d?.name?.trim()) fail('Investment name is required.');
  if (!d.sector) fail('Please choose a sector.');
  if (!(Number(d.invested_amount) > 0)) fail('Invested amount must be greater than zero.');
  if (d.current_estimated_value !== undefined && d.current_estimated_value !== '' && Number(d.current_estimated_value) < 0) fail('Estimated value cannot be negative.');
}

function addInvestment(d: any) {
  validateInvestment(d);
  const id = tx(() => {
    run(`INSERT INTO investments (name, sector, purchase_date, invested_amount, current_estimated_value, status, review_date, location_details, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [d.name.trim(), d.sector, toISODate(d.purchase_date) || todayISO(), Number(d.invested_amount),
        Number(d.current_estimated_value) || Number(d.invested_amount), d.status || 'Growing',
        toISODate(d.review_date), d.location_details || '', d.notes || '', actor]);
    const nid = lastId();
    audit('create', 'investment', nid, `${d.name} ${d.invested_amount}`);
    return nid;
  });
  mutated();
  return id;
}

function updateInvestment(id: number, d: any) {
  const cur = get('SELECT * FROM investments WHERE id = ?', [id]);
  if (!cur) fail('Investment not found.');
  const f: Record<string, any> = {
    name: d.name?.trim(), sector: d.sector, status: d.status, location_details: d.location_details, notes: d.notes,
    purchase_date: d.purchase_date ? toISODate(d.purchase_date) : undefined,
    review_date: d.review_date !== undefined ? toISODate(d.review_date) : undefined,
    invested_amount: d.invested_amount !== undefined ? Number(d.invested_amount) : undefined,
    current_estimated_value: d.current_estimated_value !== undefined ? Number(d.current_estimated_value) : undefined,
    sold_date: d.sold_date ? toISODate(d.sold_date) : undefined,
    sold_amount: d.sold_amount !== undefined ? Number(d.sold_amount) : undefined,
  };
  if (f.status === 'Sold' && !(f.sold_amount ?? cur.sold_amount)) fail('Enter the sale amount to mark an investment as sold.');
  if (f.status === 'Sold' && !(f.sold_date ?? cur.sold_date)) f.sold_date = todayISO();
  if (f.status && f.status !== 'Sold' && cur.status === 'Sold') { f.sold_amount = null; f.sold_date = null; }
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (!keys.length) return;
  // realised gain/loss feeds member settlements — don't let a sale be rewritten after a member was paid out on it
  const touchesSale = ['status', 'sold_date', 'sold_amount', 'invested_amount'].some(k => f[k] !== undefined && f[k] !== cur[k]);
  if (touchesSale && (cur.status === 'Sold' || f.status === 'Sold')) {
    const when = [cur.sold_date, f.sold_date].filter(Boolean).sort()[0] || todayISO();
    if (get('SELECT 1 FROM member_settlements WHERE settlement_date >= ?', [when]))
      fail('A member was settled on or after this sale date, so the sale cannot be changed. Cancel that settlement first (Admin).');
  }
  tx(() => {
    run(`UPDATE investments SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`, [...keys.map(k => f[k]), id]);
    audit('update', 'investment', id, keys.join(', '));
  });
  mutated();
}

function updateInvestmentValuation(id: number, value: number) {
  if (!(Number(value) >= 0)) fail('Estimated value must be a positive number.');
  updateInvestment(id, { current_estimated_value: Number(value) });
}

// ---------------------------------------------------------------------------
// Committee review of an investment: done after the meeting, from the software
// ---------------------------------------------------------------------------
const REVIEW_DECISIONS = ['Hold', 'Watch', 'Sell', 'Other'];
const getInvestmentReviews = (investmentId: number) =>
  all('SELECT * FROM investment_reviews WHERE investment_id = ? ORDER BY meeting_date DESC, id DESC', [Number(investmentId)]);

/**
 * Records the outcome of a review meeting and, in one step: schedules the next review (or clears it), sets the status that follows from the
 * decision, and — if the committee agreed a new estimated value — updates the value. The history is kept; the investment stops showing as "review due".
 *   Hold  = keep as it is (status Growing)      Watch = keep but look again (status Review)
 *   Sell  = the committee decided to sell (stays flagged until the sale is recorded)      Other = anything else (status unchanged)
 */
function completeInvestmentReview(d: any) {
  const inv = get('SELECT * FROM investments WHERE id = ?', [Number(d?.investment_id)]);
  if (!inv) fail('Investment not found.');
  if (inv.status === 'Sold') fail('This investment has been sold, so there is nothing left to review.');
  const meeting = toISODate(d.meeting_date);
  if (!meeting) fail('Enter the date of the committee meeting.');
  if (meeting > todayISO()) fail('The meeting date cannot be in the future: record the review after the meeting has taken place.');
  if (meeting < String(inv.purchase_date).slice(0, 10)) fail('The meeting date cannot be before the investment was bought.');
  const last = get('SELECT MAX(meeting_date) AS d FROM investment_reviews WHERE investment_id = ?', [inv.id])?.d;
  if (last && meeting < last) fail(`A review on ${last} is already recorded. The new meeting must be on or after that date.`);
  const decision = String(d.decision || '');
  if (!REVIEW_DECISIONS.includes(decision)) fail('Choose what the committee decided.');
  const notes = String(d.notes ?? '').trim();
  if (notes.length > 2000) fail('The notes are too long (2000 characters at most).');
  if (decision !== 'Hold' && notes.length < 3) fail('Write what the committee decided (a short note is enough).');
  const attendees = String(d.attendees ?? '').trim().slice(0, 300);
  const rawValue = d.new_value === undefined || d.new_value === null || d.new_value === '' ? Number(inv.current_estimated_value) : Number(d.new_value);
  if (!Number.isFinite(rawValue) || rawValue < 0) fail('The estimated value must be zero or more.');
  const value = r2(rawValue);
  const next = d.next_review_date ? toISODate(d.next_review_date) : null;
  if (d.next_review_date && !next) fail('The next review date is not a valid date.');
  if (next && next <= meeting) fail('The next review must be after the meeting date.');
  const statusAfter = decision === 'Hold' ? 'Growing' : decision === 'Other' ? inv.status : 'Review';
  const id = tx(() => {
    run(`INSERT INTO investment_reviews (investment_id, meeting_date, decision, notes, value_before, value_after, status_after, next_review_date, attendees, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`, [inv.id, meeting, decision, notes, Number(inv.current_estimated_value), value, statusAfter, next, attendees, actor]);
    const rid = lastId();
    run(`UPDATE investments SET status = ?, review_date = ?, current_estimated_value = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [statusAfter, next, value, inv.id]);
    audit('review', 'investment', inv.id, `${inv.name}: committee review of ${meeting} — ${decision}${value !== Number(inv.current_estimated_value) ? `, value ${inv.current_estimated_value} → ${value}` : ''}${next ? `, next review ${next}` : ''}`);
    return rid;
  });
  mutated();
  return id;
}

function deleteInvestment(id: number) {
  const n = num('SELECT COUNT(*) FROM investment_returns WHERE investment_id = ?', [id]);
  if (n > 0) fail(`This investment has ${n} profit/loss entr${n === 1 ? 'y' : 'ies'}. Remove those entries first so the fund history stays correct.`);
  const inv = get('SELECT status, sold_date FROM investments WHERE id = ?', [id]);
  if (inv?.status === 'Sold' && get('SELECT 1 FROM member_settlements WHERE settlement_date >= ?', [inv.sold_date]))
    fail('This sale was shared with settled members and cannot be deleted.');
  tx(() => { run('DELETE FROM investments WHERE id = ?', [id]); audit('delete', 'investment', id); });
  mutated();
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
const EXP_SORT: Record<string, string> = {
  newest: 'expense_date DESC, id DESC', oldest: 'expense_date ASC, id ASC', amount_high: 'amount DESC',
  amount_low: 'amount ASC', title_asc: 'title COLLATE NOCASE ASC', category: 'category, expense_date DESC',
};

function getExpenses(category = 'All', status = 'All', startDate?: string, endDate?: string, search = '', sortBy = 'newest') {
  const where: string[] = [];
  const params: any[] = [];
  if (category && category !== 'All') { where.push('category = ?'); params.push(category); }
  if (status && status !== 'All') { where.push('status = ?'); params.push(status); }
  const s = toISODate(startDate), e = toISODate(endDate);
  if (s) { where.push('expense_date >= ?'); params.push(s); }
  if (e) { where.push('expense_date <= ?'); params.push(e); }
  if (search?.trim()) { const q = `%${search.trim()}%`; where.push('(title LIKE ? OR payee LIKE ? OR receipt_ref LIKE ? OR notes LIKE ?)'); params.push(q, q, q, q); }
  return all(`SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${EXP_SORT[sortBy] || EXP_SORT.newest}`, params);
}

function addExpense(d: any) {
  if (!d?.title?.trim()) fail('Expense title is required.');
  if (!d.category) fail('Please choose an expense category.');
  if (!(Number(d.amount) > 0)) fail('Amount must be greater than zero.');
  const date = toISODate(d.expense_date) || todayISO();
  if (date > todayISO()) fail('Expense date cannot be in the future.');
  const id = tx(() => {
    run(`INSERT INTO expenses (title, category, amount, expense_date, payee, receipt_ref, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      [d.title.trim(), d.category, Number(d.amount), date, d.payee || '', d.receipt_ref || '',
        d.status || (d.receipt_ref ? 'Verified' : 'Needs receipt'), d.notes || '', actor]);
    const nid = lastId();
    audit('create', 'expense', nid, `${d.title} ${d.amount}`);
    return nid;
  });
  mutated();
  return id;
}

function updateExpense(id: number, d: any) {
  if (!get('SELECT 1 FROM expenses WHERE id = ?', [id])) fail('Expense not found.');
  const f: Record<string, any> = {
    title: d.title?.trim(), category: d.category, payee: d.payee, receipt_ref: d.receipt_ref, status: d.status, notes: d.notes,
    amount: d.amount !== undefined ? Number(d.amount) : undefined, expense_date: d.expense_date ? toISODate(d.expense_date) : undefined,
  };
  if (f.amount !== undefined && !(f.amount > 0)) fail('Amount must be greater than zero.');
  // receipt reference drives verification status unless the caller sets it explicitly
  if (f.status === undefined && d.receipt_ref !== undefined) f.status = String(d.receipt_ref).trim() ? 'Verified' : 'Needs receipt';
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (!keys.length) return;
  tx(() => { run(`UPDATE expenses SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => f[k]), id]); audit('update', 'expense', id, keys.join(', ')); });
  mutated();
}

function verifyExpenseReceipt(id: number, receiptRef: string) {
  if (!receiptRef?.trim()) fail('Receipt / voucher reference is required.');
  updateExpense(id, { status: 'Verified', receipt_ref: receiptRef.trim() });
}

function deleteExpense(id: number) {
  tx(() => { run('DELETE FROM expenses WHERE id = ?', [id]); audit('delete', 'expense', id); });
  mutated();
}

// ---------------------------------------------------------------------------
// Users & master data
// ---------------------------------------------------------------------------
// Never send credential columns to the renderer.
const USER_COLS = `id, username, full_name, full_name_bn, email, role, avatar_initials, status, created_at, phone, designation, address, bio, avatar,
  last_login_at, updated_at, is_system, permissions, (password_hash IS NOT NULL) AS has_password`;
/** The protected iqbal_labs super-user account is visible only to itself. */
const seesSystem = () => !!getSession()?.canUpload;
const getUsers = () => all(`SELECT ${USER_COLS} FROM users ${seesSystem() ? '' : 'WHERE is_system = 0'} ORDER BY id`);

/** Profile page: user + activity statistics from the audit log. */
function getUserProfile(id: number) {
  const user = get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
  if (!user) fail('User not found.');
  if (!seesSystem() && get('SELECT 1 FROM users WHERE id = ? AND is_system = 1', [id])) fail('User not found.');
  const byAction = all(`SELECT action, entity, COUNT(*) AS count FROM audit_log WHERE user_id = ? GROUP BY action, entity ORDER BY count DESC`, [id]);
  const span = get(`SELECT MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*) AS total FROM audit_log WHERE user_id = ?`, [id]) || {};
  const monthly = all(`SELECT substr(at,1,7) AS month, COUNT(*) AS count FROM audit_log WHERE user_id = ? AND at >= ? GROUP BY month ORDER BY month`,
    [id, `${addMonths(currentMonthKey(), -11)}-01`]);
  const paymentsRecorded = num(`SELECT COUNT(*) FROM audit_log WHERE user_id = ? AND action = 'payment'`, [id]);
  const amountCollected = num(`SELECT SUM(c.total_amount) FROM collections c WHERE c.id IN (SELECT entity_id FROM audit_log WHERE user_id = ? AND action = 'payment')`, [id]);
  return {
    user,
    stats: {
      totalActions: Number(span.total) || 0, firstActivity: span.first_at || null, lastActivity: span.last_at || null,
      paymentsRecorded, amountCollected,
      expensesEntered: byAction.filter(a => a.entity === 'expense' && a.action === 'create').reduce((s, a) => s + a.count, 0),
      membersAdded: byAction.filter(a => a.entity === 'member' && (a.action === 'create' || a.action === 'import')).reduce((s, a) => s + a.count, 0),
    },
    byAction,
    monthly,
    recent: all(`SELECT id, at, action, entity, entity_id, details FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50`, [id]),
  };
}

function addUser(u: any) {
  const username = String(u?.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  if (!u.full_name?.trim()) fail('Full name is required.');
  if (get('SELECT 1 FROM users WHERE username = ?', [username])) fail(`Username "${username}" is already taken.`);
  const id = tx(() => {
    checkImage(u.avatar, 'Profile picture');
    run('INSERT INTO users (username, full_name, full_name_bn, email, role, avatar_initials, status, phone, designation, address, bio, avatar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [username, u.full_name.trim(), String(u.full_name_bn || '').trim() || null, u.email?.trim() || '', u.role || 'Manager', u.avatar_initials || initials(u.full_name), u.status || 'Active',
        u.phone || '', u.designation || '', u.address || '', u.bio || '', u.avatar || null]);
    const nid = lastId();
    audit('create', 'user', nid, username);
    if (u.permissions) setUserPermissionsInTx(nid, u.permissions);
    return nid;
  });
  mutated();
  return id;
}

/** Same as setUserPermissions but inside an already open transaction (used when a user is created together with their access). */
function setUserPermissionsInTx(userId: number, perms: Partial<Record<ModuleKey, AccessLevel>>) {
  const clean: Record<string, AccessLevel> = {};
  for (const [k, v] of Object.entries(perms || {})) {
    if (!(MODULES as readonly string[]).includes(k)) fail(`Unknown module "${k}".`);
    if (v !== 'none' && v !== 'view' && v !== 'edit') fail(`Access for ${k} must be none, view or edit.`);
    clean[k] = v as AccessLevel;
  }
  run('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(clean), userId]);
  audit('permissions', 'user', userId, Object.entries(clean).map(([k, v]) => `${k}=${v}`).join(', '));
}

function updateUser(id: number, u: any) {
  const cur = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!cur) fail('User not found.');
  const demotingAdmin = cur.role === 'Admin' && ((u.role && u.role !== 'Admin') || u.status === 'Inactive');
  if (demotingAdmin && num(`SELECT COUNT(*) FROM users WHERE role='Admin' AND status='Active'`) <= 1) fail('At least one active Admin is required.');
  if (u.full_name !== undefined && !String(u.full_name).trim()) fail('Full name is required.');
  if (u.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) fail('Please enter a valid email address.');
  checkImage(u.avatar, 'Profile picture');
  const f: Record<string, any> = { full_name: u.full_name?.trim(), full_name_bn: u.full_name_bn === undefined ? undefined : (String(u.full_name_bn).trim() || null), email: u.email, role: u.role, status: u.status,
    phone: u.phone, designation: u.designation, address: u.address, bio: u.bio,
    avatar: u.avatar === undefined ? undefined : (u.avatar || null),
    avatar_initials: u.full_name ? initials(u.full_name) : undefined };
  if (Object.values(f).some(v => v !== undefined)) f.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (!keys.length) return;
  tx(() => { run(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => f[k]), id]); audit('update', 'user', id, keys.join(', ')); });
  mutated();
}

function deleteUser(id: number) {
  const u = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) return;
  if (u.is_system) fail('The iqbal_labs account is protected and cannot be deleted.');
  if (session && u.id === session.id) fail('You cannot delete the account you are signed in with.');
  if (num('SELECT COUNT(*) FROM users') <= 1) fail('You cannot delete the only user.');
  if (u.role === 'Admin' && num(`SELECT COUNT(*) FROM users WHERE role='Admin' AND status='Active'`) <= 1) fail('You cannot delete the last Admin.');
  tx(() => { run('DELETE FROM users WHERE id = ?', [id]); audit('delete', 'user', id, u.username); });
  mutated();
}

// ---------------------------------------------------------------------------
// Sign-in, session & permissions
// ---------------------------------------------------------------------------
/**
 * Built-in accounts (ensured on every open):
 *  - admin       : role Admin, owner-set initial password (only its scrypt hash is stored here; changeable).
 *                  Everything except data upload.
 *  - iqbal_labs  : protected system account, fixed password (only its scrypt hash is stored here),
 *                  the ONLY account allowed to upload data (Excel / bulk member import).
 */
const SYSTEM_USER = 'iqbal_labs';
const SYSTEM_SALT = '1b67ae44a77d2428a68be9cc886d8780';
const SYSTEM_HASH = 'e18f832c1169fc1b872765ebfd326224e7e9ac637ea143e0e8b26bcb1650b331a9edf6f1cb9cd3b03fefaa5711d88b098969a050254d52b336ec88a826410b29';
const ADMIN_SALT = '515617069c45cc20cfa6b6dc74dd1888';
const ADMIN_HASH = 'b46ed0057df930290b0dc5bc2388a66b0df83fa35bba4e13abef526d5a9fae27120ef525b157f6680aa64718f9108d5dd40fc675dd0ebdcbb2e2248c101b9977';
const SCRYPT = { N: 16384, r: 8, p: 1 };

interface Session { id: number; username: string; role: string; isSystem: boolean }
let session: Session | null = null;

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64, SCRYPT).toString('hex') };
}
function verifyPassword(password: string, salt: string, hash: string) {
  const a = Buffer.from(crypto.scryptSync(password, salt, 64, SCRYPT).toString('hex'), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Schema v3: is_system flag + the two built-in accounts. Idempotent. */
function ensureAccounts() {
  addColumn('users', 'is_system', 'INTEGER NOT NULL DEFAULT 0');
  const admin = get(`SELECT id, password_hash, password_salt, must_change_password FROM users WHERE username = 'admin'`);
  if (!admin) {
    run(`INSERT INTO users (username, full_name, email, role, avatar_initials, status, password_hash, password_salt, must_change_password)
         VALUES ('admin','Administrator','','Admin','AD','Active',?,?,0)`, [ADMIN_HASH, ADMIN_SALT]);
  } else if (!admin.password_hash) {
    run(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, status = 'Active', role = 'Admin' WHERE id = ?`, [ADMIN_HASH, ADMIN_SALT, admin.id]);
  } else if (admin.must_change_password && verifyPassword('admin', admin.password_salt, admin.password_hash)) {
    // Databases created by earlier versions still carry the old public default password: replace it.
    run(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?`, [ADMIN_HASH, ADMIN_SALT, admin.id]);
  }
  const sys = get('SELECT id FROM users WHERE username = ?', [SYSTEM_USER]);
  if (!sys) {
    run(`INSERT INTO users (username, full_name, email, role, avatar_initials, status, password_hash, password_salt, is_system, designation)
         VALUES (?, 'Iqbal Labs', '', 'Admin', 'IL', 'Active', ?, ?, 1, 'System owner')`, [SYSTEM_USER, SYSTEM_HASH, SYSTEM_SALT]);
  } else {
    // fixed account: credentials, role and status are always restored
    run(`UPDATE users SET password_hash = ?, password_salt = ?, is_system = 1, role = 'Admin', status = 'Active', must_change_password = 0 WHERE id = ?`,
      [SYSTEM_HASH, SYSTEM_SALT, sys.id]);
  }
}

function login(username: string, password: string) {
  const u = get(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`, [String(username || '').trim()]);
  const bad = () => fail('Incorrect username or password.');
  if (!u) bad();
  if (u.status !== 'Active') fail('This account is inactive. Ask an administrator to activate it.');
  if (!u.password_hash) fail('No password has been set for this account yet. Ask an administrator to set one.');
  const lockedUntil = u.failed_logins >= 5 && u.last_login_at ? Date.parse(u.last_login_at.replace(' ', 'T')) + 5 * 60_000 : 0;
  if (lockedUntil > Date.now()) fail('Too many wrong attempts. Please wait 5 minutes and try again.');
  if (!verifyPassword(String(password || ''), u.password_salt, u.password_hash)) {
    run(`UPDATE users SET failed_logins = failed_logins + 1, last_login_at = CASE WHEN failed_logins + 1 >= 5 THEN datetime('now','localtime') ELSE last_login_at END WHERE id = ?`, [u.id]);
    mutated(true);
    bad();
  }
  if (!u.is_system && accessGate) { const locked = accessGate(u.username); if (locked) fail(locked); }   // only after the password is right, so licences of other people cannot be probed
  run(`UPDATE users SET failed_logins = 0, last_login_at = datetime('now','localtime') WHERE id = ?`, [u.id]);
  session = { id: u.id, username: u.username, role: u.role, isSystem: !!u.is_system };
  setActor(`${u.full_name} (${u.role})`, u.id);
  audit('login', 'user', u.id, u.username);
  mutated(true);
  return getSession();
}

/** Re-check the protected iqbal_labs password (used before creating its recovery key). */
export function verifySystemPassword(password: string): boolean {
  const u = get('SELECT password_salt, password_hash FROM users WHERE is_system = 1');
  return !!u && !!u.password_hash && verifyPassword(String(password || ''), u.password_salt, u.password_hash);
}
/** Public half of the Super User's backup-recovery key (base64) — safe to keep in the database. */
export function getMasterRecoveryPub(): string | null {
  return get(`SELECT value FROM app_settings WHERE key = 'master_recovery_pub'`)?.value || null;
}
export function setMasterRecoveryPub(b64: string) {
  run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('master_recovery_pub', ?)`, [b64]);
  audit('update', 'settings', null, 'backup master recovery key set');
  mutated();
}

function logout() {
  if (session) { audit('logout', 'user', session.id, session.username); mutated(true); }
  session = null;
  setActor('System', null);
}

function getSession() {
  if (!session) return null;
  if (!session.isSystem && accessGate && accessGate(session.username)) { session = null; setActor('System', null); return null; }   // locked by the licence
  const u = get(`SELECT ${USER_COLS}, must_change_password, is_system FROM users WHERE id = ?`, [session.id]);
  if (!u || u.status !== 'Active') { session = null; return null; }      // e.g. after a restore
  session.role = u.role;
  return { user: u, canUpload: !!u.is_system, isAdmin: u.role === 'Admin', mustChangePassword: !!u.must_change_password && !u.is_system, permissions: effectivePermissions(u) };
}

/** After a restore the database is different: drop the session if that user no longer exists. */
export function revalidateSession() { getSession(); }

function changeOwnPassword(current: string, next: string) {
  if (!session) fail('Please sign in first.');
  if (session.isSystem) fail('The iqbal_labs account password is fixed and cannot be changed.');
  const u = get('SELECT * FROM users WHERE id = ?', [session.id]);
  if (!verifyPassword(String(current || ''), u.password_salt, u.password_hash)) fail('Current password is incorrect.');
  validateNewPassword(next, u.username);
  const h = hashPassword(next);
  tx(() => {
    run(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = datetime('now','localtime') WHERE id = ?`, [h.hash, h.salt, u.id]);
    audit('password', 'user', u.id, 'changed own password');
  });
  mutated();
}

function setUserPassword(userId: number, next: string) {
  const u = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u) fail('User not found.');
  if (u.is_system) fail('The iqbal_labs account password is fixed and cannot be changed.');
  validateNewPassword(next, u.username);
  const h = hashPassword(next);
  tx(() => {
    run(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1, failed_logins = 0, updated_at = datetime('now','localtime') WHERE id = ?`, [h.hash, h.salt, userId]);
    audit('password', 'user', userId, `password set by ${session?.username}`);
  });
  mutated();
}

function validateNewPassword(p: string, username: string) {
  const s = String(p || '');
  if (s.length < 6) fail('Password must be at least 6 characters.');
  if (s.toLowerCase() === String(username).toLowerCase() || s === 'admin') fail('Choose a password that is different from the username and from "admin".');
}

// Permission model -----------------------------------------------------------------------
// Access is granted per MODULE and per LEVEL (none / view / edit). A user's level for a module is, in this order:
//   iqbal_labs (the Super User) = edit everywhere, always;  else the Super User's custom grant for that user;  else the default of the user's role.
// Role rules that are not about a module stay as they were (Auditors never edit; write-offs, settlement cancellation and database reset need the Admin role).
export const MODULES = ['overview', 'collections', 'members', 'expenses', 'entry', 'investments', 'returns', 'loans', 'reports', 'master', 'users', 'backup', 'settings', 'google_sync', 'drive_backup'] as const;
export type ModuleKey = typeof MODULES[number];
export type AccessLevel = 'none' | 'view' | 'edit';
const LV: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };
export const MODULE_LABEL: Record<ModuleKey, string> = {
  overview: 'Overview', collections: 'Collections', members: 'Members', expenses: 'Operating Expenses', entry: 'Entry Center', investments: 'Investments', returns: 'Investment Returns',
  loans: 'Personal Loans', reports: 'Reports & Export', master: 'Master Data', users: 'Users & Roles', backup: 'Backup & Restore (this computer)', settings: 'Settings',
  google_sync: 'Google account sync', drive_backup: 'Google Drive backup',
};
const allAt = (l: AccessLevel) => Object.fromEntries(MODULES.map(m => [m, l])) as Record<ModuleKey, AccessLevel>;
const OPERATOR: Record<ModuleKey, AccessLevel> = { ...allAt('none'), overview: 'edit', collections: 'edit', members: 'edit', expenses: 'edit', entry: 'edit', investments: 'edit', returns: 'edit', loans: 'edit', reports: 'edit', backup: 'edit' };
const ROLE_DEFAULTS: Record<string, Record<ModuleKey, AccessLevel>> = {
  Admin: allAt('edit'),
  Treasurer: OPERATOR,
  Manager: OPERATOR,
  Auditor: { ...allAt('none'), overview: 'view', collections: 'view', members: 'view', expenses: 'view', investments: 'view', returns: 'view', loans: 'view', reports: 'view', backup: 'view' },
};
export const defaultPermissions = (role: string): Record<ModuleKey, AccessLevel> => ({ ...(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.Manager) });

function parsePermissions(raw: unknown): Partial<Record<ModuleKey, AccessLevel>> | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(String(raw));
    const out: Partial<Record<ModuleKey, AccessLevel>> = {};
    for (const m of MODULES) if (o && (o[m] === 'none' || o[m] === 'view' || o[m] === 'edit')) out[m] = o[m];
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/** What one user may do in every module. */
export function effectivePermissions(u: Row): Record<ModuleKey, AccessLevel> {
  if (u.is_system) return allAt('edit');
  const base = defaultPermissions(String(u.role));
  const custom = parsePermissions(u.permissions);
  if (custom) for (const m of MODULES) if (custom[m]) base[m] = custom[m]!;
  if (u.role === 'Auditor') for (const m of MODULES) if (base[m] === 'edit') base[m] = 'view';     // an Auditor never edits
  return base;
}

/** Which module(s) a database operation belongs to (any one of them is enough). Reads need "view", everything else "edit". */
const NEEDS: Record<string, ModuleKey[]> = {
  getMembers: ['members'], getMemberHistory: ['members'], getMemberStatement: ['members'], addMember: ['members'], updateMember: ['members'], deleteMember: ['members'],
  bulkAddMembers: ['members'], getNextMemberCode: ['members', 'entry'], previewMemberSettlement: ['members'], settleMember: ['members'], getMemberSettlements: ['members'], cancelSettlement: ['members'],
  getCollections: ['collections'], getFineRegister: ['collections'], getFundBooks: ['collections'], recordPayment: ['collections', 'entry'], deletePayment: ['collections'], suggestLateFee: ['collections', 'entry'],
  getInvestments: ['investments', 'returns', 'entry'], addInvestment: ['investments', 'entry'], updateInvestment: ['investments'], updateInvestmentValuation: ['investments'], getInvestmentReviews: ['investments'], completeInvestmentReview: ['investments'], deleteInvestment: ['investments'],
  getInvestmentReturns: ['returns'], getReturnsSummary: ['returns'], addInvestmentReturn: ['returns', 'entry'], deleteInvestmentReturn: ['returns'],
  getExpenses: ['expenses'], addExpense: ['expenses', 'entry'], updateExpense: ['expenses'], verifyExpenseReceipt: ['expenses'], deleteExpense: ['expenses'],
  getLoans: ['loans'], getLoan: ['loans'], getLoanSummary: ['loans'], previewLoan: ['loans'], previewGuarantor: ['loans'], addLoan: ['loans'], updateLoan: ['loans'], deleteLoan: ['loans'],
  previewLoanRepayment: ['loans'], recordLoanRepayment: ['loans'], deleteLoanRepayment: ['loans'], writeOffLoan: ['loans'], cancelLoanWriteOff: ['loans'],
  getLoanApplications: ['loans'], getLoanApplication: ['loans'], createLoanApplication: ['loans'], updateLoanApplication: ['loans'], deleteLoanApplication: ['loans'], activateLoanApplication: ['loans'],
  getOverviewMetrics: ['overview'], getOverviewData: ['overview'], getTransactions: ['reports'],
  getAuditLog: ['users', 'settings'], getBackupLogs: ['backup', 'settings'], getDatabaseStats: ['backup', 'settings'],
  addUser: ['users'], deleteUser: ['users'], setUserPassword: ['users'], getUserPermissions: ['users'],
  addMasterItem: ['master'], updateMasterItem: ['master'], deleteMasterItem: ['master'],
  saveAppSettings: ['settings'], resetDatabase: ['settings', 'backup'],
};
/** Operations every signed-in user needs just to use the app (forms, dropdowns, own profile). */
const SHARED = new Set(['getRoleDefaults', 'logout', 'changeOwnPassword', 'setActor', 'getAllMembersLite', 'getMasterData', 'getUsers', 'getUserProfile', 'getDynamicNotifications', 'updateUser']);
/** Read-only data a person with the "Reports" module may also read (reports are built from every part of the books). */
const REPORT_READS = new Set(['getMembers', 'getMemberHistory', 'getMemberStatement', 'getMemberSettlements', 'getCollections', 'getExpenses', 'getInvestments', 'getInvestmentReturns', 'getReturnsSummary',
  'getOverviewMetrics', 'getOverviewData', 'getLoans', 'getLoan', 'getLoanSummary', 'getLoanApplications']);

const PUBLIC = new Set(['login', 'getSession', 'getAppSettings']);
const UPLOAD = new Set(['bulkAddMembers']);                          // + Excel import IPC (main.ts)
const ADMIN = new Set(['cancelSettlement', 'writeOffLoan', 'cancelLoanWriteOff', 'resetDatabase', 'loadDemoData']);   // critical actions: Admin role AND the module
const READ = /^(get|suggest|preview|export)/;
const SYSTEM_ONLY = new Set(['loadDemoData', 'checkAccountingHealth', 'deleteMember', 'setUserPermissions']);   // iqbal_labs only

const levelOf = (s: { permissions: Record<ModuleKey, AccessLevel> }, m: ModuleKey) => LV[s.permissions[m] || 'none'];
const labelsOf = (ms: ModuleKey[]) => ms.map(m => MODULE_LABEL[m]).join(' / ');

/** Throws unless the signed-in user has at least `level` in one of `modules`. Used by the main process for file, backup and Google operations. */
export function requireModule(modules: ModuleKey | ModuleKey[], level: 'view' | 'edit' = 'view') {
  const s = getSession();
  if (!s) fail('Please sign in.');
  const ms = Array.isArray(modules) ? modules : [modules];
  if (!ms.some(m => levelOf(s, m) >= LV[level])) fail(`You do not have ${level === 'edit' ? 'edit' : 'view'} access to ${labelsOf(ms)}. Ask the Super User to grant it.`);
  if (level === 'edit' && s.user.role === 'Auditor') fail('Auditors have read-only access.');
}
export function can(modules: ModuleKey | ModuleKey[], level: 'view' | 'edit' = 'view') {
  try { requireModule(modules, level); return true; } catch { return false; }
}

/** Throws unless the signed-in user may call `method` with `args`. Called by main.ts for every IPC call. */
export function authorize(method: string, args: any[] = []) {
  if (PUBLIC.has(method)) return;
  const s = getSession();
  if (!s) fail('Your session has ended. Please sign in again.');
  if (SYSTEM_ONLY.has(method) && !s.canUpload) fail('This is available only to the iqbal_labs account.');
  if (UPLOAD.has(method) && !s.canUpload) fail('Data upload is only available to the iqbal_labs account.');
  if (ADMIN.has(method) && !s.isAdmin) fail('Only an Admin can do this.');
  const write = !READ.test(method);
  if (s.user.role === 'Auditor' && write && !['logout', 'changeOwnPassword', 'updateUser', 'setActor'].includes(method)) fail('Auditors have read-only access.');
  const canManageUsers = levelOf(s, 'users') >= LV.edit;

  if (method === 'saveAppSettings') {
    const keys = Object.keys(args[0] || {});
    if (keys.length && keys.every(k => k.startsWith('loan_'))) {         // the loan policy
      if (!s.isAdmin) fail('Only an Admin can do this.');
      if (levelOf(s, 'loans') < LV.edit) fail(`You do not have edit access to ${MODULE_LABEL.loans}.`);
    } else if (levelOf(s, 'settings') < LV.edit) fail(`You do not have edit access to ${MODULE_LABEL.settings}. Ask the Super User to grant it.`);
  } else if (method === 'updateUser') {
    const targetId = Number(args[0]);
    const patch = args[1] || {};
    const target = get('SELECT is_system FROM users WHERE id = ?', [targetId]);
    if (target?.is_system && targetId !== s.user.id) fail('The iqbal_labs account is protected.');
    const privileged = ['role', 'status'].some(k => patch[k] !== undefined);
    if (targetId !== s.user.id && !canManageUsers) fail('You can only edit your own profile.');
    if (privileged && (targetId === s.user.id || !canManageUsers)) fail(targetId === s.user.id ? 'You cannot change your own role or status.' : 'You do not have access to change roles.');
  } else if (method === 'getUserPermissions') {
    if (Number(args[0]) !== s.user.id && levelOf(s, 'users') < LV.view) fail(`You do not have view access to ${MODULE_LABEL.users}.`);
  } else if (method === 'addUser') {
    if (!canManageUsers) fail(`You do not have edit access to ${MODULE_LABEL.users}. Ask the Super User to grant it.`);
    if (args[0]?.permissions && !s.canUpload) fail('Only the iqbal_labs Super User can set a user\'s module access.');
  } else if (!SHARED.has(method)) {
    const needs = NEEDS[method];
    if (needs) {
      const req = write ? LV.edit : LV.view;
      let ok = needs.some(m => levelOf(s, m) >= req);
      if (!ok && !write && REPORT_READS.has(method) && levelOf(s, 'reports') >= LV.view) ok = true;
      if (!ok) fail(`You do not have ${write ? 'edit' : 'view'} access to ${labelsOf(needs)}. Ask the Super User to grant it.`);
    }
  }
}
/** Every operation the renderer may call is either mapped to a module or deliberately shared (the tests check this list stays complete). */
export const accessCoverage = (method: string) => PUBLIC.has(method) || SHARED.has(method) || method in NEEDS || SYSTEM_ONLY.has(method) || method === 'getUserPermissions' || method === 'checkAccountingHealth' || method === 'loadDemoData';

export function requireUpload() { const s = getSession(); if (!s?.canUpload) fail('Data upload is only available to the iqbal_labs account.'); }
export function requireAdmin() { const s = getSession(); if (!s) fail('Please sign in.'); if (!s.isAdmin) fail('Only an Admin can do this.'); }
export function requireSession() { if (!getSession()) fail('Please sign in.'); }

/** The default access of every role (the permission editor starts from these). */
function getRoleDefaults() { return Object.fromEntries(Object.keys(ROLE_DEFAULTS).map(r => [r, defaultPermissions(r)])); }

/** One user's access: the role default, the Super User's custom grant (if any), and the result. */
function getUserPermissions(userId: number) {
  const u = get(`SELECT id, role, is_system, permissions FROM users WHERE id = ?`, [Number(userId)]);
  if (!u || (u.is_system && !seesSystem())) fail('User not found.');
  return { userId: u.id, role: u.role, isSystem: !!u.is_system, defaults: defaultPermissions(String(u.role)), custom: parsePermissions(u.permissions), effective: effectivePermissions(u) };
}

/** Super User only: choose which modules a user can open, and whether they can change anything there. null = back to the role default. */
function setUserPermissions(userId: number, perms: Partial<Record<ModuleKey, AccessLevel>> | null) {
  const u = get('SELECT id, username, role, is_system FROM users WHERE id = ?', [Number(userId)]);
  if (!u) fail('User not found.');
  if (u.is_system) fail('The iqbal_labs account always has full access.');
  let json: string | null = null;
  if (perms) {
    const clean: Record<string, AccessLevel> = {};
    for (const [k, v] of Object.entries(perms)) {
      if (!(MODULES as readonly string[]).includes(k)) fail(`Unknown module "${k}".`);
      if (v !== 'none' && v !== 'view' && v !== 'edit') fail(`Access for ${k} must be none, view or edit.`);
      clean[k] = v as AccessLevel;
    }
    json = JSON.stringify(clean);
  }
  tx(() => {
    run('UPDATE users SET permissions = ?, updated_at = ? WHERE id = ?', [json, new Date().toISOString().slice(0, 19).replace('T', ' '), u.id]);
    audit('permissions', 'user', u.id, `${u.username}: ${json ? Object.entries(JSON.parse(json)).map(([k, v]) => `${k}=${v}`).join(', ') : 'back to the default of the ' + u.role + ' role'}`);
  });
  mutated();
}


function getMasterData(type?: string, activeOnly = false) {
  const where: string[] = [];
  const params: any[] = [];
  if (type) { where.push('type = ?'); params.push(type); }
  if (activeOnly) where.push('is_active = 1');
  return all(`SELECT * FROM master_data ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY type, name COLLATE NOCASE`, params);
}

function addMasterItem(d: any) {
  if (!d?.name?.trim()) fail('Name is required.');
  if (!['expense_category', 'investment_sector', 'payment_method'].includes(d.type)) fail('Unknown master data type.');
  if (get('SELECT 1 FROM master_data WHERE type = ? AND name = ? COLLATE NOCASE', [d.type, d.name.trim()])) fail(`"${d.name.trim()}" already exists.`);
  const id = tx(() => {
    run('INSERT INTO master_data (type, name, name_bn, description, is_active) VALUES (?,?,?,?,?)', [d.type, d.name.trim(), d.name_bn?.trim() || null, d.description || '', d.is_active ?? 1]);
    const nid = lastId();
    audit('create', 'master_data', nid, `${d.type}: ${d.name}`);
    return nid;
  });
  mutated();
  return id;
}

function updateMasterItem(id: number, d: any) {
  const cur = get('SELECT * FROM master_data WHERE id = ?', [id]);
  if (!cur) fail('Item not found.');
  const name = d.name?.trim();
  tx(() => {
    run('UPDATE master_data SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active) WHERE id = ?',
      [name || null, d.description ?? null, d.is_active ?? null, id]);
    if (d.name_bn !== undefined) run('UPDATE master_data SET name_bn = ? WHERE id = ?', [String(d.name_bn).trim() || null, id]);
    if (name && name !== cur.name) {
      // keep existing records consistent with the renamed category
      if (cur.type === 'expense_category') run('UPDATE expenses SET category = ? WHERE category = ?', [name, cur.name]);
      if (cur.type === 'investment_sector') run('UPDATE investments SET sector = ? WHERE sector = ?', [name, cur.name]);
      if (cur.type === 'payment_method') run('UPDATE collections SET payment_method = ? WHERE payment_method = ?', [name, cur.name]);
    }
    audit('update', 'master_data', id, name || '');
  });
  mutated();
}

function deleteMasterItem(id: number) {
  const cur = get('SELECT * FROM master_data WHERE id = ?', [id]);
  if (!cur) return;
  const inUse =
    cur.type === 'expense_category' ? num('SELECT COUNT(*) FROM expenses WHERE category = ?', [cur.name]) :
    cur.type === 'investment_sector' ? num('SELECT COUNT(*) FROM investments WHERE sector = ?', [cur.name]) :
    num('SELECT COUNT(*) FROM collections WHERE payment_method = ?', [cur.name]);
  if (inUse > 0) fail(`"${cur.name}" is used by ${inUse} record(s). Deactivate it instead of deleting.`);
  tx(() => { run('DELETE FROM master_data WHERE id = ?', [id]); audit('delete', 'master_data', id, cur.name); });
  mutated();
}

// ---------------------------------------------------------------------------
// Overview / analytics
// ---------------------------------------------------------------------------
function getOverviewMetrics(month?: string) {
  const mk = monthArg(month);
  const ms = monthSummary(mk);
  const pos = fundPosition(monthEnd(mk) < todayISO() ? monthEnd(mk) : todayISO());
  const prev = fundPosition(monthEnd(addMonths(mk, -1)));
  const inv = get(`SELECT SUM(invested_amount) inv, SUM(current_estimated_value) val FROM investments WHERE status != 'Sold'`) || {};
  const invested = Number(inv.inv) || 0, value = Number(inv.val) || 0;
  return {
    total_fund_balance: pos.fundBalance + (value - invested),
    fund_growth_pct: prev.fundBalance > 0 ? +(((pos.fundBalance - prev.fundBalance) / prev.fundBalance) * 100).toFixed(1) : 0,
    month_collected: ms.collected, month_target: ms.expected, collection_rate: ms.rate,
    active_members: num(`SELECT COUNT(*) FROM members WHERE status='Active'`),
    overdue_members_count: ms.overdue, paid_count: ms.paid, pending_count: ms.pending, overdue_count: ms.overdue,
    invested_assets: invested,
    invested_pct_of_fund: pos.fundBalance > 0 ? +((invested / pos.fundBalance) * 100).toFixed(1) : 0,
    current_portfolio_value: value, unrealized_gain: value - invested,
    cash_in_hand: pos.cashInHand, fund_balance_at_cost: pos.fundBalance,
  };
}

function getOverviewData(month?: string) {
  const mk = monthArg(month);
  const today = todayISO();
  const asOf = monthEnd(mk) < today ? monthEnd(mk) : today;
  const ms = monthSummary(mk);
  const prevMs = monthSummary(addMonths(mk, -1));
  const pos = fundPosition(asOf);
  const prevPos = fundPosition(monthEnd(addMonths(mk, -1)));
  const inv = get(`SELECT SUM(invested_amount) inv, SUM(current_estimated_value) val, COUNT(*) n FROM investments WHERE status != 'Sold'`) || {};
  const invested = Number(inv.inv) || 0, value = Number(inv.val) || 0;
  const monthExpenses = num('SELECT SUM(amount) FROM expenses WHERE substr(expense_date,1,7) = ?', [mk]);
  const prevMonthExpenses = num('SELECT SUM(amount) FROM expenses WHERE substr(expense_date,1,7) = ?', [addMonths(mk, -1)]);
  // late fees by the month the payment is for (month, previous month, year-to-date, all time)
  const lateQ = (where: string, params: any[]) => get(`SELECT COALESCE(SUM(late_fee),0) AS v, COUNT(*) AS n FROM collections WHERE late_fee > 0 AND ${where}`, params) || {};
  const lfMonth = lateQ('payment_month = ?', [mk]);
  const lfPrev = lateQ('payment_month = ?', [addMonths(mk, -1)]);
  const lfYear = lateQ('payment_month >= ? AND payment_month <= ?', [`${mk.slice(0, 4)}-01`, mk]);
  const lfAll = lateQ('1 = 1', []);

  // 12-month trend
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const k = addMonths(mk, -i);
    const s = monthSummary(k);
    const p = fundPosition(monthEnd(k));
    trend.push({
      month: k, expected: s.expected, collected: s.collected, lateFees: s.lateFees, rate: s.rate,
      expenses: num('SELECT SUM(amount) FROM expenses WHERE substr(expense_date,1,7) = ?', [k]),
      invested: num('SELECT SUM(invested_amount) FROM investments WHERE substr(purchase_date,1,7) = ?', [k]),
      returnProfit: num(`SELECT SUM(amount) FROM investment_returns WHERE entry_type = 'Profit' AND substr(entry_date,1,7) = ?`, [k]),
      returnLoss: num(`SELECT SUM(amount) FROM investment_returns WHERE entry_type = 'Loss' AND substr(entry_date,1,7) = ?`, [k]),
      fundBalance: p.fundBalance, cashInHand: p.cashInHand,
    });
  }
  const from12 = `${addMonths(mk, -11)}-01`;
  // investment benefit / loss entries: selected month, year to date, all time
  const retSum = (where: string, params: any[]) => get(`SELECT COALESCE(SUM(CASE entry_type WHEN 'Profit' THEN amount END),0) p, COALESCE(SUM(CASE entry_type WHEN 'Loss' THEN amount END),0) l, COUNT(*) n FROM investment_returns WHERE ${where}`, params) || {};
  const rMonth = retSum('substr(entry_date,1,7) = ?', [mk]);
  const rYear = retSum('substr(entry_date,1,4) = ? AND entry_date <= ?', [mk.slice(0, 4), asOf]);
  const rAll = retSum('entry_date <= ?', [asOf]);

  // arrears: unpaid past-due months per active member (since joining)
  const dd = dueDay();
  const paidMonths = new Map<number, Set<string>>();
  for (const r of all('SELECT member_id, payment_month FROM collections')) {
    if (!paidMonths.has(r.member_id)) paidMonths.set(r.member_id, new Set());
    paidMonths.get(r.member_id)!.add(r.payment_month);
  }
  const arrears = all(`SELECT id, member_code, name, name_bn, phone, monthly_due, join_date, avatar_initials FROM members WHERE status='Active'`)
    .map(m => {
      let months = 0;
      for (let k = String(m.join_date).slice(0, 7); k <= mk; k = addMonths(k, 1)) {
        if (dueDateOf(k, dd) < today && !paidMonths.get(m.id)?.has(k)) months++;
      }
      return { ...m, months, amount: months * (m.monthly_due || 0) };
    })
    .filter(m => m.months > 0)
    .sort((a, b) => b.amount - a.amount);

  const recent = all(`
    SELECT * FROM (
      SELECT 'collection' AS kind, c.id, m.name || ' paid ' || c.payment_month AS title, c.payment_method AS sub, c.total_amount AS amount, c.payment_date AS date, c.created_at FROM collections c JOIN members m ON m.id=c.member_id
      UNION ALL SELECT 'expense', id, title, category, -amount, expense_date, created_at FROM expenses
      UNION ALL SELECT 'investment', id, name, sector, -invested_amount, purchase_date, created_at FROM investments
      UNION ALL SELECT 'return', r.id, i.name || CASE r.entry_type WHEN 'Profit' THEN ' benefit received' ELSE ' loss booked' END, i.sector,
                CASE r.entry_type WHEN 'Profit' THEN r.amount ELSE -r.amount END, r.entry_date, r.created_at FROM investment_returns r JOIN investments i ON i.id = r.investment_id
      UNION ALL SELECT 'settlement', s.id, m.name || ' settled', s.payment_method, -s.total_paid, s.settlement_date, s.created_at FROM member_settlements s JOIN members m ON m.id = s.member_id
      UNION ALL SELECT 'loan', l.id, m.name || ' took loan ' || l.loan_no, l.payment_method, -l.principal, l.disbursed_date, l.created_at FROM personal_loans l JOIN members m ON m.id = l.member_id
      UNION ALL SELECT 'repayment', r.id, m.name || ' repaid ' || l.loan_no, r.payment_method, r.total_paid, r.paid_date, r.created_at
                FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id JOIN members m ON m.id = l.member_id
      UNION ALL SELECT 'member', id, name || ' joined', member_code, 0, join_date, created_at FROM members
    ) ORDER BY date DESC, created_at DESC LIMIT 10`);

  const in30 = todayISO(new Date(Date.now() + 30 * 864e5));
  return {
    month: mk,
    today,
    kpis: {
      netWorth: pos.fundBalance + (value - invested),
      prevNetWorth: prevPos.fundBalance + (value - invested),
      fundBalance: pos.fundBalance, prevFundBalance: prevPos.fundBalance,
      cashInHand: pos.cashInHand, prevCashInHand: prevPos.cashInHand,
      loansOutstanding: pos.loansOutstanding, loanIncome: pos.loanIncome,
      lifetimeCollected: pos.opening + pos.collected, totalExpenses: pos.expenses, realizedGain: pos.realized,
      monthCollected: ms.collected, prevMonthCollected: prevMs.collected, monthReceived: ms.received,
      monthExpected: ms.expected, collectionRate: ms.rate, prevCollectionRate: prevMs.rate,
      monthLateFees: Number(lfMonth.v) || 0, monthLateCount: Number(lfMonth.n) || 0, prevMonthLateFees: Number(lfPrev.v) || 0,
      yearLateFees: Number(lfYear.v) || 0, yearLateCount: Number(lfYear.n) || 0, lifetimeLateFees: Number(lfAll.v) || 0,
      monthExpenses, prevMonthExpenses, outstanding: ms.outstanding,
      monthReturnProfit: Number(rMonth.p) || 0, monthReturnLoss: Number(rMonth.l) || 0, monthReturnCount: Number(rMonth.n) || 0,
      yearReturnProfit: Number(rYear.p) || 0, yearReturnLoss: Number(rYear.l) || 0,
      lifetimeReturnProfit: Number(rAll.p) || 0, lifetimeReturnLoss: Number(rAll.l) || 0, lifetimeReturnCount: Number(rAll.n) || 0,
      paid: ms.paid, pending: ms.pending, overdue: ms.overdue, dueMembers: ms.total,
      activeMembers: num(`SELECT COUNT(*) FROM members WHERE status='Active'`),
      totalMembers: num('SELECT COUNT(*) FROM members'),
      newMembersThisMonth: num(`SELECT COUNT(*) FROM members WHERE substr(join_date,1,7) = ?`, [mk]),
      invested, portfolioValue: value, unrealizedGain: value - invested, investmentCount: Number(inv.n) || 0,
      totalArrears: arrears.reduce((a, m) => a + m.amount, 0), membersInArrears: arrears.length,
    },
    trend,
    expenseByCategory: all(`SELECT category AS name, SUM(amount) AS value, COUNT(*) AS count FROM expenses
                            WHERE expense_date >= ? AND expense_date <= ? GROUP BY category ORDER BY value DESC`, [from12, asOf]),
    portfolio: all(`SELECT sector AS name, SUM(invested_amount) AS invested, SUM(current_estimated_value) AS value, COUNT(*) AS count
                    FROM investments WHERE status != 'Sold' GROUP BY sector ORDER BY value DESC`),
    investments: all(`SELECT id, name, sector, invested_amount, current_estimated_value, status, review_date FROM investments WHERE status != 'Sold' ORDER BY current_estimated_value DESC`),
    paymentMethods: all(`SELECT payment_method AS name, COUNT(*) AS count, SUM(total_amount) AS value FROM collections
                         WHERE payment_date >= ? AND payment_date <= ? GROUP BY payment_method ORDER BY value DESC`, [from12, asOf]),
    topContributors: all(`SELECT m.id, m.name, m.name_bn, m.member_code, m.avatar_initials, m.opening_balance + COALESCE(SUM(c.contribution_amount),0) AS total
                          FROM members m LEFT JOIN collections c ON c.member_id = m.id GROUP BY m.id ORDER BY total DESC LIMIT 8`),
    dailyCollections: all(`SELECT payment_date AS date, SUM(total_amount) AS value, COUNT(*) AS count FROM collections
                           WHERE payment_date >= ? GROUP BY payment_date`, [`${addMonths(mk, -5)}-01`]),
    arrears, // full list (Defaulters report); the dashboard shows the top rows
    attention: {
      overdue: ms.overdue,
      reviews: all(`SELECT id, name, review_date FROM investments WHERE status != 'Sold' AND (status='Review' OR (review_date IS NOT NULL AND review_date <= ?)) ORDER BY review_date`, [in30]),
      receipts: all(`SELECT id, title, amount, expense_date FROM expenses WHERE status = 'Needs receipt' ORDER BY expense_date DESC LIMIT 5`),
      receiptCount: num(`SELECT COUNT(*) FROM expenses WHERE status = 'Needs receipt'`),
      ...(() => { const late = enrichLoans().filter(l => l.derived_status === 'Overdue'); return { loansOverdue: late.length, loansOverdueAmount: r2(late.reduce((a, l) => a + l.overdue_amount, 0)) }; })(),
      lastBackup: settingsMap().last_backup_date,
    },
    recent,
  };
}

/** Unified ledger for reports: every money movement in a date range. */
function getTransactions(startDate?: string, endDate?: string, type = 'All') {
  const s = toISODate(startDate) || '0000-01-01', e = toISODate(endDate) || '9999-12-31';
  // the first SELECT of a UNION names the columns; this empty one guarantees the names whichever single type is asked for
  const parts: string[] = [`SELECT '' AS type, '' AS date, '' AS party, '' AS description, '' AS method, '' AS reference, 0 AS credit, 0 AS debit WHERE 0`];
  const params: any[] = [];
  if (type === 'All' || type === 'collection') {
    parts.push(`SELECT 'collection' AS type, c.payment_date AS date, m.member_code || ' ' || m.name AS party, 'Contribution ' || c.payment_month AS description,
                c.payment_method AS method, c.trx_id AS reference, c.contribution_amount AS credit, 0 AS debit FROM collections c JOIN members m ON m.id=c.member_id
                WHERE c.payment_date BETWEEN ? AND ?`);
    params.push(s, e);
  }
  // fines are their own line: the late fee of a contribution and the penalty of a loan installment
  if (type === 'All' || type === 'fine') {
    parts.push(`SELECT 'fine', c.payment_date, m.member_code || ' ' || m.name, 'Late fee ' || c.payment_month, c.payment_method, c.trx_id, c.late_fee, 0
                FROM collections c JOIN members m ON m.id = c.member_id WHERE c.late_fee > 0 AND c.payment_date BETWEEN ? AND ?`);
    parts.push(`SELECT 'fine', r.paid_date, m.member_code || ' ' || m.name, 'Loan ' || l.loan_no || ' late penalty', r.payment_method, r.trx_id, r.penalty_paid, 0
                FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id JOIN members m ON m.id = l.member_id WHERE r.penalty_paid > 0 AND r.paid_date BETWEEN ? AND ?`);
    params.push(s, e, s, e);
  }
  if (type === 'All' || type === 'expense') {
    parts.push(`SELECT 'expense', expense_date, payee, title || ' (' || category || ')', '', receipt_ref, 0, amount FROM expenses WHERE expense_date BETWEEN ? AND ?`);
    params.push(s, e);
  }
  if (type === 'All' || type === 'investment') {
    parts.push(`SELECT 'investment', purchase_date, name, 'Investment: ' || sector, '', '', 0, invested_amount FROM investments WHERE purchase_date BETWEEN ? AND ?`);
    parts.push(`SELECT 'sale', sold_date, name, 'Investment sold: ' || sector, '', '', sold_amount, 0 FROM investments WHERE status='Sold' AND sold_date BETWEEN ? AND ?`);
    params.push(s, e, s, e);
  }
  if (type === 'All' || type === 'return') {
    parts.push(`SELECT 'return', r.entry_date, i.name, r.entry_type || ' from investment' || CASE WHEN r.note != '' THEN ': ' || r.note ELSE '' END, r.payment_method, r.reference,
                CASE r.entry_type WHEN 'Profit' THEN r.amount ELSE 0 END, CASE r.entry_type WHEN 'Loss' THEN r.amount ELSE 0 END
                FROM investment_returns r JOIN investments i ON i.id = r.investment_id WHERE r.entry_date BETWEEN ? AND ?`);
    params.push(s, e);
  }
  if (type === 'All' || type === 'loan') {
    parts.push(`SELECT 'loan', l.disbursed_date, m.member_code || ' ' || m.name, 'Personal loan ' || l.loan_no || ' given (' || l.term_months || ' months)', l.payment_method, l.reference, 0, l.principal
                FROM personal_loans l JOIN members m ON m.id = l.member_id WHERE l.disbursed_date BETWEEN ? AND ?`);
    parts.push(`SELECT 'loan_repayment', r.paid_date, m.member_code || ' ' || m.name, 'Loan ' || l.loan_no || ' repayment (principal ' || r.principal_paid || ', interest ' || r.interest_paid || ')', r.payment_method, r.trx_id, r.total_paid - r.penalty_paid, 0
                FROM loan_repayments r JOIN personal_loans l ON l.id = r.loan_id JOIN members m ON m.id = l.member_id WHERE r.paid_date BETWEEN ? AND ?`);
    params.push(s, e, s, e);
  }
  if (type === 'All' || type === 'settlement') {
    parts.push(`SELECT 'settlement', s.settlement_date, m.member_code || ' ' || m.name, 'Member settlement (principal ' || s.principal || ', share ' || s.profit_share || ')',
                s.payment_method, s.trx_id, 0, s.total_paid FROM member_settlements s JOIN members m ON m.id = s.member_id WHERE s.settlement_date BETWEEN ? AND ?`);
    params.push(s, e);
  }
  if (parts.length === 1) return [];
  return all(`${parts.join(' UNION ALL ')} ORDER BY date, type`, params);
}

function getAuditLog(limit = 200) {
  // activity of the protected iqbal_labs account is hidden from everyone else
  const hide = seesSystem() ? '' : `WHERE COALESCE(user_name, '') NOT IN (SELECT username FROM users WHERE is_system = 1) AND COALESCE(user_id, 0) NOT IN (SELECT id FROM users WHERE is_system = 1)`;
  return all(`SELECT * FROM audit_log ${hide} ORDER BY id DESC LIMIT ?`, [Math.min(Number(limit) || 200, 5000)]);
}

function getDynamicNotifications() {
  const mk = currentMonthKey();
  const ms = monthSummary(mk);
  const out: any[] = [];
  const s = settingsMap();
  if (ms.overdue > 0) out.push({ id: `overdue_${mk}_${ms.overdue}`, title: `${ms.overdue} member(s) overdue this month`, message: `Dues for ${mk} passed the due date without payment.`, type: 'warning', targetTab: 'collections', targetFilter: 'Overdue', actionLabel: 'View overdue', createdAt: 'This month' });
  const in30 = todayISO(new Date(Date.now() + 30 * 864e5));
  for (const r of all(`SELECT id, name, review_date FROM investments WHERE status != 'Sold' AND review_date IS NOT NULL AND review_date <= ? ORDER BY review_date LIMIT 3`, [in30])) {
    out.push({ id: `review_${r.id}_${r.review_date}`, title: `${r.name}: review ${r.review_date < todayISO() ? 'overdue' : 'due'}`, message: `Committee review date ${r.review_date}.`, type: 'info', targetTab: 'investments', actionLabel: 'Open investments', createdAt: r.review_date });
  }
  const lateLoans = enrichLoans().filter(l => l.derived_status === 'Overdue');
  if (lateLoans.length) {
    const amt = r2(lateLoans.reduce((a, l) => a + l.overdue_amount, 0));
    out.push({ id: `loans_overdue_${lateLoans.length}_${amt}`, title: `${lateLoans.length} personal loan(s) overdue`, message: `TK ${amt} of loan installments is past its due date.`, type: 'warning', targetTab: 'loans', targetFilter: 'Overdue', actionLabel: 'View loans', createdAt: 'Now' });
  }
  const draftN = num(`SELECT COUNT(*) FROM loan_applications WHERE status = 'Draft'`);
  if (draftN > 0) out.push({ id: `loan_drafts_${draftN}`, title: `${draftN} loan draft(s) waiting for the signed consent paper`, message: 'No money has been disbursed yet. Upload the signed paper to disburse each loan.', type: 'info', targetTab: 'loans', targetFilter: 'Draft', actionLabel: 'View drafts', createdAt: 'Now' });
  const rc = num(`SELECT COUNT(*) FROM expenses WHERE status='Needs receipt'`);
  if (rc > 0) out.push({ id: `receipts_${rc}`, title: `${rc} expense(s) need a receipt`, message: 'Attach voucher references to keep the audit trail complete.', type: 'warning', targetTab: 'expenses', targetFilter: 'Needs receipt', actionLabel: 'Verify receipts', createdAt: 'Pending' });
  const last = s.last_backup_date;
  const lastT = Date.parse(last);
  if (last === 'Never' || (!isNaN(lastT) && Date.now() - lastT > 7 * 864e5)) {
    out.push({ id: `backup_${last}`, title: last === 'Never' ? 'No manual backup yet' : 'Backup older than 7 days', message: 'Save a copy of your data to a USB drive or another folder.', type: 'warning', targetTab: 'backup', actionLabel: 'Back up now', createdAt: last });
  }
  return out.map(n => ({ ...n, isRead: false }));
}

// ---------------------------------------------------------------------------
// Backup bookkeeping & reset
// ---------------------------------------------------------------------------
function getBackupLogs() { return all('SELECT * FROM backup_logs ORDER BY id DESC LIMIT 200'); }

export function logBackup(fileName: string, filePath: string, size: number, type: string) {
  run('INSERT INTO backup_logs (file_name, file_path, file_size, backup_type) VALUES (?,?,?,?)', [fileName, filePath, size, type]);
  if (type === 'Manual') run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_backup_date', ?)`, [new Date().toISOString()]);
  audit('backup', 'database', null, `${type}: ${filePath}`);
  mutated(true);
}

/** For Google sync: does this computer hold any real fund data yet, or is it a fresh install? */
export function syncHasData(): boolean {
  return ['members', 'collections', 'expenses', 'investments', 'investment_returns', 'member_settlements', 'personal_loans', 'loan_applications'].some(t => num(`SELECT COUNT(*) FROM ${t}`) > 0);
}
export function syncCounts() {
  const c = (t: string) => num(`SELECT COUNT(*) FROM ${t}`);
  return { members: c('members'), collections: c('collections'), expenses: c('expenses'), investments: c('investments'), loans: c('personal_loans'), drafts: c('loan_applications'), users: c('users') };
}

/** The signed consent papers the database points to (their files are synced separately from the database). */
export function consentFiles(): Array<{ table: 'loan_applications' | 'personal_loans'; id: number; file: string; name: string; sha256: string; size: number }> {
  const rows: any[] = [];
  for (const table of ['loan_applications', 'personal_loans'] as const) {
    for (const r of all(`SELECT id, consent_file, consent_name, consent_sha256, consent_size FROM ${table} WHERE consent_file IS NOT NULL AND consent_file != ''`)) {
      rows.push({ table, id: r.id, file: String(r.consent_file), name: String(r.consent_name || ''), sha256: String(r.consent_sha256 || ''), size: Number(r.consent_size) || 0 });
    }
  }
  return rows;
}
/** After data came from another computer the stored file paths belong to that computer: point them at this computer's documents folder. */
export function rebaseConsentFiles(dir: string) {
  tx(() => {
    for (const r of consentFiles()) {
      const base = r.file.split(/[\\/]/).pop() || r.file;
      const next = path.join(dir, base);
      if (next !== r.file) run(`UPDATE ${r.table} SET consent_file = ? WHERE id = ?`, [next, r.id]);
    }
  });
  mutated(true);
}

function getDatabaseStats() {
  const c = (t: string) => num(`SELECT COUNT(*) FROM ${t}`);
  return {
    schemaVersion: num('PRAGMA user_version'),
    members: c('members'), collections: c('collections'), investments: c('investments'), expenses: c('expenses'),
    returns: c('investment_returns'), settlements: c('member_settlements'), loans: c('personal_loans'), loanRepayments: c('loan_repayments'),
    users: c('users'), masterData: c('master_data'), auditEntries: c('audit_log'),
  };
}

/** Wipes business data. keepSetup keeps users, master data and settings. */
function resetDatabase(keepSetup = true) {
  tx(() => {
    for (const t of ['loan_applications', 'loan_repayments', 'loan_schedule', 'personal_loans', 'member_settlements', 'investment_returns', 'collections', 'members', 'investments', 'expenses']) run(`DELETE FROM ${t}`);
    if (!keepSetup) { run('DELETE FROM master_data'); run('DELETE FROM users'); run('DELETE FROM app_settings'); }
    run(`DELETE FROM sqlite_sequence WHERE name IN ('loan_applications','loan_repayments','personal_loans','member_settlements','investment_returns','collections','members','investments','expenses')`);
    audit('reset', 'database', null, keepSetup ? 'business data cleared' : 'factory reset');
  });
  ensureDefaults();
  ensureAccounts();
  mutated();
}

/**
 * Accounting health check: verifies every stored entry and reconciles the books.
 * Read-only. Each check: pass | warn (should be reviewed) | fail (data is wrong).
 */
function checkAccountingHealth() {
  type Status = 'pass' | 'warn' | 'fail';
  const checks: Array<{ id: string; title: string; status: Status; count: number; details: string[] }> = [];
  const today = todayISO();
  const add = (id: string, title: string, status: Status, rows: Row[], fmt: (r: Row) => string) =>
    checks.push({ id, title, status: rows.length ? status : 'pass', count: rows.length, details: rows.slice(0, 20).map(fmt) });
  const ISO = `(%s GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')`;
  const iso = (col: string) => ISO.replace('%s', col);

  // database engine
  const integrity = String(db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] ?? 'unknown');
  checks.push({ id: 'integrity', title: 'Database file integrity', status: integrity === 'ok' ? 'pass' : 'fail', count: integrity === 'ok' ? 0 : 1, details: integrity === 'ok' ? [] : [integrity] });
  add('fk', 'Payments linked to existing members', 'fail', all('SELECT c.id, c.member_id FROM collections c LEFT JOIN members m ON m.id = c.member_id WHERE m.id IS NULL'),
    r => `Payment #${r.id} points to missing member #${r.member_id}`);

  // collections
  add('coll_total', 'Payment total = contribution + late fee', 'fail',
    all('SELECT c.id, m.member_code, c.payment_month, c.contribution_amount, c.late_fee, c.total_amount FROM collections c JOIN members m ON m.id=c.member_id WHERE ABS(c.total_amount - (c.contribution_amount + c.late_fee)) > 0.009'),
    r => `${r.member_code} ${r.payment_month}: ${r.contribution_amount} + ${r.late_fee} ≠ ${r.total_amount}`);
  add('coll_amount', 'Payment amounts are positive', 'fail',
    all('SELECT c.id, m.member_code, c.payment_month, c.contribution_amount, c.late_fee FROM collections c JOIN members m ON m.id=c.member_id WHERE c.contribution_amount <= 0 OR c.late_fee < 0'),
    r => `${r.member_code} ${r.payment_month}: contribution ${r.contribution_amount}, late fee ${r.late_fee}`);
  add('coll_dates', 'Payment dates and months are valid', 'fail',
    all(`SELECT c.id, m.member_code, c.payment_month, c.payment_date FROM collections c JOIN members m ON m.id=c.member_id
         WHERE NOT ${iso('c.payment_date')} OR c.payment_month NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'`),
    r => `${r.member_code}: month "${r.payment_month}", date "${r.payment_date}"`);
  add('coll_future', 'No payments dated in the future', 'fail',
    all('SELECT c.id, m.member_code, c.payment_month, c.payment_date FROM collections c JOIN members m ON m.id=c.member_id WHERE c.payment_date > ? OR c.payment_month > ?', [today, today.slice(0, 7)]),
    r => `${r.member_code} ${r.payment_month} paid ${r.payment_date}`);
  add('coll_before_join', 'Payments are not for months before the member joined', 'warn',
    all('SELECT m.member_code, m.name, c.payment_month, m.join_date FROM collections c JOIN members m ON m.id=c.member_id WHERE c.payment_month < substr(m.join_date,1,7)'),
    r => `${r.member_code} ${r.name}: paid ${r.payment_month}, joined ${r.join_date}`);
  add('coll_overpay', 'Contribution matches the monthly due', 'warn',
    all('SELECT m.member_code, m.name, c.payment_month, c.contribution_amount, m.monthly_due FROM collections c JOIN members m ON m.id=c.member_id WHERE ABS(c.contribution_amount - m.monthly_due) > 0.009'),
    r => `${r.member_code} ${r.payment_month}: paid ${r.contribution_amount}, due ${r.monthly_due}`);

  // members
  add('mem_values', 'Member dues and opening balances are valid', 'fail',
    all(`SELECT member_code, name, monthly_due, opening_balance, join_date FROM members WHERE monthly_due < 0 OR opening_balance < 0 OR TRIM(name) = '' OR NOT ${iso('join_date')}`),
    r => `${r.member_code} ${r.name}: due ${r.monthly_due}, opening ${r.opening_balance}, joined "${r.join_date}"`);
  add('mem_nid', 'Every member has a National ID (NID)', 'warn',
    all(`SELECT member_code, name FROM members WHERE nid IS NULL OR TRIM(nid) = ''`), r => `${r.member_code} ${r.name}: NID missing`);
  add('mem_nid_fmt', 'National IDs are valid and unique', 'fail',
    all(`SELECT member_code, name, nid FROM members WHERE nid IS NOT NULL AND TRIM(nid) != '' AND (nid GLOB '*[^0-9]*' OR LENGTH(nid) NOT IN (10, 13, 17))`), r => `${r.member_code} ${r.name}: "${r.nid}" is not a valid NID`);
  add('mem_future', 'No members joining in the future', 'warn',
    all('SELECT member_code, name, join_date FROM members WHERE join_date > ?', [today]), r => `${r.member_code} ${r.name}: ${r.join_date}`);

  // expenses
  add('exp_values', 'Expenses have a positive amount and a valid date', 'fail',
    all(`SELECT id, title, amount, expense_date FROM expenses WHERE amount <= 0 OR NOT ${iso('expense_date')} OR expense_date > ?`, [today]),
    r => `#${r.id} ${r.title}: ${r.amount} on "${r.expense_date}"`);
  add('exp_category', 'Expense categories exist in master data', 'warn',
    all(`SELECT DISTINCT category FROM expenses WHERE category NOT IN (SELECT name FROM master_data WHERE type='expense_category')`), r => String(r.category));
  add('exp_receipt', 'Expenses have receipts', 'warn',
    all(`SELECT id, title, amount, expense_date FROM expenses WHERE status = 'Needs receipt'`), r => `${r.title} (${r.amount}, ${r.expense_date})`);

  // investments
  add('inv_values', 'Investments have valid amounts and dates', 'fail',
    all(`SELECT id, name, invested_amount, current_estimated_value, purchase_date FROM investments
         WHERE invested_amount <= 0 OR current_estimated_value < 0 OR NOT ${iso('purchase_date')} OR purchase_date > ?`, [today]),
    r => `${r.name}: cost ${r.invested_amount}, value ${r.current_estimated_value}, bought "${r.purchase_date}"`);
  add('inv_sold', 'Sold investments have sale amount and date', 'fail',
    all(`SELECT id, name, sold_amount, sold_date, purchase_date FROM investments WHERE status = 'Sold' AND (sold_amount IS NULL OR sold_amount < 0 OR sold_date IS NULL OR sold_date < purchase_date)`),
    r => `${r.name}: sold ${r.sold_amount ?? '—'} on ${r.sold_date ?? '—'}`);
  add('inv_sector', 'Investment sectors exist in master data', 'warn',
    all(`SELECT DISTINCT sector FROM investments WHERE sector NOT IN (SELECT name FROM master_data WHERE type='investment_sector')`), r => String(r.sector));

  // investment returns & member settlements
  add('ret_values', 'Investment profit/loss entries are valid', 'fail',
    all(`SELECT r.id, i.name, r.entry_type, r.amount, r.entry_date FROM investment_returns r LEFT JOIN investments i ON i.id = r.investment_id
         WHERE i.id IS NULL OR r.amount <= 0 OR NOT ${iso('r.entry_date')} OR r.entry_date > ? OR r.entry_date < i.purchase_date`, [today]),
    r => `#${r.id} ${r.name ?? 'missing investment'}: ${r.entry_type} ${r.amount} on "${r.entry_date}"`);
  add('set_missing', 'Inactive members have a recorded settlement', 'warn',
    all(`SELECT m.member_code, m.name FROM members m WHERE m.status = 'Inactive' AND NOT EXISTS (SELECT 1 FROM member_settlements s WHERE s.member_id = m.id)`),
    r => `${r.member_code} ${r.name}: inactive but no settlement (payout) was recorded`);
  add('set_active', 'Settled members are inactive', 'fail',
    all(`SELECT m.member_code, m.name FROM members m JOIN member_settlements s ON s.member_id = m.id WHERE m.status != 'Inactive'`),
    r => `${r.member_code} ${r.name}: has a settlement but is not inactive`);
  const badSet: Row[] = [];
  for (const s of all('SELECT s.*, m.member_code FROM member_settlements s JOIN members m ON m.id = s.member_id')) {
    const principal = r2(num('SELECT COALESCE(SUM(contribution_amount),0) FROM collections WHERE member_id = ?', [s.member_id]) + num('SELECT opening_balance FROM members WHERE id = ?', [s.member_id]));
    if (Math.abs(principal - Number(s.principal)) > 0.01) badSet.push({ t: `${s.member_code}: recorded principal ${s.principal} but contributions now total ${principal}` });
    if (Math.abs(Number(s.principal) + Number(s.profit_share) - Number(s.total_paid)) > 0.01) badSet.push({ t: `${s.member_code}: principal ${s.principal} + share ${s.profit_share} ≠ paid ${s.total_paid}` });
    if (get('SELECT 1 FROM collections WHERE member_id = ? AND payment_date > ?', [s.member_id, s.settlement_date])) badSet.push({ t: `${s.member_code}: payments exist after the settlement date` });
  }
  add('set_math', 'Member settlements add up', 'fail', badSet, r => r.t);

  // the books balance, and the fines are accounted for
  const books = getFundBooks();
  add('books_balance', 'The books balance: the fund = what members are owed + the fund\'s own reserve', 'fail',
    books.balanced ? [] : [{ t: `Reserve ${books.reserve} but fines ${books.parts.fines} + penalties ${books.parts.penalties} − expenses ${books.parts.expenses} − settlement adjustment ${books.parts.settlementAdjustment} + unshared benefit ${books.parts.unshared} = ${books.explained} (difference ${books.residual}). Some entry is counted in the cash totals but not in the members' shares, or the other way round.` }], r => r.t);
  add('reserve_negative', 'The fund holds at least what its members are owed', 'warn',
    books.reserve < -0.005 ? [{ t: `Members are owed ${books.owedToMembers} but the fund balance at cost is ${books.fundBalance}: ${-books.reserve} is missing. Expenses (${books.parts.expenses}) are higher than the fines and penalties collected (${r2(books.parts.fines + books.parts.penalties)}) and nothing else covers them.` }] : [], r => r.t);
  add('set_drift', 'Settled members\' figures still match the books', 'warn',
    books.drift.map(d => ({ t: `${d.member_code} ${d.name}: settled on ${d.stored}, but the books now give ${d.now} (an entry dated before the settlement was added or changed afterwards)` })), r => r.t);
  const fineReg = fineRows({});
  const fineLedger = num('SELECT COALESCE((SELECT SUM(late_fee) FROM collections WHERE late_fee > 0), 0) + COALESCE((SELECT SUM(penalty_paid) FROM loan_repayments WHERE penalty_paid > 0), 0)');
  const fineRegTotal = fineReg.reduce((a, x) => a + x.amount, 0);
  add('fine_register', 'The fine register adds up to the fines in the ledger', 'fail',
    Math.abs(fineRegTotal - fineLedger) > 0.01 ? [{ t: `Fine register ${r2(fineRegTotal)} ≠ fines in payments and loan repayments ${r2(fineLedger)}` }] : [], r => r.t);
  add('fine_on_time', 'Fines were charged only on late payments', 'warn',
    fineReg.filter(x => x.flag === 'on_time').map(x => ({ t: `${x.member_code} ${x.name}: fine ${x.amount} on ${x.label} paid ${x.date}, by the due date ${x.due_date}` })), r => r.t);

  // personal loans
  const badLoans: Row[] = [];
  for (const l of all('SELECT l.*, m.member_code FROM personal_loans l LEFT JOIN members m ON m.id = l.member_id')) {
    const sc = get('SELECT COUNT(*) n, COALESCE(SUM(principal),0) p, COALESCE(SUM(interest),0) i FROM loan_schedule WHERE loan_id = ?', [l.id]) || {};
    const back = get('SELECT COALESCE(SUM(principal_paid),0) p, COUNT(*) n FROM loan_repayments WHERE loan_id = ?', [l.id]) || {};
    const tag = `${l.loan_no} ${l.member_code ?? 'missing member'}`;
    if (!l.member_code) badLoans.push({ t: `${tag}: member record is missing` });
    if (!(l.principal > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.disbursed_date)) || l.disbursed_date > today) badLoans.push({ t: `${tag}: amount ${l.principal} or date "${l.disbursed_date}" is not valid` });
    if (Number(sc.n) !== Number(l.term_months)) badLoans.push({ t: `${tag}: schedule has ${sc.n} installments but the term is ${l.term_months}` });
    if (Math.abs(Number(sc.p) - Number(l.principal)) > 0.01) badLoans.push({ t: `${tag}: schedule principal ${sc.p} ≠ loan amount ${l.principal}` });
    if (Math.abs(Number(sc.i) - Number(l.total_interest)) > 0.01 || Math.abs(Number(l.principal) + Number(l.total_interest) - Number(l.total_payable)) > 0.01)
      badLoans.push({ t: `${tag}: interest ${sc.i} / total payable ${l.total_payable} do not add up` });
    if (Number(back.p) > Number(l.principal) + 0.01) badLoans.push({ t: `${tag}: principal repaid ${back.p} is more than the loan ${l.principal}` });
    if (l.status === 'Closed' && Math.abs(Number(back.p) - Number(l.principal)) > 0.01) badLoans.push({ t: `${tag}: marked closed but principal repaid is ${back.p} of ${l.principal}` });
    if (l.status === 'Active' && Number(back.p) >= Number(l.principal) - 0.004) badLoans.push({ t: `${tag}: fully repaid but still marked running` });
    if (l.status === 'Written off' && Math.abs(Number(l.principal) - Number(back.p) - Number(l.written_off_amount)) > 0.01)
      badLoans.push({ t: `${tag}: written-off amount ${l.written_off_amount} ≠ unpaid principal ${r2(Number(l.principal) - Number(back.p))}` });
  }
  add('loan_math', 'Personal loans: schedules, repayments and statuses add up', 'fail', badLoans, r => r.t);
  add('loan_repay', 'Loan repayments are valid', 'fail',
    all(`SELECT r.id, l.loan_no, r.paid_date, r.total_paid, r.principal_paid, r.interest_paid, r.penalty_paid FROM loan_repayments r LEFT JOIN personal_loans l ON l.id = r.loan_id
         WHERE l.id IS NULL OR r.total_paid <= 0 OR r.principal_paid < 0 OR r.interest_paid < 0 OR r.penalty_paid < 0
            OR ABS(r.total_paid - (r.principal_paid + r.interest_paid + r.penalty_paid)) > 0.009 OR NOT ${iso('r.paid_date')} OR r.paid_date > ? OR r.paid_date < l.disbursed_date`, [today]),
    r => `#${r.id} ${r.loan_no ?? 'missing loan'}: ${r.total_paid} (= ${r.principal_paid} + ${r.interest_paid} + ${r.penalty_paid}) on "${r.paid_date}"`);
  add('loan_guarantor', 'Every personal loan has complete guarantor details', 'warn',
    all(`SELECT l.loan_no, l.guarantor_type, l.guarantor_member_id, l.guarantor_name, l.guarantor_address, l.guarantor_nid, l.guarantor, l.member_id, g.status AS gstatus
         FROM personal_loans l LEFT JOIN members g ON g.id = l.guarantor_member_id`).filter(r =>
      !r.guarantor_type ? true
        : r.guarantor_type === 'member' ? (!r.guarantor_member_id || r.gstatus === null || Number(r.guarantor_member_id) === Number(r.member_id))
          : !(r.guarantor_name && r.guarantor_address && /^\d{10}$|^\d{13}$|^\d{17}$/.test(String(r.guarantor_nid || '')))),
    r => `${r.loan_no}: ${r.guarantor_type ? 'guarantor details are incomplete or invalid' : `no structured guarantor recorded${r.guarantor ? ` (only "${r.guarantor}")` : ''}`}`);
  add('loan_consent', 'Signed consent papers of disbursed loans are on this computer', 'warn',
    all(`SELECT loan_no, consent_name, consent_file FROM personal_loans WHERE consent_status = 'Signed'`).filter(r => !r.consent_file || !fs.existsSync(String(r.consent_file))),
    r => `${r.loan_no}: the file "${r.consent_name}" cannot be found (restored on another computer, or deleted). Upload the scan again.`);
  add('loan_drafts_old', 'No loan draft has been waiting more than 14 days', 'warn',
    all(`SELECT app_no, principal, created_at FROM loan_applications WHERE status = 'Draft'`).filter(r => daysBetween(String(r.created_at).slice(0, 10), today) > 14),
    r => `${r.app_no}: TK ${r.principal} draft waiting since ${String(r.created_at).slice(0, 10)} for its signed consent paper`);
  add('loan_inactive', 'Members with an unpaid loan are still active', 'warn',
    all(`SELECT m.member_code, m.name, l.loan_no FROM personal_loans l JOIN members m ON m.id = l.member_id WHERE l.status = 'Active' AND m.status != 'Active'`),
    r => `${r.member_code} ${r.name}: inactive but still owes ${r.loan_no}`);
  add('loan_overdue', 'No personal loan installments are overdue', 'warn',
    enrichLoans().filter(l => l.derived_status === 'Overdue'),
    r => `${r.loan_no} ${r.member_code} ${r.member_name}: TK ${r.overdue_amount} overdue (${r.overdue_count} installment${r.overdue_count === 1 ? '' : 's'}, ${r.days_overdue} days)`);

  // settings
  const st = settingsMap();
  const badSettings: Row[] = [];
  if (!(+st.monthly_due_day >= 1 && +st.monthly_due_day <= 28)) badSettings.push({ k: `monthly_due_day = ${st.monthly_due_day}` });
  if (!(+st.late_fee_amount >= 0)) badSettings.push({ k: `late_fee_amount = ${st.late_fee_amount}` });
  if (!(+st.default_monthly_due >= 0)) badSettings.push({ k: `default_monthly_due = ${st.default_monthly_due}` });
  add('settings', 'Fund settings are valid', 'fail', badSettings, r => r.k);

  // reconciliation: independent sums vs. the fund position used everywhere in the app
  const pos = fundPosition('9999-12-31');
  const opening = num('SELECT COALESCE(SUM(opening_balance),0) FROM members');
  const credits = num('SELECT COALESCE(SUM(total_amount),0) FROM collections')
    + num(`SELECT COALESCE(SUM(sold_amount),0) FROM investments WHERE status='Sold'`)
    + num(`SELECT COALESCE(SUM(amount),0) FROM investment_returns WHERE entry_type='Profit'`)
    + num('SELECT COALESCE(SUM(total_paid),0) FROM loan_repayments');
  const debits = num('SELECT COALESCE(SUM(amount),0) FROM expenses') + num('SELECT COALESCE(SUM(invested_amount),0) FROM investments')
    + num('SELECT COALESCE(SUM(principal),0) FROM personal_loans')
    + num(`SELECT COALESCE(SUM(amount),0) FROM investment_returns WHERE entry_type='Loss'`)
    + num('SELECT COALESCE(SUM(total_paid),0) FROM member_settlements');
  const ledgerCash = opening + credits - debits;
  const diff = Math.round((ledgerCash - pos.cashInHand) * 100) / 100;
  checks.push({ id: 'reconcile', title: 'Cash book reconciles with cash in hand', status: Math.abs(diff) < 0.01 ? 'pass' : 'fail',
    count: Math.abs(diff) < 0.01 ? 0 : 1, details: Math.abs(diff) < 0.01 ? [] : [`Ledger ${ledgerCash} vs cash in hand ${pos.cashInHand} (difference ${diff})`] });
  const memberSum = num(`SELECT COALESCE(SUM(m.opening_balance + COALESCE((SELECT SUM(contribution_amount) FROM collections c WHERE c.member_id = m.id),0)),0) FROM members m`);
  const contribSum = opening + num('SELECT COALESCE(SUM(contribution_amount),0) FROM collections');
  checks.push({ id: 'member_totals', title: 'Member totals add up to total contributions', status: Math.abs(memberSum - contribSum) < 0.01 ? 'pass' : 'fail',
    count: Math.abs(memberSum - contribSum) < 0.01 ? 0 : 1, details: Math.abs(memberSum - contribSum) < 0.01 ? [] : [`Members ${memberSum} vs contributions ${contribSum}`] });
  if (pos.cashInHand < 0) checks.push({ id: 'negative_cash', title: 'Cash in hand is not negative', status: 'warn', count: 1,
    details: [`Cash in hand is ${pos.cashInHand}: more was spent or invested than was collected (missing opening balances or payments?)`] });

  const fails = checks.filter(c => c.status === 'fail').length, warns = checks.filter(c => c.status === 'warn').length;
  return {
    checkedAt: new Date().toISOString(),
    status: (fails ? 'fail' : warns ? 'warn' : 'pass') as Status,
    fails, warns, passes: checks.length - fails - warns,
    totals: {
      members: num('SELECT COUNT(*) FROM members'), payments: num('SELECT COUNT(*) FROM collections'),
      expenses: num('SELECT COUNT(*) FROM expenses'), investments: num('SELECT COUNT(*) FROM investments'),
      openingBalances: opening, collected: num('SELECT COALESCE(SUM(total_amount),0) FROM collections'),
      spent: num('SELECT COALESCE(SUM(amount),0) FROM expenses'), invested: num('SELECT COALESCE(SUM(invested_amount),0) FROM investments'),
      fundBalance: pos.fundBalance, cashInHand: pos.cashInHand,
    },
    checks,
  };
}

/** Realistic 18-month demo dataset relative to today (for training / evaluation). */
function loadDemoData() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const names = ['Mim Akter', 'Arif Hossain', 'Sadia Rahman', 'Rafiq Hasan', 'Jannatul Ferdous', 'Tanvir Ahmed', 'Nusrat Jahan', 'Kamrul Islam',
    'Farhana Yasmin', 'Shakil Ahmed', 'Rumana Begum', 'Imran Chowdhury', 'Tahmina Akter', 'Mahmudul Hasan', 'Sharmin Sultana', 'Habibur Rahman',
    'Nasrin Akter', 'Rakibul Islam', 'Sumaiya Khan', 'Mehedi Hasan', 'Fatema Tuz Zohra', 'Sajjad Hossain', 'Ayesha Siddika', 'Monirul Haque',
    'Shirin Akter', 'Jahid Hasan', 'Lamia Rahman', 'Asif Iqbal', 'Rubina Khatun', 'Towhid Alam'];
  const methods = ['Bank transfer', 'bKash', 'Cash', 'Nagad', 'bKash', 'Bank transfer'];
  const cur = currentMonthKey();
  const start = addMonths(cur, -17);
  const dd = dueDay();
  const fee = Number(settingsMap().late_fee_amount) || 300;
  resetDatabase(true);
  tx(() => {
    names.forEach((name, i) => {
      const join = addMonths(start, i < 20 ? 0 : Math.floor(rnd() * 14));
      const due = i % 7 === 0 ? 3000 : 2000;
      const reliability = i % 9 === 3 ? 0.6 : i % 5 === 1 ? 0.85 : 0.97;
      run(`INSERT INTO members (member_code, name, phone, email, status, monthly_due, join_date, avatar_initials, opening_balance, nid)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [`BF-${pad4(i + 1)}`, name, `01${7 + (i % 3)}${String(10000000 + Math.floor(rnd() * 89999999)).slice(0, 8)}`,
          `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, i === 29 ? 'Inactive' : 'Active', due, `${join}-0${1 + (i % 9)}`,
          initials(name), i < 20 ? due * 18 : 0, String(1990123456000 + i * 7919)]);
      const mid = lastId();
      for (let k = join; k <= (i === 29 ? addMonths(cur, -4) : cur); k = addMonths(k, 1)) {
        const dueDate = dueDateOf(k, dd);
        const isCur = k === cur;
        if (isCur && todayISO() < dueDate && rnd() > 0.55) continue;
        if (rnd() > (isCur ? reliability - 0.2 : reliability)) continue;
        const late = rnd() < 0.12;
        let day = late ? dd + 2 + Math.floor(rnd() * 12) : 1 + Math.floor(rnd() * dd);
        day = Math.min(day, daysInMonth(k));
        let pd = `${k}-${pad(day)}`;
        if (pd > todayISO()) pd = todayISO();
        run(`INSERT INTO collections (member_id, payment_month, payment_date, contribution_amount, late_fee, total_amount, payment_method, trx_id, note, created_by, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [mid, k, pd, due, pd > dueDate ? fee : 0, due + (pd > dueDate ? fee : 0), methods[Math.floor(rnd() * methods.length)],
            `TRX${k.replace('-', '')}${pad4(mid)}`, 'Monthly contribution', 'Demo', `${pd} 10:00:00`]);
      }
    });
    const inv = [
      ['Green Valley Land', 'Land', -15, 386400, 452000, 'Growing', 'Purbachal, Sector 4'],
      ['Mirpur Commercial Flat', 'Flat', -11, 290000, 318000, 'Growing', 'Mirpur 10'],
      ['Uttara Plot 7B', 'Plot', -7, 180000, 172000, 'Review', 'Uttara Sector 7'],
      ['Sonali Bank FDR', 'Fixed Deposit', -4, 100000, 104500, 'Growing', 'Sonali Bank, Motijheel'],
    ] as const;
    for (const [n, sec, off, a, v, st, loc] of inv) {
      const pdate = `${addMonths(cur, off)}-15`;
      run(`INSERT INTO investments (name, sector, purchase_date, invested_amount, current_estimated_value, status, review_date, location_details, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [n, sec, pdate, a, v, st, st === 'Review' ? todayISO(new Date(Date.now() + 12 * 864e5)) : null, loc, 'Demo', `${pdate} 11:00:00`]);
    }
    // benefit / loss entries and one member exit (so the demo shows settlements correctly)
    const invId = (n: string) => num('SELECT id FROM investments WHERE name = ?', [n]);
    const retRows: Array<[string, string, number, string, string]> = [
      ['Sonali Bank FDR', 'Profit', 2400, `${addMonths(cur, -2)}-05`, 'Bank transfer'],
      ['Sonali Bank FDR', 'Profit', 2600, `${addMonths(cur, -1)}-05`, 'Bank transfer'],
      ['Mirpur Commercial Flat', 'Profit', 9000, `${addMonths(cur, -1)}-08`, 'Cash'],
      ['Uttara Plot 7B', 'Loss', 3500, `${addMonths(cur, -1)}-12`, ''],
    ];
    for (const [n, t, a, d, pm] of retRows) {
      run(`INSERT INTO investment_returns (investment_id, entry_type, amount, entry_date, payment_method, note, created_by) VALUES (?,?,?,?,?,?,?)`,
        [invId(n), t, a, d, pm, t === 'Profit' ? 'Periodic benefit' : 'Valuation loss', 'Demo']);
    }
    const exitM = get(`SELECT id, member_code, opening_balance FROM members WHERE status = 'Inactive'`);
    if (exitM) {
      const principal = r2(Number(exitM.opening_balance) + num('SELECT SUM(contribution_amount) FROM collections WHERE member_id = ?', [exitM.id]));
      const last = get('SELECT MAX(payment_date) d FROM collections WHERE member_id = ?', [exitM.id])?.d || todayISO();
      run(`INSERT INTO member_settlements (member_id, settlement_date, principal, calc_profit_share, profit_share, total_paid, payment_method, note, created_by)
           VALUES (?,?,?,?,?,?,?,?,?)`, [exitM.id, last, principal, 0, 0, principal, 'Bank transfer', 'Left the fund', 'Demo']);
    }
    const cats = ['Meetup & Events', 'Office & Supplies', 'Legal & Documentation', 'Bank Charges', 'Maintenance', 'Emergency Support'];
    for (let k = start; k <= cur; k = addMonths(k, 1)) {
      const n = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const cat = cats[Math.floor(rnd() * cats.length)];
        let d = `${k}-${pad(1 + Math.floor(rnd() * 27))}`;
        if (d > todayISO()) d = todayISO();
        const amt = cat === 'Bank Charges' ? 150 + Math.floor(rnd() * 400) : cat === 'Legal & Documentation' ? 4000 + Math.floor(rnd() * 12000) : 800 + Math.floor(rnd() * 7000);
        const needs = k >= addMonths(cur, -1) && rnd() < 0.4;
        run(`INSERT INTO expenses (title, category, amount, expense_date, payee, receipt_ref, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [`${cat} — ${k}`, cat, Math.round(amt / 10) * 10, d, names[Math.floor(rnd() * 10)], needs ? '' : `VCH-${k.replace('-', '')}-${j + 1}`,
            needs ? 'Needs receipt' : 'Verified', 'Demo', `${d} 15:00:00`]);
      }
    }
    audit('demo', 'database', null, 'Demo data loaded');
  });
  mutated();
}

// ---------------------------------------------------------------------------
// Public API (whitelisted for IPC)
// ---------------------------------------------------------------------------
export const api: Record<string, (...args: any[]) => any> = {
  getAppSettings, saveAppSettings,
  getMembers, getAllMembersLite, addMember, updateMember, deleteMember, getMemberHistory, getMemberStatement, bulkAddMembers, getNextMemberCode,
  getCollections, recordPayment, deletePayment, suggestLateFee,
  getInvestments, addInvestment, updateInvestment, updateInvestmentValuation, getInvestmentReviews, completeInvestmentReview, deleteInvestment,
  getInvestmentReturns, getReturnsSummary, addInvestmentReturn, deleteInvestmentReturn,
  previewMemberSettlement, settleMember, getMemberSettlements, cancelSettlement,
  getLoans, getLoan, getLoanSummary, previewLoan, previewGuarantor, addLoan,
  getLoanApplications, getLoanApplication, createLoanApplication, updateLoanApplication, deleteLoanApplication, activateLoanApplication, updateLoan, deleteLoan, previewLoanRepayment, recordLoanRepayment, deleteLoanRepayment, writeOffLoan, cancelLoanWriteOff,
  getExpenses, addExpense, updateExpense, verifyExpenseReceipt, deleteExpense,
  getUsers, getUserProfile, addUser, updateUser, deleteUser,
  login, logout, getSession, changeOwnPassword, setUserPassword, checkAccountingHealth, getUserPermissions, setUserPermissions, getRoleDefaults,
  getMasterData, addMasterItem, updateMasterItem, deleteMasterItem,
  getOverviewMetrics, getOverviewData, getTransactions, getFineRegister, getFundBooks, getAuditLog, getDynamicNotifications,
  getBackupLogs, getDatabaseStats, resetDatabase, loadDemoData,
  // actor now comes from the signed-in session; kept as a no-op for older renderer code
  setActor: () => undefined,
};
