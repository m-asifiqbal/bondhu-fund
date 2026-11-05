import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** sm 420px · md 560px · lg 720px · xl 920px */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Prevent closing by backdrop click / Esc (e.g. while saving) */
  locked?: boolean;
  className?: string;
}

const WIDTH = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[720px]', xl: 'max-w-[920px]' };
let openCount = 0;

/**
 * Standard dialog: soft frosted backdrop (not a black sheet), scale-in panel, Esc / outside click to close,
 * body scroll lock, focus moved into the dialog and restored afterwards.
 */
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, subtitle, icon, size = 'md', footer, children, locked, className = '' }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  // refs so parent re-renders (inline onClose) never re-run the open effect and steal focus
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement;
    openCount++;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, button:not([data-modal-close])');
    const timer = setTimeout(() => (first || panelRef.current)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lockedRef.current) { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (--openCount === 0) document.body.style.overflow = '';
      lastFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} className={`modal-panel w-full ${WIDTH[size]} ${className}`}>
        {(title || icon) && (
          <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-[#22353f]">
            {icon && <div className="w-10 h-10 shrink-0 rounded-xl bg-brand-light dark:bg-emerald-950/50 text-brand dark:text-emerald-400 flex items-center justify-center">{icon}</div>}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>}
            </div>
            {!locked && (
              <button type="button" data-modal-close onClick={onClose} aria-label="Close"
                className="p-2 -m-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 dark:border-[#22353f] flex items-center justify-end gap-2.5 bg-slate-50/60 dark:bg-[#0f1a20]/60 rounded-b-3xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
