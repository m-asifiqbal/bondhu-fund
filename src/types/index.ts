export type PaymentStatus = 'Paid' | 'Pending' | 'Overdue';
export type InvestmentStatus = 'Growing' | 'Review' | 'Sold';
export type ExpenseStatus = 'Verified' | 'Needs receipt';
export type UserRole = 'Treasurer' | 'Admin' | 'Auditor' | 'Manager';
export type UserStatus = 'Active' | 'Inactive';

export type NavTab =
  | 'overview'
  | 'members'
  | 'collections'
  | 'fines'
  | 'investments'
  | 'returns'
  | 'loans'
  | 'expenses'
  | 'entry'
  | 'master'
  | 'users'
  | 'backup'
  | 'license'
  | 'reports'
  | 'settings'
  | 'profile';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'warning' | 'info' | 'success';
  targetTab: NavTab;
  targetFilter?: string;
  actionLabel: string;
  isRead: boolean;
  createdAt: string;
}

export interface Member {
  id: number;
  member_code: string; // e.g. BF-0012
  name: string;
  phone: string;
  email: string;
  designation: string; // e.g. Member, Committee Member
  status: 'Active' | 'Inactive';
  monthly_due: number; // e.g. 2000
  join_date: string;
  avatar_initials: string;
  total_contributed?: number;
  last_payment_date?: string;
  current_month_status?: PaymentStatus | null;
  name_bn?: string | null;
  /** National ID (NID): required for every member; 10, 13 or 17 digits. */
  nid?: string | null;
  opening_balance?: number;
  notes?: string;
}

export interface CollectionRecord {
  id: number;
  member_id: number;
  member_name?: string;
  member_name_bn?: string | null;
  member_code?: string;
  payment_month: string; // e.g. "June 2024" or "2024-06"
  due_date: string; // e.g. "05 Jun"
  payment_date: string; // e.g. "28 Jun 2024"
  contribution_amount: number;
  late_fee: number;
  total_amount: number;
  status: PaymentStatus;
  payment_method: string;
  trx_id: string;
  note: string;
  created_at?: string;
  payment_id?: number | null;
  monthly_due?: number;
  member_phone?: string;
  avatar_initials?: string;
}

export interface Investment {
  id: number;
  name: string; // e.g. "Green Valley Land"
  sector: string; // "Land purchase" | "Flat purchase" | "Plot purchase" | "Assets"
  purchase_date: string; // "12 Jan 2024"
  invested_amount: number; // e.g. 386400
  current_estimated_value: number; // e.g. 452000
  gain_loss: number; // e.g. 65600
  status: InvestmentStatus; // "Growing" | "Review"
  review_date?: string; // e.g. "28 June 2024"
  notes?: string;
  location_details?: string;
  sold_date?: string | null;
  sold_amount?: number | null;
  last_review_date?: string | null;
  last_review_decision?: ReviewDecision | null;
  created_at?: string;
}

export type ReviewDecision = 'Hold' | 'Watch' | 'Sell' | 'Other';
export interface InvestmentReview {
  id: number; investment_id: number; meeting_date: string; decision: ReviewDecision; notes: string | null;
  value_before: number; value_after: number; status_after: string | null; next_review_date: string | null; attendees: string | null; created_by: string | null; created_at: string;
}

export interface Expense {
  id: number;
  title: string; // e.g. "June meetup expense"
  category: string; // "Meetup & Events" | "Office Supplies" | "Legal & Documentation" | "Maintenance"
  amount: number;
  expense_date: string;
  payee: string; // e.g. "Rafiq Hasan"
  receipt_ref: string;
  status: ExpenseStatus; // "Verified" | "Needs receipt"
  notes?: string;
  created_at?: string;
}

export interface AppUser {
  id: number;
  username: string;
  full_name: string;
  full_name_bn?: string | null;
  email: string;
  role: UserRole;
  avatar_initials: string;
  status: UserStatus;
  created_at: string;
  phone?: string;
  designation?: string;
  address?: string;
  bio?: string;
  /** data:image/... */
  avatar?: string | null;
  last_login_at?: string | null;
  updated_at?: string | null;
  /** 1 when a password is set (account can sign in) */
  has_password?: number;
  /** 1 for the protected iqbal_labs account */
  is_system?: number;
  /** the Super User's custom module access (JSON); null = the role's default */
  permissions?: string | null;
}

