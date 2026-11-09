export type PaymentStatus = 'Paid' | 'Pending' | 'Overdue';
export type InvestmentStatus = 'Growing' | 'Review' | 'Sold';
export type ExpenseStatus = 'Verified' | 'Needs receipt';
export type UserRole = 'Treasurer' | 'Admin' | 'Auditor' | 'Manager';
export type UserStatus = 'Active' | 'Inactive';

export type NavTab =
  | 'overview'
  | 'members'
  | 'collections'
  | 'investments'
  | 'returns'
  | 'loans'
  | 'expenses'
  | 'entry'
  | 'master'
  | 'users'
  | 'backup'
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
  created_at?: string;
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
  type: 'collection' | 'expense' | 'investment' | 'sale' | 'return' | 'settlement' | 'loan' | 'loan_repayment';
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
export interface SessionInfo {
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
}
export interface LoanPlanRow { no: number; due_date: string; principal: number; interest: number; total: number; balance: number }
export interface LoanTermOption { term: number; installment: number; totalInterest: number; totalPayable: number; effectiveRate: number }
export interface LoanPreview {
  valid: boolean; error?: string;
  terms?: { principal: number; method: LoanMethod; annual_rate: number; term_months: number; first_due_date: string; disbursed_date: string };
  plan?: { rows: LoanPlanRow[]; installment: number; lastInstallment: number; totalInterest: number; totalPayable: number; effectiveRate: number };
  options?: LoanTermOption[];
  warnings?: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
  cash?: number;
  member?: { id: number; member_code: string; name: string; status: string; monthly_due: number; savings: number; owed: number; limit: number | null; multiple: number; available: number | null; overdueLoans: number } | null;
}
export interface LoanInstallment { no: number; due_date: string; principal: number; interest: number; total: number; paid: number; status: 'Paid' | 'Partial' | 'Due' | 'Overdue' | 'Waived' | 'Written off'; balance_after: number }
export interface LoanRepayment {
  id: number; loan_id: number; paid_date: string; kind: 'Installment' | 'Closure';
  principal_paid: number; interest_paid: number; penalty_paid: number; total_paid: number;
  payment_method?: string | null; trx_id?: string | null; note?: string | null; created_by?: string | null;
}
export interface LoanDetail {
  loan: Loan; schedule: LoanInstallment[]; repayments: LoanRepayment[]; latestRepaymentId: number | null;
  member: { id: number; member_code: string; name: string; name_bn?: string | null; avatar_initials?: string; phone?: string; monthly_due: number; status: string; savings: number; owed: number };
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
  disbursed_date: string; first_due_date?: string; payment_method: string; reference?: string; purpose?: string; guarantor?: string; notes?: string; limit_note?: string;
}
