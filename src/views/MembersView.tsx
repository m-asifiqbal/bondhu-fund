import React, { useState, useEffect } from 'react';
import {
  Plus, Upload, Search, ChevronLeft, ChevronRight, X, UserPlus, Edit2, Trash2, Receipt, FileSpreadsheet, Users,
  CheckCircle2, Clock, AlertTriangle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getMembers, addMember, updateMember, deleteMember, getMemberStatement, bulkAddMembers, getNextMemberCode, getAppSettings,
} from '../services/db';
import { Member, MemberStats, MemberStatement, PaymentStatus } from '../types';
import { todayISO } from '../utils/date';

const PAGE_SIZE = 10;
const EMPTY_STATS: MemberStats = { total: 0, active: 0, paid: 0, pending: 0, overdue: 0 };

interface MemberForm {
  member_code: string;
  name: string;
  phone: string;
  email: string;
  designation: string;
  status: 'Active' | 'Inactive';
  monthly_due: number | '';
  join_date: string;
  opening_balance: number | '';
  notes: string;
}

const blankForm = (due: number): MemberForm => ({
  member_code: '', name: '', phone: '', email: '', designation: 'Member', status: 'Active',
  monthly_due: due, join_date: todayISO(), opening_balance: 0, notes: '',
});

const btnPrimary = 'flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50';
const btnSecondary = 'flex items-center justify-center gap-1.5 px-4 py-2 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50';
const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors';

