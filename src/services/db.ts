/**
 * Renderer-side database client.
 * All SQL runs in the Electron main process (electron/database.ts); this file is a
 * thin, typed proxy so views keep calling the same async functions as before.
 *
 * Formats returned by the API:  dates 'YYYY-MM-DD', months 'YYYY-MM'.
 * Month arguments accept either 'YYYY-MM' or 'June 2024'.
 */
import type {
  Member, CollectionRecord, Investment, Expense, AppUser, MasterCategory, BackupRecord,
  OverviewMetrics, AppSettings, AppNotification, OverviewData, MemberStats, CollectionStats,
  LedgerRow, AuditEntry, SnapshotFile, AppInfo, MemberStatement,
} from '../types';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface ElectronAPI {
  isElectron: boolean;
  call: (method: string, args: unknown[]) => Promise<Result<any>>;
  appInfo: () => Promise<Result<AppInfo>>;
  backup: () => Promise<Result<{ canceled: boolean; filePath?: string; fileName?: string; fileSize?: number }>>;
  restore: () => Promise<Result<{ canceled: boolean; fileName?: string; safetySnapshot?: string }>>;
  restoreSnapshot: (fileName: string) => Promise<Result<{ canceled: boolean; fileName?: string; safetySnapshot?: string }>>;
  listSnapshots: () => Promise<Result<SnapshotFile[]>>;
  snapshotNow: () => Promise<Result<string>>;
  openBackupsFolder: () => Promise<Result<string>>;
  saveText: (name: string, content: string, filters?: { name: string; extensions: string[] }[]) => Promise<Result<{ canceled: boolean; filePath?: string }>>;
  savePdf: (name: string) => Promise<Result<{ canceled: boolean; filePath?: string }>>;
}

declare global {
  interface Window { electronAPI?: ElectronAPI }
}

function bridge(): ElectronAPI {
  if (!window.electronAPI) throw new Error('Bondhu Fund must run inside the desktop app (Electron).');
  return window.electronAPI;
}

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error((r as { error: string }).error);
  return (r as { data: T }).data;
}

const call = <T = any>(method: string, ...args: unknown[]): Promise<T> => unwrap(bridge().call(method, args));

/** Kept for backward compatibility; the database is opened by the main process. */
export async function initDatabase(): Promise<void> { /* no-op */ }
export async function persistDatabase(): Promise<void> { /* main process saves automatically */ }

// Settings -------------------------------------------------------------------
export const getAppSettings = () => call<AppSettings>('getAppSettings');
export const saveAppSettings = (s: Partial<AppSettings>) => call<void>('saveAppSettings', s);
export const setActor = (name: string) => call<void>('setActor', name);

// Members --------------------------------------------------------------------
export const getNextMemberCode = (extra?: Set<string> | string[]) => call<string>('getNextMemberCode', extra ? [...extra] : undefined);
export const getMembers = (search = '', status = 'All', page = 1, limit = 10, month?: string, startDate?: string, endDate?: string, sortBy = 'newest') =>
  call<{ members: Member[]; total: number; stats: MemberStats }>('getMembers', search, status, page, limit, month, startDate, endDate, sortBy);
export const getAllMembersLite = () => call<Pick<Member, 'id' | 'member_code' | 'name' | 'phone' | 'monthly_due' | 'status' | 'avatar_initials'>[]>('getAllMembersLite');
export const addMember = (d: Partial<Member>) => call<number>('addMember', d);
export const updateMember = (id: number, d: Partial<Member>) => call<void>('updateMember', id, d);
export const deleteMember = (id: number) => call<void>('deleteMember', id);
export const getMemberHistory = (memberId: number) => call<CollectionRecord[]>('getMemberHistory', memberId);
export const getMemberStatement = (memberId: number) => call<MemberStatement>('getMemberStatement', memberId);
export const bulkAddMembers = (list: Array<{ name: string; phone?: string; email?: string; monthly_due?: number; join_date?: string }>) => call<number>('bulkAddMembers', list);

// Collections ----------------------------------------------------------------
export const getCollections = (month?: string, statusTab = 'All', startDate?: string, endDate?: string, search = '', sortBy = 'newest') =>
  call<{ records: CollectionRecord[]; stats: CollectionStats }>('getCollections', month, statusTab, startDate, endDate, search, sortBy);
export const recordPayment = (d: {
  member_id: number; payment_month: string; payment_date: string; contribution_amount: number;
  late_fee: number; payment_method: string; trx_id?: string; note?: string;
}) => call<number>('recordPayment', d);
export const deletePayment = (id: number) => call<void>('deletePayment', id);
export const suggestLateFee = (month: string, paymentDate?: string) => call<number>('suggestLateFee', month, paymentDate);

