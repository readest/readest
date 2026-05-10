import clsx from 'clsx';
import React from 'react';
import SettingLabel from './SettingLabel';

interface SettingsRowProps {
  /** Primary label. ReactNode so callers can embed icons/badges. */
  label: React.ReactNode;
  /**
   * Optional secondary line under the label (description / status hint).
   * Keep it short — settings rows aren't meant to host paragraphs.
   */
  description?: React.ReactNode;
  /** Trailing slot — typically the control (toggle, select, input, button). */
  children?: React.ReactNode;
  /**
   * Render as `<label>` (default for toggle rows so clicking anywhere on
   * the row forwards focus to the input). Set false for rows whose trailing
   * control should NOT receive label-click forwarding (e.g., select rows
   * where clicking the label area shouldn't reopen the dropdown).
   */
  asLabel?: boolean;
  /**
   * Vertical alignment of label + trailing slot.
   *  - `'center'` (default): both vertically centered. Use for typical
   *    single-control rows (toggle, select, input).
   *  - `'start'`: both top-aligned with symmetric padding. Use when the
   *    trailing slot can wrap to multiple lines (e.g. a flex-wrap grid of
   *    swatches / chips) — the label then aligns with the top row of
   *    wrapped content instead of floating between rows.
   */
  align?: 'center' | 'start';
  /** Greyed-out + non-interactive state. */
  disabled?: boolean;
  className?: string;
  'data-setting-id'?: string;
}

/**
 * Canonical boxed-list row at `min-h-14 items-center justify-between gap-3
 * px-4`. Every row in a `<BoxedList>` should use this (or one of its
 * specialized variants like `<SettingsSwitchRow>`) so the chassis stays
 * uniform across the app. See DESIGN.md §5.
 */
const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  description,
  children,
  asLabel = false,
  align = 'center',
  disabled = false,
  className,
  'data-setting-id': dataSettingId,
}) => {
  const Wrapper = asLabel ? 'label' : 'div';
  return (
    <Wrapper
      data-setting-id={dataSettingId}
      className={clsx(
        'flex min-h-14 justify-between gap-3 pe-4',
        align === 'start' ? 'items-start py-3.5' : 'items-center',
        disabled && 'cursor-not-allowed opacity-50',
        asLabel && !disabled && 'cursor-pointer',
        className,
      )}
    >
      <div className='flex min-w-0 flex-col'>
        <SettingLabel>{label}</SettingLabel>
        {description && (
          <span className='text-base-content/65 text-[0.8em] leading-snug'>{description}</span>
        )}
      </div>
      {children}
    </Wrapper>
  );
};

export default SettingsRow;
