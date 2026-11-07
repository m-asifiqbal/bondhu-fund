import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from 'recharts';

interface Props {
  data: any[];
  axisTick: (v: number) => string;
  tooltip: React.ReactElement;
  investedLabel: string;
  estimatedLabel: string;
}

/** Invested vs estimated value by sector. Loaded on demand so the charting library is not read until a chart is drawn. */
const InvestmentsSectorChart: React.FC<Props> = ({ data, axisTick, tooltip, investedLabel, estimatedLabel }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} barGap={6}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={axisTick} width={48} />
      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={tooltip} />
      <Bar dataKey="invested" name={investedLabel} fill="#0f4a3c" radius={[6, 6, 0, 0]}>
        <LabelList dataKey="invested" position="top" fontSize={9} fontWeight={600} fill="#64748b" formatter={(v: any) => (Number(v) ? axisTick(Number(v)) : '')} />
      </Bar>
      <Bar dataKey="estimated" name={estimatedLabel} fill="#d97706" radius={[6, 6, 0, 0]}>
        <LabelList dataKey="estimated" position="top" fontSize={9} fontWeight={600} fill="#64748b" formatter={(v: any) => (Number(v) ? axisTick(Number(v)) : '')} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

export default InvestmentsSectorChart;
