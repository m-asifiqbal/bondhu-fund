import React, { useEffect, useState } from 'react';

/** Selector for the small icon buttons inside tables / lists that need a readable label. */
const TARGET = '.btn-act, main table .btn-icon, main table button[data-tip]';

/**
 * One global tooltip for table action icons — same look as the collapsed-sidebar labels, large and readable.
 * It takes over the native `title`, so there is never a second tiny tooltip.
 */
export const ActionTips: React.FC = () => {
  const [tip, setTip] = useState<{ label: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const labelOf = (el: HTMLElement) => {
      const title = el.getAttribute('title');
      if (title) { el.setAttribute('data-tip', title); el.removeAttribute('title'); }
      return el.getAttribute('data-tip') || el.getAttribute('aria-label') || '';
    };
    const show = (el: HTMLElement) => {
      const label = labelOf(el);
      if (!label) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 70;
      current = el;
      setTip({ label, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    };
    const hide = () => { current = null; setTip(null); };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.(TARGET) as HTMLElement | null;
      if (el && !(el as HTMLButtonElement).disabled) { if (el !== current) show(el); } else if (current) hide();
    };
    const out = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.(TARGET);
      if (el && el === current) hide();
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div role="tooltip" className={`act-tip ${tip.below ? 'act-tip-below' : ''}`} style={{ left: tip.x, top: tip.y }}>{tip.label}</div>
  );
};
