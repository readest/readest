import clsx from 'clsx';
import React from 'react';
import { MdChevronRight } from 'react-icons/md';
import SettingLabel from './SettingLabel';

interface NavigationRowProps {
  /** Optional leading icon. Rendered inside a `bg-base-200` chip. */
  icon?: React.ElementType;
  /** Primary label. */
  title: string;
  /** Secondary line under the title (e.g. "Connected as user@host"). */
  status?: string;
  onClick: () => void;
  disabled?: boolean;
  'data-setting-id'?: string;
  className?: string;
}

/**
 * Boxed-list row that pushes the panel into a sub-page. Anatomy:
 * prefix icon chip · title · status · trailing chevron-right. Hovers
 * subtly; gets a focus-visible ring (since it IS a button, not a
 * chromeless control like the boxed-list value cells).
 *
 * Used by `<IntegrationsPanel>` for KOSync/Readwise/Hardcover/OPDS rows;
 * any panel that surfaces a "tap to drill into config" affordance should
 * use this rather than rolling a custom button. See DESIGN.md §5.
 */
const NavigationRow: React.FC<NavigationRowProps> = ({
  icon: Icon,
  title,
  status,
  onClick,
  disabled,
  'data-setting-id': dataSettingId,
  className,
}) => {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      data-setting-id={dataSettingId}
      className={clsx(
        'group flex w-full items-center gap-3 py-4 pe-4 text-left',
        'transition-colors duration-150',
        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {Icon && (
        <span className='bg-base-200 text-base-content/70 group-hover:bg-base-300/70 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150'>
          <Icon className='h-5 w-5' />
        </span>
      )}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        {status && <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>}
      </div>
      <MdChevronRight className='text-base-content/50 h-5 w-5 flex-shrink-0' />
    </button>
  );
};

export default NavigationRow;
