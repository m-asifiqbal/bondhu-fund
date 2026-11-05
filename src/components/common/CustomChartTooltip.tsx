import React from 'react';

interface CustomChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  currencyPrefix?: string;
}

export const CustomChartTooltip: React.FC<CustomChartTooltipProps> = ({
  active,
  payload,
  label,
  currencyPrefix = 'TK',
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/95 dark:bg-[#0c161c]/95 backdrop-blur-md border border-slate-700/80 dark:border-slate-600/80 p-3 rounded-xl shadow-2xl text-xs z-50 pointer-events-none min-w-[140px] animate-in fade-in duration-75">
        {label && (
          <div className="font-bold text-slate-300 dark:text-slate-300 text-[11px] pb-1.5 mb-1.5 border-b border-slate-800 dark:border-slate-700/60">
            {label}
          </div>
        )}

        <div className="space-y-1.5">
          {payload.map((entry, index) => {
            const val = entry.value;
            const formattedVal =
              typeof val === 'number' ? `${currencyPrefix} ${val.toLocaleString()}` : val;
            const name = entry.name || entry.dataKey;

            return (
              <div key={`item-${index}`} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.color || entry.fill || '#10b981' }}
                  />
                  <span className="text-[11px] text-slate-300 truncate max-w-[120px]">
                    {name}
                  </span>
                </div>
                <span className="font-black text-white text-[12px] whitespace-nowrap">
                  {formattedVal}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};

