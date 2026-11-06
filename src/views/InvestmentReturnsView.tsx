import React, { useEffect, useMemo, useState } from 'react';
import { MoneyInput } from '../components/common/MoneyInput';
import { serial } from '../utils/i18n';
import { Plus, TrendingUp, TrendingDown, Scale, CalendarDays, Trash2, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  getInvestments, getInvestmentReturns, getReturnsSummary, addInvestmentReturn, deleteInvestmentReturn,
} from '../services/db';
import type { Investment, InvestmentReturn, ReturnsSummary } from '../types';
import { Modal } from '../components/common/Modal';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { ChipTabs } from '../components/common/ChipTabs';
import { SearchableSelect, SelectOption } from '../components/common/SearchableSelect';
import { DatePicker } from '../components/common/DatePicker';
import { todayISO } from '../utils/date';

type Filter = 'All' | 'Profit' | 'Loss';
const EMPTY: ReturnsSummary = { profit: 0, loss: 0, net: 0, entries: 0, yearNet: 0, byInvestment: [] };

/** Investment benefits received and losses booked, per investment. Feeds the fund balance and member settlements. */
export const InvestmentReturnsView: React.FC = () => {
  const { t, tv, formatCurrency, formatDate, showToast, refreshKey, triggerRefresh, masterData, canWrite } = useApp() as any;
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [rows, setRows] = useState<InvestmentReturn[]>([]);
  const [sum, setSum] = useState<ReturnsSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('All');
  const [invFilter, setInvFilter] = useState<number | ''>('');

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<'Profit' | 'Loss'>('Profit');
  const [invId, setInvId] = useState<number | ''>('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [confirmDel, setConfirmDel] = useState<InvestmentReturn | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getInvestments('newest', 'All'), getInvestmentReturns(invFilter === '' ? undefined : Number(invFilter)), getReturnsSummary()])
      .then(([inv, r, s]) => { if (alive) { setInvestments(inv); setRows(r); setSum(s); } })
      .catch((e: any) => showToast(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [refreshKey, invFilter]);

  const invOptions = useMemo<SelectOption[]>(() => investments.map(i => ({ value: i.id, label: i.name, sublabel: i.sector } as SelectOption)), [investments]);
  const methodOptions = useMemo<SelectOption[]>(
    () => masterData.filter((m: any) => m.type === 'payment_method' && Number(m.is_active) === 1).map((m: any) => ({ value: m.name, label: tv(m.name) })),
    [masterData, tv],
  );
  const shown = rows.filter(r => filter === 'All' || r.entry_type === filter);

  const openAdd = () => {
    setType('Profit'); setInvId(invFilter); setAmount(''); setDate(todayISO()); setMethod(''); setRef(''); setNote(''); setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!invId) { showToast(t('ret.err_inv', 'Choose the investment.'), 'error'); return; }
    if (amount === '' || Number(amount) <= 0) { showToast(t('ret.err_amount', 'Enter an amount greater than zero.'), 'error'); return; }
    if (type === 'Profit' && !method) { showToast(t('ret.err_method', 'Choose how the benefit was received (cash, bank, bKash…).'), 'error'); return; }
    setSaving(true);
    try {
      await addInvestmentReturn({ investment_id: Number(invId), entry_type: type, amount: Number(amount), entry_date: date, payment_method: method, reference: ref.trim(), note: note.trim() });
      showToast(type === 'Profit' ? t('ret.saved_profit', 'Benefit recorded.') : t('ret.saved_loss', 'Loss recorded.'));
      setOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!confirmDel || saving) return;
    setSaving(true);
    try {
      await deleteInvestmentReturn(confirmDel.id);
      showToast(t('ret.deleted', 'Entry removed.'));
      setConfirmDel(null);
      triggerRefresh();
    } catch (err: any) { showToast(err.message, 'error'); setConfirmDel(null); } finally { setSaving(false); }
  };

  const kpi = (accent: string, label: string, icon: React.ReactNode, iconCls: string, value: string, valueCls: string, sub: string) => (
    <div className={`card-base border-l-4 ${accent} p-5 flex flex-col justify-between shadow-sm min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</div>
      </div>
      <div className="mt-4 min-w-0">
        <div className={`text-2xl font-black tracking-tight truncate ${valueCls}`} title={value}>{value}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 truncate" title={sub}>{sub}</div>
      </div>
    </div>
  );
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(n))}`;
  const tone = (n: number) => (n > 0 ? 'text-emerald-700 dark:text-emerald-400' : n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white');

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1680px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('ret.title', 'Investment returns')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('ret.subtitle', 'Record the benefit received from investments, and any loss. These change the fund balance and are shared with members when they are settled.')}</p>
        </div>
        <button type="button" onClick={openAdd} className="btn btn-primary">
          <Plus size={15} strokeWidth={2.5} />
          <span>{t('ret.add', 'Record profit / loss')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpi('border-l-emerald-500', t('ret.kpi_profit', 'Total benefit received'), <TrendingUp size={16} />, 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
          formatCurrency(sum.profit), 'text-emerald-700 dark:text-emerald-400', `${investments.length} ${t('ret.investments', 'investments')}`)}
        {kpi('border-l-rose-500', t('ret.kpi_loss', 'Total loss booked'), <TrendingDown size={16} />, 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
          formatCurrency(sum.loss), 'text-rose-600 dark:text-rose-400', `${sum.entries} ${t('ret.entries', 'entries in total')}`)}
        {kpi('border-l-blue-500', t('ret.kpi_net', 'Net result'), <Scale size={16} />, 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
          signed(sum.net), tone(sum.net), t('ret.kpi_net_sub', 'Benefit minus loss, all time'))}
        {kpi('border-l-amber-500', t('ret.kpi_year', 'This year'), <CalendarDays size={16} />, 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
          signed(sum.yearNet), tone(sum.yearNet), todayISO().slice(0, 4))}
      </div>

      {sum.byInvestment.length > 0 && (
        <div className="card-base p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{t('ret.by_inv', 'Result by investment')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sum.byInvestment.map(b => (
              <button key={b.id} type="button" onClick={() => setInvFilter(invFilter === b.id ? '' : b.id)}
                className={`text-left p-3 rounded-2xl border transition-all min-w-0 ${invFilter === b.id ? 'border-slate-900 dark:border-white ring-2 ring-slate-900/10 dark:ring-white/10' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{b.name}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{b.sector} · {t('ret.cost', 'Cost')} {formatCurrency(b.invested_amount)}</div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2 tabular-nums">
                  <span className="text-[10px] text-slate-500">+{formatCurrency(b.profit)} / −{formatCurrency(b.loss)}</span>
                  <span className={`text-sm font-black ${tone(b.net)}`}>{signed(b.net)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card-base overflow-hidden">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <ChipTabs ariaLabel={t('ret.filter', 'Entry type')} value={filter} onChange={(k: any) => setFilter(k as Filter)}
            items={[{ key: 'All', label: t('ret.f_all', 'All') }, { key: 'Profit', label: t('ret.f_profit', 'Benefit') }, { key: 'Loss', label: t('ret.f_loss', 'Loss') }]} />
          <div className="w-64">
            <SearchableSelect options={[{ value: '', label: t('ret.all_inv', 'All investments') } as SelectOption, ...invOptions]} value={invFilter}
              onChange={v => setInvFilter(v === '' || v == null ? '' : Number(v))} placeholder={t('ret.all_inv', 'All investments')} />
          </div>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[820px] text-left text-xs text-slate-800 dark:text-slate-200">
            <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              <tr>
<th className="py-3 px-4 w-12 text-center">{t('common.no', 'No.')}</th>
                <th className="py-3 px-4">{t('common.date', 'Date')}</th>
                <th className="py-3 px-4">{t('ret.col_inv', 'Investment')}</th>
                <th className="py-3 px-4">{t('ret.col_type', 'Type')}</th>
                <th className="py-3 px-4 text-right">{t('common.amount', 'Amount')}</th>
                <th className="py-3 px-4">{t('ret.col_via', 'Received through')}</th>
                <th className="py-3 px-4">{t('ret.col_note', 'Reference / note')}</th>
                <th className="py-3 px-4 text-right">{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
              {shown.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{loading ? t('common.loading', 'Loading...') : t('ret.empty', 'No profit or loss entries yet.')}</td></tr>
              ) : shown.map((r, __i) => (
                <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
<td className="py-3 px-4 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(0 + __i + 1)}</td>
                  <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">{formatDate(r.entry_date)}</td>
                  <td className="py-3 px-4"><div className="font-bold text-slate-900 dark:text-white">{r.investment_name}</div><div className="text-[11px] text-slate-500 font-normal">{r.sector}</div></td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${r.entry_type === 'Profit' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300'}`}>
                      {r.entry_type === 'Profit' ? t('ret.f_profit', 'Benefit') : t('ret.f_loss', 'Loss')}
                    </span>
                  </td>
                  <td className={`py-3 px-4 text-right font-black tabular-nums whitespace-nowrap ${r.entry_type === 'Profit' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {r.entry_type === 'Profit' ? '+' : '−'}{formatCurrency(r.amount)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{r.payment_method ? tv(r.payment_method) : '—'}</td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400"><span className="line-clamp-1">{[r.reference, r.note].filter(Boolean).join(' · ') || '—'}</span></td>
                  <td className="py-3 px-4">
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setConfirmDel(r)} className="btn btn-danger-outline btn-sm btn-icon" title={t('common.delete', 'Delete')} aria-label={t('common.delete', 'Delete')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => !saving && setOpen(false)} locked={saving} size="lg" icon={<TrendingUp size={20} />}
        title={t('ret.add_title', 'Record investment profit / loss')} subtitle={t('ret.add_sub', 'A benefit adds money to the fund; a loss reduces it.')}
        footer={<>
          <button type="button" onClick={() => setOpen(false)} disabled={saving} className="btn btn-cancel min-w-[7.5rem]">{t('common.cancel', 'Cancel')}</button>
          <button type="submit" form="return-form" disabled={saving} className="btn btn-primary min-w-[10.5rem]">
            <Check size={16} strokeWidth={2.6} /><span>{saving ? t('common.saving', 'Saving...') : t('ret.save', 'Save entry')}</span>
          </button>
        </>}>
        <form id="return-form" onSubmit={submit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 items-start">
          <div className="sm:col-span-2">
            <SegmentedTabs ariaLabel={t('ret.filter', 'Entry type')} value={type} onChange={(k: any) => setType(k as 'Profit' | 'Loss')}
              items={[{ key: 'Profit', label: t('ret.t_profit', 'Benefit received'), icon: <TrendingUp size={15} /> }, { key: 'Loss', label: t('ret.t_loss', 'Loss'), icon: <TrendingDown size={15} /> }]} />
          </div>
          <SearchableSelect label={t('ret.col_inv', 'Investment')} required options={invOptions} value={invId}
            onChange={v => setInvId(v === '' || v == null ? '' : Number(v))} placeholder={t('ret.inv_ph', 'Choose investment…')} />
          <DatePicker label={t('common.date', 'Date')} required clearable={false} value={date} max={todayISO()} onChange={setDate} />
          <div>
            <label className="form-label">{t('common.amount', 'Amount')} <span className="text-rose-500">*</span></label>
            <MoneyInput min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} className="form-input font-bold tabular-nums" />
          </div>
          <SearchableSelect label={type === 'Profit' ? t('ret.col_via', 'Received through') : t('ret.via_optional', 'Paid through (optional)')} required={type === 'Profit'}
            options={methodOptions} value={method} onChange={v => setMethod(String(v ?? ''))} placeholder={t('members.pay_method_ph', 'Select method…')} />
          <div>
            <label className="form-label">{t('members.trx', 'Transaction / Ref ID')}</label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} className="form-input font-mono" />
          </div>
          <div>
            <label className="form-label">{t('members.note', 'Note')}</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} className="form-input" />
          </div>
        </form>
      </Modal>

      <Modal open={!!confirmDel} onClose={() => !saving && setConfirmDel(null)} locked={saving} size="sm" tone="danger" icon={<Trash2 size={18} />}
        title={t('ret.del_title', 'Remove this entry?')}
        footer={<>
          <button type="button" onClick={() => setConfirmDel(null)} disabled={saving} className="btn btn-cancel">{t('common.cancel', 'Cancel')}</button>
          <button type="button" onClick={doDelete} disabled={saving} className="btn btn-danger">{t('common.delete', 'Delete')}</button>
        </>}>
        {confirmDel && <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {confirmDel.entry_type === 'Profit' ? t('ret.f_profit', 'Benefit') : t('ret.f_loss', 'Loss')} {formatCurrency(confirmDel.amount)} · {confirmDel.investment_name} · {formatDate(confirmDel.entry_date)}. {t('ret.del_msg', 'The fund balance will change back.')}
        </p>}
      </Modal>
    </div>
  );
};
