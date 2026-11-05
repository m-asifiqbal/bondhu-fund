import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Users,
  TrendingUp,
  Receipt,
  Database,
  Clock,
  Layers,
  SlidersHorizontal,
  Search,
  RotateCcw,
  Table,
  Coins,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getMembers,
  getCollections,
  getInvestments,
  getExpenses,
  getMemberHistory,
  getOverviewMetrics,
  matchesDateRange,
} from '../services/db';
import { Member, CollectionRecord, Investment, Expense } from '../types';
import { MonthPicker } from '../components/common/MonthPicker';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';

type EntityType = 'collections' | 'members' | 'expenses' | 'investments';

interface ColumnDef {
  key: string;
  label: string;
  default: boolean;
}

const ENTITY_COLUMNS: Record<EntityType, ColumnDef[]> = {
  collections: [
    { key: 'member_code', label: 'Member ID', default: true },
    { key: 'member_name', label: 'Member Name', default: true },
    { key: 'payment_month', label: 'Month', default: true },
    { key: 'due_date', label: 'Due Date', default: false },
    { key: 'payment_date', label: 'Payment Date', default: true },
    { key: 'contribution_amount', label: 'Contribution (TK)', default: true },
    { key: 'late_fee', label: 'Late Fee (TK)', default: true },
    { key: 'total_amount', label: 'Total (TK)', default: true },
    { key: 'status', label: 'Status', default: true },
    { key: 'payment_method', label: 'Method', default: false },
    { key: 'trx_id', label: 'TRX ID', default: true },
    { key: 'note', label: 'Note', default: false },
  ],
  members: [
    { key: 'member_code', label: 'Member Code', default: true },
    { key: 'name', label: 'Full Name', default: true },
    { key: 'phone', label: 'Phone', default: true },
    { key: 'email', label: 'Email', default: false },
    { key: 'status', label: 'Status', default: true },
    { key: 'monthly_due', label: 'Monthly Due (TK)', default: true },
    { key: 'join_date', label: 'Join Date', default: true },
    { key: 'total_contributed', label: 'Lifetime Contributed (TK)', default: true },
  ],
  expenses: [
    { key: 'title', label: 'Expense Title', default: true },
    { key: 'category', label: 'Category', default: true },
    { key: 'amount', label: 'Amount (TK)', default: true },
    { key: 'expense_date', label: 'Date', default: true },
    { key: 'payee', label: 'Disbursed To', default: true },
    { key: 'receipt_ref', label: 'Receipt Ref', default: true },
    { key: 'status', label: 'Audit Status', default: true },
    { key: 'notes', label: 'Notes', default: false },
  ],
  investments: [
    { key: 'name', label: 'Asset Name', default: true },
    { key: 'sector', label: 'Sector', default: true },
    { key: 'purchase_date', label: 'Purchase Date', default: true },
    { key: 'invested_amount', label: 'Invested Cost (TK)', default: true },
    { key: 'current_estimated_value', label: 'Current Value (TK)', default: true },
    { key: 'gain_loss', label: 'Unrealized Gain (TK)', default: true },
    { key: 'status', label: 'Status', default: true },
    { key: 'review_date', label: 'Review Date', default: false },
    { key: 'location_details', label: 'Location Details', default: false },
    { key: 'notes', label: 'Notes', default: false },
  ],
};

