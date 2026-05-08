'use client';

import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { PIN_LENGTH } from '@/libs/crypto/applock';

interface PinInputProps {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  shake?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  /**
   * When true, the component keeps focus pinned to the hidden input —
   * used by the full-screen lock screen so the on-screen keyboard
   * stays available even after taps elsewhere on the page.
   */
  stickyFocus?: boolean;
  /** Form-level autocomplete hint. */
  autoComplete?: 'one-time-code' | 'current-password' | 'new-password';
}

export interface PinInputHandle {
  focus: () => void;
}

const PinDot = ({ filled }: { filled: boolean }) => (
  <div
    className={clsx(
      'eink-bordered flex h-12 w-10 items-center justify-center rounded-lg border',
      'border-base-content/20 bg-base-200/60',
      filled && 'border-base-content/40',
    )}
  >
    <span
      className={clsx(
        'inline-block h-3 w-3 rounded-full transition-opacity',
        filled ? 'bg-base-content opacity-100' : 'opacity-0',
      )}
    />
  </div>
);

const PinInput = forwardRef<PinInputHandle, PinInputProps>(function PinInput(
  {
    value,
    onChange,
    autoFocus,
    shake,
    disabled,
    ariaLabel,
    stickyFocus,
    autoComplete = 'one-time-code',
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  useEffect(() => {
    if (autoFocus) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [autoFocus]);

  useEffect(() => {
    if (!stickyFocus) return;
    const focus = () => inputRef.current?.focus();
    focus();
    const t = window.setInterval(focus, 200);
    return () => window.clearInterval(t);
  }, [stickyFocus]);

  const handleClick = () => inputRef.current?.focus();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    onChange(next);
  };

  return (
    <label className='relative block w-fit cursor-pointer' onClick={handleClick}>
      <span className='sr-only'>{ariaLabel}</span>
      <input
        ref={inputRef}
        type='password'
        inputMode='numeric'
        pattern='[0-9]*'
        maxLength={PIN_LENGTH}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        className='absolute inset-0 z-10 cursor-pointer opacity-0'
      />
      <div className={clsx('flex gap-3', shake && 'animate-pin-shake')}>
        {Array.from({ length: PIN_LENGTH }).map((_dot, i) => (
          <PinDot key={i} filled={i < value.length} />
        ))}
      </div>
    </label>
  );
});

export default PinInput;
