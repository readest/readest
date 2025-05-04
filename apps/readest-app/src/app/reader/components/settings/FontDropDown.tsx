import clsx from 'clsx';
import React from 'react';
import { FiChevronUp, FiChevronLeft } from 'react-icons/fi';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

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
  const { appService } = useEnv();
  const iconSize16 = useResponsiveSize(16);
  const allOptions = [...options, ...(moreOptions ?? [])];
  const selectedOption = allOptions.find((option) => option.option === selected) ?? allOptions[0]!;
  return (
    <div className='dropdown dropdown-top'>
      <button
        tabIndex={0}
        className='btn btn-sm flex items-center px-[10px] font-normal normal-case sm:px-[20px]'
        onClick={(e) => e.currentTarget.focus()}
      >
        <div className='flex items-center gap-x-1'>
          <span
            className='text-ellipsis'
            style={{
              fontFamily: onGetFontFamily(selectedOption.option, family ?? ''),
            }}
          >
            {selectedOption.label}
          </span>
          <FiChevronUp size={iconSize16} />
        </div>
      </button>
      <ul
        tabIndex={0}
        className={clsx(
          'dropdown-content bgcolor-base-200 no-triangle menu rounded-box absolute z-[1] mt-4 shadow',
          '!sm:px-2 right-[-32px] w-[46vw] !px-1 sm:right-0 sm:w-44',
          moreOptions?.length ? '' : 'inline max-h-80 overflow-y-scroll',
        )}
      >
        {options.map(({ option, label }) => (
          <li key={option} onClick={() => onSelect(option)}>
            <div className='flex w-full items-center overflow-hidden px-0 text-sm'>
              <span style={{ minWidth: `${iconSize16}px` }}>
                {selected === option && <MdCheck className='text-base-content' size={iconSize16} />}
              </span>
              <span style={{ fontFamily: onGetFontFamily(option, family ?? '') }}>
                {label || option}
              </span>
            </div>
          </li>
        ))}
        {moreOptions && moreOptions.length > 0 && (
          <li className='dropdown dropdown-left dropdown-top'>
            <div className='flex items-center px-0 text-sm'>
              <span style={{ minWidth: `${iconSize16}px` }}>
                <FiChevronLeft size={iconSize16} />
              </span>
              <span>{_('System Fonts')}</span>
            </div>
            <ul
              tabIndex={0}
              className={clsx(
                'dropdown-content bgcolor-base-200 menu rounded-box relative z-[1] shadow',
                '!sm:px-2 !mr-4 mb-[-46px] inline max-h-80 w-[46vw] overflow-y-scroll !px-1 sm:w-[200px]',
              )}
            >
              {moreOptions.map((option, index) => (
                <li key={`${index}-${option.option}`} onClick={() => onSelect(option.option)}>
                  <div className='flex w-full items-center overflow-hidden px-0 text-sm'>
                    <span style={{ minWidth: `${iconSize16}px` }}>
                      {selected === option.option && (
                        <MdCheck className='text-base-content' size={iconSize16} />
                      )}
                    </span>
                    <span
                      style={
                        !appService?.isLinuxApp
                          ? { fontFamily: onGetFontFamily(option.option, family ?? '') }
                          : {}
                      }
                    >
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
