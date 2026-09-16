import React, { useEffect, useState } from 'react';

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
  heightPx = 44,
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
    setValue(initialValue);
  }, [initialValue]);

  const percentage = Math.max(0, Math.min(100, valueToPos(value, min, max)));
  const thumbRadius = heightPx / 2;
  const thumbOffset = Math.abs((0.5 - percentage / 100) * heightPx);
  const thumbPosition =
    percentage <= 0
      ? `${thumbRadius}px`
      : percentage >= 100
        ? `calc(100% - ${thumbRadius}px)`
        : `calc(${percentage}% ${percentage < 50 ? '+' : '-'} ${thumbOffset}px)`;
  const fillWidth =
    percentage <= 0
      ? '0px'
      : percentage >= 100
        ? '100%'
        : `max(calc(${percentage}% + ${(1 - percentage / 100) * heightPx}px), ${heightPx}px)`;

  // The track, the fill and the thumb are placed with logical properties, so the
  // browser mirrors them from the inherited direction — the same source the
  // native range input reads. Resolving the direction in JS instead (a one-shot
  // ancestor walk for dir='rtl') went stale: the reader's footer bar derives its
  // dir from viewSettings.rtl, which FoliateViewer only computes once the first
  // document loads, and the panels are mounted before that. The input mirrored
  // and the visuals did not, so the thumb ran away from the drag (#6157).
  return (
    <div aria-label={label} className={`slider bg-base-200 mx-auto w-full rounded-xl ${className}`}>
      <div className='relative' style={{ height: `${heightPx}px` }}>
        {/* Background track */}
        <div className='bg-base-300/40 absolute h-full w-full rounded-full'></div>
        {/* Filled portion */}
        <div
          className='slider-fill bg-base-300 absolute h-full rounded-full'
          style={{
            width: fillWidth,
            insetInlineStart: 0,
          }}
        ></div>
        {/* Min/Max labels */}
        <div className='absolute inset-0 flex items-center justify-between px-4 text-sm'>
          {minIcon ? minIcon : <span className={`ml-2 ${minClassName}`}>{minLabel}</span>}
          {maxIcon ? maxIcon : <span className={`mr-2 ${maxClassName}`}>{maxLabel}</span>}
        </div>
        {/* Thumb bubble */}
        <div
          className='slider-thumb pointer-events-none absolute top-0 z-10'
          style={{
            insetInlineStart: thumbPosition,
            // The bubble is exactly `heightPx` wide, so a negative start margin
            // centers it on `thumbPosition`. `transform: translateX(-50%)` would
            // do the same but has no logical form, and would have to flip sign
            // by hand for right-to-left.
            marginInlineStart: `-${thumbRadius}px`,
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
          className='slider-input absolute inset-0 h-full min-h-12 w-full cursor-pointer opacity-0'
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
