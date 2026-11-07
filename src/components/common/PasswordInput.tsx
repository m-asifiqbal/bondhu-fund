import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Controlled visibility (e.g. one eye for several fields). Leave out for a field that manages its own. */
  show?: boolean;
  onShowChange?: (visible: boolean) => void;
  /** Decoration drawn inside the field at its start (the caller adds the left padding). */
  icon?: React.ReactNode;
};

/**
 * Password / PIN field: an eye button shows or hides what was typed. It never gets the "×" clear button
 * (data-no-clear) so the two controls cannot overlap, and a secret is never one stray click from being wiped.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
  ({ show, onShowChange, icon, className = 'form-input', ...rest }, ref) => {
    const { t } = useApp();
    const [own, setOwn] = useState(false);
    const visible = show ?? own;
    const label = visible ? t('auth.hide_password', 'Hide password') : t('auth.show_password', 'Show password');
    return (
      <div className="relative">
        {icon}
        <input
          autoCapitalize="off" spellCheck={false}
          {...rest} ref={ref}
          type={visible ? 'text' : 'password'}
          data-no-clear=""
          className={`${className} !pr-11`}
        />
        <button
          type="button" tabIndex={-1} title={label} aria-label={label} aria-pressed={visible}
          onMouseDown={e => e.preventDefault()}
          onClick={() => (onShowChange ? onShowChange(!visible) : setOwn(v => !v))}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
