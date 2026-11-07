import React, { useEffect, useRef, useState } from 'react';
import { serial } from '../../utils/i18n';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, CalendarComponent, VisualMapComponent,
  MarkLineComponent, AxisPointerComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { Table2, BarChart3 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, CalendarComponent, VisualMapComponent,
  MarkLineComponent, AxisPointerComponent, SVGRenderer,
]);

// ---------------------------------------------------------------------------
// Palette (validated reference instance; light & dark are separately stepped)
// ---------------------------------------------------------------------------
export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
/** Reserved for state (always paired with a text label). */
export const STATUS = {
  light: { good: '#0f8a4a', warning: '#d18a00', critical: '#d03b3b', neutral: '#94a3b8' },
  dark: { good: '#2fb36b', warning: '#e0a325', critical: '#e66767', neutral: '#64748b' },
};
/** Single-hue sequential ramp (brand teal), light → dark. */
export const SEQUENTIAL = {
  light: ['#e6f3ee', '#b5dccb', '#7cc0a5', '#3f9c7c', '#0f4a3c'],
  dark: ['#173029', '#1d4d3e', '#24705a', '#2f9677', '#5cc9a2'],
};

export interface ChartTheme {
  dark: boolean;
  text: string; textMuted: string; grid: string; axis: string; surface: string; tooltipBg: string; tooltipBorder: string;
  cat: string[]; status: typeof STATUS.light; seq: string[];
}

export function chartTheme(dark: boolean): ChartTheme {
  return {
    dark,
    text: dark ? '#e2e8f0' : '#0f172a',
    textMuted: dark ? '#94a3b8' : '#64748b',
    grid: dark ? '#22353f' : '#e8eef0',
    axis: dark ? '#2c4250' : '#cbd5e1',
    surface: dark ? '#142026' : '#ffffff',
    tooltipBg: dark ? '#0f1a20' : '#ffffff',
    tooltipBorder: dark ? '#2c4250' : '#e2e8f0',
    cat: dark ? CATEGORICAL.dark : CATEGORICAL.light,
    status: dark ? STATUS.dark : STATUS.light,
    seq: dark ? SEQUENTIAL.dark : SEQUENTIAL.light,
  };
}

/** Shared option fragments so every chart reads as one system. */
export function baseOption(th: ChartTheme): EChartsCoreOption {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif', color: th.text },
    tooltip: {
      backgroundColor: th.tooltipBg,
      borderColor: th.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: th.text, fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);',
    },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: th.textMuted, fontSize: 11 } },
  };
}

export const valueAxis = (th: ChartTheme, fmt: (v: number) => string) => ({
  type: 'value',
  axisLabel: { color: th.textMuted, fontSize: 11, formatter: fmt },
  splitLine: { lineStyle: { color: th.grid } },
  axisLine: { show: false },
  axisTick: { show: false },
});

export const categoryAxis = (th: ChartTheme, data: string[]) => ({
  type: 'category',
  data,
  axisLabel: { color: th.textMuted, fontSize: 11 },
  axisLine: { lineStyle: { color: th.axis } },
  axisTick: { show: false },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
  onClick?: (params: any) => void;
  className?: string;
  ariaLabel?: string;
}

export const EChart: React.FC<EChartProps> = ({ option, height = 260, onClick, className, ariaLabel }) => {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: 'svg' });
    // Resize at once the first time, then only when the size has settled — redrawing on every frame of an
    // animated resize (e.g. the sidebar sliding) stalls the whole window.
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; chart.current?.resize(); return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => chart.current?.resize(), 90);
    });
    ro.observe(ref.current);
    return () => { if (timer) clearTimeout(timer); ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onClick) return;
    c.on('click', onClick);
    return () => { c.off('click', onClick); };
  }, [onClick]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={className} style={{ height, width: '100%' }} />;
};

// ---------------------------------------------------------------------------
// Card with chart/table toggle (every chart has an accessible table view)
// ---------------------------------------------------------------------------
interface ChartCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  table?: { headers: string[]; rows: Array<Array<React.ReactNode>> };
  empty?: boolean;
  emptyText?: string;
  className?: string;
  /** Larger title and more air between title and diagram (donut / pie cards). */
  roomy?: boolean;
  children: React.ReactNode;
}

export const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, icon, actions, table, empty, emptyText, className = '', roomy, children }) => {
  const { t } = useApp();
  const [showTable, setShowTable] = useState(false);
  const toggleLabel = showTable ? t('chart.show_chart', 'Show chart') : t('chart.show_table', 'Show table');
  return (
    <section className={`card-base p-5 flex flex-col min-w-0 ${className}`}>
      <header className={`flex items-start justify-between gap-3 ${roomy ? 'mb-6' : 'mb-3'}`}>
        <div className="flex items-start gap-2.5 min-w-0">
          {icon && <div className="mt-0.5 w-8 h-8 shrink-0 rounded-xl bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center">{icon}</div>}
          <div className="min-w-0">
            <h3 className={`${roomy ? 'text-[17px]' : 'text-sm'} font-extrabold text-slate-900 dark:text-white truncate`}>{title}</h3>
            {subtitle && <p className={`${roomy ? 'text-xs mt-1' : 'text-[11px] mt-0.5'} text-slate-500 dark:text-slate-400`}>{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          {table && !empty && (
            <button
              type="button"
              onClick={() => setShowTable(s => !s)}
              title={toggleLabel}
              aria-label={toggleLabel}
              className="btn btn-outline btn-sm btn-icon"
            >
              {showTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
            </button>
          )}
        </div>
      </header>
      {empty ? (
        <div className="flex-1 min-h-[160px] flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 text-center px-6">
          {emptyText || t('chart.no_data', 'No data to show yet')}
        </div>
      ) : showTable && table ? (
        <div className="overflow-auto max-h-[320px] -mx-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-[#142026]">
              <tr><th className="py-2 px-2 w-10 text-center font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#22353f]">{t('common.no', 'No.')}</th>{table.headers.map((h, i) => <th key={i} className={`py-2 px-2 font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#22353f] ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-[#1b2c34] last:border-0">
                  <td className="py-2 px-2 text-center text-slate-400 font-semibold tabular-nums">{serial(i + 1)}</td>
                  {r.map((c, j) => <td key={j} className={`py-2 px-2 text-slate-700 dark:text-slate-200 ${j ? 'text-right tabular-nums' : ''}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
};
