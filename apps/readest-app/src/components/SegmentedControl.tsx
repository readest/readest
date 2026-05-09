import clsx from 'clsx';
import React from 'react';

export interface SegmentedControlOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  // Optional accessible label when `label` is a non-text node (icon, badge…).
  ariaLabel?: string;
  // Per-option disable, in addition to the group-level `disabled` prop.
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string | number> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  // Group-level accessible name (rendered as `aria-label` on the wrapper).
  ariaLabel?: string;
  // Group-level disable. Per-option `disabled` is OR'd with this.
  disabled?: boolean;
  size?: 'sm' | 'md';
  // Stretch segments to fill the container; otherwise they hug their content.
  fullWidth?: boolean;
  className?: string;
}

// iOS-style segmented control: a subtle track holds N equally-weighted
// segments. The active one rises on top as a filled pill with a slight
// shadow; inactive ones are flat, transparent, and slightly muted so the
// group reads as a single control rather than a row of separate buttons.
//
// Generic over the value type so callers preserve number / string / enum
// semantics:
//
//     <SegmentedControl<number>
//       options={[{ value: 1, label: '1 day' }, ...]}
//       value={days}
//       onChange={setDays}
//     />
const SegmentedControl = <T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  size = 'sm',
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) => {
  const sizeClasses = size === 'md' ? 'px-4 py-1.5 text-sm' : 'px-3 py-1 text-sm';

  return (
    <div
      role='radiogroup'
      aria-label={ariaLabel}
      className={clsx(
        'bg-base-300/60 rounded-lg p-0.5',
        fullWidth ? 'flex w-full' : 'inline-flex',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = !!disabled || !!option.disabled;
        return (
          <button
            key={String(option.value)}
            type='button'
            role='radio'
            aria-checked={selected}
            aria-label={option.ariaLabel}
            disabled={optionDisabled}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            className={clsx(
              'rounded-md font-medium transition-colors disabled:opacity-50',
              fullWidth && 'flex-1',
              sizeClasses,
              selected
                ? 'bg-primary text-primary-content shadow-sm'
                : 'text-base-content/70 hover:text-base-content',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
