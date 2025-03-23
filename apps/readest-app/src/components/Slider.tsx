import React, { useEffect, useState } from 'react';

interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  initialValue?: number;
  heightPx?: number;
  minLabel?: string;
  maxLabel?: string;
  bubbleElement?: React.ReactNode;
  bubbleLabel?: string;
  className?: string;
  minClassName?: string;
  maxClassName?: string;
  bubbleClassName?: string;
  onChange?: (value: number) => void;
}

const Slider: React.FC<SliderProps> = ({
  min = 0,
  max = 100,
  step = 1,
  initialValue = 50,
  heightPx = 40,
  minLabel = '',
  maxLabel = '',
  bubbleElement,
  bubbleLabel = '',
  className = '',
  minClassName = '',
  maxClassName = '',
  bubbleClassName = '',
  onChange,
}) => {
  const [value, setValue] = useState(initialValue);

  const handleChange = (e: React.ChangeEvent) => {
    const newValue = parseInt((e.target as HTMLInputElement).value, 10);
    setValue(newValue);
    if (onChange) {
      onChange(newValue);
    }
  };

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`slider bg-base-200 mx-auto w-full max-w-md rounded-xl ${className}`}>
      <div className='relative' style={{ height: `${heightPx}px` }}>
        <div className='bg-base-300/40 absolute h-full w-full rounded-full'></div>
        <div
          className='bg-base-300 absolute h-full rounded-full'
          style={{ width: percentage > 0 ? `calc(${percentage}% + ${heightPx / 2}px)` : '0px' }}
        ></div>
        <div className='absolute inset-0 flex items-center justify-between px-4 text-sm'>
          <span className={`ml-2 ${minClassName}`}>{minLabel}</span>
          <span className={`mr-2 ${maxClassName}`}>{maxLabel}</span>
        </div>
        <div
          className='pointer-events-none absolute top-0 z-10'
          style={{
            left: `max(${heightPx / 2}px, calc(${percentage}%))`,
            transform: 'translateX(calc(-50%))',
            height: '100%',
          }}
        >
          <div
            className={`bg-base-200 flex h-full items-center justify-center rounded-full text-sm shadow-md ${bubbleClassName}`}
            style={{ width: `${heightPx}px` }}
          >
            {bubbleElement || bubbleLabel}
          </div>
        </div>
        <input
          type='range'
          min={min}
          max={max}
          step={step}
          value={value}
          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
          onChange={handleChange}
        />
      </div>
    </div>
  );
};

export default Slider;
