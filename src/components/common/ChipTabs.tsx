import React from 'react';
import type { SegItem } from './SegmentedTabs';

interface Props<T extends string> {
  items: SegItem<T>[];
  value: T;
  onChange(key: any): void;
  className?: string;
  ariaLabel?: string;
}

/**
 * Rounded selection chips for filters (notifications, status filters, quick lists).
 * Each chip is its own pill: outlined when idle, solid green with white text when selected.
 */
export function ChipTabs<T extends string>({ items, value, onChange, className = '', ariaLabel }: Props<T>) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex(x => x.key === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(items[(next + items.length) % items.length].key);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={onKey} className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map(it => {
        const selected = it.key === value;
        return (
          <button key={it.key} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} title={it.title}
            onClick={() => onChange(it.key)} className="chip">
            {it.icon}
            <span>{it.label}</span>
            {it.count !== undefined && <span className="chip-count">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default ChipTabs;
