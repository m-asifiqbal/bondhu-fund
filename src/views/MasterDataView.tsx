import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Tag, Briefcase, CreditCard, Pencil, Check, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getMasterData, addMasterItem, updateMasterItem, deleteMasterItem } from '../services/db';
import { MasterCategory } from '../types';

type MasterType = MasterCategory['type'];

export const MasterDataView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey, t } = useApp();
  const [activeType, setActiveType] = useState<MasterType>('expense_category');
  const [items, setItems] = useState<MasterCategory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'add' | null>(null);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const tabs: { id: MasterType; label: string; single: string; icon: React.ElementType }[] = [
    { id: 'expense_category', label: t('master.expense_categories', 'Expense categories'), single: t('master.expense_category', 'expense category'), icon: Tag },
    { id: 'investment_sector', label: t('master.investment_sectors', 'Investment sectors'), single: t('master.investment_sector', 'investment sector'), icon: Briefcase },
    { id: 'payment_method', label: t('master.payment_methods', 'Payment methods'), single: t('master.payment_method', 'payment method'), icon: CreditCard },
  ];
  const current = tabs.find(x => x.id === activeType)!;

  const load = useCallback(() => {
    getMasterData(activeType)
      .then(list => { setItems(list); setLoadError(null); })
      .catch(e => setLoadError(e.message));
  }, [activeType]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setEditId(null); }, [activeType]);

  const done = (msg: string) => {
    showToast(msg);
    triggerRefresh();
    load();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusyId('add');
    try {
      await addMasterItem({ type: activeType, name, description: newDesc.trim(), is_active: 1 });
      setNewName('');
      setNewDesc('');
      done(`${t('master.added', 'Added')} "${name}"`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (item: MasterCategory) => {
    setEditId(item.id);
    setEditName(item.name);
    setEditDesc(item.description || '');
  };

  const saveEdit = async (item: MasterCategory) => {
    const name = editName.trim();
    if (!name) {
      showToast(t('master.name_required', 'Name is required.'), 'error');
      return;
    }
    setBusyId(item.id);
    try {
      await updateMasterItem(item.id, { name, description: editDesc.trim(), is_active: item.is_active });
      setEditId(null);
      done(name !== item.name
        ? `${t('master.renamed', 'Renamed')} "${item.name}" → "${name}"`
        : t('master.updated', 'Saved.'));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (item: MasterCategory) => {
    setBusyId(item.id);
    try {
      const next = item.is_active ? 0 : 1;
      await updateMasterItem(item.id, { name: item.name, description: item.description || '', is_active: next });
      done(`"${item.name}" ${next ? t('master.activated', 'activated') : t('master.deactivated', 'deactivated')}`);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: MasterCategory) => {
    if (!window.confirm(`${t('master.confirm_delete', 'Delete')} "${item.name}"?`)) return;
    setBusyId(item.id);
    try {
      await deleteMasterItem(item.id);
      done(`${t('master.deleted', 'Deleted')} "${item.name}"`);
    } catch (err: any) {
      // e.g. "in use" → the API message suggests deactivating instead
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = items.filter(i => i.is_active).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('master.title', 'Master Data')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('master.subtitle', 'Options offered in dropdowns. Renaming updates existing records; deactivate items you no longer use.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 card-base p-1.5 w-max max-w-full">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveType(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeType === tab.id
                  ? 'bg-brand dark:bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-base p-6 h-max">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t('master.add_new', 'Add new')} {current.single}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('master.add_desc', 'It becomes available in all dropdowns immediately.')}</p>
          <form onSubmit={handleAdd} className="space-y-4 text-xs">
            <div>
              <label className="form-label">{t('master.name', 'Name')} *</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="form-input" maxLength={60} required />
            </div>
            <div>
              <label className="form-label">{t('master.description', 'Description')}</label>
              <textarea rows={3} value={newDesc} onChange={e => setNewDesc(e.target.value)} className="form-input" />
            </div>
            <button
              type="submit"
              disabled={busyId === 'add' || !newName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={15} />
              <span>{busyId === 'add' ? t('common.saving', 'Saving...') : t('master.add', 'Add')}</span>
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 card-base overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{current.label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {items.length} {t('master.items', 'items')} · {activeCount} {t('master.active', 'active')}
            </p>
          </div>

          {loadError && <div className="p-4 text-xs text-rose-600 dark:text-rose-400">{loadError}</div>}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map(item => {
              const editing = editId === item.id;
              const busy = busyId === item.id;
              return (
                <div key={item.id} className={`p-4 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors ${item.is_active ? '' : 'opacity-70'}`}>
                  {editing ? (
                    <form
                      className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2"
                      onSubmit={e => { e.preventDefault(); saveEdit(item); }}
                      onKeyDown={e => { if (e.key === 'Escape') setEditId(null); }}
                    >
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} className="form-input" maxLength={60} placeholder={t('master.name', 'Name')} />
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="form-input" placeholder={t('master.description', 'Description')} />
                      <button type="submit" className="hidden" />
                    </form>
                  ) : (
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white truncate">{item.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          item.is_active
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}>
                          {item.is_active ? t('master.status_active', 'Active') : t('master.status_inactive', 'Inactive')}
                        </span>
                      </div>
                      {item.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</p>}
                    </div>
                  )}

                  <div className="flex items-center gap-1 shrink-0">
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(item)} disabled={busy} title={t('common.save', 'Save')}
                          className="w-8 h-8 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center disabled:opacity-50">
                          <Check size={15} />
                        </button>
                        <button onClick={() => setEditId(null)} disabled={busy} title={t('common.cancel', 'Cancel')}
                          className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center">
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleActive(item)}
                          disabled={busy}
                          role="switch"
                          aria-checked={!!item.is_active}
                          title={item.is_active ? t('master.deactivate', 'Deactivate') : t('master.activate', 'Activate')}
                          className={`relative w-9 h-5 rounded-full transition-colors mr-1 disabled:opacity-50 ${item.is_active ? 'bg-brand dark:bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${item.is_active ? 'translate-x-4' : ''}`} />
                        </button>
                        <button onClick={() => startEdit(item)} disabled={busy} title={t('master.rename', 'Rename')}
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(item)} disabled={busy} title={t('common.delete', 'Delete')}
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center disabled:opacity-50">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {items.length === 0 && !loadError && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500">
                {t('master.empty', 'Nothing here yet. Add the first item using the form.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
