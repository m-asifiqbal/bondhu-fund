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

export const SCHEMA_VERSION = 4;

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

function mutated() {
  dirty = true;
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
  addColumn('master_data', 'name_bn', 'TEXT');
  for (const [, n, , bn] of DEFAULT_MASTER) run('UPDATE master_data SET name_bn = ? WHERE name = ? AND name_bn IS NULL', [bn, n]);
  addColumn('audit_log', 'user_id', 'INTEGER');
  run('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, id)');
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
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
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
  fiscal_year_start_month: '7',
  last_backup_date: 'Never',
  active_user_id: '1',
  auto_backup_enabled: '1',
  auto_backup_keep: '14',
  organization_name_bn: '',
  org_logo: '',
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
    fiscal_year_start_month: Number(s.fiscal_year_start_month),
    last_backup_date: s.last_backup_date,
    active_user_id: Number(s.active_user_id),
    auto_backup_enabled: s.auto_backup_enabled === '1',
    auto_backup_keep: Number(s.auto_backup_keep) || 14,
    organization_name_bn: s.organization_name_bn || '',
    org_logo: s.org_logo || '',
  };
}

function saveAppSettings(patch: Record<string, any>) {
  tx(() => {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      const val = typeof v === 'boolean' ? (v ? '1' : '0') : String(v ?? '');
      if (['default_monthly_due', 'late_fee_amount'].includes(k) && (isNaN(+val) || +val < 0)) fail(`${k} must be a positive number`);
      if (k === 'monthly_due_day' && (!(+val >= 1 && +val <= 28))) fail('Due day must be between 1 and 28');
      if (k === 'org_logo') checkImage(val, 'Logo');
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
             m.monthly_due, m.avatar_initials,
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
  const fundBalance = opening + collected - expenses + realized + returnsNet - settlements;
  return { opening, collected, expenses, realized, returnsNet, settlements, investedAtCost, fundBalance, cashInHand: fundBalance - investedAtCost };
}

// ---------------------------------------------------------------------------
// Member settlement (exit payout) — principal + the member's share of investment benefit
// ---------------------------------------------------------------------------
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Share of investment benefit for one member, from the date each benefit was earned.
 * Every benefit event (profit entry, loss entry, realised gain/loss on a sale) is split between the members
 * who were still in the fund on that date, in proportion to each member's principal (opening balance +
 * contributions paid up to that date). A member only shares in events dated up to their settlement date.
 */
function memberBenefitShare(memberId: number, settleDate: string) {
  type E = { date: string; amount: number; label: string };
  const events: E[] = [
    ...all(`SELECT r.entry_date AS date, CASE r.entry_type WHEN 'Profit' THEN r.amount ELSE -r.amount END AS amount, i.name AS label
            FROM investment_returns r JOIN investments i ON i.id = r.investment_id WHERE r.entry_date <= ?`, [settleDate]),
    ...all(`SELECT sold_date AS date, sold_amount - invested_amount AS amount, name AS label FROM investments
            WHERE status = 'Sold' AND sold_date IS NOT NULL AND sold_date <= ?`, [settleDate]),
  ].map(e => ({ date: String(e.date), amount: Number(e.amount) || 0, label: String(e.label) }));
  events.sort((a, b) => a.date.localeCompare(b.date));

  const members = all('SELECT id, opening_balance FROM members');
  const pays = new Map<number, Array<{ d: string; a: number }>>();
  for (const r of all('SELECT member_id, payment_date, contribution_amount FROM collections')) {
    if (!pays.has(r.member_id)) pays.set(r.member_id, []);
    pays.get(r.member_id)!.push({ d: String(r.payment_date), a: Number(r.contribution_amount) || 0 });
  }
  const settledOn = new Map<number, string>(all('SELECT member_id, settlement_date FROM member_settlements WHERE member_id != ?', [memberId])
    .map(r => [Number(r.member_id), String(r.settlement_date)]));
  settledOn.set(memberId, settleDate);
  const principalAt = (id: number, opening: number, d: string) =>
    opening + (pays.get(id) || []).reduce((s, p) => s + (p.d <= d ? p.a : 0), 0);

  let total = 0;
  const lines: Array<{ date: string; label: string; amount: number; share: number }> = [];
  for (const ev of events) {
    let mine = 0, all_ = 0;
    for (const m of members) {
      const sd = settledOn.get(Number(m.id));
      if (sd !== undefined && sd < ev.date) continue;          // already paid out before this benefit existed
      const p = principalAt(Number(m.id), Number(m.opening_balance) || 0, ev.date);
      all_ += p;
      if (Number(m.id) === memberId) mine = p;
    }
    const share = all_ > 0 ? (ev.amount * mine) / all_ : 0;
    total += share;
    if (Math.abs(share) >= 0.005) lines.push({ date: ev.date, label: ev.label, amount: ev.amount, share: r2(share) });
  }
  return { share: r2(total), lines };
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
  const date = toISODate(d.settlement_date) || todayISO();
  if (date > todayISO()) fail('Settlement date cannot be in the future.');
  const prev = previewMemberSettlement(memberId, date);
  if (prev.lastPaymentDate && date < prev.lastPaymentDate) fail(`Settlement date cannot be before the member's last payment (${prev.lastPaymentDate}).`);
  if (date < String(m.join_date)) fail('Settlement date cannot be before the join date.');
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
// Members
// ---------------------------------------------------------------------------
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
           m.avatar_initials, m.notes, m.opening_balance, m.name_bn,
           m.opening_balance + COALESCE(p.s,0) AS total_contributed, p.last AS last_payment_date,
           CASE WHEN cur.id IS NOT NULL THEN 'Paid'
                WHEN m.status != 'Active' OR substr(m.join_date,1,7) > ? THEN NULL
                WHEN ? > ? THEN 'Overdue' ELSE 'Pending' END AS current_month_status
    FROM members m LEFT JOIN paid p ON p.member_id = m.id LEFT JOIN cur ON cur.member_id = m.id`;
  const baseParams = [mk, mk, todayISO(), due];

  const where: string[] = [];
  const params: any[] = [];
  if (search?.trim()) {
    where.push('(name LIKE ? OR name_bn LIKE ? OR phone LIKE ? OR member_code LIKE ? OR email LIKE ?)');
    const q = `%${search.trim()}%`;
    params.push(q, q, q, q, q);
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
  return all(`SELECT id, member_code, name, name_bn, phone, monthly_due, status, avatar_initials FROM members ORDER BY name COLLATE NOCASE`);
}

function validateMember(d: any) {
  if (!d?.name?.trim()) fail('Member name is required.');
  if (d.monthly_due !== undefined && (isNaN(+d.monthly_due) || +d.monthly_due < 0)) fail('Monthly due must be a positive number.');
}

function addMember(d: any) {
  validateMember(d);
  const s = settingsMap();
  let code = d.member_code?.trim();
  if (!code || get('SELECT 1 FROM members WHERE member_code = ?', [code])) code = getNextMemberCode();
  const name = d.name.trim();
  const id = tx(() => {
    run(`INSERT INTO members (member_code, name, name_bn, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, name, d.name_bn?.trim() || null, d.phone?.trim() || '', d.email?.trim() || '', d.designation || 'Member', d.status || 'Active',
        d.monthly_due !== undefined && d.monthly_due !== '' ? Number(d.monthly_due) : Number(s.default_monthly_due),
        toISODate(d.join_date) || todayISO(), d.avatar_initials || initials(name),
        Number(d.opening_balance ?? d.total_contributed) || 0, d.notes || '']);
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
    avatar_initials: d.name ? initials(d.name) : undefined,
  };
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  if (!keys.length) return;
  const cur = get('SELECT status, opening_balance FROM members WHERE id = ?', [id]);
  const settled = !!get('SELECT 1 FROM member_settlements WHERE member_id = ?', [id]);
  if (d.status !== undefined && d.status !== cur.status) {
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
  if (payments > 0) fail(`This member has ${payments} payment record(s). Set the member to Inactive instead, so the fund history stays correct.`);
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
  const count = tx(() => {
    let c = 0;
    for (const m of list || []) {
      const name = String(m?.name || '').trim();
      if (!name) continue;
      const code = getNextMemberCode(batch);
      batch.push(code);
      run(`INSERT INTO members (member_code, name, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes)
           VALUES (?,?,?,?,?,'Active',?,?,?,?,?)`,
        [code, name, String(m.phone || '').trim(), String(m.email || '').trim(), String(m.designation || 'Member').trim(),
          Number(m.monthly_due) || Number(s.default_monthly_due), toISODate(m.join_date) || todayISO(), initials(name),
          Number(m.opening_balance) || 0, String(m.notes || '')]);
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
  const dbMembers = all('SELECT id, member_code, name, monthly_due, join_date, status, opening_balance FROM members');
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
    // No code: re-importing the same sheet must not duplicate people → match a unique exact name already in the app
    if (!code && name) {
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
      row: m.row, code, name, name_bn: m.name_bn, phone: m.phone, email: m.email, designation: m.designation || 'Member',
      status: status || 'Active', monthly_due: m.monthly_due ?? (existing ? Number(existing.monthly_due) : defDue),
      join_date: m.join_date, opening_balance: m.opening_balance ?? 0, notes: m.notes,
      existingId: existing ? Number(existing.id) : null, action: level === 'error' ? 'error' as const : action, level, messages: msgs,
      payments: 0, paidTotal: 0, autoGeneratedCode: !m.code.trim() && !existing,
    };
  });
  // First occurrence wins: a later duplicate-code row (an error) must not capture the valid member's payments.
  const fileByCode = new Map<string, (typeof members)[number]>();
  for (const m of members) if (m.code && !fileByCode.has(m.code.toLowerCase())) fileByCode.set(m.code.toLowerCase(), m);
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
    if (!fileM && !dbM && !x.code && x.name) {
      const k = x.name.trim().toLowerCase();
      const fm = fileByName.get(k) || [];
      // an app member already represented by a sheet row (matched by code or name) is the same person, not a second one
      const dm = (dbByName.get(k) || []).filter(d => !fm.some(f => f.existingId === Number(d.id)));
      if (fm.length + dm.length > 1) msgs.push({ level: 'error', text: `More than one member is named "${x.name}" — add the Member Code` });
      else { fileM = fm[0]; dbM = dm[0]; }
    }
    if (!fileM && !dbM) msgs.push({ level: 'error', text: `Member ${x.code || x.name} not found in the Members sheet or the app` });
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
        run(`INSERT INTO members (member_code, name, name_bn, phone, email, designation, status, monthly_due, join_date, avatar_initials, opening_balance, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [m.code, m.name, m.name_bn || null, m.phone, m.email, m.designation, m.status, m.monthly_due, m.join_date, initials(m.name), m.opening_balance, m.notes]);
        idByRow.set(m.row, lastId());
        created++;
      } else if (m.action === 'update' && m.existingId) {
        run(`UPDATE members SET name = ?, name_bn = COALESCE(NULLIF(?, ''), name_bn), phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email),
               designation = ?, status = ?, monthly_due = ?, join_date = ?, avatar_initials = ?, opening_balance = ?, notes = COALESCE(NULLIF(?, ''), notes),
               updated_at = datetime('now','localtime') WHERE id = ?`,
          [m.name, m.name_bn, m.phone, m.email, m.designation, m.status, m.monthly_due, m.join_date, initials(m.name), m.opening_balance, m.notes, m.existingId]);
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
  const members = all(`SELECT member_code, name, name_bn, phone, email, designation, status, monthly_due, join_date, opening_balance, notes FROM members ORDER BY member_code`);
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
    where.push('(member_name LIKE ? OR member_code LIKE ? OR trx_id LIKE ? OR member_phone LIKE ?)');
    params.push(q, q, q, q);
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
  return all(`SELECT *, (CASE WHEN status='Sold' THEN COALESCE(sold_amount,0) ELSE current_estimated_value END) - invested_amount AS gain_loss
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
const USER_COLS = `id, username, full_name, email, role, avatar_initials, status, created_at, phone, designation, address, bio, avatar,
  last_login_at, updated_at, is_system, (password_hash IS NOT NULL) AS has_password`;
const getUsers = () => all(`SELECT ${USER_COLS} FROM users ORDER BY id`);

/** Profile page: user + activity statistics from the audit log. */
function getUserProfile(id: number) {
  const user = get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
  if (!user) fail('User not found.');
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
    run('INSERT INTO users (username, full_name, email, role, avatar_initials, status, phone, designation, address, bio, avatar) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [username, u.full_name.trim(), u.email?.trim() || '', u.role || 'Manager', u.avatar_initials || initials(u.full_name), u.status || 'Active',
        u.phone || '', u.designation || '', u.address || '', u.bio || '', u.avatar || null]);
    const nid = lastId();
    audit('create', 'user', nid, username);
    return nid;
  });
  mutated();
  return id;
}

