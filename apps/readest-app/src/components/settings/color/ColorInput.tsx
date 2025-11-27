import React, { useState, useEffect, useRef } from 'react';
import { SketchPicker, ColorResult } from 'react-color';

type ColorInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  pickerPosition?: 'left' | 'center' | 'right';
};

const ColorInput: React.FC<ColorInputProps> = ({
  label,
  value,
  onChange,
  compact = false,
  pickerPosition = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handlePickerChange = (colorResult: ColorResult) => {
    onChange(colorResult.hex);
  };

  const getPickerPositionClass = () => {
    if (pickerPosition === 'right') {
      return 'right-0';
    } else if (pickerPosition === 'center') {
      return 'left-1/2 -translate-x-1/2';
    }
    return 'left-0';
  };

  if (compact) {
    return (
      <div className='relative'>
        <input
          type='text'
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onClick={() => setIsOpen(!isOpen)}
          className='bg-base-100 text-base-content border-base-200/75 w-16 cursor-pointer rounded border px-1 py-0.5 text-center font-mono text-xs'
        />

        {isOpen && (
          <div
            ref={pickerRef}
            className={`absolute top-full z-50 py-1 ${getPickerPositionClass()}`}
          >
            <SketchPicker
              width='200px'
              color={value}
              onChange={handlePickerChange}
              disableAlpha={true}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className='mb-3'>
      <label className='mb-1 block text-sm font-medium'>{label}</label>
      <div className='flex items-center'>
        <button
          className='border-base-200/75 relative mr-2 flex h-7 w-8 cursor-pointer items-center justify-center overflow-hidden rounded border'
          style={{ backgroundColor: value }}
          onClick={() => setIsOpen(!isOpen)}
        />

        <input
          type='text'
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className='bg-base-100 text-base-content border-base-200/75 min-w-4 max-w-36 flex-1 rounded border p-1 font-mono text-sm'
        />
      </div>

      {isOpen && (
        <div ref={pickerRef} className='relative z-50 mt-2'>
          <div className='absolute'>
            <SketchPicker
              width='100%'
              color={value}
              onChange={handlePickerChange}
              disableAlpha={true}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorInput;