export const ReportsView: React.FC = () => {
  const { showToast, selectedMonth, language, t, formatCurrency, toBanglaDigits } = useApp();

  // State for all data
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<number>(1);
  const [reportDate, setReportDate] = useState('28 Jun 2024');
  const [reportMonth, setReportMonth] = useState('June 2024');
  const [fiscalYear, setFiscalYear] = useState('2024');
  const [expenseCategory, setExpenseCategory] = useState('All');

  const memberOptions: SelectOption[] = members.map(m => ({
    value: m.id,
    label: m.name,
    subLabel: m.phone,
    badge: m.member_code,
    badgeColor: 'bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300',
  }));

  // Custom Report Builder States
  const [customEntity, setCustomEntity] = useState<EntityType>('collections');
  const [customSearch, setCustomSearch] = useState('');
  const [customStatus, setCustomStatus] = useState('All');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Record<string, boolean>>({});

  // Raw dataset cache for dynamic preview
  const [rawCollections, setRawCollections] = useState<CollectionRecord[]>([]);
  const [rawMembers, setRawMembers] = useState<Member[]>([]);
  const [rawExpenses, setRawExpenses] = useState<Expense[]>([]);
  const [rawInvestments, setRawInvestments] = useState<Investment[]>([]);

  useEffect(() => {
    getMembers('', 'All', 1, 100).then(res => {
      setMembers(res.members);
      setRawMembers(res.members);
      if (res.members.length > 0) setSelectedMemberId(res.members[0].id);
    });
    getCollections(selectedMonth, 'All').then(res => setRawCollections(res.records));
    getExpenses().then(setRawExpenses);
    getInvestments().then(setRawInvestments);
  }, [selectedMonth]);

  // Sync columns when entity changes
  useEffect(() => {
    const defaultCols: Record<string, boolean> = {};
    ENTITY_COLUMNS[customEntity].forEach(col => {
      defaultCols[col.key] = col.default;
    });
    setSelectedColumns(defaultCols);
  }, [customEntity]);

  // Compute filtered dataset for custom report builder
  const customDataset = useMemo(() => {
    switch (customEntity) {
      case 'collections': {
        return rawCollections.filter(item => {
          if (customStatus !== 'All' && item.status !== customStatus) return false;
          if (customStartDate || customEndDate) {
            if (!matchesDateRange(item.payment_date, customStartDate, customEndDate)) return false;
          }
          if (customSearch) {
            const q = customSearch.toLowerCase();
            const matches =
              item.member_name.toLowerCase().includes(q) ||
              (item.member_code && item.member_code.toLowerCase().includes(q)) ||
              (item.trx_id && item.trx_id.toLowerCase().includes(q));
            if (!matches) return false;
          }
          return true;
        });
      }
      case 'members': {
        return rawMembers.filter(item => {
          if (customStatus !== 'All' && item.status !== customStatus) return false;
          if (customStartDate || customEndDate) {
            if (!matchesDateRange(item.join_date, customStartDate, customEndDate)) return false;
          }
          if (customSearch) {
            const q = customSearch.toLowerCase();
            const matches =
              item.name.toLowerCase().includes(q) ||
              item.member_code.toLowerCase().includes(q) ||
              item.phone.toLowerCase().includes(q);
            if (!matches) return false;
          }
          return true;
        });
      }
      case 'expenses': {
        return rawExpenses.filter(item => {
          if (customStatus !== 'All' && item.status !== customStatus) return false;
          if (customStartDate || customEndDate) {
            if (!matchesDateRange(item.expense_date, customStartDate, customEndDate)) return false;
          }
          if (customSearch) {
            const q = customSearch.toLowerCase();
            const matches =
              item.title.toLowerCase().includes(q) ||
              item.payee.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q) ||
              item.receipt_ref.toLowerCase().includes(q);
            if (!matches) return false;
          }
          return true;
        });
      }
      case 'investments': {
        return rawInvestments.filter(item => {
          if (customStatus !== 'All' && item.status !== customStatus) return false;
          if (customStartDate || customEndDate) {
            if (!matchesDateRange(item.purchase_date, customStartDate, customEndDate)) return false;
          }
          if (customSearch) {
            const q = customSearch.toLowerCase();
            const matches =
              item.name.toLowerCase().includes(q) ||
              item.sector.toLowerCase().includes(q) ||
              (item.location_details && item.location_details.toLowerCase().includes(q));
            if (!matches) return false;
          }
          return true;
        });
      }
      default:
        return [];
    }
  }, [customEntity, rawCollections, rawMembers, rawExpenses, rawInvestments, customStatus, customStartDate, customEndDate, customSearch]);

  const triggerDownload = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded: ${fileName}`);
  };

  // 1. Day-wise Report
  const handleDownloadDayWise = async () => {
    showToast(`Generating Daily Ledger Report for ${reportDate}...`);
    const collRes = await getCollections(selectedMonth, 'All');
    const allExpenses = await getExpenses();

    const dayCollections = collRes.records.filter(r =>
      r.payment_date?.toLowerCase().includes(reportDate.toLowerCase())
    );
    const dayExpenses = allExpenses.filter(e =>
      e.expense_date?.toLowerCase().includes(reportDate.toLowerCase())
    );

    const totalCollected = dayCollections.reduce((sum, r) => sum + r.contribution_amount + r.late_fee, 0);
    const totalExp = dayExpenses.reduce((sum, e) => sum + e.amount, 0);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `DAILY TRANSACTION & AUDIT REPORT FOR: "${reportDate}"`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Total Collections: TK ${totalCollected.toLocaleString()}`,
      `Total Operating Expenses: TK ${totalExp.toLocaleString()}`,
      `Net Daily Movement: TK ${(totalCollected - totalExp).toLocaleString()}`,
      ``,
      `--- MONEY RECEIVED (COLLECTIONS) ---`,
      `Member ID,Member Name,Payment Month,Due Date,Payment Date,Contribution (TK),Late Fee (TK),Total (TK),Method,TRX ID,Status,Notes`,
    ];

    if (dayCollections.length > 0) {
      dayCollections.forEach(r => {
        lines.push(
          `"${r.member_code || ''}","${r.member_name || ''}","${r.payment_month}","${r.due_date}","${r.payment_date}",${r.contribution_amount},${r.late_fee},${r.contribution_amount + r.late_fee},"${r.payment_method}","${r.trx_id}","${r.status}","${r.note || ''}"`
        );
      });
    } else {
      lines.push(`"No payments recorded for this date."`);
    }

    lines.push(``);
    lines.push(`--- OPERATING EXPENSES DISBURSED ---`);
    lines.push(`Expense Title,Category,Amount (TK),Expense Date,Payee,Receipt Voucher,Status,Notes`);

    if (dayExpenses.length > 0) {
      dayExpenses.forEach(e => {
        lines.push(
          `"${e.title}","${e.category}",${e.amount},"${e.expense_date}","${e.payee}","${e.receipt_ref}","${e.status}","${e.notes || ''}"`
        );
      });
    } else {
      lines.push(`"No expenses recorded for this date."`);
    }

    triggerDownload(`BondhuFund_Day_Report_${reportDate.replace(/\s+/g, '_')}.csv`, lines.join('\n'));
  };

  // 2. Month-wise Report
  const handleDownloadMonthWise = async () => {
    showToast(`Generating Monthly Financial Statement for ${reportMonth}...`);
    const collRes = await getCollections(reportMonth, 'All');
    const allExpenses = await getExpenses();
    const monthExpenses = allExpenses.filter(e =>
      e.expense_date?.toLowerCase().includes(reportMonth.toLowerCase().split(' ')[0].toLowerCase())
    );

    const totalCollected = collRes.stats.collectedAmount;
    const totalLateFees = collRes.stats.lateFeeAmount;
    const totalDuesExpected = collRes.stats.expectedAmount;
    const totalExpenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `MONTHLY FINANCIAL LEDGER STATEMENT: "${reportMonth}"`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Total Members Enrolled: ${collRes.stats.totalMembers}`,
      `Paid Members: ${collRes.stats.paidCount} | Pending: ${collRes.stats.pendingCount} | Overdue: ${collRes.stats.overdueCount}`,
      `Collection Rate: ${collRes.stats.percentage}%`,
      `Total Expected Dues: TK ${totalDuesExpected.toLocaleString()}`,
      `Total Collected: TK ${totalCollected.toLocaleString()}`,
      `Total Late Penalty Fees: TK ${totalLateFees.toLocaleString()}`,
      `Total Operating Expenses: TK ${totalExpenses.toLocaleString()}`,
      `Net Monthly Surplus: TK ${(totalCollected + totalLateFees - totalExpenses).toLocaleString()}`,
      ``,
      `Member Code,Member Name,Payment Month,Due Date,Payment Date,Contribution (TK),Late Fee (TK),Total Paid (TK),Status,Method,Transaction ID,Note`,
    ];

    collRes.records.forEach(r => {
      lines.push(
        `"${r.member_code || ''}","${r.member_name || ''}","${r.payment_month}","${r.due_date}","${r.payment_date || '-'}",${r.contribution_amount},${r.late_fee},${r.total_amount || (r.contribution_amount + r.late_fee)},"${r.status}","${r.payment_method}","${r.trx_id || '-'}","${r.note || ''}"`
      );
    });

    triggerDownload(`BondhuFund_Monthly_Ledger_${reportMonth.replace(/\s+/g, '_')}.csv`, lines.join('\n'));
  };

  // 3. Year-wise Report
  const handleDownloadYearWise = async () => {
    showToast(`Generating Annual Financial Report for Year ${fiscalYear}...`);
    const membersRes = await getMembers('', 'All', 1, 100);
    const investments = await getInvestments();
    const expenses = await getExpenses();

    const totalContributed = membersRes.members.reduce((s, m) => s + (m.total_contributed || 0), 0);
    const totalInvested = investments.reduce((s, i) => s + i.invested_amount, 0);
    const currentEstValue = investments.reduce((s, i) => s + i.current_estimated_value, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `ANNUAL CONSOLIDATED FINANCIAL REPORT (FISCAL YEAR ${fiscalYear})`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Total Active Members: ${membersRes.total}`,
      `Total Member Lifetime Equity/Savings: TK ${totalContributed.toLocaleString()}`,
      `Total Invested Portfolio Capital: TK ${totalInvested.toLocaleString()}`,
      `Current Portfolio Market Valuation: TK ${currentEstValue.toLocaleString()}`,
      `Net Unrealized Asset Appreciation: TK ${(currentEstValue - totalInvested).toLocaleString()}`,
      `Total Operational Expenses: TK ${totalExpenses.toLocaleString()}`,
      `Consolidated Net Fund Worth: TK ${(totalContributed + (currentEstValue - totalInvested) - totalExpenses).toLocaleString()}`,
      ``,
      `--- MEMBER CONTRIBUTION ROSTER ---`,
      `Member ID,Member Name,Phone,Email,Status,Monthly Due (TK),Join Date,Lifetime Contributed (TK)`,
    ];

    membersRes.members.forEach(m => {
      lines.push(
        `"${m.member_code}","${m.name}","${m.phone}","${m.email}","${m.status}",${m.monthly_due},"${m.join_date}",${m.total_contributed}`
      );
    });

    lines.push(``);
    lines.push(`--- INVESTMENT PORTFOLIO ASSETS ---`);
    lines.push(`Asset Name,Sector,Purchase Date,Invested Cost (TK),Market Valuation (TK),Unrealized Gain (TK),Status,Review Date`);

    investments.forEach(i => {
      lines.push(
        `"${i.name}","${i.sector}","${i.purchase_date}",${i.invested_amount},${i.current_estimated_value},${i.gain_loss},"${i.status}","${i.review_date || '-'}"`
      );
    });

    triggerDownload(`BondhuFund_Annual_Financial_Report_${fiscalYear}.csv`, lines.join('\n'));
  };

  // 4. Member-wise Report
  const handleDownloadMemberWise = async () => {
    const targetMember = members.find(m => m.id === selectedMemberId) || members[0];
    if (!targetMember) return;

    showToast(`Generating Ledger Statement for ${targetMember.name}...`);
    const history = await getMemberHistory(targetMember.id);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `INDIVIDUAL MEMBER AUDIT STATEMENT: "${targetMember.name.toUpperCase()}"`,
      `Member ID: ${targetMember.member_code}`,
      `Phone: ${targetMember.phone}`,
      `Email: ${targetMember.email}`,
      `Enrolled Since: ${targetMember.join_date}`,
      `Monthly Obligation: TK ${targetMember.monthly_due.toLocaleString()}`,
      `Lifetime Contributed: TK ${targetMember.total_contributed.toLocaleString()}`,
      `Current Standing: ${targetMember.current_month_status || 'Active'}`,
      `Generated On: ${new Date().toLocaleString()}`,
      ``,
      `Payment Month,Due Date,Payment Date,Contribution (TK),Late Fine (TK),Total Paid (TK),Payment Method,Transaction ID,Status,Notes`,
    ];

    if (history.length > 0) {
      history.forEach(r => {
        lines.push(
          `"${r.payment_month}","${r.due_date}","${r.payment_date || 'Awaiting Payment'}",${r.contribution_amount},${r.late_fee},${r.total_amount || (r.contribution_amount + r.late_fee)},"${r.payment_method}","${r.trx_id || '-'}","${r.status}","${r.note || ''}"`
        );
      });
    } else {
      lines.push(`"No past payment records registered."`);
    }

    triggerDownload(
      `BondhuFund_Member_${targetMember.member_code}_${targetMember.name.replace(/\s+/g, '_')}.csv`,
      lines.join('\n')
    );
  };

  // 5. Investment Report
  const handleDownloadInvestments = async () => {
    showToast('Exporting Investment Portfolio Valuation Audit...');
    const investments = await getInvestments();
    const totalCost = investments.reduce((s, i) => s + i.invested_amount, 0);
    const totalVal = investments.reduce((s, i) => s + i.current_estimated_value, 0);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `INVESTMENT PORTFOLIO VALUATION REPORT`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Total Assets Held: ${investments.length}`,
      `Total Capital Invested: TK ${totalCost.toLocaleString()}`,
      `Total Current Market Value: TK ${totalVal.toLocaleString()}`,
      `Total Unrealized Capital Gain: TK ${(totalVal - totalCost).toLocaleString()}`,
      ``,
      `Asset Name,Sector,Purchase Date,Invested Cost (TK),Estimated Valuation (TK),Capital Gain (TK),Status,Review Schedule,Location Details,Notes`,
    ];

    investments.forEach(i => {
      lines.push(
        `"${i.name}","${i.sector}","${i.purchase_date}",${i.invested_amount},${i.current_estimated_value},${i.gain_loss},"${i.status}","${i.review_date || '-'}","${i.location_details || '-'}","${i.notes || ''}"`
      );
    });

    triggerDownload(`BondhuFund_Investment_Portfolio_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  };

  // 6. Expenses Report
  const handleDownloadExpenses = async () => {
    showToast('Exporting Operating Expenses Audit Log...');
    const expenses = await getExpenses(expenseCategory);
    const totalExp = expenses.reduce((s, e) => s + e.amount, 0);

    const lines: string[] = [
      `BONDHU FUND - UNION FINANCE DESK`,
      `OPERATING EXPENSES DISBURSEMENT AUDIT (CATEGORY: ${expenseCategory})`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Total Transactions: ${expenses.length}`,
      `Total Disbursed: TK ${totalExp.toLocaleString()}`,
      ``,
      `Expense Title,Category,Amount (TK),Date,Payee / Vendor,Receipt Voucher Ref,Audit Status,Notes`,
    ];

    expenses.forEach(e => {
      lines.push(
        `"${e.title}","${e.category}",${e.amount},"${e.expense_date}","${e.payee}","${e.receipt_ref || '-'}","${e.status}","${e.notes || ''}"`
      );
    });

    triggerDownload(`BondhuFund_Operating_Expenses_${expenseCategory}_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  };

  // 7. Full SQLite Database Master Dump
  const handleDownloadFullDatabaseReport = async () => {
    showToast('Compiling Full Master Audit Dump across entire SQLite database...');
    const metrics = await getOverviewMetrics(selectedMonth);
    const membersRes = await getMembers('', 'All', 1, 100);
    const collRes = await getCollections(selectedMonth, 'All');
    const investments = await getInvestments();
    const expenses = await getExpenses();

    const lines: string[] = [
      `================================================================================`,
      `BONDHU FUND - UNION FINANCE DESK (COMPLETE MASTER AUDIT DUMP)`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Fund Balance: TK ${metrics.total_fund_balance.toLocaleString()}`,
      `Invested Assets: TK ${metrics.invested_assets.toLocaleString()}`,
      `Active Members: ${metrics.active_members}`,
      `================================================================================`,
      ``,
      `[SECTION 1: MEMBERS REGISTRY]`,
      `Member ID,Name,Phone,Email,Status,Monthly Due,Join Date,Total Contributed`,
    ];

    membersRes.members.forEach(m => {
      lines.push(`"${m.member_code}","${m.name}","${m.phone}","${m.email}","${m.status}",${m.monthly_due},"${m.join_date}",${m.total_contributed}`);
    });

    lines.push(``);
    lines.push(`[SECTION 2: COLLECTIONS LEDGER - ${selectedMonth}]`);
    lines.push(`Member ID,Member Name,Month,Due Date,Payment Date,Contribution,Late Fee,Total,Status,Method,TRX ID,Note`);

    collRes.records.forEach(r => {
      lines.push(`"${r.member_code}","${r.member_name}","${r.payment_month}","${r.due_date}","${r.payment_date || '-'}",${r.contribution_amount},${r.late_fee},${r.total_amount || (r.contribution_amount + r.late_fee)},"${r.status}","${r.payment_method}","${r.trx_id || '-'}","${r.note || ''}"`);
    });

    lines.push(``);
    lines.push(`[SECTION 3: INVESTMENTS]`);
    lines.push(`Name,Sector,Purchase Date,Invested,Valuation,Gain,Status,Review Date`);

    investments.forEach(i => {
      lines.push(`"${i.name}","${i.sector}","${i.purchase_date}",${i.invested_amount},${i.current_estimated_value},${i.gain_loss},"${i.status}","${i.review_date || '-'}"`);
    });

    lines.push(``);
    lines.push(`[SECTION 4: EXPENSES]`);
    lines.push(`Title,Category,Amount,Date,Payee,Receipt Voucher,Status`);

    expenses.forEach(e => {
      lines.push(`"${e.title}","${e.category}",${e.amount},"${e.expense_date}","${e.payee}","${e.receipt_ref || '-'}","${e.status}"`);
    });

    triggerDownload(`BondhuFund_Master_Audit_Dump_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet size={24} className="text-[#0f4a3c] dark:text-emerald-400" />
            <span>Reports & Data Export Center</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Download comprehensive financial reports in universal CSV format for Day, Month, Year, and Member-wise audits.
          </p>
        </div>

        {/* Master Export Button */}
        <button
          onClick={handleDownloadFullDatabaseReport}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
        >
          <Database size={15} />
          <span>Full Master Audit Export (CSV)</span>
        </button>
      </div>

      {/* Grid of Report Generators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Card 1: Day-wise Report */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center mb-3 border border-emerald-200 dark:border-emerald-800">
              <Clock size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Day-wise Daily Ledger</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Detailed breakdown of all money received and operating expenses disbursed on a specific calendar date.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="form-label">Select / Enter Date</label>
              <input
                type="text"
                value={reportDate}
                onChange={e => setReportDate(e.target.value)}
                placeholder="e.g. 28 Jun 2024"
                className="form-input"
              />
            </div>

            <button
              onClick={handleDownloadDayWise}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Day Report (.csv)</span>
            </button>
          </div>
        </div>

        {/* Card 2: Month-wise Report */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center mb-3 border border-amber-200 dark:border-amber-800">
              <Calendar size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Month-wise Ledger Statement</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Complete monthly balance sheet with expected contributions, collections, late fees, and expenses.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="form-label mb-1.5 block">
                {language === 'bn' ? 'মাস নির্বাচন করুন' : 'Select Month'}
              </label>
              <MonthPicker
                value={reportMonth}
                onChange={setReportMonth}
                align="left"
                className="w-full"
              />
            </div>

            <button
              onClick={handleDownloadMonthWise}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Month Report (.csv)</span>
            </button>
          </div>
        </div>

        {/* Card 3: Year-wise Report */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 flex items-center justify-center mb-3 border border-blue-200 dark:border-blue-800">
              <Layers size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Fiscal Year-wise Annual Summary</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Annual consolidated audit across all 48 members, all asset holdings, total returns, and operational costs.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="form-label">Select Fiscal Year</label>
              <select
                value={fiscalYear}
                onChange={e => setFiscalYear(e.target.value)}
                className="form-select font-semibold"
              >
                <option value="2024">Fiscal Year 2024</option>
                <option value="2023">Fiscal Year 2023</option>
                <option value="2025">Fiscal Year 2025 (Forecast)</option>
              </select>
            </div>

            <button
              onClick={handleDownloadYearWise}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Annual Audit (.csv)</span>
            </button>
          </div>
        </div>

        {/* Card 4: Member-wise Individual Statement */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 flex items-center justify-center mb-3 border border-purple-200 dark:border-purple-800">
              <Users size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Member-wise Ledger Statement</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Export the full lifetime payment history, total contributions, and overdue standing for a specific member.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <SearchableSelect
                label={language === 'bn' ? 'সদস্য নির্বাচন করুন' : 'Select Member'}
                required
                options={memberOptions}
                value={selectedMemberId}
                onChange={val => setSelectedMemberId(Number(val))}
                placeholder={language === 'bn' ? 'সদস্য খুঁজুন...' : 'Search member...'}
              />
            </div>

            <button
              onClick={handleDownloadMemberWise}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Member Statement (.csv)</span>
            </button>
          </div>
        </div>

        {/* Card 5: Investment Portfolio Valuation */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center mb-3 border border-emerald-200 dark:border-emerald-800">
              <TrendingUp size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Investment Portfolio Report</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Export all active properties, plots, and assets with original cost basis, latest market values, and gains.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Includes Land purchase, Flat purchase, Plot purchase & Assets.</p>
            <button
              onClick={handleDownloadInvestments}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Portfolio Valuation (.csv)</span>
            </button>
          </div>
        </div>

        {/* Card 6: Operating Expenses Report */}
        <div className="card-base p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 flex items-center justify-center mb-3 border border-rose-200 dark:border-rose-800">
              <Receipt size={20} />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Operating Expenses Audit</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Export all operating disbursements with voucher references, payees, audit verification flags, and notes.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="form-label">Expense Category</label>
              <select
                value={expenseCategory}
                onChange={e => setExpenseCategory(e.target.value)}
                className="form-select font-semibold"
              >
                <option value="All">All Categories</option>
                <option value="Meetup & Events">Meetup & Events</option>
                <option value="Office Supplies">Office Supplies</option>
                <option value="Legal & Documentation">Legal & Documentation</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </div>

            <button
              onClick={handleDownloadExpenses}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download Expenses Audit (.csv)</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* ADVANCED CUSTOM REPORT BUILDER & DYNAMIC EXPORTER         */}
      {/* ========================================================= */}
      <div className="card-base p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-[#0f4a3c] dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-800">
                <SlidersHorizontal size={16} />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Custom Report Builder & Exporter</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Select data model, apply dynamic date ranges & filters, select specific columns, and preview live before exporting.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              {customDataset.length} records matching
            </span>
            <button
              onClick={() => {
                const activeCols = ENTITY_COLUMNS[customEntity].filter(c => selectedColumns[c.key]);
                if (activeCols.length === 0) {
                  showToast('Please select at least one column for the custom report.', 'error');
                  return;
                }
                if (customDataset.length === 0) {
                  showToast('No records match your criteria to export.', 'error');
                  return;
                }

                const header = activeCols.map(c => `"${c.label}"`).join(',');
                const rows = customDataset.map(item => {
                  return activeCols
                    .map(c => {
                      let val = (item as any)[c.key];
                      if (val === undefined || val === null) val = '';
                      if (typeof val === 'number') return val;
                      return `"${String(val).replace(/"/g, '""')}"`;
                    })
                    .join(',');
                });

                const lines = [
                  `BONDHU FUND - CUSTOM ${customEntity.toUpperCase()} REPORT`,
                  `Export Timestamp: ${new Date().toLocaleString()}`,
                  `Total Filtered Records: ${customDataset.length}`,
                  ...(customStartDate || customEndDate ? [`Date Range: ${customStartDate || 'Start'} to ${customEndDate || 'Current'}`] : []),
                  ...(customStatus !== 'All' ? [`Status Filter: ${customStatus}`] : []),
                  ``,
                  header,
                  ...rows,
                ];

                const entityName = customEntity.charAt(0).toUpperCase() + customEntity.slice(1);
                triggerDownload(`BondhuFund_Custom_${entityName}_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
            >
              <Download size={14} />
              <span>Download Custom CSV</span>
            </button>
          </div>
        </div>

        {/* Step 1: Entity Selector Tabs */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Step 1: Choose Data Entity
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { id: 'collections' as EntityType, name: 'Collections & Dues', desc: 'Monthly member fee records', icon: Coins },
              { id: 'members' as EntityType, name: 'Member Registry', desc: 'Accounts & total savings', icon: Users },
              { id: 'expenses' as EntityType, name: 'Operating Expenses', desc: 'Disbursements & vouchers', icon: Receipt },
              { id: 'investments' as EntityType, name: 'Investment Assets', desc: 'Land, flats & valuations', icon: TrendingUp },
            ].map(tab => {
              const Icon = tab.icon || Table;
              const isSelected = customEntity === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCustomEntity(tab.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-[#0f4a3c] dark:border-emerald-500 bg-emerald-50/70 dark:bg-[#173027] shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131f26] hover:bg-slate-50 dark:hover:bg-[#182830]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={16} className={isSelected ? 'text-[#0f4a3c] dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'} />
                    <span className={`text-xs font-bold ${isSelected ? 'text-[#0f4a3c] dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                      {tab.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{tab.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Filter Parameters */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Step 2: Filter Parameters (Date Range & Status)
          </label>
          <div className="p-4 bg-slate-50 dark:bg-[#121f26] rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search keywords..."
                value={customSearch}
                onChange={e => setCustomSearch(e.target.value)}
                className="form-input pl-8"
              />
            </div>

            {/* Dynamic Status Filter */}
            <div className="w-40">
              <select
                value={customStatus}
                onChange={e => setCustomStatus(e.target.value)}
                className="form-select font-semibold"
              >
                <option value="All">All Statuses</option>
                {customEntity === 'collections' && (
                  <>
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending</option>
                    <option value="Overdue">Overdue</option>
                  </>
                )}
                {customEntity === 'members' && (
                  <>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </>
                )}
                {customEntity === 'expenses' && (
                  <>
                    <option value="Verified">Verified</option>
                    <option value="Needs receipt">Needs receipt</option>
                  </>
                )}
                {customEntity === 'investments' && (
                  <>
                    <option value="Growing">Growing</option>
                    <option value="Review">Review</option>
                  </>
                )}
              </select>
            </div>

            {/* Date Range Inputs */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
              <span className="text-slate-600 dark:text-slate-400 font-bold text-[11px]">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="px-2 py-1.5 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
              />
            </div>

            {(customSearch || customStatus !== 'All' || customStartDate || customEndDate) && (
              <button
                type="button"
                onClick={() => {
                  setCustomSearch('');
                  setCustomStatus('All');
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-[#182830] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold transition-colors"
                title="Reset filters"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Step 3: Column Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Step 3: Select Columns for CSV ({Object.values(selectedColumns).filter(Boolean).length} of {ENTITY_COLUMNS[customEntity].length} selected)
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  const allOn: Record<string, boolean> = {};
                  ENTITY_COLUMNS[customEntity].forEach(c => { allOn[c.key] = true; });
                  setSelectedColumns(allOn);
                }}
                className="text-[#0f4a3c] dark:text-emerald-400 hover:underline font-bold"
              >
                Select All
              </button>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <button
                type="button"
                onClick={() => {
                  const allOff: Record<string, boolean> = {};
                  ENTITY_COLUMNS[customEntity].forEach(c => { allOff[c.key] = false; });
                  setSelectedColumns(allOff);
                }}
                className="text-slate-500 dark:text-slate-400 hover:underline font-bold"
              >
                Clear All
              </button>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <button
                type="button"
                onClick={() => {
                  const def: Record<string, boolean> = {};
                  ENTITY_COLUMNS[customEntity].forEach(c => { def[c.key] = c.default; });
                  setSelectedColumns(def);
                }}
                className="text-slate-500 dark:text-slate-400 hover:underline font-bold"
              >
                Defaults
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {ENTITY_COLUMNS[customEntity].map(col => {
              const isChecked = !!selectedColumns[col.key];
              return (
                <label
                  key={col.key}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs cursor-pointer select-none transition-all ${
                    isChecked
                      ? 'border-[#0f4a3c] dark:border-emerald-500 bg-emerald-50/70 dark:bg-[#1a332a] text-[#0f4a3c] dark:text-emerald-300 font-bold'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#142026] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1a2b34]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={e => {
                      setSelectedColumns(prev => ({
                        ...prev,
                        [col.key]: e.target.checked,
                      }));
                    }}
                    className="rounded text-[#0f4a3c] focus:ring-[#0f4a3c] h-3.5 w-3.5"
                  />
                  <span className="truncate">{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Step 4: Live Data Preview */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Step 4: Live Data Preview (First 5 Matching Records)
            </label>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
              {customDataset.length} total records will be exported to CSV
            </span>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden card-base">
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[750px] text-left text-xs text-slate-800 dark:text-slate-200">
                <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase text-[10px]">
                  <tr>
                    {ENTITY_COLUMNS[customEntity]
                      .filter(c => selectedColumns[c.key])
                      .map(c => (
                        <th key={c.key} className="py-2.5 px-3 whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                  {customDataset.length === 0 ? (
                    <tr>
                      <td
                        colSpan={ENTITY_COLUMNS[customEntity].filter(c => selectedColumns[c.key]).length || 1}
                        className="py-6 text-center text-slate-400 dark:text-slate-500"
                      >
                        No records match the filter criteria.
                      </td>
                    </tr>
                  ) : (
                    customDataset.slice(0, 5).map((row: any, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34]">
                        {ENTITY_COLUMNS[customEntity]
                          .filter(c => selectedColumns[c.key])
                          .map(c => {
                            let val = row[c.key];
                            if (val === undefined || val === null) val = '-';
                            if (typeof val === 'number') {
                              val = val.toLocaleString();
                            }
                            return (
                              <td key={c.key} className="py-2.5 px-3 whitespace-nowrap">
                                {String(val)}
                              </td>
                            );
                          })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