function updateUser(id: number, u: any) {
  const cur = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!cur) fail('User not found.');
  const demotingAdmin = cur.role === 'Admin' && ((u.role && u.role !== 'Admin') || u.status === 'Inactive');
  if (demotingAdmin && num(`SELECT COUNT(*) FROM users WHERE role='Admin' AND status='Active'`) <= 1) fail('At least one active Admin is required.');
  if (u.full_name !== undefined && !String(u.full_name).trim()) fail('Full name is required.');
  if (u.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) fail('Please enter a valid email address.');
  checkImage(u.avatar, 'Profile picture');
  const f: Record<string, any> = { full_name: u.full_name?.trim(), email: u.email, role: u.role, status: u.status,
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
    mutated();
    bad();
  }
  run(`UPDATE users SET failed_logins = 0, last_login_at = datetime('now','localtime') WHERE id = ?`, [u.id]);
  session = { id: u.id, username: u.username, role: u.role, isSystem: !!u.is_system };
  setActor(`${u.full_name} (${u.role})`, u.id);
  audit('login', 'user', u.id, u.username);
  mutated();
  return getSession();
}

function logout() {
  if (session) { audit('logout', 'user', session.id, session.username); mutated(); }
  session = null;
  setActor('System', null);
}

function getSession() {
  if (!session) return null;
  const u = get(`SELECT ${USER_COLS}, must_change_password, is_system FROM users WHERE id = ?`, [session.id]);
  if (!u || u.status !== 'Active') { session = null; return null; }      // e.g. after a restore
  session.role = u.role;
  return { user: u, canUpload: !!u.is_system, isAdmin: u.role === 'Admin', mustChangePassword: !!u.must_change_password && !u.is_system };
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
const PUBLIC = new Set(['login', 'getSession', 'getAppSettings']);
const UPLOAD = new Set(['bulkAddMembers']);                          // + Excel import IPC (main.ts)
const ADMIN = new Set(['cancelSettlement', 'addUser', 'deleteUser', 'setUserPassword', 'saveAppSettings', 'resetDatabase', 'loadDemoData',
  'addMasterItem', 'updateMasterItem', 'deleteMasterItem']);
const READ = /^(get|suggest|preview|export)/;

/** Throws unless the signed-in user may call `method` with `args`. Called by main.ts for every IPC call. */
export function authorize(method: string, args: any[] = []) {
  if (PUBLIC.has(method)) return;
  const s = getSession();
  if (!s) fail('Your session has ended. Please sign in again.');
  if (UPLOAD.has(method) && !s.canUpload) fail('Data upload is only available to the iqbal_labs account.');
  if (ADMIN.has(method) && !s.isAdmin) fail('Only an Admin can do this.');
  if (method === 'updateUser') {
    const targetId = Number(args[0]);
    const patch = args[1] || {};
    const target = get('SELECT is_system FROM users WHERE id = ?', [targetId]);
    if (target?.is_system && targetId !== s.user.id) fail('The iqbal_labs account is protected.');
    const privileged = ['role', 'status'].some(k => patch[k] !== undefined);
    if (targetId !== s.user.id && !s.isAdmin) fail('You can only edit your own profile.');
    if (privileged && (targetId === s.user.id || !s.isAdmin)) fail(targetId === s.user.id ? 'You cannot change your own role or status.' : 'Only an Admin can change roles.');
  }
  if (s.user.role === 'Auditor' && !READ.test(method) && !['logout', 'changeOwnPassword', 'updateUser', 'setActor'].includes(method)) {
    fail('Auditors have read-only access.');
  }
}
export function requireUpload() { const s = getSession(); if (!s?.canUpload) fail('Data upload is only available to the iqbal_labs account.'); }
export function requireAdmin() { const s = getSession(); if (!s) fail('Please sign in.'); if (!s.isAdmin) fail('Only an Admin can do this.'); }
export function requireSession() { if (!getSession()) fail('Please sign in.'); }

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
      fundBalance: p.fundBalance, cashInHand: p.cashInHand,
    });
  }
  const from12 = `${addMonths(mk, -11)}-01`;

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
      lifetimeCollected: pos.opening + pos.collected, totalExpenses: pos.expenses, realizedGain: pos.realized,
      monthCollected: ms.collected, prevMonthCollected: prevMs.collected, monthReceived: ms.received,
      monthExpected: ms.expected, collectionRate: ms.rate, prevCollectionRate: prevMs.rate,
      monthLateFees: Number(lfMonth.v) || 0, monthLateCount: Number(lfMonth.n) || 0, prevMonthLateFees: Number(lfPrev.v) || 0,
      yearLateFees: Number(lfYear.v) || 0, yearLateCount: Number(lfYear.n) || 0, lifetimeLateFees: Number(lfAll.v) || 0,
      monthExpenses, prevMonthExpenses, outstanding: ms.outstanding,
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
      lastBackup: settingsMap().last_backup_date,
    },
    recent,
  };
}

