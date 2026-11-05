import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Tag, Briefcase, CreditCard, Pencil, Check, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getMasterData, addMasterItem, updateMasterItem, deleteMasterItem } from '../services/db';
import { MasterCategory } from '../types';
import { Modal } from '../components/common/Modal';

type MasterType = MasterCategory['type'];

export const MasterDataView: React.FC = () => {
  const { showToast, triggerRefresh, refreshKey, t, language, toBanglaDigits } = useApp();
  const [activeType, setActiveType] = useState<MasterType>('expense_category');
  const [items, setItems] = useState<MasterCategory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'add' | null>(null);

  const [newName, setNewName] = useState('');
  const [newNameBn, setNewNameBn] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editNameBn, setEditNameBn] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [confirmDelete, setConfirmDelete] = useState<MasterCategory | null>(null);

  const n = (v: number) => (language === 'bn' ? toBanglaDigits(v) : String(v));

  const tabs = useMemo<{ id: MasterType; label: string; single: string; icon: React.ElementType }[]>(
    () => [
      { id: 'expense_category', label: t('finance.master_expense_categories', 'Expense categories'), single: t('finance.master_expense_category', 'expense category'), icon: Tag },
      { id: 'investment_sector', label: t('finance.master_investment_sectors', 'Investment sectors'), single: t('finance.master_investment_sector', 'investment sector'), icon: Briefcase },
      { id: 'payment_method', label: t('finance.master_payment_methods', 'Payment methods'), single: t('finance.master_payment_method', 'payment method'), icon: CreditCard },
    ],
    [t]
  );
  const current = tabs.find(x => x.id === activeType)!;

  const load = useCallback(() => {
    getMasterData(activeType)
      .then(list => { setItems(list); setLoadError(null); })
      .catch(e => setLoadError(e.message));
  }, [activeType]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setEditId(null); }, [activeType]);

  const label = (item: { name: string; name_bn?: string | null }) => (language === 'bn' && item.name_bn ? item.name_bn : item.name);

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
      await addMasterItem({ type: activeType, name, name_bn: newNameBn.trim(), description: newDesc.trim(), is_active: 1 });
      setNewName('');
      setNewNameBn('');
      setNewDesc('');
      done(t('finance.master_added', 'Added "{name}"').replace('{name}', label({ name, name_bn: newNameBn.trim() })));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (item: MasterCategory) => {
    setEditId(item.id);
    setEditName(item.name);
    setEditNameBn(item.name_bn || '');
    setEditDesc(item.description || '');
  };

  const saveEdit = async (item: MasterCategory) => {
    const name = editName.trim();
    if (!name) {
      showToast(t('finance.master_name_required', 'Name is required.'), 'error');
      return;
    }
    setBusyId(item.id);
    try {
      await updateMasterItem(item.id, { name, name_bn: editNameBn.trim(), description: editDesc.trim(), is_active: item.is_active });
      setEditId(null);
      done(name !== item.name
        ? t('finance.master_renamed', 'Renamed "{old}" → "{new}"').replace('{old}', item.name).replace('{new}', name)
        : t('finance.master_updated', 'Saved.'));
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
      await updateMasterItem(item.id, { name: item.name, name_bn: item.name_bn || '', description: item.description || '', is_active: next });
      done((next ? t('finance.master_activated', '"{name}" activated') : t('finance.master_deactivated', '"{name}" deactivated')).replace('{name}', label(item)));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const item = confirmDelete;
    if (!item) return;
    setBusyId(item.id);
    try {
      await deleteMasterItem(item.id);
      setConfirmDelete(null);
      done(t('finance.master_deleted', 'Deleted "{name}"').replace('{name}', label(item)));
    } catch (err: any) {
      // e.g. "in use" → the API message suggests deactivating instead
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = useMemo(() => items.filter(i => i.is_active).length, [items]);
  const deleting = confirmDelete !== null && busyId === confirmDelete.id;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('finance.master_title', 'Master data')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('finance.master_subtitle', 'Options offered in dropdowns. Renaming updates existing records; deactivate items you no longer use.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 card-base p-1.5 w-max max-w-full" role="tablist">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeType === tab.id}
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
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            {t('finance.master_add_new', 'Add new {item}').replace('{item}', current.single)}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('finance.master_add_desc', 'It becomes available in all dropdowns immediately.')}</p>
          <form onSubmit={handleAdd} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('finance.master_name_en', 'Name (English)')} *</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="form-input" maxLength={60} required
                  placeholder={t('finance.master_name_en_ph', 'e.g. Office supplies')} />
              </div>
              <div>
                <label className="form-label">{t('finance.master_name_bn', 'Name (Bangla)')}</label>
                <input type="text" lang="bn" value={newNameBn} onChange={e => setNewNameBn(e.target.value)} className="form-input" maxLength={60}
                  placeholder={t('finance.master_name_bn_ph', 'e.g. অফিস সামগ্রী')} />
              </div>
            </div>
            <div>
              <label className="form-label">{t('finance.master_description', 'Description')}</label>
              <textarea rows={3} value={newDesc} onChange={e => setNewDesc(e.target.value)} className="form-input" />
            </div>
            <button
              type="submit"
              disabled={busyId === 'add' || !newName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand hover:bg-brand-hover dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={15} />
              <span>{busyId === 'add' ? t('common.saving', 'Saving…') : t('common.add', 'Add')}</span>
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 card-base overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{current.label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('finance.master_counts', '{items} items · {active} active').replace('{items}', n(items.length)).replace('{active}', n(activeCount))}
            </p>
          </div>

          {loadError && <div className="p-4 text-xs text-rose-600 dark:text-rose-400">{loadError}</div>}

          <div className="hidden md:grid grid-cols-2 gap-3 px-4 py-2 bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 pr-36">
            <span>{t('finance.master_name_en', 'Name (English)')}</span>
            <span>{t('finance.master_name_bn', 'Name (Bangla)')}</span>
          </div>

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
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} className="form-input" maxLength={60}
                        placeholder={t('finance.master_name_en', 'Name (English)')} aria-label={t('finance.master_name_en', 'Name (English)')} />
                      <input lang="bn" value={editNameBn} onChange={e => setEditNameBn(e.target.value)} className="form-input" maxLength={60}
                        placeholder={t('finance.master_name_bn', 'Name (Bangla)')} aria-label={t('finance.master_name_bn', 'Name (Bangla)')} />
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="form-input md:col-span-2"
                        placeholder={t('finance.master_description', 'Description')} aria-label={t('finance.master_description', 'Description')} />
                      <button type="submit" className="hidden" />
                    </form>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white truncate" title={item.name}>{item.name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                            item.is_active
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}>
                            {item.is_active ? t('status.active', 'Active') : t('status.inactive', 'Inactive')}
                          </span>
                        </div>
                        <span lang="bn" className={`truncate ${item.name_bn ? 'font-semibold text-slate-800 dark:text-slate-200' : 'italic text-slate-400 dark:text-slate-500'}`}
                          title={item.name_bn || ''}>
                          {item.name_bn || t('finance.master_no_bn', 'No Bangla name')}
                        </span>
                      </div>
                      {item.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.description}</p>}
                    </div>
                  )}

                  <div className="flex items-center gap-1 shrink-0">
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(item)} disabled={busy} title={t('common.save', 'Save')} aria-label={t('common.save', 'Save')}
                          className="w-8 h-8 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center disabled:opacity-50">
                          <Check size={15} />
                        </button>
                        <button onClick={() => setEditId(null)} disabled={busy} title={t('common.cancel', 'Cancel')} aria-label={t('common.cancel', 'Cancel')}
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
                          aria-label={item.is_active ? t('finance.master_deactivate', 'Deactivate') : t('finance.master_activate', 'Activate')}
                          title={item.is_active ? t('finance.master_deactivate', 'Deactivate') : t('finance.master_activate', 'Activate')}
                          className={`relative w-9 h-5 rounded-full transition-colors mr-1 disabled:opacity-50 ${item.is_active ? 'bg-brand dark:bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${item.is_active ? 'translate-x-4' : ''}`} />
                        </button>
                        <button onClick={() => startEdit(item)} disabled={busy} title={t('finance.master_rename', 'Rename / edit')} aria-label={t('finance.master_rename', 'Rename / edit')}
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setConfirmDelete(item)} disabled={busy} title={t('common.delete', 'Delete')} aria-label={t('common.delete', 'Delete')}
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
                {t('finance.master_empty', 'Nothing here yet. Add the first item using the form.')}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        locked={deleting}
        size="sm"
        icon={<Trash2 size={18} />}
        title={t('finance.master_delete_title', 'Delete item?')}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={deleting}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold disabled:opacity-50">
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md disabled:opacity-50">
              {deleting ? t('finance.deleting', 'Deleting…') : t('common.delete', 'Delete')}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('finance.master_delete_body', 'Delete "{name}"? Items already used in records cannot be deleted — deactivate them instead.')
              .replace('{name}', label(confirmDelete))}
          </p>
        )}
      </Modal>
    </div>
  );
};
