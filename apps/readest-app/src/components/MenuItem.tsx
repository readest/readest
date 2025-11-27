import clsx from 'clsx';
import React from 'react';
import { IconType } from 'react-icons';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface MenuItemProps {
  label: string;
  toggled?: boolean;
  description?: string;
  tooltip?: string;
  buttonClass?: string;
  labelClass?: string;
  shortcut?: string;
  disabled?: boolean;
  noIcon?: boolean;
  transient?: boolean;
  Icon?: React.ReactNode | IconType;
  iconClassName?: string;
  children?: React.ReactNode;
  siblings?: React.ReactNode;
  onClick?: () => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  label,
  toggled,
  description,
  tooltip,
  buttonClass,
  labelClass,
  shortcut,
  disabled,
  noIcon = false,
  transient = false,
  Icon,
  iconClassName,
  children,
  siblings,
  onClick,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const IconType = Icon || (toggled !== undefined ? (toggled ? MdCheck : undefined) : undefined);

  const handleClick = () => {
    onClick?.();
    if (transient) {
      setIsDropdownOpen?.(false);
    }
  };

  const buttonContent = (
    <>
      <div className='flex w-full items-center justify-between'>
        <div className='flex min-w-0 items-center'>
          {!noIcon && (
            <span style={{ minWidth: `${iconSize}px` }}>
              {typeof IconType === 'function' ? (
                <IconType
                  className={clsx(disabled ? 'text-gray-400' : 'text-base-content', iconClassName)}
                  size={iconSize}
                />
              ) : (
                IconType
              )}
            </span>
          )}
          <span
            className={clsx('mx-2 flex-1 truncate text-base sm:text-sm', labelClass)}
            style={{ minWidth: 0 }}
          >
            {label}
          </span>
        </div>
        {shortcut && (
          <kbd
            className={clsx(
              'border-base-300/40 bg-base-300/75 hidden rounded-md border shadow-sm sm:flex',
              'shrink-0 px-1.5 py-0.5 text-xs font-medium',
              disabled ? 'text-gray-400' : 'text-neutral-content',
            )}
          >
            {shortcut}
          </kbd>
        )}
      </div>
      <div className='flex w-full'>
        {description && (
          <span
            className='mt-1 truncate text-start text-xs text-gray-500'
            style={{ minWidth: 0, paddingInlineStart: noIcon ? '0' : `${iconSize + 8}px` }}
          >
            {description}
          </span>
        )}
      </div>
    </>
  );

  if (children) {
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      <ul className='menu rounded-box m-0 p-0' role='menuitem' tabIndex={-1}>
        <li aria-label={label}>
          <details>
            <summary
              className={clsx(
                'hover:bg-base-300 text-base-content cursor-pointer rounded-md p-1 py-[10px] pr-3',
                disabled && 'btn-disabled cursor-not-allowed text-gray-400',
                buttonClass,
              )}
              title={tooltip ? tooltip : ''}
            >
              {buttonContent}
            </summary>
            {children}
          </details>
        </li>
      </ul>
    );
  }

  return (
    <div className='flex'>
      <button
        role={disabled ? 'none' : 'menuitem'}
        aria-label={
          toggled !== undefined ? `${label} - ${toggled ? _('ON') : _('OFF')}` : undefined
        }
        aria-live={toggled === undefined ? 'polite' : 'off'}
        tabIndex={disabled ? -1 : 0}
        className={clsx(
          'hover:bg-base-300 text-base-content flex w-full flex-col items-center justify-center rounded-md p-1 py-[10px]',
          disabled && 'btn-disabled text-gray-400',
          buttonClass,
        )}
        title={tooltip ? tooltip : ''}
        onClick={handleClick}
        disabled={disabled}
      >
        {buttonContent}
      </button>
      {siblings}
    </div>
  );
};

export default MenuItem;