/** Unified ledger for reports: every money movement in a date range. */
function getTransactions(startDate?: string, endDate?: string, type = 'All') {
  const s = toISODate(startDate) || '0000-01-01', e = toISODate(endDate) || '9999-12-31';
  const parts: string[] = [];
  const params: any[] = [];
  if (type === 'All' || type === 'collection') {
    parts.push(`SELECT 'collection' AS type, c.payment_date AS date, m.member_code || ' ' || m.name AS party, 'Contribution ' || c.payment_month AS description,
                c.payment_method AS method, c.trx_id AS reference, c.total_amount AS credit, 0 AS debit FROM collections c JOIN members m ON m.id=c.member_id
                WHERE c.payment_date BETWEEN ? AND ?`);
    params.push(s, e);
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
  if (type === 'All' || type === 'settlement') {
    parts.push(`SELECT 'settlement', s.settlement_date, m.member_code || ' ' || m.name, 'Member settlement (principal ' || s.principal || ', share ' || s.profit_share || ')',
                s.payment_method, s.trx_id, 0, s.total_paid FROM member_settlements s JOIN members m ON m.id = s.member_id WHERE s.settlement_date BETWEEN ? AND ?`);
    params.push(s, e);
  }
  if (!parts.length) return [];
  return all(`${parts.join(' UNION ALL ')} ORDER BY date, type`, params);
}

function getAuditLog(limit = 200) {
  return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 200, 5000)]);
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
  mutated();
}

