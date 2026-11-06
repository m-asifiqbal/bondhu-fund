import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

type Field = HTMLInputElement | HTMLTextAreaElement;
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', '']);

/** An editable text field that already has something written in it. */
const eligible = (el: EventTarget | null): el is Field => {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) return false;
  return !el.readOnly && !el.disabled && el.dataset.noClear === undefined;
};

/**
 * One "×" for every editable field: appears at the end of the field once something is written, clears it with one click
 * and keeps the cursor in the field. Works for React-controlled inputs (the change is sent as a real input event).
 */
export const ClearButtons: React.FC = () => {
  const { t } = useApp();
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const target = useRef<Field | null>(null);
  const hoverBtn = useRef(false);
  const hideTimer = useRef<number>();

  useEffect(() => {
    const place = () => {
      const el = target.current;
      if (!el || !el.isConnected || !el.value) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { setBox(null); return; }
      const offset = Number(el.dataset.clearOffset || 0);            // room for another button at the field's end (e.g. show/hide PIN)
      const isArea = el instanceof HTMLTextAreaElement;
      setBox({ x: r.right - 36 - offset, y: isArea ? r.top + 14 : r.top + r.height / 2 });
    };
    const show = (e: Event) => {
      if (!eligible(e.target)) return;
      window.clearTimeout(hideTimer.current);
      target.current = e.target;
      place();
    };
    const leave = () => {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        const el = target.current;
        if (hoverBtn.current || (el && (document.activeElement === el || el.matches(':hover')))) return;
        target.current = null; setBox(null);
      }, 160);
    };
    const onInput = (e: Event) => { if (e.target === target.current) place(); };
    document.addEventListener('focusin', show);
    document.addEventListener('mouseover', show);
    document.addEventListener('focusout', leave);
    document.addEventListener('mouseout', leave);
    document.addEventListener('input', onInput);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('input', onInput);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  const clear = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = target.current;
    if (!el) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));         // React sees a normal edit
    el.focus();
    setBox(null);
  };

  if (!box) return null;
  const label = t('common.clear', 'Clear');
  return (
    <button
      type="button" tabIndex={-1} title={label} aria-label={label}
      onMouseDown={e => e.preventDefault()} onClick={clear}
      onMouseEnter={() => { hoverBtn.current = true; }} onMouseLeave={() => { hoverBtn.current = false; }}
      style={{ position: 'fixed', left: box.x, top: box.y, transform: 'translateY(-50%)', zIndex: 2000 }}
      className="clear-x"
    >
      <X size={13} strokeWidth={2.6} />
    </button>
  );
};
