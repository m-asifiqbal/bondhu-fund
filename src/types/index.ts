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
  last_backup_date: string;
  active_user_id: number;
  fiscal_year_start_month?: number;
  auto_backup_enabled?: boolean;
  auto_backup_keep?: number;
  organization_name_bn?: string;
  /** data:image/... logo, '' when unset */
  org_logo?: string;
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
  type: 'collection' | 'expense' | 'investment' | 'sale' | 'return' | 'settlement';
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
    cashInHand: number; prevCashInHand: number; lifetimeCollected: number; totalExpenses: number; realizedGain: number;
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
  recent: Array<{ kind: 'collection' | 'expense' | 'investment' | 'member' | 'return' | 'settlement'; id: number; title: string; sub: string; amount: number; date: string; created_at: string }>;
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
  row: number; code: string; name: string; name_bn: string; phone: string; email: string; designation: string; status: string;
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
