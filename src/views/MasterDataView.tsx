import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Tag,
  Briefcase,
  CreditCard,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getMasterData, addMasterItem, deleteMasterItem } from '../services/db';
import { MasterCategory } from '../types';

export const MasterDataView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey } = useApp();
  const [activeMasterType, setActiveMasterType] = useState<'expense_category' | 'investment_sector' | 'payment_method'>('expense_category');
  const [items, setItems] = useState<MasterCategory[]>([]);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    getMasterData(activeMasterType).then(setItems);
  }, [activeMasterType, refreshKey]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      await addMasterItem({
        type: activeMasterType,
        name: newName.trim(),
        description: newDesc.trim(),
        is_active: 1,
      });

      showToast(`Added "${newName.trim()}" to ${activeMasterType.replace('_', ' ')}!`);
      setNewName('');
      setNewDesc('');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      await deleteMasterItem(id);
      showToast(`Removed "${name}" from master data.`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const getMasterTitle = () => {
    switch (activeMasterType) {
      case 'expense_category': return 'Expense Types & Categories';
      case 'investment_sector': return 'Investment Sectors & Types';
      case 'payment_method': return 'Payment Methods';
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Master Data Management</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure foundational master categories, sectors, and methods stored in local SQLite.
        </p>
      </div>

      {/* Type Selector Pills */}
      <div className="flex items-center gap-2 card-base p-1.5 w-max">
        <button
          onClick={() => setActiveMasterType('expense_category')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeMasterType === 'expense_category'
              ? 'bg-[#0f4a3c] dark:bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Tag size={14} />
          <span>Expense Types</span>
        </button>

        <button
          onClick={() => setActiveMasterType('investment_sector')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeMasterType === 'investment_sector'
              ? 'bg-[#0f4a3c] dark:bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Briefcase size={14} />
          <span>Investment Types</span>
        </button>

        <button
          onClick={() => setActiveMasterType('payment_method')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeMasterType === 'payment_method'
              ? 'bg-[#0f4a3c] dark:bg-emerald-700 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <CreditCard size={14} />
          <span>Payment Methods</span>
        </button>
      </div>

      {/* 2-Column Layout: Add Form on Left, List on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Add New Form */}
        <div className="card-base p-6">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Add New {getMasterTitle().slice(0, -1)}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Define a new entry to be available in all dropdowns.</p>

          <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
            <div>
              <label className="form-label">Name / Label *</label>
              <input
                type="text"
                placeholder="e.g. Solar Energy Asset"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="form-input"
                required
              />
            </div>

            <div>
              <label className="form-label">Description / Rules</label>
              <textarea
                rows={3}
                placeholder="Brief description or purpose"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="form-input"
              />
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
            >
              <Plus size={15} />
              <span>Save to SQLite</span>
            </button>
          </form>
        </div>

        {/* Right Column: Existing Items List */}
        <div className="lg:col-span-2 card-base overflow-hidden">
          <div className="p-6 pb-2 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{getMasterTitle()}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Currently active options in local SQLite database ({items.length} items)</p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map(item => (
              <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">{item.name}</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Active
                    </span>
                  </div>
                  {item.description && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</p>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(item.id, item.name)}
                  className="w-8 h-8 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-colors"
                  title="Delete Item"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500">No records found.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
