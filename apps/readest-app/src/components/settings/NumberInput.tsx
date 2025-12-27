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
}) => {
  const _ = useTranslation();
  const [localValue, setLocalValue] = useState(value);
  const numberStep = step || 1;

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty string or valid numbers without leading zeros
    if (value === '' || /^[1-9]\d*\.?\d*$|^0?\.?\d*$/.test(value)) {
      const newValue = value === '' ? 0 : parseFloat(value);
      setLocalValue(newValue);

      if (!isNaN(newValue)) {
        const roundedValue = Math.round(newValue * 10) / 10;
        onChange(Math.max(min, Math.min(max, roundedValue)));
      }
    }
  };

  const increment = () => {
    const newValue = Math.min(max, localValue + numberStep);
    const roundedValue = Math.round(newValue * 10) / 10;
    setLocalValue(roundedValue);
    onChange(roundedValue);
  };

  const decrement = () => {
    const newValue = Math.max(min, localValue - numberStep);
    const roundedValue = Math.round(newValue * 10) / 10;
    setLocalValue(roundedValue);
    onChange(roundedValue);
  };

  const handleOnBlur = () => {
    const newValue = Math.max(min, Math.min(max, localValue));
    setLocalValue(newValue);
    onChange(newValue);
  };

  return (
    <div className={clsx('config-item', className)}>
      <span className='text-base-content line-clamp-2'>{label}</span>
      {iconSize && <span style={{ minWidth: `${iconSize}px` }} />}
      <div className='text-base-content flex items-center gap-2'>
        <input
          type='text'
          inputMode='decimal'
          disabled={disabled}
          value={localValue}
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
        <button
          tabIndex={disabled ? -1 : 0}
          aria-label={_('Decrease')}
          onClick={decrement}
          className={`btn btn-circle btn-sm ${value <= min || disabled ? 'btn-disabled !bg-opacity-5' : ''}`}
        >
          <FiMinus className='h-4 w-4' />
        </button>
        <button
          tabIndex={disabled ? -1 : 0}
          aria-label={_('Increase')}
          onClick={increment}
          className={`btn btn-circle btn-sm ${value >= max || disabled ? 'btn-disabled !bg-opacity-5' : ''}`}
        >
          <FiPlus className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};

export default NumberInput;
