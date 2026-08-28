import React from 'react';
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

/**
 * Chromeless trailing-edge select for use inside `<SettingsRow>` /
 * `<BoxedList>`. Renders the daisyui `<select>` element with all chrome
 * suppressed (`border-0! bg-transparent! bg-none! focus:outline-hidden! ...`)
 * plus a real `<MdArrowDropDown>` icon at the cell's trailing edge so the
 * chevron lands at the same X as toggles in adjacent rows.
 *
 * Hover / focus state is signaled by a wrapper bg-shift
 * (`hover:bg-base-200/60 focus-within:bg-base-200/60`) — no rings, per
 * DESIGN.md §5's "Why no ring?" rule.
 */
const SettingsSelect: React.FC<SettingsSelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}) => {
  return (
    <div className='flex max-w-[60%] items-center rounded-md focus-within:bg-transparent hover:bg-transparent'>
      {/* No `appearance-none!` here: daisyUI's `.select` already hides the
          native arrow and, where supported, opts into `appearance: base-select`
          so the option popup is painted by the page in the app theme instead
          of by the OS (#5587). */}
      <select
        value={value}
        onChange={onChange}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={disabled}
        aria-label={ariaLabel}
        className='select settings-content h-9 min-w-0 cursor-pointer truncate border-0! bg-transparent! bg-none! pe-1! ps-2! text-end focus:border-0! focus:shadow-none! focus:outline-hidden! focus:ring-0! open:outline-hidden!'
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
        className='text-base-content/55 pointer-events-none h-5 w-5 shrink-0'
      />
    </div>
  );
};

export default SettingsSelect;
