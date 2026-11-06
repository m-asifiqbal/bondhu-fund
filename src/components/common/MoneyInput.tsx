import React from 'react';
import { useApp } from '../../context/AppContext';

/**
 * Number input for money: the currency symbol sits at the start of the field and the amount is typed after it.
 * No increment / decrement arrows (hidden globally in index.css). Accepts every normal <input> prop.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className = '', ...rest }, ref) => {
  const { language, settings } = useApp();
  const symbol = language === 'bn' ? '৳' : settings?.currency_symbol || 'TK';
  return (
    <div className="money-field">
      <span className="money-prefix" aria-hidden="true">{symbol}</span>
      <input ref={ref} {...rest} type="number" inputMode="decimal" className={`${className} money-input`} />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';
