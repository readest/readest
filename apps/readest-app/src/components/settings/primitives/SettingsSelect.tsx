import React, { useEffect, useRef } from 'react';
import { MdArrowDropDown } from 'react-icons/md';

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

// `:open` is unknown to engines without the in-page picker (WebKit), where
// `matches` throws; their popup is OS-drawn and takes the keys itself.
const isPickerOpen = (select: HTMLSelectElement) => {
  try {
    return select.matches(':open');
  } catch {
    return false;
  }
};

/**
 * Trailing-edge select for use inside `<SettingsRow>` / `<BoxedList>`. The
 * daisyui `<select>` has its own chrome suppressed (`border-0! bg-transparent!
 * bg-none! focus:outline-hidden! ...`); the wrapper carries a subtle fill so
 * the value and the `<MdArrowDropDown>` chevron read as one button, like the
 * font pickers. The chevron is drawn over the select's end padding with
 * `pointer-events-none`, so a press on it lands on the select (#7650) and the
 * native picker opens and closes as usual.
 *
 * Hover / focus state is signaled by the wrapper's bg-shift — no rings, per
 * DESIGN.md §5's "Why no ring?" rule.
 */
const SettingsSelect: React.FC<SettingsSelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}) => {
  const selectRef = useRef<HTMLSelectElement>(null);

  // The settings dialog listens for Escape on its <dialog> element, natively,
  // so it sees the key before the React `onKeyDown` below can stop it, and an
  // Escape meant for the open picker closed the whole dialog. Claim the key
  // natively, and only while the picker is open.
  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPickerOpen(select)) e.stopPropagation();
    };
    select.addEventListener('keydown', onKeyDown);
    return () => select.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    // The wrapper is the visible control (fill and chevron), so the picker
    // anchors to it rather than to the bare <select>; the name is scoped so a
    // page full of these rows resolves each picker to its own wrapper rather
    // than to the last one in tree order. `position-anchor` is applied to
    // `::picker(select)` in globals.css.
    <div className='[anchor-name:--settings-select] [anchor-scope:--settings-select] eink-bordered bg-base-200/70 hover:bg-base-300/70 focus-within:bg-base-300/70 relative inline-flex max-w-[60%] items-center rounded-md'>
      {/* No `appearance-none!` here: daisyUI's `.select` already hides the
          native arrow and, where supported, opts into `appearance: base-select`
          so the option popup is painted by the page in the app theme instead
          of by the OS (#5587). Size to the selected text so the shadow-root
          value sits against the trailing chevron, including short labels. */}
      <select
        ref={selectRef}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={disabled}
        aria-label={ariaLabel}
        className='select settings-content h-9 w-auto min-w-0 [field-sizing:content] cursor-pointer truncate border-0! bg-transparent! bg-none! pe-6! ps-2! text-end focus:border-0! focus:shadow-none! focus:outline-hidden! focus:ring-0! open:outline-hidden!'
        style={{
          textAlignLast: 'end',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <MdArrowDropDown
        aria-hidden='true'
        className='text-base-content/55 pointer-events-none absolute end-0.5 h-5 w-5'
      />
    </div>
  );
};

export default SettingsSelect;
