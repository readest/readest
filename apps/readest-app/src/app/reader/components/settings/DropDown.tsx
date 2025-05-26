import clsx from 'clsx';
import React from 'react';
import { FiChevronDown } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
import { useDefaultIconSize, useResponsiveSize } from '@/hooks/useResponsiveSize';

interface DropDownProps {
  selected: { option: string; label: string };
  options: { option: string; label: string }[];
  onSelect: (option: string) => void;
  disabled?: boolean;
  className?: string;
  listClassName?: string;
}

const DropDown: React.FC<DropDownProps> = ({
  selected,
  options,
  onSelect,
  className,
  listClassName,
  disabled = false,
}) => {
  const iconSize16 = useResponsiveSize(16);
  const defaultIconSize = useDefaultIconSize();

  return (
    <div className={clsx('dropdown dropdown-bottom', className)}>
      <button
        tabIndex={0}
        className={clsx(
          'btn btn-sm flex items-center gap-1 px-[20px] font-normal normal-case',
          disabled && 'btn-disabled',
        )}
        onClick={(e) => e.currentTarget.focus()}
      >
        <span>{selected.label}</span>
        <FiChevronDown size={iconSize16} />
      </button>
      <ul
        tabIndex={0}
        className={clsx(
          'dropdown-content bgcolor-base-200 no-triangle menu rounded-box absolute z-[1] shadow',
          'menu-vertical right-[-32px] mt-2 inline max-h-80 w-44 overflow-y-scroll sm:right-0',
          listClassName,
        )}
      >
        {options.map(({ option, label }) => (
          <li key={option} onClick={() => onSelect(option)}>
            <div className='flex items-center px-0'>
              <span style={{ minWidth: `${defaultIconSize}px` }}>
                {selected.option === option && <MdCheck className='text-base-content' />}
              </span>
              <span>{label || option}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DropDown;