export interface MasterCategory {
  id: number;
  type: 'expense_category' | 'investment_sector' | 'payment_method';
  name: string;
  description?: string;
  is_active: number; // 1 or 0
  name_bn?: string | null;
}

export interface BackupRecord {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  backup_type: 'Manual' | 'Pre-Restore' | 'Automatic' | 'Restored';
  created_at: string;
}

export interface AppSettings {
  organization_name: string;
  currency_symbol: string;
  default_monthly_due: number;
  monthly_due_day: number;
  late_fee_amount: number;
  hijri_adjust_days: number;
  last_backup_date: string;
  active_user_id: number;
  fiscal_year_start_month?: number;
  auto_backup_enabled?: boolean;
  auto_backup_keep?: number;
  organization_name_bn?: string;
  /** data:image/... logo, '' when unset */
  org_logo?: string;
  /** personal-loan policy (Settings → Personal loans) */
  loan_default_rate?: number;
  loan_default_method?: LoanMethod;
  loan_max_multiple?: number;
  loan_late_fee?: number;
  /** 1 = a loan stays a draft until its signed consent paper is uploaded */
  loan_consent_required?: boolean;
}

export interface OverviewMetrics {
  total_fund_balance: number;
  fund_growth_pct: number;
  month_collected: number;
  month_target: number;
  collection_rate: number;
  active_members: number;
  overdue_members_count: number;
  invested_assets: number;
  invested_pct_of_fund: number;
  current_portfolio_value: number;
  unrealized_gain: number;
  paid_count?: number;
  pending_count?: number;
  overdue_count?: number;
  cash_in_hand?: number;
  fund_balance_at_cost?: number;
}

// ---------------------------------------------------------------------------
// v1 data-layer types (main-process database). Dates 'YYYY-MM-DD', months 'YYYY-MM'.
// ---------------------------------------------------------------------------
export interface MemberStats { total: number; active: number; paid: number; pending: number; overdue: number }

export interface CollectionStats {
  totalMembers: number; paidCount: number; pendingCount: number; overdueCount: number;
  collectedAmount: number; lateFeeAmount: number; expectedAmount: number; outstandingAmount: number; percentage: string;
}

export interface MemberStatement {
  member: Member;
  rows: Array<Partial<CollectionRecord> & { payment_month: string; due_date: string; monthly_due: number; status: PaymentStatus }>;
}

export interface LedgerRow {
  type: 'collection' | 'fine' | 'expense' | 'investment' | 'sale' | 'return' | 'settlement' | 'loan' | 'loan_repayment';
  date: string; party: string; description: string; method: string; reference: string; credit: number; debit: number;
}

export interface AuditEntry { id: number; at: string; user_name: string; action: string; entity: string; entity_id: number | null; details: string }

export interface SnapshotFile { fileName: string; filePath: string; size: number; sizeKb: string; createdAt: string }

export interface AppInfo {
  version: string; dbPath: string; backupsDir: string; sizeKb: string; lastModified: string | null;
  schemaVersion: number; members: number; collections: number; investments: number; expenses: number;
  users: number; masterData: number; auditEntries: number;
}

export interface TrendPoint {
  month: string; expected: number; collected: number; lateFees: number; rate: number;
  expenses: number; invested: number; fundBalance: number; cashInHand: number;
  returnProfit: number; returnLoss: number;
}

