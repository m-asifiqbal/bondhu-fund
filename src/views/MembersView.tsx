import React, { useState, useEffect } from 'react';
import {
  Plus,
  Upload,
  Search,
  Filter,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
  UserPlus,
  Edit2,
  Trash2,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getMembers,
  addMember,
  updateMember,
  deleteMember,
  getMemberHistory,
  bulkAddMembers,
  getNextMemberCode,
} from '../services/db';
import { Member, PaymentStatus, CollectionRecord } from '../types';

export const MembersView: React.FC = () => {
  const {
    showToast,
    refreshKey,
    triggerRefresh,
    memberFilterStatus,
    setMemberFilterStatus,
    setOpenRecordModal,
    setSelectedMemberIdForPayment,
    selectedMonth,
    language,
    t,
    formatCurrency,
    toBanglaDigits,
  } = useApp();

  const [members, setMembers] = useState<Member[]>([]);
  const [totalCount, setTotalCount] = useState(48);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 6;

  // Date Range Filters & Sorting
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  // Add Member Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [assignedCode, setAssignedCode] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberPhone, setNewMemberPhone] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberDue, setNewMemberDue] = useState(2000);

  // Edit Member Modal
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDue, setEditDue] = useState(2000);

  // View Member History Modal
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [historyRecords, setHistoryRecords] = useState<CollectionRecord[]>([]);

  // Import CSV Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState(
    'Faruk Hossain, 01711-998877, faruk@gmail.com, 2000\nNusrat Jahan Tina, 01822-334455, tina@gmail.com, 2000'
  );

  // Row Action Dropdown
  const [openActionId, setOpenActionId] = useState<number | null>(null);

  useEffect(() => {
    getMembers(search, memberFilterStatus, page, limit, selectedMonth, startDate, endDate, sortBy).then(res => {
      setMembers(res.members);
      setTotalCount(res.total);
    });
  }, [search, memberFilterStatus, page, selectedMonth, startDate, endDate, sortBy, refreshKey]);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleOpenAddModal = async () => {
    try {
      const nextCode = await getNextMemberCode();
      setAssignedCode(nextCode);
    } catch {
      setAssignedCode(`BF-${String(totalCount + 1).padStart(4, '0')}`);
    }
    setShowAddModal(true);
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    const parts = newMemberName.trim().split(' ');
    const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    const finalCode = assignedCode.trim() || (await getNextMemberCode());

    try {
      await addMember({
        member_code: finalCode,
        name: newMemberName.trim(),
        phone: newMemberPhone.trim() || '01700-000000',
        email: newMemberEmail.trim() || `${newMemberName.toLowerCase().replace(/\s+/g, '.')}@bondhufund.org`,
        designation: 'Member',
        status: 'Active',
        monthly_due: Number(newMemberDue),
        join_date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        avatar_initials: initials,
        total_contributed: 0,
      });

      showToast(`Member ${newMemberName} (${finalCode}) created successfully!`);
      triggerRefresh();
      setShowAddModal(false);
      setNewMemberName('');
      setNewMemberPhone('');
      setNewMemberEmail('');
      setAssignedCode('');
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    try {
      await updateMember(editingMember.id, {
        phone: editPhone,
        email: editEmail,
        monthly_due: Number(editDue),
      });
      showToast(`Member "${editingMember.name}" updated successfully!`);
      triggerRefresh();
      setEditingMember(null);
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (m: Member) => {
    const confirm = window.confirm(`Are you sure you want to delete member ${m.name} (${m.member_code})?`);
    if (!confirm) return;

    try {
      await deleteMember(m.id);
      showToast(`Member ${m.name} deleted.`);
      triggerRefresh();
      setOpenActionId(null);
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleViewHistory = async (m: Member) => {
    const records = await getMemberHistory(m.id);
    setHistoryRecords(records);
    setHistoryMember(m);
    setOpenActionId(null);
  };

  const handleBulkImport = async () => {
    try {
      const lines = csvText.split('\n').filter(l => l.trim().length > 0);
      const toImport = lines.map(line => {
        const [name, phone, email, due] = line.split(',').map(s => s.trim());
        return {
          name: name || 'New Member',
          phone: phone || '01700-000000',
          email: email || 'member@bondhufund.org',
          monthly_due: Number(due) || 2000,
        };
      });

      const count = await bulkAddMembers(toImport);
      showToast(`Successfully imported ${count} members into SQLite!`);
      triggerRefresh();
      setShowImportModal(false);
    } catch (err: any) {
      showToast(`Import error: ${err.message}`, 'error');
    }
  };

  const getStatusBadge = (status?: PaymentStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Paid
          </span>
        );
      case 'Pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Pending
          </span>
        );
      case 'Overdue':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            Overdue
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            Active
          </span>
        );
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Members</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage members, payment history, and account standing.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Add member</span>
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Upload size={14} className="text-slate-500" />
            <span>Import list</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stats (Matching Image 2) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 card-base p-5 divide-x divide-slate-200 dark:divide-slate-800">
        <div className="px-4">
          <div className="text-2xl font-black text-slate-900 dark:text-white">48</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">total members</div>
        </div>
        <div className="px-4">
          <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">42</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">paid this month</div>
        </div>
        <div className="px-4">
          <div className="text-2xl font-black text-amber-700 dark:text-amber-400">3</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">pending</div>
        </div>
        <div className="px-4">
          <div className="text-2xl font-black text-rose-700 dark:text-rose-400">3</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">overdue</div>
        </div>
      </div>

      {/* Filter, Search, Sort and Date Range Bar */}
      <div className="card-base p-4 space-y-3">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, phone, or member ID"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="form-input pl-9"
            />
          </div>

          {/* Status Filter */}
          <div className="w-36">
            <select
              value={memberFilterStatus}
              onChange={e => {
                setMemberFilterStatus(e.target.value);
                setPage(1);
              }}
              className="form-select"
            >
              <option value="All">All statuses</option>
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
              <option value="Overdue">Overdue</option>
            </select>
          </div>

          {/* Sort By Filter (Item 3) */}
          <div className="w-48">
            <select
              value={sortBy}
              onChange={e => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className="form-select"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="name_asc">Name: A to Z</option>
              <option value="name_desc">Name: Z to A</option>
              <option value="due_high">Due: High to Low</option>
              <option value="contributed_high">Most Contributed</option>
            </select>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-bold text-[11px]">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-2 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
            />
            <span className="text-slate-600 dark:text-slate-300 font-bold text-[11px]">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={e => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-2 bg-white dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-xs text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
            />
          </div>

          {(search || memberFilterStatus !== 'All' || startDate || endDate || sortBy !== 'newest') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setMemberFilterStatus('All');
                setStartDate('');
                setEndDate('');
                setSortBy('newest');
                setPage(1);
              }}
              className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline font-bold"
            >
              Reset
            </button>
          )}

          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            <Filter size={14} />
            <span>Filter</span>
          </button>
        </form>
      </div>

      {/* Members Table with Guaranteed Horizontal Scroll */}
      <div className="card-base overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[850px] text-left text-xs text-slate-800 dark:text-slate-200">
            <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-6">{t('common.member')}</th>
                <th className="py-3.5 px-6">{t('common.member_id')}</th>
                <th className="py-3.5 px-6">{t('common.monthly_due')}</th>
                <th className="py-3.5 px-6">{t('common.last_payment')}</th>
                <th className="py-3.5 px-6">{t('common.status')}</th>
                <th className="py-3.5 px-6">{t('common.total_contributed')}</th>
                <th className="py-3.5 px-6 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
              {members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {language === 'bn' ? 'কোনো সদস্য পাওয়া যায়নি।' : 'No members found matching your search and filter criteria.'}
                  </td>
                </tr>
              ) : (
                members.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#e2ede7] dark:bg-emerald-950/60 text-[#0f4a3c] dark:text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0 border border-[#c3ded0] dark:border-emerald-800">
                          {m.avatar_initials}
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white block">{m.name}</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">{m.phone}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono font-bold text-slate-700 dark:text-slate-300">{m.member_code}</td>
                    <td className="py-4 px-6 font-black text-slate-900 dark:text-white">
                      {formatCurrency(m.monthly_due)}
                    </td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{m.last_payment_date || '-'}</td>
                    <td className="py-4 px-6">{getStatusBadge(m.current_month_status)}</td>
                    <td className="py-4 px-6 font-black text-emerald-800 dark:text-emerald-400">
                      {formatCurrency(m.total_contributed || 0)}
                    </td>
                    <td className="py-4 px-6 text-right relative">
                      <button
                        onClick={() => setOpenActionId(openActionId === m.id ? null : m.id)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
                        title={t('common.actions')}
                      >
                        <MoreHorizontal size={15} />
                      </button>

                      {/* Row Action Dropdown Menu */}
                      {openActionId === m.id && (
                        <div className="absolute right-6 top-10 w-44 bg-white dark:bg-[#16252d] border border-slate-200 dark:border-[#283e4a] rounded-xl shadow-xl p-1 z-30 text-xs text-left">
                          <button
                            onClick={() => {
                              setSelectedMemberIdForPayment(m.id);
                              setOpenRecordModal(true);
                              setOpenActionId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#eef6f3] dark:hover:bg-[#1a332d] text-[#0f4a3c] dark:text-emerald-400 font-bold"
                          >
                            <Receipt size={14} />
                            <span>Record Payment</span>
                          </button>

                          <button
                            onClick={() => handleViewHistory(m)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                          >
                            <FileSpreadsheet size={14} />
                            <span>View History</span>
                          </button>

                          <button
                            onClick={() => {
                              setEditingMember(m);
                              setEditPhone(m.phone);
                              setEditEmail(m.email);
                              setEditDue(m.monthly_due);
                              setOpenActionId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                          >
                            <Edit2 size={14} />
                            <span>Edit Member</span>
                          </button>

                          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

                          <button
                            onClick={() => handleDelete(m)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-bold"
                          >
                            <Trash2 size={14} />
                            <span>Delete Member</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">
            Showing {(page - 1) * limit + 1}-{Math.min(page * limit, totalCount)} of {totalCount} members
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none font-semibold text-slate-700 dark:text-slate-200"
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <span className="px-2 font-bold text-slate-800 dark:text-slate-200">
              Page {page} of {Math.ceil(totalCount / limit) || 1}
            </span>
            <button
              onClick={() => setPage(p => Math.min(Math.ceil(totalCount / limit), p + 1))}
              disabled={page >= Math.ceil(totalCount / limit)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none font-semibold text-slate-700 dark:text-slate-200"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-slate-50 dark:bg-[#121f26] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus size={18} className="text-[#0f4a3c] dark:text-emerald-400" />
                <span>Add New Member</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddMemberSubmit} className="p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label">Member Code (Unique ID) *</label>
                  <span className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    Auto-Guaranteed Unique
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. BF-0049"
                  value={assignedCode}
                  onChange={e => setAssignedCode(e.target.value.toUpperCase())}
                  className="form-input font-mono font-bold"
                  required
                />
                <p className="form-hint">Generated automatically from highest SQLite sequence.</p>
              </div>

              <div>
                <label className="form-label">Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Mahfuzur Rahman"
                  value={newMemberName}
                  onChange={e => setNewMemberName(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div>
                <label className="form-label">Mobile Phone Number</label>
                <input
                  type="text"
                  placeholder="017xx-xxxxxx"
                  value={newMemberPhone}
                  onChange={e => setNewMemberPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  placeholder="member@bondhufund.org"
                  value={newMemberEmail}
                  onChange={e => setNewMemberEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Monthly Due (TK)</label>
                <input
                  type="number"
                  value={newMemberDue}
                  onChange={e => setNewMemberDue(Number(e.target.value))}
                  className="form-input font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold text-xs shadow-md"
                >
                  Save Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Edit Member Details</h3>
              <button
                onClick={() => setEditingMember(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-slate-100 dark:bg-[#142026] p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <span className="font-bold text-slate-900 dark:text-white block">{editingMember.name}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{editingMember.member_code}</span>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div>
                <label className="form-label">Phone Number</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Monthly Due (TK)</label>
                <input
                  type="number"
                  value={editDue}
                  onChange={e => setEditDue(Number(e.target.value))}
                  className="form-input font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View History Modal */}
      {historyMember && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-lg p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Payment Ledger History</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {historyMember.name} ({historyMember.member_code})
                </p>
              </div>
              <button
                onClick={() => setHistoryMember(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {historyRecords.map(r => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white block">{r.payment_month}</span>
                    <span className="text-[11px] text-slate-400">
                      {r.payment_date || 'Awaiting payment'} &bull; {r.payment_method}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900 dark:text-white block">
                      TK {r.total_amount?.toLocaleString() || r.contribution_amount.toLocaleString()}
                    </span>
                    {getStatusBadge(r.status)}
                  </div>
                </div>
              ))}
              {historyRecords.length === 0 && (
                <div className="text-center py-6 text-slate-400">No payment history on record.</div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setHistoryMember(null)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-200 font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import CSV Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-lg p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-[#0f4a3c] dark:text-emerald-400" />
                <span>Bulk Import Members (CSV)</span>
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Paste member records in CSV format (<span className="font-mono font-bold">Name, Phone, Email, Monthly Due</span>):
            </p>

            <textarea
              rows={6}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              className="w-full p-3 font-mono text-[11px] bg-slate-50 dark:bg-[#101b21] border border-slate-300 dark:border-[#283d47] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f4a3c]"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3.5 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkImport}
                className="px-5 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
              >
                Import to SQLite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