function getDatabaseStats() {
  const c = (t: string) => num(`SELECT COUNT(*) FROM ${t}`);
  return {
    schemaVersion: num('PRAGMA user_version'),
    members: c('members'), collections: c('collections'), investments: c('investments'), expenses: c('expenses'),
    returns: c('investment_returns'), settlements: c('member_settlements'),
    users: c('users'), masterData: c('master_data'), auditEntries: c('audit_log'),
  };
}

/** Wipes business data. keepSetup keeps users, master data and settings. */
function resetDatabase(keepSetup = true) {
  tx(() => {
    for (const t of ['member_settlements', 'investment_returns', 'collections', 'members', 'investments', 'expenses']) run(`DELETE FROM ${t}`);
    if (!keepSetup) { run('DELETE FROM master_data'); run('DELETE FROM users'); run('DELETE FROM app_settings'); }
    run(`DELETE FROM sqlite_sequence WHERE name IN ('member_settlements','investment_returns','collections','members','investments','expenses')`);
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
    + num(`SELECT COALESCE(SUM(amount),0) FROM investment_returns WHERE entry_type='Profit'`);
  const debits = num('SELECT COALESCE(SUM(amount),0) FROM expenses') + num('SELECT COALESCE(SUM(invested_amount),0) FROM investments')
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
      run(`INSERT INTO members (member_code, name, phone, email, status, monthly_due, join_date, avatar_initials, opening_balance)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        [`BF-${pad4(i + 1)}`, name, `01${7 + (i % 3)}${String(10000000 + Math.floor(rnd() * 89999999)).slice(0, 8)}`,
          `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`, i === 29 ? 'Inactive' : 'Active', due, `${join}-0${1 + (i % 9)}`,
          initials(name), i < 20 ? due * 18 : 0]);
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
  getInvestments, addInvestment, updateInvestment, updateInvestmentValuation, deleteInvestment,
  getInvestmentReturns, getReturnsSummary, addInvestmentReturn, deleteInvestmentReturn,
  previewMemberSettlement, settleMember, getMemberSettlements, cancelSettlement,
  getExpenses, addExpense, updateExpense, verifyExpenseReceipt, deleteExpense,
  getUsers, getUserProfile, addUser, updateUser, deleteUser,
  login, logout, getSession, changeOwnPassword, setUserPassword, checkAccountingHealth,
  getMasterData, addMasterItem, updateMasterItem, deleteMasterItem,
  getOverviewMetrics, getOverviewData, getTransactions, getAuditLog, getDynamicNotifications,
  getBackupLogs, getDatabaseStats, resetDatabase, loadDemoData,
  // actor now comes from the signed-in session; kept as a no-op for older renderer code
  setActor: () => undefined,
};
