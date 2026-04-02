import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import { useTranslation } from '@/hooks/useTranslation';

interface NumberInputProps {
  className?: string;
  inputClassName?: string;
  label: string;
  iconSize?: number;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  'data-setting-id'?: string;
}

const NumberInput: React.FC<NumberInputProps> = ({
  className,
  inputClassName,
  label,
  iconSize,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  'data-setting-id': settingId,
}) => {
  const _ = useTranslation();
  const [displayValue, setDisplayValue] = useState(String(value));
  const numberStep = step || 1;

  useEffect(() => {
    setDisplayValue(String(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow empty string or valid number fragments while typing
    if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
      setDisplayValue(raw);
    }
  };

  const commitValue = (v: number) => {
    const clamped = Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;
    setDisplayValue(String(clamped));
    onChange(clamped);
  };

  const currentNumericValue = parseFloat(displayValue) || 0;

  const increment = () => commitValue(currentNumericValue + numberStep);
  const decrement = () => commitValue(currentNumericValue - numberStep);
  const handleOnBlur = () => commitValue(currentNumericValue);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    commitValue(currentNumericValue);
    (document.activeElement as HTMLElement)?.blur();
  };

  return (
    <div className={clsx('config-item', className)} data-setting-id={settingId}>
      <span className='text-base-content line-clamp-2'>{label}</span>
      {iconSize && <span style={{ minWidth: `${iconSize}px` }} />}
      <div className='text-base-content flex items-center gap-2'>
        <form onSubmit={handleSubmit}>
          <input
            type='text'
            inputMode='decimal'
            disabled={disabled}
            value={displayValue}
            onChange={handleChange}
            onBlur={handleOnBlur}
            className={clsx(
              'input input-ghost settings-content text-base-content w-16 max-w-xs rounded border-0 bg-transparent pe-3 !outline-none',
              label && 'py-1 ps-1 text-right',
              disabled && 'input-disabled cursor-not-allowed disabled:bg-transparent',
              inputClassName,
            )}
            onFocus={(e) => e.target.select()}
          />
        </form>
        <button
          tabIndex={disabled ? -1 : 0}
          aria-label={_('Decrease')}
          onClick={decrement}
          className={`btn btn-circle btn-sm ${currentNumericValue <= min || disabled ? 'btn-disabled !bg-opacity-5' : ''}`}
        >
          <FiMinus className='h-4 w-4' />
        </button>
        <button
          tabIndex={disabled ? -1 : 0}
          aria-label={_('Increase')}
          onClick={increment}
          className={`btn btn-circle btn-sm ${currentNumericValue >= max || disabled ? 'btn-disabled !bg-opacity-5' : ''}`}
        >
          <FiPlus className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};

export default NumberInput;