export interface OverviewData {
  month: string;
  today: string;
  kpis: {
    netWorth: number; prevNetWorth: number; fundBalance: number; prevFundBalance: number;
    cashInHand: number; prevCashInHand: number; loansOutstanding: number; loanIncome: number; lifetimeCollected: number; totalExpenses: number; realizedGain: number;
    monthCollected: number; prevMonthCollected: number; monthReceived: number; monthExpected: number;
    collectionRate: number; prevCollectionRate: number; monthLateFees: number; monthLateCount: number; prevMonthLateFees: number; yearLateFees: number; yearLateCount: number; lifetimeLateFees: number; monthExpenses: number; prevMonthExpenses: number;
    outstanding: number; paid: number; pending: number; overdue: number; dueMembers: number;
    activeMembers: number; totalMembers: number; newMembersThisMonth: number;
    invested: number; portfolioValue: number; unrealizedGain: number; investmentCount: number;
    totalArrears: number; membersInArrears: number;
    monthReturnProfit: number; monthReturnLoss: number; monthReturnCount: number; yearReturnProfit: number; yearReturnLoss: number;
    lifetimeReturnProfit: number; lifetimeReturnLoss: number; lifetimeReturnCount: number;
  };
  trend: TrendPoint[];
  expenseByCategory: Array<{ name: string; value: number; count: number }>;
  portfolio: Array<{ name: string; invested: number; value: number; count: number }>;
  investments: Array<{ id: number; name: string; sector: string; invested_amount: number; current_estimated_value: number; status: string; review_date: string | null }>;
  paymentMethods: Array<{ name: string; count: number; value: number }>;
  topContributors: Array<{ id: number; name: string; name_bn?: string | null; member_code: string; avatar_initials: string; total: number }>;
  dailyCollections: Array<{ date: string; value: number; count: number }>;
  arrears: Array<{ id: number; member_code: string; name: string; name_bn?: string | null; phone: string; monthly_due: number; avatar_initials: string; months: number; amount: number }>;
  attention: {
    overdue: number;
    reviews: Array<{ id: number; name: string; review_date: string | null }>;
    receipts: Array<{ id: number; title: string; amount: number; expense_date: string }>;
    receiptCount: number;
    loansOverdue: number; loansOverdueAmount: number;
    lastBackup: string;
  };
  recent: Array<{ kind: 'collection' | 'expense' | 'investment' | 'member' | 'return' | 'settlement' | 'loan' | 'repayment'; id: number; title: string; sub: string; amount: number; date: string; created_at: string }>;
}

export interface UserProfile {
  user: AppUser;
  stats: {
    totalActions: number; firstActivity: string | null; lastActivity: string | null;
    paymentsRecorded: number; amountCollected: number; expensesEntered: number; membersAdded: number;
  };
  byAction: Array<{ action: string; entity: string; count: number }>;
  monthly: Array<{ month: string; count: number }>;
  recent: AuditEntry[];
}
// Excel import --------------------------------------------------------------------------
export interface ImportOptions { existing?: 'skip' | 'update'; payment_method?: string }
export type ImportLevel = 'ok' | 'warning' | 'error';
export interface ImportMessage { level: ImportLevel; text: string }
export interface ImportMemberRow {
  row: number; code: string; name: string; name_bn: string; nid: string; phone: string; email: string; designation: string; status: string;
  monthly_due: number; join_date: string | null; opening_balance: number; notes: string;
  action: 'new' | 'update' | 'skip' | 'error'; level: ImportLevel; messages: ImportMessage[];
  payments: number; paidTotal: number; autoGeneratedCode: boolean;
}
export interface ImportPaymentRow {
  row: number; cell: string; code: string; name: string; month: string; amount: number; fullMarker: boolean;
  action: 'new' | 'exists' | 'error'; level: ImportLevel; messages: ImportMessage[];
}
export interface ImportPreview {
  members: ImportMemberRow[];
  /** only rows needing attention (warnings/errors), max 500 */
  payments: ImportPaymentRow[];
  summary: {
    membersInFile: number; newMembers: number; updatedMembers: number; skippedMembers: number; memberErrors: number;
    paymentsInFile: number; newPayments: number; existingPayments: number; paymentErrors: number;
    paymentTotal: number; openingTotal: number; monthRange: [string, string] | null; examplesSkipped: number;
  };
  sheetWarnings: string[];
}
export interface ImportResult { created: number; updated: number; skipped: number; errors: number; paymentsAdded: number; amount: number }
// Sign-in -----------------------------------------------------------------------------------
import type { ModuleKey, AccessLevel } from '../utils/access';
export interface UserAccess { userId: number; role: UserRole; isSystem: boolean; defaults: Record<ModuleKey, AccessLevel>; custom: Partial<Record<ModuleKey, AccessLevel>> | null; effective: Record<ModuleKey, AccessLevel> }
export interface SessionInfo {
  /** what this user may do in every module (decided by role and by the Super User) */
  permissions: Record<ModuleKey, AccessLevel>;
  user: AppUser & { is_system?: number; must_change_password?: number };
  /** only the protected iqbal_labs account */
  canUpload: boolean;
  isAdmin: boolean;
  /** admin still using the default password */
  mustChangePassword: boolean;
}

