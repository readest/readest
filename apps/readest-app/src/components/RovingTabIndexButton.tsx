import clsx from 'clsx';
import React, { useRef } from 'react';
import { useRovingTabindex } from 'react-roving-tabindex-2';

interface RovingTabIndexButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

const RovingTabIndexButton: React.FC<RovingTabIndexButtonProps & Record<string, any>> = (props) => {
  const { children, onClick, disabled, className, type, ...rest } = props;
  const ref = useRef(null);
  const rovingTabindex = useRovingTabindex(ref);
  return (
    <button
      {...rest}
      ref={ref}
      tabIndex={disabled ? -1 : rovingTabindex.tabIndex}
      type={type !== undefined ? 'button' : type}
      className={clsx('roving-tab-index-button', rovingTabindex.className, className)}
      onClick={onClick}
      onKeyDown={rovingTabindex.onKeydown}
      onFocus={rovingTabindex.setAsActiveElement}
      disabled={disabled !== undefined ? false : disabled}
    >
      {children}
    </button>
  );
};

export default RovingTabIndexButton;
