import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

type Field = HTMLInputElement | HTMLTextAreaElement;
interface Spot { id: number; el: Field; x: number; y: number }
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', '']);

const editable = (el: Element): el is Field => {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) return false;
  return !el.readOnly && !el.disabled && el.dataset.noClear === undefined;
};

/**
 * One "×" for every editable field that has something written in it — always visible, hovered or not.
 * One click empties the field and keeps the cursor in it. Works for React-controlled inputs (a real input event is sent).
 * Fields hidden behind a dialog or scrolled out of their container get no button.
 */
export const ClearButtons: React.FC = () => {
  const { t } = useApp();
  const [spots, setSpots] = useState<Spot[]>([]);
  const ids = useRef(new WeakMap<Field, number>());
  const next = useRef(1);
  const raf = useRef(0);

  useEffect(() => {
    const scan = () => {
      raf.current = 0;
      const found: Spot[] = [];
      document.querySelectorAll<Field>('input, textarea').forEach(el => {
        if (!editable(el) || !el.value) return;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 16 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
        const offset = Number(el.dataset.clearOffset || 0);          // room for another button at the field's end (e.g. show/hide PIN)
        const isArea = el instanceof HTMLTextAreaElement;
        const x = r.right - 36 - offset, y = isArea ? r.top + 16 : r.top + r.height / 2;
        const top = document.elementFromPoint(r.right - 60 - offset, Math.min(Math.max(y, 1), innerHeight - 1));
        if (top !== el) return;                                       // covered by a dialog / clipped by a scroll area
        if (!ids.current.has(el)) ids.current.set(el, next.current++);
        found.push({ id: ids.current.get(el)!, el, x, y });
      });
      setSpots(prev => (prev.length === found.length && prev.every((p, i) => p.id === found[i].id && Math.abs(p.x - found[i].x) < 0.5 && Math.abs(p.y - found[i].y) < 0.5) ? prev : found));
    };
    const soon = () => { if (!raf.current) raf.current = requestAnimationFrame(scan); };
    const events = ['input', 'change', 'focusin', 'focusout', 'click', 'keyup', 'transitionend', 'animationend'];
    events.forEach(e => document.addEventListener(e, soon, true));
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    const timer = window.setInterval(soon, 250);                      // catches programmatic changes (forms that fill or reset themselves)
    soon();
    return () => {
      events.forEach(e => document.removeEventListener(e, soon, true));
      window.removeEventListener('scroll', soon, true);
      window.removeEventListener('resize', soon);
      window.clearInterval(timer);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const clear = (el: Field) => (e: React.MouseEvent) => {
    e.preventDefault();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));         // React sees a normal edit
    el.focus();
  };

  const label = t('common.clear', 'Clear');
  return (
    <>
      {spots.map(s => (
        <button
          key={s.id} type="button" tabIndex={-1} title={label} aria-label={label}
          onMouseDown={e => e.preventDefault()} onClick={clear(s.el)}
          style={{ position: 'fixed', left: s.x, top: s.y, transform: 'translateY(-50%)', zIndex: 2000 }}
          className="clear-x"
        >
          <X size={13} strokeWidth={2.6} />
        </button>
      ))}
    </>
  );
};
