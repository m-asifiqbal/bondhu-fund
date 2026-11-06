import React, { useLayoutEffect, useRef, useState } from 'react';

export interface SegItem<T extends string> {
  key: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** small count badge after the label */
  count?: React.ReactNode;
  title?: string;
}

interface Props<T extends string> {
  items: SegItem<T>[];
  value: T;
  onChange(key: any): void;   // callers pass their own typed setState
  size?: 'md' | 'sm';
  className?: string;
  ariaLabel?: string;
}

/**
 * Segmented control with a solid-green selection pill that slides (and resizes) to the chosen tab.
 * The selected tab is solid green with white text; the badge pops when it becomes active.
 */
export function SegmentedTabs<T extends string>({ items, value, onChange, size = 'md', className = '', ariaLabel }: Props<T>) {
  const wrap = useRef<HTMLDivElement>(null);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;
  // Only update state when the numbers really changed — a fresh object every time re-renders forever.
  const measure = () => {
    const b = btns.current[valueRef.current];
    if (!b) return;
    const x = b.offsetLeft, w = b.offsetWidth;
    setBox(prev => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Measure before paint; only start animating after the first measurement so the pill never slides in from 0.
  useLayoutEffect(() => {
    measure();
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [value, items.length, items.map(i => (typeof i.label === 'string' ? i.label : '')).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-measure when fonts load / the container resizes. One observer for the component's lifetime.
  useLayoutEffect(() => {
    const run = () => measureRef.current();
    const ro = new ResizeObserver(run);
    if (wrap.current) ro.observe(wrap.current);
    Object.values(btns.current).forEach(b => b && ro.observe(b));
    (document as any).fonts?.ready?.then(run);
    return () => ro.disconnect();
  }, [items.length]);

  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex(x => x.key === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length];
    onChange(target.key);
    btns.current[target.key]?.focus();
  };

  return (
    <div ref={wrap} role="tablist" aria-label={ariaLabel} onKeyDown={onKey} className={`seg ${size === 'sm' ? 'seg-sm' : ''} ${className}`}>
      <span
        aria-hidden
        className="seg-ind"
        style={{
          width: box?.w ?? 0, opacity: box ? 1 : 0,
          transform: `translateX(${box?.x ?? 0}px)`,
          transitionDuration: animate ? undefined : '0s',
        }}
      />
      {items.map(it => {
        const selected = it.key === value;
        return (
          <button
            key={it.key}
            ref={el => { btns.current[it.key] = el; }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={it.title}
            onClick={() => onChange(it.key)}
            className="seg-btn"
          >
            {it.icon}
            <span>{it.label}</span>
            {it.count !== undefined && <span className="seg-count">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedTabs;