// Accounting health check -------------------------------------------------------------------
export type HealthStatus = 'pass' | 'warn' | 'fail';
export interface HealthReport {
  checkedAt: string; status: HealthStatus; fails: number; warns: number; passes: number;
  totals: { members: number; payments: number; expenses: number; investments: number; openingBalances: number; collected: number;
    spent: number; invested: number; fundBalance: number; cashInHand: number };
  checks: Array<{ id: string; title: string; status: HealthStatus; count: number; details: string[] }>;
}
export interface InvestmentReturn {
  id: number; investment_id: number; investment_name: string; sector?: string;
  entry_type: 'Profit' | 'Loss'; amount: number; entry_date: string;
  payment_method?: string | null; reference?: string | null; note?: string | null; created_by?: string | null;
}
export interface ReturnsSummary {
  profit: number; loss: number; net: number; entries: number; yearNet: number;
  byInvestment: Array<{ id: number; name: string; sector: string; invested_amount: number; profit: number; loss: number; net: number }>;
}
export interface SettlementPreview {
  member: { id: number; member_code: string; name: string; status: string; join_date: string };
  settlementDate: string; lastPaymentDate: string | null; existing: unknown | null;
  openingBalance: number; contributions: number; lateFeesKept: number; principal: number;
  profitShare: number; lines: Array<{ date: string; label: string; amount: number; share: number }>;
  suggestedPayout: number; cashInHand: number;
}
export interface MemberSettlement {
  id: number; member_id: number; member_code: string; member_name: string; member_name_bn?: string | null; avatar_initials?: string;
  settlement_date: string; principal: number; calc_profit_share: number; profit_share: number; total_paid: number;
  payment_method: string; trx_id?: string | null; note?: string | null;
}

// Personal loans ----------------------------------------------------------------------------
export type LoanMethod = 'reducing' | 'flat' | 'free';
/** derived: 'Running' = open and on time; 'Overdue' = open with a past-due installment */
export type LoanStatus = 'Running' | 'Overdue' | 'Closed' | 'Written off';
export interface Loan {
  id: number; loan_no: string; member_id: number;
  member_code: string; member_name: string; member_name_bn?: string | null; avatar_initials?: string; member_phone?: string | null; member_status?: string;
  principal: number; method: LoanMethod; annual_rate: number; term_months: number;
  disbursed_date: string; first_due_date: string; installment: number; total_interest: number; total_payable: number;
  payment_method?: string | null; reference?: string | null; purpose?: string | null; guarantor?: string | null; notes?: string | null;
  guarantor_type?: 'member' | 'outsider' | null; guarantor_member_id?: number | null; guarantor_name?: string | null; guarantor_address?: string | null;
  guarantor_nid?: string | null; guarantor_phone?: string | null; guarantor_relation?: string | null; guarantor_member_code?: string | null; guarantor_member_name?: string | null;
  application_no?: string | null; consent_status?: 'Signed' | 'Waived' | null; consent_name?: string | null; consent_size?: number | null; consent_uploaded_at?: string | null;
  status: 'Active' | 'Closed' | 'Written off'; closed_date?: string | null;
  written_off_amount: number; written_off_date?: string | null; written_off_reason?: string | null;
  paid_principal: number; paid_interest: number; paid_penalty: number; total_paid: number; paid_schedule: number;
  outstanding_principal: number; remaining_interest: number; remaining_payable: number;
  installments_total: number; installments_paid: number;
  next_due_date: string | null; next_due_amount: number;
  overdue_count: number; overdue_amount: number; days_overdue: number; due_30: number; due_to_date: number;
  last_payment_date: string | null; repayment_count: number;
  derived_status: LoanStatus; progress_pct: number;
}
export interface LoanSummary {
  loans: number; running: number; overdueLoans: number; closed: number; writtenOff: number; borrowers: number;
  totalLent: number; outstanding: number; principalRepaid: number; interestEarned: number; penaltyEarned: number; interestExpected: number; totalCollected: number;
  overdueAmount: number; overduePrincipal: number; dueNext30: number; writtenOffAmount: number; onTrackPct: number;
  cashInHand: number; fundBalance: number; lentPctOfFund: number; avgRate: number;
  drafts: number; draftsAmount: number;
}
export interface LoanPlanRow { no: number; due_date: string; principal: number; interest: number; total: number; balance: number }
export interface LoanTermOption { term: number; installment: number; totalInterest: number; totalPayable: number; effectiveRate: number }
export interface LoanPreview {
  valid: boolean; error?: string;
  terms?: { principal: number; method: LoanMethod; annual_rate: number; term_months: number; first_due_date: string; disbursed_date: string };
  plan?: { rows: LoanPlanRow[]; installment: number; lastInstallment: number; totalInterest: number; totalPayable: number; effectiveRate: number };
  options?: LoanTermOption[];
  warnings?: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
  cash?: number; nextLoanNo?: string; nextAppNo?: string; autoReference?: string;
  member?: { id: number; member_code: string; name: string; name_bn?: string | null; nid?: string | null; phone?: string | null; status: string; monthly_due: number; savings: number; owed: number; limit: number | null; multiple: number; available: number | null; overdueLoans: number } | null;
}
export interface LoanInstallment { no: number; due_date: string; principal: number; interest: number; total: number; paid: number; status: 'Paid' | 'Partial' | 'Due' | 'Overdue' | 'Waived' | 'Written off'; balance_after: number }
export interface LoanRepayment {
  id: number; loan_id: number; paid_date: string; kind: 'Installment' | 'Closure';
  principal_paid: number; interest_paid: number; penalty_paid: number; total_paid: number;
  payment_method?: string | null; trx_id?: string | null; note?: string | null; created_by?: string | null;
}
export interface GuarantorInfo { type: 'member' | 'outsider' | 'legacy'; member_id?: number; name: string; name_bn?: string | null; code?: string; address: string; nid: string; phone: string; relation: string }
export interface GuarantorCheck { ok: boolean; error: string; info: GuarantorInfo | null }
export interface LoanDetail {
  loan: Loan; guarantor: GuarantorInfo | null; schedule: LoanInstallment[]; repayments: LoanRepayment[]; latestRepaymentId: number | null;
  member: { id: number; member_code: string; name: string; name_bn?: string | null; avatar_initials?: string; phone?: string; monthly_due: number; status: string; savings: number; owed: number; nid?: string };
  memberLoans: Loan[];
}
export interface LoanRepaymentQuote {
  open: boolean; status?: string; loan_no?: string; date?: string; kind?: 'Installment' | 'Closure';
  principal?: number; interest?: number; calcInterest?: number; amount?: number; completed?: number[]; closes?: boolean; waivedInterest?: number;
  suggestedPenalty?: number; nextDueAmount?: number; nextDueDate?: string | null; overdueAmount?: number; overdueCount?: number;
  outstanding?: number; remainingPayable?: number; outstandingAfter?: number;
}
export interface LoanInput {
  member_id: number; principal: number; method: LoanMethod; annual_rate: number; term_months: number;
  disbursed_date: string; first_due_date?: string; payment_method: string; reference?: string; purpose?: string; notes?: string; limit_note?: string;
  /** a guarantor is mandatory: a fund member, or an outsider with name, address and NID */
  guarantor_type: 'member' | 'outsider'; guarantor_member_id?: number; guarantor_name?: string; guarantor_address?: string; guarantor_nid?: string; guarantor_phone?: string; guarantor_relation?: string;
}

