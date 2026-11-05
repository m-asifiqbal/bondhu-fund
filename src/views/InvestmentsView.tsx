import React, { useState, useEffect } from 'react';
import {
  Plus,
  Download,
  FileText,
  Building,
  Home,
  MapPin,
  Cpu,
  AlertCircle,
  X,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useApp } from '../context/AppContext';
import {
  getInvestments,
  addInvestment,
  updateInvestmentValuation,
  deleteInvestment,
  getMasterData,
} from '../services/db';
import { Investment, MasterCategory } from '../types';
import { CustomChartTooltip } from '../components/common/CustomChartTooltip';

export const InvestmentsView: React.FC = () => {
  const { setActiveTab, setEntryCenterInitialTab, showToast, refreshKey, triggerRefresh, language, t, formatCurrency, toBanglaDigits } = useApp();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [sectors, setSectors] = useState<MasterCategory[]>([]);
  const [sortBy, setSortBy] = useState('newest');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReviewInv, setSelectedReviewInv] = useState<Investment | null>(null);
  const [newEstVal, setNewEstVal] = useState<number>(0);

  // New investment form state
  const [name, setName] = useState('');
  const [sector, setSector] = useState('Land purchase');
  const [purchaseDate, setPurchaseDate] = useState('28 Jun 2024');
  const [investedAmount, setInvestedAmount] = useState(100000);
  const [estimatedValue, setEstimatedValue] = useState(115000);
  const [reviewDate, setReviewDate] = useState('30 Jul 2024');
  const [locationDetails, setLocationDetails] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    getInvestments(sortBy).then(setInvestments);
    getMasterData('investment_sector').then(setSectors);
  }, [sortBy, refreshKey]);

  const totalInvested = investments.reduce((acc, i) => acc + i.invested_amount, 0) || 920000;
  const currentEstValue = investments.reduce((acc, i) => acc + i.current_estimated_value, 0) || 1076000;
  const totalGain = currentEstValue - totalInvested;

  // Grouped bar chart data for Return snapshot
  const barData = [
    { name: 'Land', invested: 386400, estimated: 452000 },
    { name: 'Flat', invested: 285200, estimated: 309000 },
    { name: 'Plot', invested: 165600, estimated: 201000 },
    { name: 'Assets', invested: 82800, estimated: 114000 },
  ];

  const handleExport = () => {
    showToast('Exporting Investment Portfolio valuation report (CSV)...');
    const header = ['Investment Name', 'Sector', 'Purchase Date', 'Invested Amount', 'Estimated Value', 'Gain/Loss', 'Status', 'Review Date'];
    const rows = investments.map(i => [
      `"${i.name}"`,
      `"${i.sector}"`,
      `"${i.purchase_date}"`,
      i.invested_amount,
      i.current_estimated_value,
      i.gain_loss,
      `"${i.status}"`,
      `"${i.review_date || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Bondhu_Fund_Investments_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await addInvestment({
        name,
        sector,
        purchase_date: purchaseDate,
        invested_amount: Number(investedAmount),
        current_estimated_value: Number(estimatedValue),
        status: 'Growing',
        review_date: reviewDate,
        location_details: locationDetails,
        notes,
      });

      showToast(`Investment "${name}" added to SQLite portfolio!`);
      triggerRefresh();
      setShowAddModal(false);
      setName('');
      setLocationDetails('');
      setNotes('');
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleValuationUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReviewInv) return;

    try {
      await updateInvestmentValuation(selectedReviewInv.id, Number(newEstVal));
      showToast(`Valuation updated for ${selectedReviewInv.name} to TK ${Number(newEstVal).toLocaleString()}`);
      triggerRefresh();
      setSelectedReviewInv(null);
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const handleDeleteInv = async (inv: Investment) => {
    const confirm = window.confirm(`Delete investment record "${inv.name}"?`);
    if (!confirm) return;

    try {
      await deleteInvestment(inv.id);
      showToast(`Investment "${inv.name}" removed.`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'error');
    }
  };

  const getSectorIcon = (sectorName: string) => {
    if (sectorName.toLowerCase().includes('land')) return <MapPin size={16} className="text-emerald-700 dark:text-emerald-400" />;
    if (sectorName.toLowerCase().includes('flat')) return <Home size={16} className="text-amber-700 dark:text-amber-400" />;
    if (sectorName.toLowerCase().includes('plot')) return <Building size={16} className="text-blue-700 dark:text-blue-400" />;
    return <Cpu size={16} className="text-purple-700 dark:text-purple-400" />;
  };

  const getSectorBadge = (sectorName: string) => {
    if (sectorName.toLowerCase().includes('land')) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          Land purchase
        </span>
      );
    }
    if (sectorName.toLowerCase().includes('flat')) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          Flat purchase
        </span>
      );
    }
    if (sectorName.toLowerCase().includes('plot')) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          Plot purchase
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
        Assets
      </span>
    );
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Investment portfolio</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Grow the union fund through shared, long-term assets.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEntryCenterInitialTab('investment');
              setActiveTab('entry');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <FileText size={14} className="text-slate-500 dark:text-slate-400" />
            <span>Use detailed entry form</span>
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white dark:bg-[#16252d] border border-slate-300 dark:border-[#283e4a] rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={14} className="text-slate-500 dark:text-slate-400" />
            <span>Export</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Add investment</span>
          </button>
        </div>
      </div>

      {/* 3 Metric Cards (Matching Design System) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card-base p-5 border-l-4 border-l-purple-500">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Total invested</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-2">
            TK {totalInvested.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-1">
            71.6% of total fund
          </div>
        </div>

        <div className="card-base p-5 border-l-4 border-l-emerald-500">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Current estimated value</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-2">
            TK {currentEstValue.toLocaleString()}
          </div>
          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            +TK {totalGain.toLocaleString()} unrealized gain
          </div>
        </div>

        <div className="card-base p-5 border-l-4 border-l-blue-500">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Active investments</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-2">
            {investments.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-1">
            Across 4 sectors
          </div>
        </div>
      </div>

      {/* Middle Row: Allocation & Return Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Portfolio Allocation Bar */}
        <div className="card-base p-6 flex flex-col justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">Portfolio allocation</h3>

          <div className="w-full h-4 rounded-full overflow-hidden flex shadow-inner p-0.5 bg-slate-100 dark:bg-slate-800">
            <div className="bg-[#0f4a3c] dark:bg-emerald-500 h-full rounded-l-full" style={{ width: '42%' }} title="Land 42%" />
            <div className="bg-[#d97706] dark:bg-amber-500 h-full" style={{ width: '31%' }} title="Flat 31%" />
            <div className="bg-[#2563eb] dark:bg-blue-500 h-full" style={{ width: '18%' }} title="Plot 18%" />
            <div className="bg-[#9333ea] dark:bg-purple-500 h-full rounded-r-full" style={{ width: '9%' }} title="Assets 9%" />
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#0f4a3c] dark:bg-emerald-500 shrink-0" />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Land purchase</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">42% - TK 386,400</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#d97706] dark:bg-amber-500 shrink-0" />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Flat purchase</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">31% - TK 285,200</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#2563eb] dark:bg-blue-500 shrink-0" />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Plot purchase</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">18% - TK 165,600</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#9333ea] dark:bg-purple-500 shrink-0" />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Assets</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">9% - TK 82,800</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Return Snapshot Grouped Bar Chart */}
        <div className="card-base p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Return snapshot</h3>
            <div className="flex items-center gap-4 text-[11px] font-bold">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0f4a3c] dark:bg-emerald-500" />
                <span className="text-slate-700 dark:text-slate-300">Invested</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#d97706] dark:bg-amber-500" />
                <span className="text-slate-700 dark:text-slate-300">Estimated value</span>
              </div>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} barGap={6}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomChartTooltip currencyPrefix={language === 'bn' ? '৳' : 'TK'} />} />
                <Bar dataKey="invested" name={language === 'bn' ? 'বিনিয়োগকৃত' : 'Invested'} fill="#0f4a3c" radius={[6, 6, 0, 0]} />
                <Bar dataKey="estimated" name={language === 'bn' ? 'বর্তমান মূল্য' : 'Estimated value'} fill="#d97706" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">
            {language === 'bn' ? 'সর্বশেষ বাজারমূল্য হালনাগাদ: ২৮ জুন ২০২৪' : 'Estimated values updated 28 June 2024'}
          </p>
        </div>
      </div>

      {/* Active Investments Table with Guaranteed Horizontal Scroll */}
      <div className="card-base overflow-hidden">
        <div className="p-6 pb-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {language === 'bn' ? 'সক্রিয় বিনিয়োগ পোর্টফোলিও' : 'Active investments'}
          </h3>

          {/* Sort Dropdown */}
          <div className="w-48">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="form-select"
            >
              <option value="newest">{language === 'bn' ? 'নতুন আগে' : 'Sort: Newest First'}</option>
              <option value="oldest">{language === 'bn' ? 'পুরাতন আগে' : 'Sort: Oldest First'}</option>
              <option value="name_asc">{language === 'bn' ? 'নাম: ক থেকে য়' : 'Name: A to Z'}</option>
              <option value="val_high">{language === 'bn' ? 'মূল্য: বেশি থেকে কম' : 'Value: High to Low'}</option>
              <option value="gain_high">{language === 'bn' ? 'লাভ: বেশি থেকে কম' : 'Gain: High to Low'}</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[850px] text-left text-xs text-slate-800 dark:text-slate-200">
            <thead className="bg-slate-50 dark:bg-[#111e24] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-6">{language === 'bn' ? 'বিনিয়োগ প্রকল্প' : 'Investment'}</th>
                <th className="py-3.5 px-6">{language === 'bn' ? 'খাত / সেক্টর' : 'Sector'}</th>
                <th className="py-3.5 px-6">{language === 'bn' ? 'ক্রয়ের তারিখ' : 'Purchased'}</th>
                <th className="py-3.5 px-6">{language === 'bn' ? 'বিনিয়োগকৃত টাকা' : 'Invested'}</th>
                <th className="py-3.5 px-6">{language === 'bn' ? 'বর্তমান মূল্য' : 'Estimated value'}</th>
                <th className="py-3.5 px-6">{language === 'bn' ? 'অনুপাত / লাভ' : 'Gain'}</th>
                <th className="py-3.5 px-6">{t('common.status')}</th>
                <th className="py-3.5 px-6 text-right">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
              {investments.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-[#1a2b34] transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                        {getSectorIcon(inv.sector)}
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white">{inv.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6">{getSectorBadge(inv.sector)}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{inv.purchase_date}</td>
                  <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                    {formatCurrency(inv.invested_amount)}
                  </td>
                  <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                    {formatCurrency(inv.current_estimated_value)}
                  </td>
                  <td className="py-4 px-6 font-black text-emerald-700 dark:text-emerald-400">
                    +{formatCurrency(inv.gain_loss)}
                  </td>
                  <td className="py-4 px-6">
                    {inv.status === 'Growing' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        {language === 'bn' ? 'বর্ধনশীল' : 'Growing'}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        {language === 'bn' ? 'পর্যালোচনা' : 'Review'}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedReviewInv(inv);
                          setNewEstVal(inv.current_estimated_value);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[#0f4a3c] dark:text-emerald-400 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors"
                      >
                        <TrendingUp size={12} />
                        <span>{language === 'bn' ? 'হালনাগাদ' : 'Update'}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteInv(inv)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Committee Review Due Notice (Matching Image 4) */}
      <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-2xl p-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 flex items-center justify-center shrink-0 border border-amber-300 dark:border-amber-700">
            <AlertCircle size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">Committee review due</h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Uttara Plot 7B has a document review scheduled for 28 June 2024.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            const uttara = investments.find(i => i.name.includes('Uttara')) || investments[0];
            setSelectedReviewInv(uttara);
            setNewEstVal(uttara.current_estimated_value);
          }}
          className="px-4 py-2 bg-white dark:bg-[#1a2830] hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-xl text-xs font-bold shadow-sm transition-colors"
        >
          Open review
        </button>
      </div>

      {/* Add Investment Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-md p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add New Union Investment</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="form-label">Investment Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Gazipur Industrial Plot"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div>
                <label className="form-label">Sector *</label>
                <select
                  value={sector}
                  onChange={e => setSector(e.target.value)}
                  className="form-select"
                >
                  {sectors.length > 0 ? (
                    sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)
                  ) : (
                    <>
                      <option value="Land purchase">Land purchase</option>
                      <option value="Flat purchase">Flat purchase</option>
                      <option value="Plot purchase">Plot purchase</option>
                      <option value="Assets">Assets</option>
                    </>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Invested Amount (TK) *</label>
                  <input
                    type="number"
                    value={investedAmount}
                    onChange={e => setInvestedAmount(Number(e.target.value))}
                    className="form-input font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Current Estimated Value</label>
                  <input
                    type="number"
                    value={estimatedValue}
                    onChange={e => setEstimatedValue(Number(e.target.value))}
                    className="form-input font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Purchase Date</label>
                  <input
                    type="text"
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Review Date</label>
                  <input
                    type="text"
                    value={reviewDate}
                    onChange={e => setReviewDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Location / Deed Details</label>
                <input
                  type="text"
                  placeholder="Plot number, mouza, deed ref"
                  value={locationDetails}
                  onChange={e => setLocationDetails(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
                >
                  Save Investment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Valuation Modal */}
      {selectedReviewInv && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-base w-full max-w-sm p-6 text-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Review & Update Valuation</h3>
              <button
                onClick={() => setSelectedReviewInv(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-slate-100 dark:bg-[#121f26] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-bold text-slate-900 dark:text-white text-sm">{selectedReviewInv.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Sector: {selectedReviewInv.sector}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                Original Invested: <span className="font-bold">TK {selectedReviewInv.invested_amount.toLocaleString()}</span>
              </p>
            </div>

            <form onSubmit={handleValuationUpdate} className="space-y-3">
              <div>
                <label className="form-label">New Estimated Market Value (TK)</label>
                <input
                  type="number"
                  value={newEstVal}
                  onChange={e => setNewEstVal(Number(e.target.value))}
                  className="form-input font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedReviewInv(null)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0f4a3c] hover:bg-[#145c4b] dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white rounded-xl font-bold shadow-md"
                >
                  Update Valuation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
