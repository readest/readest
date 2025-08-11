import clsx from 'clsx';
import React from 'react';
import { IconType } from 'react-icons';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface MenuItemProps {
  label: string;
  description?: string;
  tooltip?: string;
  buttonClass?: string;
  labelClass?: string;
  shortcut?: string;
  disabled?: boolean;
  noIcon?: boolean;
  transient?: boolean; // For transient items the dropdown will close on click
  Icon?: React.ReactNode | IconType;
  children?: React.ReactNode;
  onClick?: () => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  label,
  description,
  tooltip,
  buttonClass,
  labelClass,
  shortcut,
  disabled,
  noIcon = false,
  transient = false,
  Icon,
  children,
  onClick,
  setIsDropdownOpen,
}) => {
  const iconSize = useResponsiveSize(16);
  const menuButton = (
    <button
      className={clsx(
        'hover:bg-base-300 text-base-content flex w-full flex-col items-center justify-center rounded-md p-1 py-[10px]',
        disabled && 'btn-disabled text-gray-400',
        buttonClass,
      )}
      aria-label={label}
      data-tip={tooltip ? tooltip : ''}
      onClick={() => {
        onClick?.();
        if (transient) {
          setIsDropdownOpen?.(false);
        }
      }}
      disabled={disabled}
    >
      <div className='flex w-full items-center justify-between'>
        <div className='flex min-w-0 items-center'>
          {!noIcon && (
            <span style={{ minWidth: `${iconSize}px` }}>
              {typeof Icon === 'function' ? (
                <Icon className='text-base-content' size={iconSize} />
              ) : (
                Icon
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
              'border-base-300/40 bg-base-300/75 text-neutral-content hidden rounded-md border shadow-sm sm:flex',
              'shrink-0 px-1.5 py-0.5 text-xs font-medium',
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
    </button>
  );

  if (children) {
    return (
      <ul className='menu rounded-box m-0 p-0'>
        <li>
          <details>
            <summary className='hover:bg-base-300 p-0 pr-3'>{menuButton}</summary>
            {children}
          </details>
        </li>
      </ul>
    );
  }
  return menuButton;
};

export default MenuItem;
