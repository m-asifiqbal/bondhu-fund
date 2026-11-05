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
  | 'expenses'
  | 'entry'
  | 'master'
  | 'users'
  | 'backup'
  | 'reports'
  | 'settings';

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
  current_month_status?: PaymentStatus;
}

export interface CollectionRecord {
  id: number;
  member_id: number;
  member_name?: string;
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
}

export interface MasterCategory {
  id: number;
  type: 'expense_category' | 'investment_sector' | 'payment_method';
  name: string;
  description?: string;
  is_active: number; // 1 or 0
}

export interface BackupRecord {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  backup_type: 'Manual' | 'Pre-Restore' | 'Automatic';
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
}
