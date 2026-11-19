import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdArrowDropDown } from 'react-icons/md';

const MENU_GAP = 4;
// Keeps parity with the `max-h-60` class, which is the resting cap.
const MENU_MAX_HEIGHT = 240;

interface SettingsSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SettingsSelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SettingsSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * Trailing-edge select for `<SettingsRow>` / `<BoxedList>`. The value and the
 * chevron share one raised button so the whole control is a single hit area,
 * matching the font pickers; clicking it twice opens and dismisses the menu.
 *
 * The native `<select>` stays in the tree as the labelled `combobox`, so
 * assistive tech and anything that reads or writes the control's value (tests
 * included) keeps working. It is `sr-only` and out of the tab order: the button
 * is what the pointer and the keyboard drive. The select is uncontrolled --
 * a controlled `value` makes React install a value tracker, whose getter keeps
 * reporting the old value after the native setter writes the picked one -- so
 * the `value` prop is mirrored onto it with an effect instead.
 */
const SettingsSelect: React.FC<SettingsSelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const selected = options.find((opt) => opt.value === value);

  // Native selects drop their popup above the control when it would otherwise
  // be clipped, and clamp it to the room that is left so every option stays
  // reachable by scrolling. The settings panel scrolls its own content, so the
  // visible edge is that scroller rather than the window.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      let limitTop = 0;
      let limitBottom = window.innerHeight;
      for (let el = button.parentElement; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
          const box = el.getBoundingClientRect();
          limitTop = Math.max(limitTop, box.top);
          limitBottom = Math.min(limitBottom, box.bottom);
          break;
        }
      }
      const rect = button.getBoundingClientRect();
      const spaceBelow = limitBottom - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - limitTop - MENU_GAP;
      // scrollHeight is the unclamped content height, so measuring it never
      // feeds the clamp back into itself.
      const contentHeight = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
      const above = spaceBelow < contentHeight && spaceAbove > spaceBelow;
      const room = Math.max(0, above ? spaceAbove : spaceBelow);
      let maxHeight: number | null = null;
      if (room < contentHeight) {
        // Snap to whole rows: a menu cut through the middle of an option reads
        // as clipped, which is exactly what this clamp exists to avoid.
        const padding =
          parseFloat(getComputedStyle(menu).paddingTop) +
          parseFloat(getComputedStyle(menu).paddingBottom);
        const rowHeight = menu.querySelector('li > button')?.clientHeight ?? 0;
        const rows = rowHeight > 0 ? Math.floor((room - padding) / rowHeight) : 0;
        maxHeight = rows > 0 ? padding + rows * rowHeight : room;
      }
      setDropUp(above);
      setMenuMaxHeight(maxHeight);
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // A long list would otherwise start at the first option even when the value
  // sits far down it, so open on the current one -- again what the native
  // popup does.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const current = menu.querySelector('[aria-selected="true"]') as HTMLElement | null;
    if (current) {
      menu.scrollTop = Math.max(
        0,
        current.offsetTop - (menu.clientHeight - current.offsetHeight) / 2,
      );
    }
  }, [open, menuMaxHeight]);

  // Dismiss on an outside press. Escape is handled on the focused control
  // itself so it doesn't bubble out and close the whole settings dialog.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Mirror the prop onto the uncontrolled select. Without this, a caller that
  // rejects a pick (and rolls its state back), or a value that arrives after
  // mount, would leave the native control reporting the stale option.
  useEffect(() => {
    const select = selectRef.current;
    if (!select || select.value === value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') setOpen(false);
  };

  const pick = (option: SettingsSelectOption) => {
    if (option.disabled) return;
    const select = selectRef.current;
    if (select) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
  };

  return (
    <div className='flex max-w-[60%] items-center justify-end'>
      <div ref={rootRef} className='relative inline-flex max-w-full'>
        <button
          ref={buttonRef}
          type='button'
          aria-haspopup='listbox'
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          onKeyDown={handleKeyDown}
          className='flex h-9 max-w-full items-center gap-1 rounded-md bg-base-200/70 px-2 text-end transition-colors hover:bg-base-300/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-base-content/40 disabled:cursor-default disabled:opacity-60'
        >
          <span className='min-w-0 truncate text-sm'>{selected?.label ?? value}</span>
          <MdArrowDropDown aria-hidden='true' className='text-base-content/55 h-5 w-5 shrink-0' />
        </button>

        {open && !disabled && (
          <ul
            ref={menuRef}
            role='listbox'
            onKeyDown={handleKeyDown}
            style={menuMaxHeight ? { maxHeight: menuMaxHeight } : undefined}
            className={`absolute end-0 z-50 max-h-60 min-w-full overflow-auto overscroll-contain rounded-md bg-base-100 p-1 shadow-lg ring-1 ring-base-300 ${
              dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
            {options.map((opt) => (
              <li key={opt.value} role='option' aria-selected={opt.value === value}>
                <button
                  type='button'
                  disabled={opt.disabled}
                  onClick={() => pick(opt)}
                  className={`flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-start text-sm whitespace-nowrap hover:bg-base-200 disabled:cursor-default disabled:opacity-40 ${
                    opt.value === value ? 'bg-base-200' : ''
                  }`}
                >
                  <span>{opt.label}</span>
                  {opt.value === value && <span aria-hidden='true'>✓</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <select
        ref={selectRef}
        defaultValue={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={-1}
        className='sr-only'
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SettingsSelect;
