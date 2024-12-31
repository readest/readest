import clsx from 'clsx';
import React from 'react';
import { FiChevronUp, FiChevronLeft } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';

interface DropdownProps {
  family?: string;
  selected: string;
  options: string[];
  moreOptions?: string[];
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
  return (
    <div className='dropdown dropdown-top'>
      <button
        tabIndex={0}
        className='btn btn-sm flex items-center gap-1 px-[20px] font-normal normal-case'
      >
        <span style={{ fontFamily: onGetFontFamily(selected, family ?? '') }}>{selected}</span>
        <FiChevronUp className='h-4 w-4' />
      </button>
      <ul
        tabIndex={0}
        className='dropdown-content menu bg-base-100 rounded-box absolute right-0 z-[1] mt-4 w-44 shadow'
      >
        {options.map((option) => (
          <li key={option} onClick={() => onSelect(option)}>
            <div className='flex items-center px-0'>
              <span style={{ minWidth: '20px' }}>
                {selected === option && <MdCheck size={20} className='text-base-content' />}
              </span>
              <span style={{ fontFamily: onGetFontFamily(option, family ?? '') }}>{option}</span>
            </div>
          </li>
        ))}
        {moreOptions && moreOptions.length > 0 && (
          <li className='dropdown dropdown-left dropdown-top'>
            <div className='flex items-center px-0'>
              <span style={{ minWidth: '20px' }}>
                <FiChevronLeft className='h-4 w-4' />
              </span>
              <span>{_('System Fonts')}</span>
            </div>
            <ul
              tabIndex={0}
              className={clsx(
                'dropdown-content menu bg-base-100 rounded-box relative z-[1] overflow-y-scroll shadow',
                'mb-[-40px] mr-4 max-h-80 w-80',
              )}
            >
              {moreOptions.map((option) => (
                <li key={option} onClick={() => onSelect(option)}>
                  <div className='flex items-center px-0'>
                    <span style={{ minWidth: '20px' }}>
                      {selected === option && <MdCheck size={20} className='text-base-content' />}
                    </span>
                    <span style={{ fontFamily: onGetFontFamily(option, family ?? '') }}>
                      {option}
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
