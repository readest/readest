import clsx from 'clsx';
import React from 'react';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';

interface MenuItemProps {
  label: string;
  labelClass?: string;
  shortcut?: string;
  disabled?: boolean;
  noIcon?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  label,
  labelClass,
  shortcut,
  disabled,
  noIcon = false,
  icon,
  children,
  onClick,
}) => {
  const iconSize = useDefaultIconSize();
  const menuButton = (
    <button
      className={clsx(
        'hover:bg-base-300 text-base-content flex h-10 w-full items-center justify-between rounded-md p-2',
        disabled && 'btn-disabled text-gray-400',
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <div className='flex items-center'>
        {!noIcon && <span style={{ minWidth: `${iconSize}px` }}>{icon}</span>}
        <span className={clsx('ml-2 truncate text-base sm:max-w-32 sm:text-sm', labelClass)}>
          {label}
        </span>
      </div>
      {shortcut && <span className='text-neutral-content hidden text-sm sm:flex'>{shortcut}</span>}
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
