import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

type Field = HTMLInputElement | HTMLTextAreaElement;
interface Spot { id: number; el: Field; host: HTMLElement; left: number; top: number }
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', '']);   // password fields have their own eye button (PasswordInput)
const ids = new WeakMap<Field, number>();
let nextId = 1;

const editable = (el: Element): el is Field => {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) return false;
  return !el.readOnly && !el.disabled && el.dataset.noClear === undefined;
};

/**
 * One "×" for every editable field that has something written in it, always visible.
 * The button lives inside the field's own container (absolutely positioned), so it scrolls together with the field —
 * it can never lag or shake while a page or dialog scrolls, and it is naturally hidden behind dialogs / clipped by scroll areas.
 * One click empties the field and keeps the cursor in it; React-controlled inputs get a real input event.
 */
export const ClearButtons: React.FC = () => {
  const { t } = useApp();
  const [spots, setSpots] = useState<Spot[]>([]);

  useEffect(() => {
    let raf = 0;
    const scan = () => {
      raf = 0;
      const found: Spot[] = [];
      document.querySelectorAll<Field>('input, textarea').forEach(el => {
        if (!editable(el) || !el.value) return;
        const host = el.parentElement;
        if (!host || el.offsetWidth < 40 || el.offsetHeight < 16) return;      // not displayed
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';   // so offsets are relative to the host
        const offset = Number(el.dataset.clearOffset || 0);                    // room for another button at the field's end (e.g. show/hide PIN)
        const isArea = el instanceof HTMLTextAreaElement;
        if (!ids.has(el)) ids.set(el, nextId++);
        found.push({
          id: ids.get(el)!, el, host,
          left: el.offsetLeft + el.offsetWidth - 36 - offset,
          top: el.offsetTop + (isArea ? 16 : el.offsetHeight / 2),
        });
      });
      setSpots(prev => (prev.length === found.length && prev.every((p, i) => p.id === found[i].id && p.host === found[i].host && Math.abs(p.left - found[i].left) < 0.5 && Math.abs(p.top - found[i].top) < 0.5) ? prev : found));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(scan); };
    // layout only changes on these (never on scroll): input, focus, resize, animations, and a light poll for programmatic changes
    const events = ['input', 'change', 'focusin', 'focusout', 'click', 'keyup', 'transitionend', 'animationend'];
    events.forEach(e => document.addEventListener(e, soon, true));
    window.addEventListener('resize', soon);
    const timer = window.setInterval(soon, 250);
    soon();
    return () => {
      events.forEach(e => document.removeEventListener(e, soon, true));
      window.removeEventListener('resize', soon);
      window.clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const clear = (el: Field) => (e: React.MouseEvent) => {
    e.preventDefault();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  const label = t('common.clear', 'Clear');
  return (
    <>
      {spots.map(s => createPortal(
        <button
          key={s.id} type="button" tabIndex={-1} title={label} aria-label={label}
          onMouseDown={e => e.preventDefault()} onClick={clear(s.el)}
          style={{ position: 'absolute', left: s.left, top: s.top, transform: 'translateY(-50%)', zIndex: 5 }}
          className="clear-x"
        >
          <X size={13} strokeWidth={2.6} />
        </button>, s.host, `clear-${s.id}`))}
    </>
  );
};