/** A loan draft: terms and guarantor are fixed and printed on the consent paper; no money has moved yet. */
export interface LoanApplication {
  id: number; app_no: string; member_id: number; member_code: string; member_name: string; member_name_bn?: string | null; avatar_initials?: string; member_phone?: string | null;
  principal: number; method: LoanMethod; annual_rate: number; term_months: number; disbursed_date: string; first_due_date: string;
  installment: number; total_interest: number; total_payable: number; payment_method?: string | null; reference?: string | null; purpose?: string | null; notes?: string | null; limit_note?: string | null;
  guarantor?: string | null; guarantor_type?: 'member' | 'outsider' | null; guarantor_member_id?: number | null; guarantor_name?: string | null; guarantor_address?: string | null; guarantor_nid?: string | null;
  guarantor_phone?: string | null; guarantor_relation?: string | null; guarantor_member_code?: string | null; guarantor_member_name?: string | null;
  consent_file?: string | null; consent_name?: string | null; consent_size?: number | null; consent_uploaded_at?: string | null;
  status: 'Draft' | 'Activated'; loan_id?: number | null; created_at: string; has_consent: boolean; consent_file_exists: boolean; age_days: number;
}
export interface LoanApplicationDetail {
  application: LoanApplication; guarantor: GuarantorInfo | null; consentRequired: boolean;
  plan: { rows: LoanPlanRow[]; installment: number; lastInstallment: number; totalInterest: number; totalPayable: number; effectiveRate: number };
  warnings: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
  member: { id: number; member_code: string; name: string; name_bn?: string | null; nid?: string | null; phone?: string | null; status: string; savings: number; owed: number };
}

