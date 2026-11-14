import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { serial } from '../utils/i18n';
import { Scale,
  Wallet, Landmark, HandCoins, AlertTriangle, Building2, Receipt, TrendingUp, TrendingDown, Minus,
  Download, Printer, RefreshCw, Users, CalendarDays, PieChart as PieIcon, Activity, BellRing,
  ArrowDownLeft, ArrowUpRight, UserPlus, FileWarning, ShieldCheck, Sparkles, DatabaseBackup, Plus, Timer,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ClockCard, TodayDates } from '../components/common/ClockCard';
import { MonthPicker } from '../components/common/MonthPicker';
import { Modal } from '../components/common/Modal';
import { EChart, ChartCard, chartTheme, baseOption, valueAxis, categoryAxis } from '../components/charts/EChart';
import { getOverviewData, loadDemoData, savePdf, exportTable } from '../services/db';
import { cell, type ExportDoc } from '../utils/exportDoc';
import { PrintSignatures } from '../components/common/PrintSignatures';
import { formatMonth as fmtMonth, toMonthKey, todayISO } from '../utils/date';
import { toBanglaDigits } from '../utils/i18n';
import type { OverviewData } from '../types';

// --- small bilingual dictionary for this screen ------------------------------
const L = {
  greeting: ['Good morning', 'শুভ সকাল'], afternoon: ['Good afternoon', 'শুভ অপরাহ্ন'], evening: ['Good evening', 'শুভ সন্ধ্যা'], night: ['Good night', 'শুভ রাত্রি'],
  subtitle: ['Financial position of the fund for', 'তহবিলের আর্থিক অবস্থা —'],
  collectedShort: ['Collected', 'আদায়'],
  netWorth: ['Net worth', 'মোট সম্পদ'], cash: ['Cash in hand', 'হাতে নগদ'], collected: ['Collected this month', 'এ মাসে আদায়'],
  outstanding: ['Outstanding dues', 'বকেয়া'], portfolio: ['Portfolio value', 'বিনিয়োগ মূল্য'], expenses: ['Expenses this month', 'এ মাসের খরচ'],
  vsLast: ['vs last month', 'গত মাসের তুলনায়'], of: ['of', 'এর মধ্যে'], lentOut: ['lent to members as loans', 'সদস্যদের ঋণ হিসেবে দেওয়া'],
  collections: ['Collections', 'আদায়'], fund: ['Fund growth & cash flow', 'তহবিল বৃদ্ধি ও নগদ প্রবাহ'],
  portfolioSpend: ['Portfolio & spending', 'বিনিয়োগ ও খরচ'], members: ['Members', 'সদস্য'],
  expVsColl: ['Expected vs collected', 'প্রত্যাশিত বনাম আদায়'], expected: ['Expected', 'প্রত্যাশিত'], last12: ['Last 12 months', 'গত ১২ মাস'],
  status: ['Dues status', 'বকেয়ার অবস্থা'], paid: ['Paid', 'পরিশোধিত'], pending: ['Pending', 'অপেক্ষমাণ'], overdue: ['Overdue', 'মেয়াদোত্তীর্ণ'],
  balance: ['Fund balance', 'তহবিল স্থিতি'], cashLine: ['Cash in hand', 'হাতে নগদ'],
  flow: ['Monthly cash flow', 'মাসিক নগদ প্রবাহ'], inflow: ['Money in', 'আয়'], outExp: ['Expenses', 'খরচ'], outInv: ['Investments', 'বিনিয়োগ'],
  bySector: ['Portfolio by sector', 'খাতভিত্তিক বিনিয়োগ'], cost: ['Cost', 'ক্রয়মূল্য'], value: ['Est. value', 'বর্তমান মূল্য'],
  byCategory: ['Expenses by category', 'খাতভিত্তিক খরচ'], heat: ['Payment calendar', 'পেমেন্ট ক্যালেন্ডার'], heatSub: ['Daily collections, last 6 months', 'দৈনিক আদায়, গত ৬ মাস'],
  top: ['Top contributors', 'শীর্ষ অবদানকারী'], methods: ['Payment methods', 'পেমেন্ট মাধ্যম'],
  arrears: ['Members in arrears', 'বকেয়াধারী সদস্য'], months: ['months', 'মাস'],
  attention: ['Needs attention', 'মনোযোগ প্রয়োজন'], recent: ['Recent activity', 'সাম্প্রতিক কার্যক্রম'],
  allClear: ['All clear — nothing needs attention.', 'সব ঠিক আছে।'],
  emptyTitle: ['Welcome to Bondhu Fund', 'বন্ধু ফান্ডে স্বাগতম'],
  emptyBody: ['Your database is empty. Add members to start tracking dues, or restore an existing backup.', 'ডাটাবেস খালি। সদস্য যোগ করুন অথবা ব্যাকআপ রিস্টোর করুন।'],
  addMember: ['Add first member', 'প্রথম সদস্য যোগ করুন'], restore: ['Restore a backup', 'ব্যাকআপ রিস্টোর'], demo: ['Explore with demo data', 'ডেমো ডেটা দেখুন'],
  export: ['Export Excel', 'এক্সেল এক্সপোর্ট'], pdf: ['Save PDF', 'PDF সংরক্ষণ'], rate: ['collection rate', 'আদায় হার'],
  refresh: ['Refresh', 'রিফ্রেশ'], saved: ['Saved', 'সংরক্ষিত হয়েছে'], demoTitle: ['Load demo data?', 'ডেমো ডেটা লোড করবেন?'],
  demoBody: ['This fills the app with sample members, payments, expenses and investments so you can explore. You can clear it later from Backup & Restore.', 'অ্যাপটি ঘুরে দেখার জন্য নমুনা সদস্য, পেমেন্ট, খরচ ও বিনিয়োগ যোগ হবে। পরে ব্যাকআপ ও রিস্টোর থেকে এগুলো মুছে ফেলা যাবে।'],
  demoLoad: ['Load demo data', 'ডেমো ডেটা লোড করুন'], demoLoaded: ['Demo data loaded', 'ডেমো ডেটা লোড হয়েছে'], cancel: ['Cancel', 'বাতিল'],
  hMonth: ['Month', 'মাস'], hRate: ['Rate', 'হার'], hStatus: ['Status', 'অবস্থা'], hIn: ['In', 'আয়'], hSector: ['Sector', 'খাত'], hGain: ['Gain', 'লাভ'],
  hCategory: ['Category', 'খাত'], hAmount: ['Amount', 'পরিমাণ'], hEntries: ['Entries', 'এন্ট্রি'], hDate: ['Date', 'তারিখ'], hPayments: ['Payments', 'পেমেন্ট'],
  hMethod: ['Method', 'মাধ্যম'], hMember: ['Member', 'সদস্য'], hTotal: ['Total', 'মোট'], paidFor: ['paid for', 'পরিশোধ করেছেন —'], joined: ['joined', 'যোগ দিয়েছেন'],
  lateFees: ['Late fees collected', 'আদায়কৃত বিলম্ব ফি'], lateMonth: ['This month', 'এ মাসে'], lateYear: ['This year', 'এ বছরে'],
  latePayments: ['late payments', 'টি বিলম্বিত পেমেন্ট'], lateAll: ['All time', 'সর্বমোট'], lateToDate: ['to date', 'পর্যন্ত'], lateLast: ['last month', 'গত মাসে'],
  retBenefit: ['Investment benefit', 'বিনিয়োগ থেকে লাভ'], retLoss: ['Investment loss', 'বিনিয়োগে ক্ষতি'], retNet: ['Net investment result', 'নিট বিনিয়োগ ফলাফল'],
  retChart: ['Investment benefit & loss', 'বিনিয়োগের লাভ ও ক্ষতি'], benefit: ['Benefit', 'লাভ'], lossT: ['Loss', 'ক্ষতি'], net: ['Net', 'নিট'], retEntries: ['entries', 'টি এন্ট্রি'],
  members_n: ['members', 'জন সদস্য'], gain: ['gain', 'লাভ'], loss: ['loss', 'ক্ষতি'], noData: ['No data for this period yet.', 'এই সময়ের কোনো তথ্য নেই।'],
};
type Key = keyof typeof L;

