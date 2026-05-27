import React, { useState, useEffect, useRef } from 'react';
import { SketchPicker, ColorResult } from 'react-color';
import { CgColorPicker } from 'react-icons/cg';

type ColorInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Fires when the user finishes choosing a color — i.e. the hex input loses
   * focus (compact mode) or the picker popup closes. Useful for auto-save
   * flows where you want to pin the chosen color when the interaction
   * settles, not on every onChange tick.
   */
  onCommit?: () => void;
  compact?: boolean;
  /**
   * Render only the color swatch as a circular button — no hex input. Click
   * the swatch to open the picker. Cleaner UX for casual users who don't
   * care about the hex value.
   */
  swatchOnly?: boolean;
  /**
   * In `swatchOnly` mode, render a small palette icon button immediately
   * after the swatch. Both the swatch and the icon open the picker; the
   * icon adds an explicit "click to change" affordance for users who might
   * otherwise read the swatch as a passive preview.
   */
  showPickerIcon?: boolean;
  pickerPosition?: 'left' | 'center' | 'right';
};

const ColorInput: React.FC<ColorInputProps> = ({
  label,
  value,
  onChange,
  onCommit,
  compact = false,
  swatchOnly = false,
  showPickerIcon = false,
  pickerPosition = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Picker close = "user is done choosing" — emit commit so callers
        // can run auto-save logic (e.g. pin to a Quick Colors palette).
        onCommit?.();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onCommit]);

  const handlePickerChange = (colorResult: ColorResult) => {
    onChange(colorResult.hex);
  };

  const getPickerPositionClass = () => {
    if (pickerPosition === 'right') {
      return 'end-0';
    } else if (pickerPosition === 'center') {
      return 'start-1/2 -translate-x-1/2';
    }
    return 'start-0';
  };

  if (swatchOnly) {
    return (
      <div className='relative flex items-center gap-1.5'>
        <button
          type='button'
          onClick={() => setIsOpen(!isOpen)}
          className='border-base-300 focus-visible:ring-base-content/20 focus-visible:ring-offset-base-100 h-7 w-7 rounded-full border-2 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1'
          style={{ backgroundColor: value }}
          aria-label={label || 'Choose color'}
          title={label || 'Choose color'}
        />
        {showPickerIcon && (
          <button
            type='button'
            onClick={() => setIsOpen(!isOpen)}
            className='text-base-content/60 hover:bg-base-200 hover:text-base-content focus-visible:ring-base-content/15 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2'
            aria-label={label || 'Choose color'}
            title={label || 'Choose color'}
          >
            <CgColorPicker className='h-5 w-5' />
          </button>
        )}
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

  if (compact) {
    return (
      <div className='relative'>
        <input
          type='text'
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.()}
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
          className='border-base-200/75 relative me-2 flex h-7 w-8 cursor-pointer items-center justify-center overflow-hidden rounded border'
          style={{ backgroundColor: value }}
          onClick={() => setIsOpen(!isOpen)}
        />

        <input
          type='text'
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.()}
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
