import React, { useState, useEffect, useRef } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { CgColorPicker } from 'react-icons/cg';

type ColorInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Fires when the picker popup closes. Useful for auto-save flows where you
   * want to pin the chosen color when the interaction settles, not on every
   * onChange tick.
   */
  onCommit?: () => void;
  /**
   * Render a small palette icon button immediately after the swatch. Both the
   * swatch and the icon open the picker; the icon adds an explicit "click to
   * change" affordance for users who might otherwise read the swatch as a
   * passive preview.
   */
  showPickerIcon?: boolean;
  pickerPosition?: 'left' | 'center' | 'right';
};

const ColorInput: React.FC<ColorInputProps> = ({
  label,
  value,
  onChange,
  onCommit,
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

  const handlePickerChange = (colorResultHex: string) => {
    onChange(colorResultHex);
  };

  // Anchored positioning only applies from `sm` up; below that the popup is
  // rendered as a centered floating card (see the popup container classes) so
  // it can never overflow the panel and cause horizontal scrolling.
  const getPickerPositionClass = () => {
    if (pickerPosition === 'right') {
      return 'sm:start-auto sm:end-0 sm:translate-x-0';
    } else if (pickerPosition === 'center') {
      return 'sm:start-1/2';
    }
    return 'sm:start-0 sm:translate-x-0';
  };

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
          className={`fixed start-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 sm:absolute sm:top-full sm:mt-2 sm:translate-y-0 flex flex-col gap-2 rounded-lg border not-eink:border-base-300/50 bg-base-100 p-3 not-eink:shadow-xl items-center ${getPickerPositionClass()}`}
        >
          <HexColorPicker
            color={value}
            onChange={handlePickerChange}
            className='eink-bordered rounded-lg m-2'
          />
          <HexColorInput
            color={value}
            onChange={handlePickerChange}
            prefixed
            className='rounded-md px-2 py-1 bg-base-300 text-base-content w-[200px] font-mono eink-bordered'
          />
        </div>
      )}
    </div>
  );
};

export default ColorInput;
