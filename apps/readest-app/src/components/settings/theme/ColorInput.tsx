import React, { useState, useEffect, useRef } from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { CgColorPicker } from 'react-icons/cg';
import { eventDispatcher } from '@/utils/event';

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

// Pickers stack: a second one can open by keyboard (Enter on another swatch
// never fires the mousedown that would close the first), so more than one can be
// live at a time. Only the most recently opened one answers Escape — every open
// picker listens on document, and stopPropagation does not stop the other
// listeners on that same node, so without this one key press would close them
// all.
const openPickers: Array<() => void> = [];

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
  // Read through a ref so a caller that rebuilds `onCommit` on every render (the
  // highlight editor does, from the colour being edited) cannot re-run the
  // registration effect below: that would move this picker to the top of
  // `openPickers` and hand it an Escape meant for a later one.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

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

  // The settings dialog claims Escape on the <dialog> element (and on window) to
  // mean "step back one level", so while the picker is open Escape would cancel
  // the whole page — in the theme editor that drops the entire unsaved draft when
  // the user only meant to put the picker away.
  //
  // Captured on document rather than bound to the picker or its wrapper: the
  // popup can stay open while focus moves elsewhere (Shift+Tab never fires the
  // mousedown that closes it), and the key has to be claimed before the dialog's
  // listeners see it.
  //
  // Android Back takes the same way out. Sync `native-key-down` listeners run
  // newest first and the dialog's registered when it opened, so the most recently
  // opened picker answers before the dialog or any picker opened earlier.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => {
      setIsOpen(false);
      // The colour was already applied live on every onChange; closing the popup
      // is the "interaction settled" moment onCommit exists for, whichever way it
      // closes. Skipping it here would leave auto-save consumers (Word Lens gloss
      // colour) with the new swatch showing but the old value stored.
      onCommitRef.current?.();
    };
    openPickers.push(close);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openPickers[openPickers.length - 1] !== close) return;
      event.stopPropagation();
      close();
    };
    const handleBackKey = (event: CustomEvent) => {
      if (event.detail?.keyName !== 'Back') return false;
      close();
      return true;
    };
    document.addEventListener('keydown', handleKeyDown, true);
    eventDispatcher.onSync('native-key-down', handleBackKey);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      eventDispatcher.offSync('native-key-down', handleBackKey);
      const index = openPickers.indexOf(close);
      if (index !== -1) openPickers.splice(index, 1);
    };
  }, [isOpen]);

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
        className='border-base-300 focus-visible:ring-base-content/20 focus-visible:ring-offset-base-100 h-7 w-7 rounded-full border-2 shadow-xs transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1'
        style={{ backgroundColor: value }}
        aria-label={label || 'Choose color'}
        title={label || 'Choose color'}
      />
      {showPickerIcon && (
        <button
          type='button'
          onClick={() => setIsOpen(!isOpen)}
          className='text-base-content/60 hover:bg-base-200 hover:text-base-content focus-visible:ring-base-content/15 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2'
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