export const MembersView: React.FC = () => {
  const {
    showToast, refreshKey, triggerRefresh, memberFilterStatus, setMemberFilterStatus, setOpenRecordModal,
    setSelectedMemberIdForPayment, selectedMonth, t, formatCurrency, formatDate, formatMonth,
  } = useApp();

  const [members, setMembers] = useState<Member[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<MemberStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [defaultDue, setDefaultDue] = useState(0);

  // Add / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MemberForm>(blankForm(0));
  const [saving, setSaving] = useState(false);

  // Statement panel
  const [statement, setStatement] = useState<MemberStatement | null>(null);
  const [statementId, setStatementId] = useState<number | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [memberFilterStatus]);

  useEffect(() => {
    getAppSettings().then(s => setDefaultDue(Number(s.default_monthly_due) || 0)).catch(() => undefined);
  }, [refreshKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMembers(search, memberFilterStatus, page, PAGE_SIZE, selectedMonth, startDate || undefined, endDate || undefined, sortBy)
      .then(res => {
        if (!alive) return;
        setMembers(res.members);
        setTotalCount(res.total);
        setStats(res.stats);
        const maxPage = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (page > maxPage) setPage(maxPage);
      })
      .catch((e: any) => alive && showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [search, memberFilterStatus, page, selectedMonth, startDate, endDate, sortBy, refreshKey]);

  // Keep the open statement in sync with data changes (e.g. a payment recorded from the panel).
  useEffect(() => {
    if (statementId == null) return;
    let alive = true;
    setStatementLoading(true);
    getMemberStatement(statementId)
      .then(s => alive && setStatement(s))
      .catch((e: any) => { if (alive) { showToast(e.message, 'error'); setStatementId(null); setStatement(null); } })
      .finally(() => alive && setStatementLoading(false));
    return () => { alive = false; };
  }, [statementId, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = !!(searchInput || memberFilterStatus !== 'All' || startDate || endDate || sortBy !== 'newest');

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setMemberFilterStatus('All');
    setStartDate('');
    setEndDate('');
    setSortBy('newest');
    setPage(1);
  };

  const openAdd = async () => {
    const f = blankForm(defaultDue);
    try { f.member_code = await getNextMemberCode(); } catch { /* server assigns one if blank */ }
    setEditingId(null);
    setForm(f);
    setFormOpen(true);
  };

  const openEdit = (m: Member) => {
    setEditingId(m.id);
    setForm({
      member_code: m.member_code,
      name: m.name,
      phone: m.phone || '',
      email: m.email || '',
      designation: m.designation || 'Member',
      status: m.status,
      monthly_due: m.monthly_due,
      join_date: m.join_date || todayISO(),
      opening_balance: m.opening_balance ?? 0,
      notes: m.notes || '',
    });
    setFormOpen(true);
  };

  const setField = <K extends keyof MemberForm>(k: K, v: MemberForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) { showToast(t('members.err_name', 'Name is required.'), 'error'); return; }
    if (form.monthly_due === '' || Number(form.monthly_due) < 0) { showToast(t('members.err_due', 'Enter a valid monthly due.'), 'error'); return; }
    if (!form.join_date) { showToast(t('members.err_join', 'Join date is required.'), 'error'); return; }
    if (Number(form.opening_balance) < 0) { showToast(t('members.err_opening', 'Opening balance cannot be negative.'), 'error'); return; }

    const payload: Partial<Member> = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      designation: form.designation.trim() || 'Member',
      status: form.status,
      monthly_due: Number(form.monthly_due),
      join_date: form.join_date,
      opening_balance: Number(form.opening_balance) || 0,
      notes: form.notes.trim(),
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updateMember(editingId, payload);
        showToast(t('members.updated', 'Member updated.'));
      } else {
        await addMember({ ...payload, member_code: form.member_code.trim() || undefined });
        showToast(`${t('members.added', 'Member added')}: ${payload.name}`);
      }
      setFormOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: Member) => {
    if (!window.confirm(`${t('members.confirm_delete', 'Delete member')} ${m.name} (${m.member_code})?`)) return;
    try {
      await deleteMember(m.id);
      showToast(`${t('members.deleted', 'Member deleted')}: ${m.name}`);
      if (statementId === m.id) { setStatementId(null); setStatement(null); }
      triggerRefresh();
    } catch (err: any) {
      // Members with payments cannot be deleted: offer to deactivate instead.
      if (m.status === 'Active' && window.confirm(`${err.message}\n\n${t('members.offer_inactive', 'Set this member to Inactive now?')}`)) {
        try {
          await updateMember(m.id, { status: 'Inactive' });
          showToast(`${m.name}: ${t('members.set_inactive_done', 'set to Inactive.')}`);
          triggerRefresh();
        } catch (e2: any) {
          showToast(e2.message, 'error');
        }
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  const recordFor = (id: number) => {
    setSelectedMemberIdForPayment(id);
    setOpenRecordModal(true);
  };

  /** CSV columns: Name, Phone, Email, Monthly Due, Join Date (YYYY-MM-DD). A header row is skipped. */
  const parsedImport = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => line.split(/[,\t]/).map(s => s.trim().replace(/^"(.*)"$/, '$1')))
    .filter((cols, i) => !(i === 0 && /^name$/i.test(cols[0])))
    .filter(cols => cols[0])
    .map(([name, phone, email, due, join]) => ({
      name,
      phone: phone || '',
      email: email || '',
      monthly_due: due && !isNaN(Number(due)) ? Number(due) : undefined,
      join_date: join && /^\d{4}-\d{2}-\d{2}$/.test(join) ? join : undefined,
    }));

  const handleBulkImport = async () => {
    if (importing) return;
    if (parsedImport.length === 0) { showToast(t('members.import_empty', 'Paste at least one member row.'), 'error'); return; }
    setImporting(true);
    try {
      const count = await bulkAddMembers(parsedImport);
      showToast(`${t('members.imported', 'Members imported')}: ${count}`);
      setShowImportModal(false);
      setCsvText('');
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const statusBadge = (status?: PaymentStatus | null) => {
    const base = 'inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap';
    switch (status) {
      case 'Paid':
        return <span className={`${base} bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800`}>{t('status.paid', 'Paid')}</span>;
      case 'Pending':
        return <span className={`${base} bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800`}>{t('status.pending', 'Pending')}</span>;
      case 'Overdue':
        return <span className={`${base} bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800`}>{t('status.overdue', 'Overdue')}</span>;
      default:
        return <span className={`${base} bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700`}>—</span>;
    }
  };

  const kpis = [
    { label: t('members.kpi_total', 'Total members'), value: stats.total, sub: `${stats.active} ${t('members.kpi_active', 'active')}`, icon: <Users size={18} />, tone: 'text-slate-900 dark:text-white', iconTone: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
    { label: t('members.kpi_paid', 'Paid'), value: stats.paid, sub: formatMonth(selectedMonth), icon: <CheckCircle2 size={18} />, tone: 'text-emerald-700 dark:text-emerald-400', iconTone: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' },
    { label: t('members.kpi_pending', 'Pending'), value: stats.pending, sub: formatMonth(selectedMonth), icon: <Clock size={18} />, tone: 'text-amber-700 dark:text-amber-400', iconTone: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400' },
    { label: t('members.kpi_overdue', 'Overdue'), value: stats.overdue, sub: formatMonth(selectedMonth), icon: <AlertTriangle size={18} />, tone: 'text-rose-700 dark:text-rose-400', iconTone: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400' },
  ];

  const statementTotals = statement
    ? statement.rows.reduce(
        (acc, r) => {
          if (r.status === 'Paid') acc.paid += Number(r.total_amount ?? r.contribution_amount ?? 0);
          else { acc.owedMonths += 1; acc.owed += Number(r.monthly_due) || 0; }
          return acc;
        },
        { paid: 0, owed: 0, owedMonths: 0 },
      )
    : null;

  const modalShell = (title: React.ReactNode, onClose: () => void, children: React.ReactNode, width = 'max-w-lg') => (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`card-base w-full ${width} max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150`}>
        <div className="px-6 py-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 xl:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('members.title', 'Members')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('members.subtitle', 'Manage members, payment history, and account standing.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={openAdd} className={btnPrimary}>
            <Plus size={16} strokeWidth={2.5} />
            <span>{t('members.add', 'Add member')}</span>
          </button>
          <button type="button" onClick={() => setShowImportModal(true)} className={btnSecondary}>
            <Upload size={14} className="text-slate-500" />
            <span>{t('members.import', 'Import list')}</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="card-base p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-600 dark:text-slate-400 font-bold">{k.label}</div>
              <div className={`text-2xl font-black mt-1 ${k.tone}`}>{k.value}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{k.sub}</div>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${k.iconTone}`}>{k.icon}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card-base p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder={t('members.search_ph', 'Search by name, phone, or member ID')}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="form-input pl-9"
            />
          </div>
          <select value={memberFilterStatus} onChange={e => setMemberFilterStatus(e.target.value)} className="form-select w-40">
            <option value="All">{t('members.f_all', 'All statuses')}</option>
            <option value="Paid">{t('status.paid', 'Paid')}</option>
            <option value="Pending">{t('status.pending', 'Pending')}</option>
            <option value="Overdue">{t('status.overdue', 'Overdue')}</option>
            <option value="Active">{t('members.active', 'Active')}</option>
            <option value="Inactive">{t('members.inactive', 'Inactive')}</option>
          </select>
          <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} className="form-select w-48">
            <option value="newest">{t('sort.newest', 'Newest first')}</option>
            <option value="oldest">{t('sort.oldest', 'Oldest first')}</option>
            <option value="name_asc">{t('sort.name_asc', 'Name: A to Z')}</option>
            <option value="name_desc">{t('sort.name_desc', 'Name: Z to A')}</option>
            <option value="code_asc">{t('sort.code_asc', 'Member ID')}</option>
            <option value="due_high">{t('sort.due_high', 'Due: high to low')}</option>
            <option value="due_low">{t('sort.due_low', 'Due: low to high')}</option>
            <option value="contributed_high">{t('sort.contributed_high', 'Most contributed')}</option>
            <option value="contributed_low">{t('sort.contributed_low', 'Least contributed')}</option>
            <option value="join_desc">{t('sort.join_desc', 'Recently joined')}</option>
          </select>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-bold text-[11px]">{t('members.joined_from', 'Joined from')}</span>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} className="form-input w-auto" />
            <span className="text-slate-600 dark:text-slate-300 font-bold text-[11px]">{t('common.to', 'to')}</span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={e => { setEndDate(e.target.value); setPage(1); }} className="form-input w-auto" />
          </div>
          {hasFilters && (
            <button type="button" onClick={resetFilters} className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline font-bold">
              {t('common.reset', 'Reset')}
            </button>
          )}
        </div>
      </div>

      {/* Table + statement panel */}
      <div className={`grid grid-cols-1 gap-6 ${statementId != null ? 'xl:grid-cols-3' : ''}`}>
        <div className={`card-base overflow-hidden min-w-0 ${statementId != null ? 'xl:col-span-2' : ''}`}>
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[820px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4">{t('common.member', 'Member')}</th>
                  <th className="py-3.5 px-4">{t('common.member_id', 'Member ID')}</th>
                  <th className="py-3.5 px-4">{t('common.monthly_due', 'Monthly due')}</th>
                  <th className="py-3.5 px-4">{t('common.last_payment', 'Last payment')}</th>
                  <th className="py-3.5 px-4">{formatMonth(selectedMonth)}</th>
                  <th className="py-3.5 px-4">{t('common.total_contributed', 'Total contributed')}</th>
                  <th className="py-3.5 px-4 text-right">{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      {loading ? t('common.loading', 'Loading...') : t('members.empty', 'No members match your search and filters.')}
                    </td>
                  </tr>
                ) : (
                  members.map(m => (
                    <tr
                      key={m.id}
                      onClick={() => setStatementId(m.id)}
                      className={`cursor-pointer transition-colors ${statementId === m.id ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : 'hover:bg-slate-50/80 dark:hover:bg-[#1a2b34]'}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#e2ede7] dark:bg-emerald-950/60 text-[#0f4a3c] dark:text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0 border border-[#c3ded0] dark:border-emerald-800">
                            {m.avatar_initials}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span className="truncate">{m.name}</span>
                              {m.status === 'Inactive' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  {t('members.inactive', 'Inactive')}
                                </span>
                              )}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">{m.phone || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-700 dark:text-slate-300">{m.member_code}</td>
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(m.monthly_due)}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatDate(m.last_payment_date)}</td>
                      <td className="py-3 px-4">{statusBadge(m.current_month_status)}</td>
                      <td className="py-3 px-4 font-black text-emerald-800 dark:text-emerald-400 whitespace-nowrap">{formatCurrency(m.total_contributed || 0)}</td>
                      <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {m.status === 'Active' && (
                            <button type="button" onClick={() => recordFor(m.id)} className={`${iconBtn} text-[#0f4a3c] dark:text-emerald-400`} title={t('members.record_payment', 'Record payment')}>
                              <Receipt size={14} />
                            </button>
                          )}
                          <button type="button" onClick={() => setStatementId(m.id)} className={iconBtn} title={t('members.statement', 'Statement')}>
                            <FileSpreadsheet size={14} />
                          </button>
                          <button type="button" onClick={() => openEdit(m)} className={iconBtn} title={t('common.edit', 'Edit')}>
                            <Edit2 size={14} />
                          </button>
                          <button type="button" onClick={() => handleDelete(m)} className={`${iconBtn} text-rose-600 dark:text-rose-400 hover:text-rose-700`} title={t('common.delete', 'Delete')}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">
              {totalCount === 0
                ? t('members.none', 'No members')
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} ${t('common.of', 'of')} ${totalCount}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none font-semibold text-slate-700 dark:text-slate-200"
              >
                <ChevronLeft size={14} />
                <span>{t('common.previous', 'Previous')}</span>
              </button>
              <span className="px-2 font-bold text-slate-800 dark:text-slate-200">{page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none font-semibold text-slate-700 dark:text-slate-200"
              >
                <span>{t('common.next', 'Next')}</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Statement panel: beside the table on xl, stacked below otherwise */}
        {statementId != null && (
          <div className="card-base overflow-hidden min-w-0 flex flex-col xl:max-h-[calc(100vh-12rem)]">
            <div className="px-5 py-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {statement?.member.name ?? t('common.loading', 'Loading...')}
                </h3>
                {statement && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {statement.member.member_code} · {t('members.joined', 'Joined')} {formatDate(statement.member.join_date)} · {statement.member.status === 'Active' ? t('members.active', 'Active') : t('members.inactive', 'Inactive')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => { setStatementId(null); setStatement(null); }} className="text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0">
                <X size={16} />
              </button>
            </div>

            {statement && statementTotals && (
              <div className="grid grid-cols-3 gap-2 p-4 border-b border-slate-200 dark:border-slate-800 text-[11px]">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">{t('members.opening', 'Opening balance')}</div>
                  <div className="font-black text-slate-900 dark:text-white">{formatCurrency(Number(statement.member.opening_balance) || 0)}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">{t('members.paid_in_app', 'Paid (in app)')}</div>
                  <div className="font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(statementTotals.paid)}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">{t('members.unpaid', 'Unpaid')} ({statementTotals.owedMonths})</div>
                  <div className="font-black text-rose-700 dark:text-rose-400">{formatCurrency(statementTotals.owed)}</div>
                </div>
              </div>
            )}

            <div className="overflow-auto flex-1">
              <table className="w-full min-w-[360px] text-left text-xs text-slate-800 dark:text-slate-200">
                <thead className="sticky top-0 bg-white dark:bg-[#14232b] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">{t('common.month', 'Month')}</th>
                    <th className="py-2.5 px-4">{t('members.paid_on', 'Paid on')}</th>
                    <th className="py-2.5 px-4 text-right">{t('common.amount', 'Amount')}</th>
                    <th className="py-2.5 px-4 text-right">{t('common.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {statementLoading && !statement ? (
                    <tr><td colSpan={4} className="py-8 text-center text-slate-400">{t('common.loading', 'Loading...')}</td></tr>
                  ) : statement && statement.rows.length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center text-slate-400">{t('members.no_months', 'No months due yet.')}</td></tr>
                  ) : (
                    statement?.rows.map(r => (
                      <tr key={r.payment_month}>
                        <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatMonth(r.payment_month)}</td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {r.status === 'Paid' ? formatDate(r.payment_date) : `${t('members.due', 'Due')} ${formatDate(r.due_date)}`}
                          {r.status === 'Paid' && r.payment_method && <span className="block text-[10px] text-slate-400">{r.payment_method}</span>}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold whitespace-nowrap">
                          {formatCurrency(Number(r.status === 'Paid' ? (r.total_amount ?? r.contribution_amount) : r.monthly_due) || 0)}
                          {r.status === 'Paid' && Number(r.late_fee) > 0 && (
                            <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-medium">+{formatCurrency(Number(r.late_fee))} {t('payment.late_fee', 'Late Fee')}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">{statusBadge(r.status)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {statement?.member.status === 'Active' && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => recordFor(statement.member.id)} className={`${btnPrimary} w-full`}>
                  <Receipt size={14} />
                  <span>{t('members.record_payment', 'Record payment')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit member modal */}
      {formOpen && modalShell(
        <>
          {editingId != null ? <Edit2 size={18} className="text-[#0f4a3c] dark:text-emerald-400" /> : <UserPlus size={18} className="text-[#0f4a3c] dark:text-emerald-400" />}
          <span>{editingId != null ? t('members.edit_title', 'Edit member') : t('members.add_title', 'Add new member')}</span>
        </>,
        () => !saving && setFormOpen(false),
        <form onSubmit={handleFormSubmit} className="p-6 space-y-4 text-xs" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('common.member_id', 'Member ID')}</label>
              <input
                type="text"
                value={form.member_code}
                onChange={e => setField('member_code', e.target.value.toUpperCase())}
                disabled={editingId != null}
                className="form-input font-mono font-bold disabled:opacity-60"
              />
              {editingId == null && <p className="form-hint">{t('members.code_hint', 'Assigned automatically; must be unique.')}</p>}
            </div>
            <div>
              <label className="form-label">{t('members.name', 'Full name')} <span className="text-rose-500">*</span></label>
              <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} className="form-input" required autoFocus />
            </div>
            <div>
              <label className="form-label">{t('members.phone', 'Mobile phone')}</label>
              <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">{t('members.email', 'Email')}</label>
              <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">{t('members.designation', 'Designation')}</label>
              <input type="text" value={form.designation} onChange={e => setField('designation', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">{t('common.status', 'Status')}</label>
              <select value={form.status} onChange={e => setField('status', e.target.value as MemberForm['status'])} className="form-select">
                <option value="Active">{t('members.active', 'Active')}</option>
                <option value="Inactive">{t('members.inactive', 'Inactive')}</option>
              </select>
            </div>
            <div>
              <label className="form-label">{t('common.monthly_due', 'Monthly due')} <span className="text-rose-500">*</span></label>
              <input
                type="number"
                min={0}
                value={form.monthly_due}
                onChange={e => setField('monthly_due', e.target.value === '' ? '' : Number(e.target.value))}
                className="form-input font-bold"
                required
              />
            </div>
            <div>
              <label className="form-label">{t('members.join_date', 'Join date')} <span className="text-rose-500">*</span></label>
              <input type="date" value={form.join_date} onChange={e => setField('join_date', e.target.value)} className="form-input" required />
              <p className="form-hint">{t('members.join_hint', 'Dues are counted from this month.')}</p>
            </div>
          </div>
          <div>
            <label className="form-label">{t('members.opening_balance', 'Contributions before using the app')}</label>
            <input
              type="number"
              min={0}
              value={form.opening_balance}
              onChange={e => setField('opening_balance', e.target.value === '' ? '' : Number(e.target.value))}
              className="form-input font-bold"
            />
            <p className="form-hint">{t('members.opening_hint', 'Total this member paid before records started in Bondhu Fund. Counted in the fund balance.')}</p>
          </div>
          <div>
            <label className="form-label">{t('members.notes', 'Notes')}</label>
            <textarea rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} className="form-input" />
          </div>
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className={btnSecondary}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? t('common.saving', 'Saving...') : editingId != null ? t('common.save_changes', 'Save changes') : t('members.save', 'Save member')}
            </button>
          </div>
        </form>,
        'max-w-2xl',
      )}

      {/* Bulk import modal */}
      {showImportModal && modalShell(
        <>
          <FileSpreadsheet size={18} className="text-[#0f4a3c] dark:text-emerald-400" />
          <span>{t('members.import_title', 'Import members (CSV)')}</span>
        </>,
        () => !importing && setShowImportModal(false),
        <div className="p-6 space-y-4 text-xs">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('members.import_help', 'Paste one member per line. Columns:')}{' '}
            <span className="font-mono font-bold">Name, Phone, Email, Monthly Due, Join Date (YYYY-MM-DD)</span>.{' '}
            {t('members.import_help2', 'Only the name is required; a blank due uses the default from Settings and a blank join date uses today.')}
          </p>
          <textarea
            rows={8}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={'Name, Phone, Email, Monthly Due, Join Date'}
            className="w-full p-3 font-mono text-[11px] bg-slate-50 dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
          />
          {parsedImport.length > 0 && (
            <div className="overflow-x-auto max-h-48 border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full min-w-[480px] text-left text-[11px] text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-[#111e24] text-slate-500 dark:text-slate-400 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2 px-3">{t('members.name', 'Full name')}</th>
                    <th className="py-2 px-3">{t('members.phone', 'Mobile phone')}</th>
                    <th className="py-2 px-3">{t('members.email', 'Email')}</th>
                    <th className="py-2 px-3">{t('common.monthly_due', 'Monthly due')}</th>
                    <th className="py-2 px-3">{t('members.join_date', 'Join date')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parsedImport.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-3 font-bold">{r.name}</td>
                      <td className="py-1.5 px-3">{r.phone || '—'}</td>
                      <td className="py-1.5 px-3">{r.email || '—'}</td>
                      <td className="py-1.5 px-3">{formatCurrency(r.monthly_due ?? defaultDue)}</td>
                      <td className="py-1.5 px-3">{formatDate(r.join_date ?? todayISO())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">{parsedImport.length} {t('members.rows_ready', 'row(s) ready')}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowImportModal(false)} disabled={importing} className={btnSecondary}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="button" onClick={handleBulkImport} disabled={importing || parsedImport.length === 0} className={btnPrimary}>
                {importing ? t('common.saving', 'Saving...') : t('members.import_btn', 'Import members')}
              </button>
            </div>
          </div>
        </div>,
      )}
    </div>
  );
};
