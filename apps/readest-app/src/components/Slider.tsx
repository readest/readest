import React, { useEffect, useRef, useState } from 'react';

interface SliderProps {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  initialValue?: number;
  heightPx?: number;
  minLabel?: string;
  maxLabel?: string;
  minIcon?: React.ReactNode;
  maxIcon?: React.ReactNode;
  bubbleElement?: React.ReactNode;
  bubbleLabel?: string;
  className?: string;
  minClassName?: string;
  maxClassName?: string;
  bubbleClassName?: string;
  onChange?: (value: number) => void;
  valueToPosition?: (value: number, min: number, max: number) => number;
  positionToValue?: (position: number, min: number, max: number) => number;
}

const Slider: React.FC<SliderProps> = ({
  label,
  min = 0,
  max = 100,
  step = 1,
  initialValue = 50,
  heightPx = 40,
  minLabel = '',
  maxLabel = '',
  minIcon,
  maxIcon,
  bubbleElement,
  bubbleLabel = '',
  className = '',
  minClassName = '',
  maxClassName = '',
  bubbleClassName = '',
  onChange,
  valueToPosition,
  positionToValue,
}) => {
  const [value, setValue] = useState(initialValue);
  const [isRtl, setIsRtl] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Default linear mapping functions
  const defaultValueToPosition = (val: number, minVal: number, maxVal: number) => {
    return ((val - minVal) / (maxVal - minVal)) * 100;
  };

  const defaultPositionToValue = (pos: number, minVal: number, maxVal: number) => {
    return minVal + (pos / 100) * (maxVal - minVal);
  };

  const valueToPos = valueToPosition || defaultValueToPosition;
  const posToValue = positionToValue || defaultPositionToValue;

  const handleChange = (e: React.ChangeEvent) => {
    const position = parseInt((e.target as HTMLInputElement).value, 10);
    const newValue = Math.round(posToValue(position, min, max) / step) * step;
    setValue(newValue);
    if (onChange) {
      onChange(newValue);
    }
  };

  useEffect(() => {
    let node: HTMLElement | null = sliderRef.current;
    while (node) {
      if (node.getAttribute('dir') === 'rtl') {
        setIsRtl(true);
        break;
      }
      node = node.parentElement;
    }
  }, []);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const percentage = valueToPos(value, min, max);
  const visualPercentage = (percentage / 100) * 95;

  return (
    <div
      ref={sliderRef}
      aria-label={label}
      className={`slider bg-base-200 mx-auto w-full rounded-xl ${className}`}
      dir={isRtl ? 'rtl' : undefined}
    >
      <div className='relative' style={{ height: `${heightPx}px` }}>
        {/* Background track */}
        <div className='bg-base-300/40 absolute h-full w-full rounded-full'></div>
        {/* Filled portion */}
        <div
          className='bg-base-300 absolute h-full rounded-full'
          style={{
            width:
              visualPercentage > 0
                ? `max(calc(${visualPercentage}% + ${heightPx / 2}px), ${heightPx}px)`
                : '0px',
            [isRtl ? 'right' : 'left']: 0,
          }}
        ></div>
        {/* Min/Max labels */}
        <div className='absolute inset-0 flex items-center justify-between px-4 text-sm'>
          {minIcon ? minIcon : <span className={`ml-2 ${minClassName}`}>{minLabel}</span>}
          {maxIcon ? maxIcon : <span className={`mr-2 ${maxClassName}`}>{maxLabel}</span>}
        </div>
        {/* Thumb bubble */}
        <div
          className='pointer-events-none absolute top-0 z-10'
          style={{
            [isRtl ? 'right' : 'left']: `max(${heightPx / 2}px, calc(${visualPercentage}%))`,
            transform: isRtl ? 'translateX(calc(50%))' : 'translateX(calc(-50%))',
            height: '100%',
          }}
        >
          <div
            className={`bg-base-200 flex h-full items-center justify-center rounded-full text-xs shadow-md ${bubbleClassName}`}
            style={{ width: `${heightPx}px` }}
          >
            {bubbleElement || bubbleLabel}
          </div>
        </div>
        <input
          type='range'
          min={0}
          max={100}
          step={step}
          value={percentage}
          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
          onChange={handleChange}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${value}`}
          aria-orientation='horizontal'
        />
      </div>
    </div>
  );
};

export default Slider;
