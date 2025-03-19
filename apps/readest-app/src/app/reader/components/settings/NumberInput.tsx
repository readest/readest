import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';

interface NumberInputProps {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

const NumberInput: React.FC<NumberInputProps> = ({
  className,
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}) => {
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
      <span className='text-base-content'>{label}</span>
      <div className='text-base-content flex items-center gap-2'>
        <input
          type='text'
          inputMode='decimal'
          value={localValue}
          onChange={handleChange}
          onBlur={handleOnBlur}
          className='input input-ghost settings-content text-base-content w-20 max-w-xs rounded border-0 bg-transparent px-3 py-1 text-right !outline-none'
          onFocus={(e) => e.target.select()}
        />
        <button
          onClick={decrement}
          className={`btn btn-circle btn-sm ${value <= min || disabled ? 'btn-disabled !bg-opacity-5' : ''}`}
        >
          <FiMinus className='h-4 w-4' />
        </button>
        <button
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
