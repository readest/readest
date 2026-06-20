import clsx from 'clsx';
import React from 'react';

type SettingsInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  /** Optional className merged in AFTER the chromeless base — use sparingly. */
  className?: string;
};

/**
 * Chromeless trailing-edge text input for use inside `<SettingsRow>` /
 * `<BoxedList>`. Mirrors `<SettingsSelect>`'s no-chrome treatment:
 * `!border-0 !bg-transparent` at rest, `bg-base-200/60` on hover/focus.
 * Text end-aligns flush against the row's trailing edge (`!ps-2 !pe-0`)
 * so the value's right edge lines up with toggles + select chevrons in
 * adjacent rows. See DESIGN.md §5.
 */
const SettingsInput = React.forwardRef<HTMLInputElement, SettingsInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={clsx(
          'input settings-content h-9 max-w-[60%] rounded-md',
          // `settings-content` re-applies the 14px-desktop / 16px-mobile
          // font-size — <input> doesn't inherit it from the dialog wrapper.
          '!border-0 !bg-transparent !pe-0 !ps-2 text-end',
          'hover:!bg-base-200/60 focus:!bg-base-200/60',
          'focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0',
          className,
        )}
      />
    );
  },
);

SettingsInput.displayName = 'SettingsInput';

export default SettingsInput;
