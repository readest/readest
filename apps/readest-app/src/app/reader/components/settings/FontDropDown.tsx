import clsx from 'clsx';
import React from 'react';
import { FiChevronUp, FiChevronLeft } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useDefaultIconSize, useResponsiveSize } from '@/hooks/useResponsiveSize';

interface DropdownProps {
  family?: string;
  selected: string;
  options: { option: string; label?: string }[];
  moreOptions?: { option: string; label?: string }[];
  onSelect: (option: string) => void;
  onGetFontFamily: (option: string, family: string) => string;
}

const FontDropdown: React.FC<DropdownProps> = ({
  family,
  selected,
  options,
  moreOptions,
  onSelect,
  onGetFontFamily,
}) => {
  const _ = useTranslation();
  const iconSize16 = useResponsiveSize(16);
  const defaultIconSize = useDefaultIconSize();
  const allOptions = [...options, ...(moreOptions ?? [])];
  const selectedOption = allOptions.find((option) => option.option === selected) ?? allOptions[0]!;
  return (
    <div className='dropdown dropdown-top'>
      <button
        tabIndex={0}
        className='btn btn-sm flex items-center gap-1 px-[20px] font-normal normal-case'
        onClick={(e) => e.currentTarget.focus()}
      >
        <span style={{ fontFamily: onGetFontFamily(selectedOption.option, family ?? '') }}>
          {selectedOption.label}
        </span>
        <FiChevronUp size={iconSize16} />
      </button>
      <ul
        tabIndex={0}
        className='dropdown-content bgcolor-base-200 no-triangle menu rounded-box absolute right-[-32px] z-[1] mt-4 w-44 shadow sm:right-0'
      >
        {options.map(({ option, label }) => (
          <li key={option} onClick={() => onSelect(option)}>
            <div className='flex items-center px-0'>
              <span style={{ minWidth: `${defaultIconSize}px` }}>
                {selected === option && <MdCheck className='text-base-content' />}
              </span>
              <span style={{ fontFamily: onGetFontFamily(option, family ?? '') }}>
                {label || option}
              </span>
            </div>
          </li>
        ))}
        {moreOptions && moreOptions.length > 0 && (
          <li className='dropdown dropdown-left dropdown-top'>
            <div className='flex items-center px-0'>
              <span style={{ minWidth: `${defaultIconSize}px` }}>
                <FiChevronLeft size={iconSize16} />
              </span>
              <span>{_('System Fonts')}</span>
            </div>
            <ul
              tabIndex={0}
              className={clsx(
                'dropdown-content bgcolor-base-200 menu rounded-box relative z-[1] overflow-y-scroll shadow',
                '!mr-5 mb-[-46px] inline max-h-80 w-[200px] overflow-y-scroll',
              )}
            >
              {moreOptions.map((option, index) => (
                <li key={`${index}-${option.option}`} onClick={() => onSelect(option.option)}>
                  <div className='flex items-center px-2'>
                    <span style={{ minWidth: `${defaultIconSize}px` }}>
                      {selected === option.option && <MdCheck className='text-base-content' />}
                    </span>
                    <span style={{ fontFamily: onGetFontFamily(option.option, family ?? '') }}>
                      {option.label || option.option}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
};

export default FontDropdown;