// Investments ----------------------------------------------------------------
export const getInvestments = (sortBy = 'newest', status = 'All', startDate?: string, endDate?: string, search = '') =>
  call<Investment[]>('getInvestments', sortBy, status, startDate, endDate, search);
export const addInvestment = (d: Partial<Investment>) => call<number>('addInvestment', d);
export const updateInvestment = (id: number, d: Partial<Investment>) => call<void>('updateInvestment', id, d);
export const updateInvestmentValuation = (id: number, value: number) => call<void>('updateInvestmentValuation', id, value);
export const deleteInvestment = (id: number) => call<void>('deleteInvestment', id);

// Expenses -------------------------------------------------------------------
export const getExpenses = (category = 'All', status = 'All', startDate?: string, endDate?: string, search = '', sortBy = 'newest') =>
  call<Expense[]>('getExpenses', category, status, startDate, endDate, search, sortBy);
export const addExpense = (d: Partial<Expense>) => call<number>('addExpense', d);
export const updateExpense = (id: number, d: Partial<Expense>) => call<void>('updateExpense', id, d);
export const verifyExpenseReceipt = (id: number, receiptRef: string) => call<void>('verifyExpenseReceipt', id, receiptRef);
export const deleteExpense = (id: number) => call<void>('deleteExpense', id);

// Users & master data ----------------------------------------------------------
export const getUsers = () => call<AppUser[]>('getUsers');
export const addUser = (u: Partial<AppUser>) => call<number>('addUser', u);
export const updateUser = (id: number, u: Partial<AppUser>) => call<void>('updateUser', id, u);
export const deleteUser = (id: number) => call<void>('deleteUser', id);
export const getMasterData = (type?: MasterCategory['type'], activeOnly = false) => call<MasterCategory[]>('getMasterData', type, activeOnly);
export const addMasterItem = (d: Partial<MasterCategory>) => call<number>('addMasterItem', d);
export const updateMasterItem = (id: number, d: Partial<MasterCategory>) => call<void>('updateMasterItem', id, d);
export const deleteMasterItem = (id: number) => call<void>('deleteMasterItem', id);

// Analytics & reports -----------------------------------------------------------
export const getOverviewMetrics = (month?: string) => call<OverviewMetrics>('getOverviewMetrics', month);
export const getOverviewData = (month?: string) => call<OverviewData>('getOverviewData', month);
export const getTransactions = (startDate?: string, endDate?: string, type: 'All' | 'collection' | 'expense' | 'investment' = 'All') =>
  call<LedgerRow[]>('getTransactions', startDate, endDate, type);
export const getAuditLog = (limit = 200) => call<AuditEntry[]>('getAuditLog', limit);
export const getDynamicNotifications = () => call<AppNotification[]>('getDynamicNotifications');

// Backup & restore ---------------------------------------------------------------
export const getBackupLogs = () => call<BackupRecord[]>('getBackupLogs');
export const getAppInfo = () => unwrap(bridge().appInfo());
export const listSnapshots = () => unwrap(bridge().listSnapshots());
export const snapshotNow = () => unwrap(bridge().snapshotNow());
export const openBackupsFolder = () => unwrap(bridge().openBackupsFolder());
export const resetDatabase = (keepSetup = true) => call<void>('resetDatabase', keepSetup);
export const loadDemoData = () => call<void>('loadDemoData');

export async function performBackup(): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> {
  try {
    const r = await unwrap(bridge().backup());
    return { success: !r.canceled, canceled: r.canceled, filePath: r.filePath };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function performRestore(): Promise<{ success: boolean; canceled?: boolean; fileName?: string; safetySnapshot?: string; error?: string }> {
  try {
    const r = await unwrap(bridge().restore());
    return { success: !r.canceled, canceled: r.canceled, fileName: r.fileName, safetySnapshot: r.safetySnapshot };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function restoreSnapshot(fileName: string) {
  try {
    const r = await unwrap(bridge().restoreSnapshot(fileName));
    return { success: true, fileName: r.fileName, safetySnapshot: r.safetySnapshot };
  } catch (e: any) {
    return { success: false, error: e.message as string };
  }
}

// Files ------------------------------------------------------------------------
/** Opens a native Save dialog and writes text (CSV gets a UTF-8 BOM for Excel). */
export async function saveTextFile(name: string, content: string, filters?: { name: string; extensions: string[] }[]) {
  return unwrap(bridge().saveText(name, content, filters));
}
export async function savePdf(name: string) {
  return unwrap(bridge().savePdf(name));
}

/** Builds RFC-4180 CSV. */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

/** Legacy helper kept for views that still filter client-side. */
export function matchesDateRange(dateStr: string | undefined | null, startDate?: string, endDate?: string): boolean {
  if (!startDate && !endDate) return true;
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}
