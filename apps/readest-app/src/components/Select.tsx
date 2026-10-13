import clsx from 'clsx';
import React from 'react';

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Option[];
  disabled?: boolean;
  className?: string;
};

export default function Select({
  value,
  onChange,
  options,
  className,
  disabled = false,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.stopPropagation()}
      className={clsx(
        // Transparent so the select takes the color of whatever surface it sits
        // on (these all live in popups) instead of tinting a block onto it.
        // `w-auto` overrides daisyUI 5's `width: clamp(3rem,20rem,100%)`, which
        // stretches the box to its max width whatever the value is and strands
        // the label at the far start of it. Sizing to the value is what puts the
        // label against the chevron at the end of the row — `text-align-last`
        // below cannot, because `appearance: base-select` paints the value into
        // a UA-generated <selectedcontent> in the shadow root that author CSS
        // never reaches. `max-w-[60%]` with `truncate` still caps a long value.
        // `field-sizing:content` covers the engines that lack `base-select` and
        // fall back to native select rendering, where `w-auto` means the widest
        // *option* rather than the selected one -- and the popup feeds this the
        // entire language list, so a one-character value measured 240px instead
        // of 49px. Where `base-select` applies the value already drives the
        // width and this changes nothing.
        'select bg-transparent h-8 min-h-8 w-auto max-w-[60%] [field-sizing:content] truncate rounded-md border-none text-sm',
        'focus:outline-hidden focus:ring-0 focus-visible:outline-hidden',
        className,
      )}
      disabled={disabled}
      style={{
        textAlignLast: 'end',
      }}
    >
      {options.map(({ value, label, disabled: optionDisabled }) => (
        <option key={value} value={value} disabled={optionDisabled}>
          {label}
        </option>
      ))}
    </select>
  );
}