/** 05–11 morning, 12–16 afternoon, 17–19 evening, 20–04 night. */
export const greetingKey = (hour: number): Key => (hour >= 5 && hour < 12 ? 'greeting' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 20 ? 'evening' : 'night');

export const OverviewView: React.FC = () => {
  const {
    selectedMonth, setSelectedMonth, isDarkMode, language, formatCurrency, formatDate, currentUser, refreshKey,
    triggerRefresh, showToast, setActiveTab, tv, setMemberFilterStatus, setOpenRecordModal, setSelectedMemberIdForPayment,
    bnName, settings, canUpload,
  } = useApp();
  const tr = useCallback((k: Key) => L[k][language === 'bn' ? 1 : 0], [language]);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getOverviewData(selectedMonth));
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const th = useMemo(() => chartTheme(isDarkMode), [isDarkMode]);
  const digits = (s: string | number) => (language === 'bn' ? toBanglaDigits(s) : String(s));
  const compact = useCallback((v: number) => {
    const a = Math.abs(v);
    const s = a >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`;
    return digits(s);
  }, [language]);
  const mLabel = useCallback((k: string) => fmtMonth(k, language as any, true), [language]);
  const money = (v: number) => formatCurrency(Math.round(v || 0));

  // Greeting follows the local time of day and refreshes while the app stays open.
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => { const id = setInterval(() => setHour(new Date().getHours()), 60_000); return () => clearInterval(id); }, []);
  const hello = tr(greetingKey(hour));
  const firstName = bnName(currentUser?.full_name, currentUser?.full_name_bn).split(' ')[0] || '';

  // ---------------------------------------------------------------------------
  // Chart options
  // ---------------------------------------------------------------------------
  const opts = useMemo(() => {
    if (!data) return null;
    const months = data.trend.map(p => mLabel(p.month));
    const tipMoney = (params: any) => {
      const list = Array.isArray(params) ? params : [params];
      const head = `<div style="font-weight:700;margin-bottom:4px">${list[0].axisValueLabel ?? list[0].name}</div>`;
      return head + list.map((p: any) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b>${money(Math.abs(p.value))}</b></div>`).join('');
    };

    // Small value labels that are always visible; the tooltip (hover) shows the full figure, and the label grows on hover.
    const valLbl = (position: string, color?: string) => ({
      show: true, position, fontSize: 9, fontWeight: 600, color: color || th.textMuted,
      formatter: (p: any) => (Number(p.value) ? compact(Math.abs(Number(p.value))) : ''),
    });
    const valEmph = { label: { fontSize: 12, fontWeight: 800, color: th.text } };
    const noOverlap = { hideOverlap: true };

    const expectedVsCollected = {
      ...baseOption(th),
      color: [th.cat[0], th.cat[2]],
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tipMoney },
      legend: { ...(baseOption(th) as any).legend, data: [tr('expected'), tr('collectedShort')] },
      xAxis: categoryAxis(th, months),
      yAxis: valueAxis(th, compact),
      series: [
        { name: tr('expected'), type: 'bar', barGap: '8%', barMaxWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0], opacity: 0.35 }, label: valLbl('top'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => p.expected) },
        { name: tr('collectedShort'), type: 'bar', barMaxWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0] }, label: valLbl('top'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => p.collected) },
      ],
    };

    const returnsChart = {
      ...baseOption(th),
      color: [th.status.good, th.status.critical, th.cat[0]],
      grid: { left: 8, right: 12, top: 36, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tipMoney },
      legend: { ...(baseOption(th) as any).legend, data: [tr('benefit'), tr('lossT'), tr('net')] },
      xAxis: categoryAxis(th, months),
      yAxis: valueAxis(th, compact),
      series: [
        { name: tr('benefit'), type: 'bar', stack: 'ret', barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] }, label: valLbl('top'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => p.returnProfit || 0) },
        { name: tr('lossT'), type: 'bar', stack: 'ret', barMaxWidth: 18, itemStyle: { borderRadius: [0, 0, 4, 4] }, label: valLbl('bottom'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => -(p.returnLoss || 0)) },
        { name: tr('net'), type: 'line', smooth: false, symbol: 'circle', symbolSize: 7, showSymbol: true, lineStyle: { width: 2 }, z: 5, data: data.trend.map(p => (p.returnProfit || 0) - (p.returnLoss || 0)) },
      ],
    };

    const k = data.kpis;
    const statusDonut = {
      ...baseOption(th),
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.marker}${p.name}: <b>${digits(p.value)}</b> ${tr('members_n')} (${digits(p.percent)}%)` },
      legend: { ...(baseOption(th) as any).legend, top: 'bottom', right: 'center' },
      title: { text: `${digits(k.collectionRate)}%`, subtext: tr('rate'), left: 'center', top: '31%', itemGap: 2,
        textStyle: { fontSize: 19, fontWeight: 800, color: th.text }, subtextStyle: { fontSize: 11, color: th.textMuted } },
      series: [{
        type: 'pie', radius: ['40%', '56%'], center: ['50%', '40%'], padAngle: 2, itemStyle: { borderRadius: 6, borderColor: th.surface, borderWidth: 2 },
        avoidLabelOverlap: true, minShowLabelAngle: 4,
        label: { show: true, position: 'outside', formatter: (p: any) => `${digits(Math.round(p.percent * 10) / 10)}%`, fontSize: 12, fontWeight: 700, color: th.text },
        labelLine: { show: true, length: 10, length2: 8 },
        emphasis: { scale: true, scaleSize: 5, label: { show: true, fontSize: 15, fontWeight: 800 } },
        data: [
          { name: tr('paid'), value: k.paid, itemStyle: { color: th.status.good }, filter: 'Paid' },
          { name: tr('pending'), value: k.pending, itemStyle: { color: th.status.warning }, filter: 'Pending' },
          { name: tr('overdue'), value: k.overdue, itemStyle: { color: th.status.critical }, filter: 'Overdue' },
        ],
      }],
    };

    const growth = {
      ...baseOption(th),
      color: [th.cat[0], th.cat[2]],
      grid: { left: 8, right: 12, top: 36, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: th.axis } }, formatter: tipMoney },
      legend: { ...(baseOption(th) as any).legend, data: [tr('balance'), tr('cashLine')] },
      xAxis: { ...categoryAxis(th, months), boundaryGap: false },
      yAxis: valueAxis(th, compact),
      series: [
        { name: tr('balance'), type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 8, showSymbol: false, lineStyle: { width: 2 },
          areaStyle: { opacity: 0.12 }, data: data.trend.map(p => Math.round(p.fundBalance)) },
        { name: tr('cashLine'), type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 8, showSymbol: false, lineStyle: { width: 2 },
          data: data.trend.map(p => Math.round(p.cashInHand)) },
      ],
    };

    const flow = {
      ...baseOption(th),
      color: [th.cat[2], th.cat[1], th.cat[6]],
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tipMoney },
      legend: { ...(baseOption(th) as any).legend, data: [tr('inflow'), tr('outExp'), tr('outInv')] },
      xAxis: categoryAxis(th, months),
      yAxis: valueAxis(th, compact),
      series: [
        { name: tr('inflow'), type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] }, label: valLbl('top'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => p.collected + p.lateFees) },
        { name: tr('outExp'), type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { borderColor: th.surface, borderWidth: 1 }, label: valLbl('bottom'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => -p.expenses) },
        { name: tr('outInv'), type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { borderRadius: [0, 0, 4, 4], borderColor: th.surface, borderWidth: 1 }, label: valLbl('bottom'), labelLayout: noOverlap, emphasis: valEmph, data: data.trend.map(p => -p.invested) },
      ],
    };

    const sectors = data.portfolio.map(p => tv(p.name));
    const portfolio = {
      ...baseOption(th),
      color: [th.cat[0], th.cat[2]],
      grid: { left: 8, right: 48, top: 36, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tipMoney },
      legend: { ...(baseOption(th) as any).legend, data: [tr('cost'), tr('value')] },
      xAxis: valueAxis(th, compact),
      yAxis: { ...categoryAxis(th, sectors), inverse: true },
      series: [
        { name: tr('cost'), type: 'bar', barMaxWidth: 12, barGap: '20%', itemStyle: { borderRadius: [0, 4, 4, 0], opacity: 0.4 }, label: valLbl('right'), emphasis: valEmph, data: data.portfolio.map(p => p.invested) },
        { name: tr('value'), type: 'bar', barMaxWidth: 12, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: valLbl('right'), emphasis: valEmph, data: data.portfolio.map(p => p.value) },
      ],
    };

    // fold categories beyond 7 into "Other" (never generate a 9th hue)
    const cats = data.expenseByCategory.slice(0, 7).map(c => ({ name: tv(c.name), value: c.value }));
    const rest = data.expenseByCategory.slice(7).reduce((a, c) => a + c.value, 0);
    if (rest > 0) cats.push({ name: language === 'bn' ? 'অন্যান্য' : 'Other', value: rest });
    const expenseDonut = {
      ...baseOption(th),
      color: th.cat,
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.marker}${p.name}<br/><b>${money(p.value)}</b> (${digits(p.percent)}%)` },
      legend: { ...(baseOption(th) as any).legend, type: 'scroll', orient: 'vertical', top: 'middle', right: 0, left: undefined },
      series: [{
        type: 'pie', radius: ['36%', '54%'], center: ['34%', '50%'], padAngle: 2, avoidLabelOverlap: true, minShowLabelAngle: 6,
        itemStyle: { borderRadius: 6, borderColor: th.surface, borderWidth: 2 },
        label: { show: true, position: 'outside', formatter: (p: any) => `${digits(Math.round(p.percent))}%`, fontSize: 11, fontWeight: 700, color: th.text },
        labelLine: { show: true, length: 8, length2: 6 },
        emphasis: { scale: true, scaleSize: 5, label: { show: true, fontSize: 14, fontWeight: 800, color: th.text } }, data: cats,
      }],
    };

    const startM = toMonthKey(data.trend[6]?.month || data.month);
    // Every day is drawn as its own rounded tile: paid days = [date, amount, count], empty days = [date, 0, 0].
    const calEnd = data.today < `${data.month}-31` ? data.today : `${data.month}-28`;
    const paidByDay = new Map(data.dailyCollections.map(d => [d.date, d] as const));
    const calDays: Array<[string, number, number]> = [];
    for (let t = new Date(`${startM}-01T00:00:00Z`); ; t.setUTCDate(t.getUTCDate() + 1)) {
      const iso = t.toISOString().slice(0, 10);
      if (iso > calEnd) break;
      const d = paidByDay.get(iso);
      calDays.push([iso, d?.value ?? 0, d?.count ?? 0]);
    }
    const heat = {
      ...baseOption(th),
      tooltip: { ...(baseOption(th) as any).tooltip, formatter: (p: any) => p.value[2] ? `${formatDate(p.value[0])}<br/><b>${money(p.value[1])}</b> · ${digits(p.value[2])} ${language === 'bn' ? 'টি পেমেন্ট' : 'payment(s)'}` : `${formatDate(p.value[0])}<br/>${language === 'bn' ? 'পেমেন্ট নেই' : 'No payment'}` },
      // Any day with a payment gets one strong colour (not shaded by amount); the amount is in the tooltip.
      visualMap: { show: false, type: 'piecewise', dimension: 1, pieces: [{ value: 0, color: th.dark ? '#22343d' : '#e6ecea' }, { gt: 0, color: th.dark ? '#34d399' : '#0f7a5c' }] },
      calendar: {
        top: 28, left: 34, right: 8, bottom: 4, cellSize: ['auto', 14],
        range: [`${startM}-01`, calEnd],
        itemStyle: { borderWidth: 0, color: 'transparent' },
        splitLine: { show: false }, yearLabel: { show: false },
        dayLabel: { color: th.textMuted, fontSize: 10, firstDay: 6, nameMap: language === 'bn' ? ['র', 'সো', 'ম', 'বু', 'বৃ', 'শু', 'শ'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
        monthLabel: { color: th.textMuted, fontSize: 10 },
      },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', itemStyle: { borderRadius: 4, borderColor: th.surface, borderWidth: 2 }, data: calDays }],
    };

    const topC = [...data.topContributors].reverse();
    const top = {
      ...baseOption(th),
      color: [th.cat[0]],
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${money(p.value)}</b>` },
      xAxis: { ...valueAxis(th, compact), show: false },
      yAxis: { ...categoryAxis(th, topC.map(c => bnName(c.name, c.name_bn))), axisLine: { show: false } },
      series: [{ type: 'bar', barMaxWidth: 12, itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: valLbl('right'), emphasis: valEmph,
        data: topC.map(c => c.total) }],
    };

    const methods = {
      ...baseOption(th),
      color: th.cat,
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(th) as any).tooltip, trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${money(p.value)}</b> · ${digits(data.paymentMethods[p.dataIndex]?.count ?? 0)}×` },
      xAxis: { ...valueAxis(th, compact), show: false },
      yAxis: { ...categoryAxis(th, data.paymentMethods.map(m => tv(m.name))), inverse: true, axisLine: { show: false } },
      series: [{ type: 'bar', barMaxWidth: 12, colorBy: 'data', itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: valLbl('right'), emphasis: valEmph,
        data: data.paymentMethods.map(m => m.value) }],
    };

    return { expectedVsCollected, statusDonut, returnsChart, growth, flow, portfolio, expenseDonut, heat, top, methods };
    // money/compact/mLabel/tr/digits/formatDate all derive from `language`; tv also tracks master data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, th, language, tv]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const exportCsv = async () => {
    if (!data) return;
    try {
      const m = (n: number) => cell(n, money(n));
      const doc: ExportDoc = {
        orgName: settings?.organization_name || 'Bondhu Fund', title: language === 'bn' ? 'সারসংক্ষেপ — ১২ মাসের হিসাব' : 'Overview — 12-month summary', subtitle: data.month,
        lang: language === 'bn' ? 'bn' : 'en', landscape: true, generatedOn: todayISO(),
        sections: [{
          columns: [{ header: 'Month' }, { header: 'Expected', kind: 'money' }, { header: 'Collected', kind: 'money' }, { header: 'Late fees', kind: 'money' }, { header: 'Collection rate', kind: 'pct' },
            { header: 'Expenses', kind: 'money' }, { header: 'New investments', kind: 'money' }, { header: 'Fund balance', kind: 'money' }, { header: 'Cash in hand', kind: 'money' }],
          rows: data.trend.map(p => [cell(p.month, mLabel(p.month)), m(p.expected), m(p.collected), m(p.lateFees), cell(p.rate, digits(p.rate) + '%'), m(p.expenses), m(p.invested), m(Math.round(p.fundBalance)), m(Math.round(p.cashInHand))]),
        }],
      };
      const r = await exportTable(doc, 'xlsx', `BondhuFund_Overview_${data.month}`);
      if (!r.canceled) showToast(`${tr('saved')}: ${r.filePath}`);
    } catch (e: any) { showToast(e.message, 'error'); }
  };
  const exportPdf = async () => {
    try { const r = await savePdf(`BondhuFund_Overview_${data?.month}.pdf`); if (!r.canceled) showToast(`${tr('saved')}: ${r.filePath}`); }
    catch (e: any) { showToast(e.message, 'error'); }
  };
  const startDemo = async () => {
    setBusy(true);
    try { await loadDemoData(); setDemoOpen(false); showToast(tr('demoLoaded')); triggerRefresh(); }
    catch (e: any) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  // Server titles are English templates: "<name> paid YYYY-MM" / "<name> joined".
  const recentTitle = (r: { kind: string; title: string }) => {
    if (r.kind === 'collection') {
      const m = r.title.match(/^(.*) paid (\d{4}-\d{2})$/);
      return m ? `${m[1]} ${tr('paidFor')} ${mLabel(m[2])}` : r.title;
    }
    if (r.kind === 'member') {
      const m = r.title.match(/^(.*) joined$/);
      return m ? `${m[1]} ${tr('joined')}` : r.title;
    }
    return r.title;
  };
  const goCollections = (status: string) => { setMemberFilterStatus(status); setActiveTab('collections'); };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading && !data) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6 animate-pulse">
        <div className="h-10 w-72 rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-72 rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</div>
      </div>
    );
  }
  if (!data || !opts) return null;
  const k = data.kpis;

  if (k.totalMembers === 0 && k.investmentCount === 0 && data.recent.length === 0) {
    return (
      <div className="p-6 lg:p-10 max-w-3xl mx-auto">
        <div className="card-base p-8 lg:p-10 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-light dark:bg-emerald-950/60 text-brand dark:text-emerald-400 flex items-center justify-center"><Sparkles size={26} /></div>
          <h1 className="mt-5 text-2xl font-black text-slate-900 dark:text-white">{tr('emptyTitle')}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 max-w-lg mx-auto">{tr('emptyBody')}</p>
          <div className={`mt-7 grid grid-cols-1 gap-3 ${canUpload ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <button onClick={() => setActiveTab('members')} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-brand text-white hover:bg-brand-hover font-bold text-sm"><UserPlus size={20} />{tr('addMember')}</button>
            <button onClick={() => setActiveTab('backup')} className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-300 dark:border-[#283e4a] text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-sm"><DatabaseBackup size={20} />{tr('restore')}</button>
            {canUpload && <button disabled={busy} onClick={() => setDemoOpen(true)} className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-300 dark:border-[#283e4a] text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-sm disabled:opacity-50"><Sparkles size={20} />{tr('demo')}</button>}
          </div>
        </div>
        <Modal open={demoOpen} onClose={() => setDemoOpen(false)} size="sm" tone="brand" locked={busy} icon={<Sparkles size={18} />} title={tr('demoTitle')}
          footer={<div className="flex flex-wrap justify-end gap-2">
            <button disabled={busy} onClick={() => setDemoOpen(false)} className="btn btn-cancel">{tr('cancel')}</button>
            <button disabled={busy} onClick={startDemo} className="btn btn-primary">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}{tr('demoLoad')}</button>
          </div>}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{tr('demoBody')}</p>
        </Modal>
      </div>
    );
  }

  const attentionCount = k.overdue + (data.attention.loansOverdue > 0 ? 1 : 0) + data.attention.reviews.length + data.attention.receiptCount + (data.attention.lastBackup === 'Never' ? 1 : 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-[1600px] mx-auto">
      {/* Header: one compact section. Row 1: greeting | actions (top right). Row 2: dates | clock. */}
      <section className="card-base px-5 py-4 lg:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-x-8 gap-y-3 items-center">
        <div className="min-w-0 ">
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">{hello}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{tr('subtitle')} <b className="text-slate-700 dark:text-slate-200">{fmtMonth(data.month, language as any, false)}</b></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print lg:justify-end">
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          <button onClick={exportCsv} className="btn btn-outline"><Download size={14} />{tr('export')}</button>
          <button onClick={exportPdf} className="btn btn-primary"><Printer size={14} />{tr('pdf')}</button>
        </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-[#22353f] flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <TodayDates />
          <ClockCard />
        </div>
      </section>

      {/* KPI tiles */}
      <div className="kpi-zoom grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 min-[1800px]:grid-cols-6 min-[2200px]:grid-cols-8 gap-4">
        <Kpi accent="purple" icon={<Wallet size={16} />} label={tr('netWorth')} value={money(k.netWorth)} delta={pct(k.fundBalance, k.prevFundBalance)} deltaLabel={tr('vsLast')} digits={digits} />
        <Kpi accent="blue" icon={<Landmark size={16} />} label={tr('cash')} value={money(k.cashInHand)} delta={pct(k.cashInHand, k.prevCashInHand)} deltaLabel={tr('vsLast')} digits={digits}
          note={k.loansOutstanding > 0 ? `${money(k.loansOutstanding)} ${tr('lentOut')}` : undefined} />
        <Kpi accent="green" icon={<HandCoins size={16} />} label={tr('collected')} value={money(k.monthCollected)}
          foot={<Progress value={k.collectionRate} label={`${digits(k.collectionRate)}% ${tr('of')} ${money(k.monthExpected)}`} />} />
        <Kpi accent="amber" icon={<AlertTriangle size={16} />} label={tr('outstanding')} value={money(k.outstanding)} tone={k.outstanding > 0 ? 'warn' : undefined}
          foot={<span className="text-[11px] text-slate-500 dark:text-slate-400">{digits(k.pending + k.overdue)} {tr('members_n')} · {language === 'bn' ? 'মোট বকেয়া' : 'total arrears'} {money(k.totalArrears)}</span>}
          onClick={() => goCollections('Overdue')} />
        <Kpi accent="teal" icon={<Building2 size={16} />} label={tr('portfolio')} value={money(k.portfolioValue)}
          foot={<span className={`text-[11px] font-bold ${k.unrealizedGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{k.unrealizedGain >= 0 ? '+' : '−'}{money(Math.abs(k.unrealizedGain))} {k.unrealizedGain >= 0 ? tr('gain') : tr('loss')}</span>}
          onClick={() => setActiveTab('investments')} />
        <Kpi accent="rose" icon={<Receipt size={16} />} label={tr('expenses')} value={money(k.monthExpenses)} delta={pct(k.monthExpenses, k.prevMonthExpenses)} deltaLabel={tr('vsLast')} invertDelta digits={digits}
          onClick={() => setActiveTab('expenses')} />
        {/* Late fees: this month + year to date */}
        <button onClick={() => setActiveTab('fines')} className="card-base accent-amber p-4 text-left flex flex-col gap-3 min-w-0 sm:col-span-2 hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">{tr('lateFees')}</span>
            <span className="w-7 h-7 shrink-0 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center"><Timer size={16} /></span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tr('lateMonth')} · {fmtMonth(data.month, language as any, true)}</div>
              <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums truncate">{money(k.monthLateFees)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{digits(k.monthLateCount)} {tr('latePayments')}
                · {tr('lateLast')} {money(k.prevMonthLateFees)}
              </div>
            </div>
            <div className="min-w-0 border-l border-slate-200 dark:border-[#22353f] pl-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tr('lateYear')} · {digits(data.month.slice(0, 4))} ({tr('lateToDate')})</div>
              <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums truncate">{money(k.yearLateFees)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{digits(k.yearLateCount)} {tr('latePayments')} · {tr('lateAll')} {money(k.lifetimeLateFees)}</div>
            </div>
          </div>
        </button>
        {/* Investment benefit / loss */}
        <Kpi accent="green" icon={<TrendingUp size={16} />} label={`${tr('retBenefit')} · ${fmtMonth(data.month, language as any, true)}`} value={money(k.monthReturnProfit)} onClick={() => setActiveTab('returns')}
          foot={<span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{tr('lateYear')} {money(k.yearReturnProfit)} · {tr('lateAll')} {money(k.lifetimeReturnProfit)}</span>} />
        <Kpi accent="rose" icon={<TrendingDown size={16} />} label={`${tr('retLoss')} · ${fmtMonth(data.month, language as any, true)}`} value={money(k.monthReturnLoss)} onClick={() => setActiveTab('returns')}
          foot={<span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{tr('lateYear')} {money(k.yearReturnLoss)} · {tr('lateAll')} {money(k.lifetimeReturnLoss)}</span>} />
        <button onClick={() => setActiveTab('returns')} className="card-base accent-blue p-4 text-left flex flex-col gap-3 min-w-0 sm:col-span-2 hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">{tr('retNet')}</span>
            <span className="w-7 h-7 shrink-0 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center"><Scale size={16} /></span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: `${tr('lateMonth')}`, v: k.monthReturnProfit - k.monthReturnLoss },
              { l: `${tr('lateYear')} · ${digits(data.month.slice(0, 4))}`, v: k.yearReturnProfit - k.yearReturnLoss },
              { l: tr('lateAll'), v: k.lifetimeReturnProfit - k.lifetimeReturnLoss },
            ].map((x, i) => (
              <div key={i} className={`min-w-0 ${i ? 'border-l border-slate-200 dark:border-[#22353f] pl-4' : ''}`}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">{x.l}</div>
                <div className={`text-xl font-black tracking-tight tabular-nums truncate ${x.v > 0 ? 'text-emerald-600 dark:text-emerald-400' : x.v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{x.v > 0 ? '+' : x.v < 0 ? '−' : ''}{money(Math.abs(x.v))}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{digits(k.lifetimeReturnCount)} {tr('retEntries')}</div>
        </button>
      </div>

      {/* Collections */}
      <Section icon={<HandCoins size={15} />} title={tr('collections')}>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <ChartCard className="xl:col-span-2" title={tr('expVsColl')} subtitle={tr('last12')} icon={<Activity size={15} />}
            empty={data.trend.every(p => !p.expected && !p.collected)} emptyText={tr('noData')}
            table={{ headers: [tr('hMonth'), tr('expected'), tr('collectedShort'), tr('hRate')], rows: data.trend.map(p => [mLabel(p.month), money(p.expected), money(p.collected), `${digits(p.rate)}%`]) }}>
            <EChart option={opts.expectedVsCollected} height={280} ariaLabel={tr('expVsColl')} />
          </ChartCard>
          <ChartCard roomy title={tr('status')} subtitle={fmtMonth(data.month, language as any, false)} icon={<PieIcon size={15} />}
            empty={k.dueMembers === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hStatus'), tr('members')], rows: [[tr('paid'), digits(k.paid)], [tr('pending'), digits(k.pending)], [tr('overdue'), digits(k.overdue)]] }}>
            <EChart option={opts.statusDonut} height={280} ariaLabel={tr('status')}
              onClick={(p: any) => p?.data?.filter && goCollections(p.data.filter)} />
          </ChartCard>
        </div>
      </Section>

      {/* Fund */}
      <Section icon={<TrendingUp size={15} />} title={tr('fund')}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard title={tr('balance')} subtitle={tr('last12')} icon={<Wallet size={15} />}
            table={{ headers: [tr('hMonth'), tr('balance'), tr('cashLine')], rows: data.trend.map(p => [mLabel(p.month), money(p.fundBalance), money(p.cashInHand)]) }}>
            <EChart option={opts.growth} height={280} ariaLabel={tr('balance')} />
          </ChartCard>
          <ChartCard title={tr('flow')} subtitle={tr('last12')} icon={<ArrowDownLeft size={15} />}
            empty={data.trend.every(p => !p.collected && !p.expenses && !p.invested)} emptyText={tr('noData')}
            table={{ headers: [tr('hMonth'), tr('hIn'), tr('outExp'), tr('outInv')], rows: data.trend.map(p => [mLabel(p.month), money(p.collected + p.lateFees), money(p.expenses), money(p.invested)]) }}>
            <EChart option={opts.flow} height={280} ariaLabel={tr('flow')} />
          </ChartCard>
        </div>
      </Section>

      {/* Portfolio & spending */}
      <Section icon={<Building2 size={15} />} title={tr('portfolioSpend')}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard title={tr('bySector')} subtitle={`${digits(k.investmentCount)} ${language === 'bn' ? 'টি সক্রিয় বিনিয়োগ' : 'active investments'}`} icon={<Building2 size={15} />}
            empty={data.portfolio.length === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hSector'), tr('cost'), tr('value'), tr('hGain')], rows: data.portfolio.map(p => [tv(p.name), money(p.invested), money(p.value), money(p.value - p.invested)]) }}>
            <EChart option={opts.portfolio} height={Math.max(200, 60 + data.portfolio.length * 46)} ariaLabel={tr('bySector')} />
          </ChartCard>
          <ChartCard roomy title={tr('byCategory')} subtitle={tr('last12')} icon={<Receipt size={15} />}
            empty={data.expenseByCategory.length === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hCategory'), tr('hAmount'), tr('hEntries')], rows: data.expenseByCategory.map(c => [tv(c.name), money(c.value), digits(c.count)]) }}>
            <EChart option={opts.expenseDonut} height={260} ariaLabel={tr('byCategory')} />
          </ChartCard>
          <ChartCard className="xl:col-span-2" title={tr('retChart')} subtitle={tr('last12')} icon={<TrendingUp size={15} />}
            empty={data.trend.every(p => !p.returnProfit && !p.returnLoss)} emptyText={tr('noData')}
            table={{ headers: [tr('hMonth'), tr('benefit'), tr('lossT'), tr('net')], rows: data.trend.map(p => [mLabel(p.month), money(p.returnProfit || 0), money(p.returnLoss || 0), money((p.returnProfit || 0) - (p.returnLoss || 0))]) }}>
            <EChart option={opts.returnsChart} height={260} ariaLabel={tr('retChart')} />
          </ChartCard>
        </div>
      </Section>

      {/* Members */}
      <Section icon={<Users size={15} />} title={tr('members')}>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <ChartCard className="xl:col-span-2" title={tr('heat')} subtitle={tr('heatSub')} icon={<CalendarDays size={15} />}
            empty={data.dailyCollections.length === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hDate'), tr('hAmount'), tr('hPayments')], rows: [...data.dailyCollections].sort((a, b) => b.date.localeCompare(a.date)).map(d => [formatDate(d.date), money(d.value), digits(d.count)]) }}>
            <EChart option={opts.heat} height={150} ariaLabel={tr('heat')} />
            <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="w-3 h-3 rounded" style={{ background: th.dark ? '#34d399' : '#0f7a5c' }} /><span>{language === 'bn' ? 'পেমেন্ট এসেছে' : 'Payment received'}</span>
              <span className="w-3 h-3 rounded ml-3" style={{ background: th.dark ? '#22343d' : '#e6ecea' }} /><span>{language === 'bn' ? 'পেমেন্ট নেই' : 'No payment'}</span>
            </div>
          </ChartCard>
          <ChartCard title={tr('methods')} subtitle={tr('last12')} icon={<Landmark size={15} />}
            empty={data.paymentMethods.length === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hMethod'), tr('hAmount'), tr('hPayments')], rows: data.paymentMethods.map(m => [tv(m.name), money(m.value), digits(m.count)]) }}>
            <EChart option={opts.methods} height={Math.max(150, 30 + data.paymentMethods.length * 34)} ariaLabel={tr('methods')} />
          </ChartCard>
          <ChartCard title={tr('top')} subtitle={language === 'bn' ? 'আজীবন অবদান' : 'Lifetime contribution'} icon={<Users size={15} />}
            empty={data.topContributors.length === 0} emptyText={tr('noData')}
            table={{ headers: [tr('hMember'), tr('hTotal')], rows: data.topContributors.map(c => [`${bnName(c.name, c.name_bn)} (${digits(c.member_code)})`, money(c.total)]) }}>
            <EChart option={opts.top} height={Math.max(180, 20 + data.topContributors.length * 30)} ariaLabel={tr('top')} />
          </ChartCard>
          <section className="card-base p-5 xl:col-span-2 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><AlertTriangle size={15} className="text-rose-500" />{tr('arrears')}</h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{digits(k.membersInArrears)} {tr('members_n')} · {money(k.totalArrears)}</span>
            </div>
            {data.arrears.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center flex items-center justify-center gap-2"><ShieldCheck size={16} className="text-emerald-500" />{tr('allClear')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#22353f]">
                    <th className="text-center py-2 font-bold w-10">{language === 'bn' ? 'নং' : 'No.'}</th>
                    <th className="text-left py-2 font-bold">{language === 'bn' ? 'সদস্য' : 'Member'}</th>
                    <th className="text-right py-2 font-bold">{language === 'bn' ? 'বকেয়া মাস' : 'Unpaid months'}</th>
                    <th className="text-right py-2 font-bold">{language === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
                    <th className="py-2" />
                  </tr></thead>
                  <tbody>
                    {data.arrears.slice(0, 8).map((a, __i) => (
                      <tr key={a.id} className="border-b border-slate-100 dark:border-[#1b2c34] last:border-0">
                        <td className="py-2 text-center text-slate-400 dark:text-slate-500 font-semibold tabular-nums">{serial(__i + 1)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2.5">
                            <span className="w-7 h-7 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 flex items-center justify-center text-[10px] font-black">{a.avatar_initials}</span>
                            <div><div className="font-bold text-slate-800 dark:text-slate-100">{bnName(a.name, a.name_bn)}</div><div className="text-[10px] text-slate-500">{digits(a.member_code)}{a.phone ? ` · ${digits(a.phone)}` : ''}</div></div>
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums font-bold text-slate-700 dark:text-slate-200">{digits(a.months)}</td>
                        <td className="py-2 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400">{money(a.amount)}</td>
                        <td className="py-2 text-right no-print">
                          <button onClick={() => { setSelectedMemberIdForPayment(a.id); setOpenRecordModal(true); }}
                            className="btn btn-primary btn-sm">{language === 'bn' ? 'আদায়' : 'Collect'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </Section>

      {/* Attention + activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="card-base p-5">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
            <BellRing size={15} className="text-amber-500" />{tr('attention')}
            {attentionCount > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-black">{digits(attentionCount)}</span>}
          </h3>
          <ul className="space-y-2">
            {k.overdue > 0 && <Attention tone="critical" icon={<AlertTriangle size={14} />} title={`${digits(k.overdue)} ${language === 'bn' ? 'জন সদস্যের বকেয়া মেয়াদোত্তীর্ণ' : 'members overdue this month'}`} sub={money(k.outstanding)} onClick={() => goCollections('Overdue')} />}
            {data.attention.loansOverdue > 0 && <Attention tone="critical" icon={<AlertTriangle size={14} />} title={`${digits(data.attention.loansOverdue)} ${language === 'bn' ? 'টি ব্যক্তিগত ঋণের কিস্তি বকেয়া' : 'personal loan(s) overdue'}`} sub={money(data.attention.loansOverdueAmount)} onClick={() => setActiveTab('loans')} />}
            {data.attention.reviews.map(r => <Attention key={r.id} tone="warning" icon={<Building2 size={14} />} title={`${r.name}`} sub={`${language === 'bn' ? 'রিভিউ' : 'Review'} ${formatDate(r.review_date)}`} onClick={() => setActiveTab('investments')} />)}
            {data.attention.receiptCount > 0 && <Attention tone="warning" icon={<FileWarning size={14} />} title={`${digits(data.attention.receiptCount)} ${language === 'bn' ? 'টি খরচের রসিদ প্রয়োজন' : 'expenses need a receipt'}`} sub={data.attention.receipts.slice(0, 2).map(r => r.title).join(', ')} onClick={() => setActiveTab('expenses')} />}
            {(data.attention.lastBackup === 'Never' || Date.now() - Date.parse(data.attention.lastBackup) > 7 * 864e5) &&
              <Attention tone="warning" icon={<DatabaseBackup size={14} />} title={language === 'bn' ? 'ব্যাকআপ নিন' : 'Back up your data'} sub={data.attention.lastBackup === 'Never' ? (language === 'bn' ? 'এখনও কোনো ব্যাকআপ নেই' : 'No manual backup yet') : `${language === 'bn' ? 'সর্বশেষ' : 'Last'} ${formatDate(data.attention.lastBackup.slice(0, 10))}`} onClick={() => setActiveTab('backup')} />}
            {attentionCount === 0 && <li className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center flex items-center justify-center gap-2"><ShieldCheck size={16} className="text-emerald-500" />{tr('allClear')}</li>}
          </ul>
        </section>
        <section className="card-base p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><Activity size={15} className="text-brand dark:text-emerald-400" />{tr('recent')}</h3>
            <button onClick={() => setOpenRecordModal(true)} className="no-print btn btn-green-outline btn-sm"><Plus size={12} />{language === 'bn' ? 'পেমেন্ট' : 'Record payment'}</button>
          </div>
          {data.recent.length === 0 ? <p className="text-xs text-slate-500 py-6 text-center">{tr('noData')}</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-[#1b2c34]">
              {data.recent.map(r => (
                <li key={`${r.kind}-${r.id}`} className="py-2.5 flex items-center gap-3">
                  <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${(r.kind === 'collection' || r.kind === 'repayment' || (r.kind === 'return' && r.amount >= 0)) ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400' : r.kind === 'member' ? 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'}`}>
                    {(r.kind === 'collection' || r.kind === 'repayment' || (r.kind === 'return' && r.amount >= 0)) ? <ArrowDownLeft size={14} /> : r.kind === 'member' ? <UserPlus size={14} /> : <ArrowUpRight size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{recentTitle(r)}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{r.kind === 'member' ? digits(r.sub) : tv(r.sub)} · {formatDate(r.date)}</div>
                  </div>
                  {r.amount !== 0 && <span className={`text-xs font-black tabular-nums ${r.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{r.amount > 0 ? '+' : '−'}{money(Math.abs(r.amount))}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <PrintSignatures />
    </div>
  );
};

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------
function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return +(((cur - prev) / Math.abs(prev)) * 100).toFixed(1);
}

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="space-y-3">
    <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
      <span className="text-brand dark:text-emerald-400">{icon}</span>{title}
      <span className="flex-1 h-px bg-slate-200 dark:bg-[#22353f] ml-2" />
    </h2>
    {children}
  </div>
);

const Kpi: React.FC<{
  accent?: string; icon: React.ReactNode; label: string; value: string; delta?: number | null; deltaLabel?: string; invertDelta?: boolean;
  foot?: React.ReactNode; note?: React.ReactNode; tone?: 'warn'; onClick?: () => void; digits?: (s: string | number) => string;
}> = ({ accent = 'green', icon, label, value, delta, deltaLabel, invertDelta, foot, note, tone, onClick, digits = String }) => {
  const good = delta === null || delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0;
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card-base accent-${accent} p-4 text-left flex flex-col gap-3 min-w-0 ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''} ${tone === 'warn' ? 'ring-1 ring-amber-300/60 dark:ring-amber-700/40' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">{label}</span>
        <span className="w-7 h-7 shrink-0 rounded-lg bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center">{icon}</span>
      </div>
      <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight tabular-nums truncate">{value}</div>
      {foot ?? (delta === null || delta === undefined ? <span className="text-[11px] text-slate-400">—</span> : (
        <span className={`flex items-center gap-1 text-[11px] font-bold ${delta === 0 ? 'text-slate-500' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {delta === 0 ? <Minus size={12} /> : delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {delta > 0 ? '+' : ''}{digits(delta)}% <span className="font-medium text-slate-400">{deltaLabel}</span>
        </span>
      ))}
      {note && <span className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1.5 truncate">{note}</span>}
    </Tag>
  );
};

const Progress: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div>
    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">{label}</div>
  </div>
);

const Attention: React.FC<{ tone: 'critical' | 'warning'; icon: React.ReactNode; title: string; sub?: string; onClick: () => void }> = ({ tone, icon, title, sub, onClick }) => (
  <li>
    <button onClick={onClick} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left">
      <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${tone === 'critical' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{title}</span>
        {sub && <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">{sub}</span>}
      </span>
      <ArrowUpRight size={14} className="text-slate-400 shrink-0" />
    </button>
  </li>
);

export default OverviewView;
