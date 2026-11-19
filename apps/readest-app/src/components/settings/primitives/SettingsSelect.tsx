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
  const valueLabel = selected?.label ?? value;
  // A caller can swap `options` while the menu is open (a filter reset, a
  // language change). The placement effect has to see that, or it keeps a
  // height budget and a side that belonged to the previous list.
  const optionSignature = options
    .map((opt) => `${opt.value}\u0000${opt.label}\u0000${opt.disabled ? 1 : 0}`)
    .join('\u0001');
  // Selection is written through the native select, then reported to the
  // caller. If the caller rejects the change, no render follows to correct the
  // DOM, so the latest prop is kept here for the deferred check in `pick`.
  const valueRef = useRef(value);
  valueRef.current = value;

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
  }, [open, optionSignature]);

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
  }, [open, menuMaxHeight, value]);

  // Dismiss on an outside press.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Escape has to close only the menu. The settings dialog listens for Escape
  // on the native <dialog>, which sees the key before any React handler on a
  // descendant, so an onKeyDown alone would take the dialog down with the menu.
  // Catch it in the capture phase and close over it -- but only while focus is
  // still inside this control: the menu can outlive a Shift+Tab, and then the
  // key belongs to whatever the user moved to.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const root = rootRef.current;
      const active = document.activeElement;
      // Someone else owns the key once focus sits on another control. A body
      // (no focus at all) still belongs to us: the trigger is what opened this.
      const claimedElsewhere = !!active && active !== document.body && !root?.contains(active);
      if (!root || claimedElsewhere) {
        // Dismiss without claiming the key or the focus.
        setOpen(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
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
  };

  const pick = (option: SettingsSelectOption) => {
    if (option.disabled) return;
    const select = selectRef.current;
    if (select) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // The caller owns the value: when it rejects the pick, no render follows
      // and the select would keep reporting an option the UI never took. Put
      // the DOM back once the change has had its chance to land.
      window.setTimeout(() => {
        const el = selectRef.current;
        if (!el || el.value === valueRef.current) return;
        setter?.call(el, valueRef.current);
      }, 0);
    }
    setOpen(false);
    // The option that had focus is about to unmount; without this, focus falls
    // back to the document body and keyboard users lose their place.
    buttonRef.current?.focus();
  };

  return (
    <div className='flex max-w-[60%] items-center justify-end'>
      <div ref={rootRef} className='relative inline-flex max-w-full'>
        <button
          ref={buttonRef}
          type='button'
          aria-haspopup='listbox'
          aria-expanded={open}
          // The visible text is only the value, so the setting's own label has
          // to come from `ariaLabel`; keeping the value in the name preserves
          // "label in name" for voice control.
          aria-label={ariaLabel ? `${ariaLabel}: ${valueLabel}` : undefined}
          disabled={disabled}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          onKeyDown={handleKeyDown}
          className='settings-content eink-bordered flex h-9 max-w-full items-center gap-1 rounded-md bg-base-200/70 px-2 text-end transition-colors hover:bg-base-300/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-base-content/40 disabled:cursor-default disabled:opacity-60'
        >
          <span className='min-w-0 truncate'>{valueLabel}</span>
          <MdArrowDropDown aria-hidden='true' className='text-base-content/55 h-5 w-5 shrink-0' />
        </button>

        {open && !disabled && (
          <ul
            ref={menuRef}
            role='listbox'
            // A standalone listbox needs a name of its own; the hidden select
            // labels the combobox, not this popup.
            aria-label={ariaLabel}
            onKeyDown={handleKeyDown}
            style={menuMaxHeight ? { maxHeight: menuMaxHeight } : undefined}
            className={`eink-bordered absolute end-0 z-50 max-h-60 min-w-full overflow-auto overscroll-contain rounded-md bg-base-100 p-1 shadow-lg ring-1 ring-base-300 ${
              dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
            }`}
          >
            {options.map((opt) => (
              <li key={opt.value} role='option' aria-selected={opt.value === value}>
                <button
                  type='button'
                  disabled={opt.disabled}
                  onClick={() => pick(opt)}
                  className={`settings-content flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-start whitespace-nowrap hover:bg-base-200 disabled:cursor-default disabled:opacity-40 ${
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
