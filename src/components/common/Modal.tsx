import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalTone = 'brand' | 'danger' | 'warning';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** sm 520px · md 640px · lg 880px · xl 1080px */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Prevent closing by backdrop click / Esc (e.g. while saving) */
  locked?: boolean;
  className?: string;
  /**
   * Confirmation layout: icon on the left, title and message stacked to its right, perfectly aligned,
   * with no divider and no dead space. The tone colours the icon tile.
   */
  tone?: ModalTone;
}

const WIDTH = { sm: 'max-w-[520px]', md: 'max-w-[640px]', lg: 'max-w-[880px]', xl: 'max-w-[1080px]' };
const TONE: Record<ModalTone, string> = {
  brand: 'bg-emerald-50 text-[#0f6b50] border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900/60',
  danger: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900/60',
  warning: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60',
};
let openCount = 0;

/**
 * Standard dialog: soft frosted backdrop, spring-in / fade-out panel, Esc / outside click to close,
 * body scroll lock, focus moved into the dialog and restored afterwards.
 */
export const Modal: React.FC<ModalProps> = (props) => {
  const { open, onClose, size = 'md', locked, className = '', tone } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  // refs so parent re-renders (inline onClose) never re-run the open effect and steal focus
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Keep the last content on screen while the dialog fades out (parents often clear their state on close).
  const snap = useRef(props);
  if (open) snap.current = props;
  const { title, subtitle, icon, footer, children } = snap.current;

  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, 160);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement;
    openCount++;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, button:not([data-modal-close])');
    const timer = setTimeout(() => (first || panelRef.current)?.focus(), 40);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lockedRef.current) { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (--openCount === 0) document.body.style.overflow = '';
      lastFocus.current?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  const closeBtn = !snap.current.locked && !closing ? (
    <button type="button" data-modal-close onClick={onClose} aria-label="Close" title="Close" className="modal-close"><X size={17} strokeWidth={2.4} /></button>
  ) : null;

  const iconTile = (cls: string) => icon && (
    <div className={`w-11 h-11 shrink-0 rounded-xl border flex items-center justify-center ${cls}`}>{icon}</div>
  );

  return createPortal(
    <div className="modal-backdrop" data-closing={closing ? '' : undefined} onMouseDown={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} className={`modal-panel w-full ${WIDTH[size]} ${className}`}>
        {tone ? (
          /* Confirmation: [icon] title + message side by side, vertically centred title, tight spacing */
          <div className="flex items-start gap-4 px-7 pt-5 pb-4 overflow-y-auto">
            {iconTile(TONE[tone])}
            <div className="flex-1 min-w-0">
              <h2 className="min-h-[2.75rem] flex items-center text-[17px] font-extrabold text-slate-900 dark:text-white leading-snug">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1 mb-1">{subtitle}</p>}
              <div className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">{children}</div>
            </div>
            {closeBtn}
          </div>
        ) : (
          <>
            {(title || icon) && (
              <div className={`flex gap-4 px-7 pt-5 pb-4 border-b border-slate-200 dark:border-[#22353f] ${subtitle ? 'items-start' : 'items-center'}`}>
                {iconTile(TONE.brand)}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight">{title}</h2>
                  {subtitle && <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>}
                </div>
                {closeBtn}
              </div>
            )}
            <div className="px-7 py-5 overflow-y-auto flex-1">{children}</div>
          </>
        )}
        {footer && (
          <div className={`modal-footer ${tone ? "modal-footer-confirm " : ""}px-7 py-3.5 border-t border-slate-200 dark:border-[#22353f] flex flex-wrap items-center justify-end gap-3 bg-slate-50/70 dark:bg-[#0f1a20]/70 rounded-b-[1.1875rem]`}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