// Google account sync & Drive backup ----------------------------------------------------------
export interface GoogleStatus {
  configured: boolean; clientSource: 'app' | 'build' | null; canConfigure: boolean; secureStorage: boolean;
  account: { email: string; name: string; picture: string } | null; device: string; hasPin: boolean;
  sync: { lastSyncAt: string | null; lastRev: number; dirty: boolean; dirtyAt: string | null; auto: boolean; encrypt: boolean; lastResult: string | null };
}
export type SyncOutcome = 'up-to-date' | 'pushed' | 'pulled' | 'conflict' | 'needs-pin' | 'nothing' | 'wrong-pin';
export interface SyncCounts { members?: number; collections?: number; expenses?: number; investments?: number; loans?: number; drafts?: number; users?: number }
export interface SyncResult {
  status: SyncOutcome; message: string; revision?: number; replaced?: boolean;
  conflict?: { local: { dirtyAt: string | null; counts: SyncCounts }; remote: { at: string; deviceName: string; revision: number; counts: SyncCounts } };
}
export interface RemoteCheck { remote: { revision: number; at: string; deviceName: string; counts: SyncCounts; encrypted: boolean; mine: boolean } | null; remoteNewer: boolean; localDirty: boolean }
export interface DriveBackupItem { id: string; name: string; size: number; at: string; device: string; encrypted: boolean }

// Software licence (activation PIN, monthly payments, remote lock) ---------------------------------
export type LockReason = 'none' | 'not_activated' | 'suspended' | 'revoked' | 'expired' | 'needs_check' | 'invalid' | 'not_registered' | 'not_allowed';
export interface LicenseView {
  enforced: boolean; configured: boolean; locked: boolean; reason: LockReason; message: string;
  scope: 'user' | 'computer' | null; username: string;
  customer: string; paidUntil: string | null; daysLeft: number | null; status: 'active' | 'suspended' | 'revoked' | null;
  installId: string; lastCheckAt: number | null; lastError: string | null;
}
export interface LicenseRecord {
  id: string; customer: string; username: string | null; contact: string | null; notes: string | null; pin: string; pin_display: string; status: 'active' | 'suspended' | 'revoked';
  paid_until: string | null; monthly_fee: number; message: string | null; max_devices: number; max_users: number | null; restrict_users: boolean; created_at: string;
  devices: LicenseDevice[]; users: LicenseUser[];
}
export interface LicenseDevice { id: string; license_id: string; install_id: string; device_name: string | null; app_version: string | null; last_user: string | null; first_seen: string; last_seen: string }
export interface LicenseUser { id: string; license_id: string; username: string; note: string | null; first_seen: string; last_seen: string | null }
export interface LicensePayment { id: string; license_id: string; amount: number; months: number; days: number; paid_on: string; method: string | null; note: string | null; period_from: string | null; period_to: string | null; created_at: string }
export interface LicenseAdminState { configured: boolean; enforced: boolean; url: string; account: string | null }

// Fines ---------------------------------------------------------------------------------------------
export interface FineRow {
  key: string; source: 'contribution' | 'loan'; id: number; date: string; month: string; due_date: string | null; days_late: number | null; amount: number; base: number;
  method: string | null; trx_id: string; note: string; member_id: number; member_code: string; name: string; name_bn: string | null; label: string; flag: 'ok' | 'on_time';
}
export interface FundBooks {
  fundBalance: number; cashInHand: number; owedToMembers: number; members: number; reserve: number;
  parts: { fines: number; penalties: number; expenses: number; settlementAdjustment: number; unshared: number };
  explained: number; residual: number; balanced: boolean; drift: Array<{ member_code: string; name: string; stored: number; now: number }>;
}
export interface FineRegister {
  filters: { start_date: string | null; end_date: string | null; member_id: number | null; source: string };
  rows: FineRow[];
  totals: { total: number; contribution: number; loan: number; count: number; members: number; onTime: number; average: number };
  overall: { contribution: number; loan: number; total: number; thisMonth: number; thisYear: number; count: number; rate: number; dueDay: number };
  byMonth: Array<{ month: string; contribution: number; loan: number; total: number; count: number }>;
  byMember: Array<{ member_id: number; member_code: string; name: string; name_bn: string | null; count: number; total: number; last_date: string }>;
  lateNoFine: { count: number; potential: number; rows: Array<{ id: number; date: string; month: string; due_date: string; days_late: number; amount: number; member_id: number; member_code: string; name: string; name_bn: string | null }> };
  overdueNow: { count: number; potential: number; rows: Array<{ member_id: number; member_code: string; name: string; name_bn: string | null; months: number; owed: number; fine_if_paid_today: number }> };
  books: FundBooks;
}
