import clsx from 'clsx';
import React from 'react';
import { FiSearch } from 'react-icons/fi';
import { MdOutlineMenu, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { MdArrowBackIosNew } from 'react-icons/md';
import Image from 'next/image';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Dropdown from '@/components/Dropdown';
import BookMenu from './BookMenu';
import SidebarToggler from '../SidebarToggler';

const SidebarHeader: React.FC<{
  bookKey: string;
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ bookKey, isPinned, isSearchBarVisible, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const { isTrafficLightVisible } = useTrafficLight();
  const iconSize14 = useResponsiveSize(14);
  const iconSize18 = useResponsiveSize(18);
  const iconSize22 = useResponsiveSize(22);

  return (
    <div
      className={clsx(
        'sidebar-header flex h-11 items-center justify-between pe-2 sm:h-36 sm:flex-col sm:justify-start sm:gap-3.5 sm:px-0 sm:pt-7',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-0' : 'ps-1.5 sm:ps-0',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8 sm:w-full sm:justify-center'>
        <button
          title={_('Close')}
          onClick={onClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew size={iconSize22} />
        </button>
        <div className='hidden sm:flex'>
          <SidebarToggler bookKey={bookKey} />
        </div>
      </div>
      <div className='pointer-events-none hidden flex-col items-center justify-center sm:flex'>
        <div className='relative flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-full border border-[#d3b576]/70 bg-[#261612] shadow-[0_0_24px_rgba(126,31,25,0.3)]'>
          <Image
            src='/citadel/citadel-logo.png'
            alt='Citadel'
            fill
            sizes='54px'
            className='object-contain p-[9px] opacity-100 brightness-110'
            priority={false}
          />
        </div>
        <div className='mt-2.5 font-serif text-[9px] font-semibold uppercase leading-none tracking-[0.24em] text-[#d9bd86]'>
          Citadel
        </div>
      </div>
      <div className='flex min-w-24 max-w-32 items-center justify-between sm:hidden sm:size-[70%]'>
        <button
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          onClick={onToggleSearchBar}
          className={clsx(
            'btn btn-ghost left-0 h-8 min-h-8 w-8 p-0',
            isSearchBarVisible ? 'bg-base-300' : '',
          )}
        >
          <FiSearch size={iconSize18} className='text-base-content' />
        </button>
        <Dropdown
          label={_('Book Menu')}
          showTooltip={false}
          className={clsx(
            window.innerWidth < 640 ? 'dropdown-end' : 'dropdown-center',
            'dropdown-bottom',
          )}
          menuClassName={clsx('no-triangle mt-1', window.innerWidth < 640 ? '' : '!relative')}
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
          containerClassName='h-8'
          toggleButton={<MdOutlineMenu className='fill-base-content' />}
        >
          <BookMenu />
        </Dropdown>
        <div className='right-0 hidden h-8 w-8 items-center justify-center sm:flex'>
          <button
            title={isPinned ? _('Unpin Sidebar') : _('Pin Sidebar')}
            onClick={onTogglePin}
            className={clsx(
              'sidebar-pin-btn btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
              isPinned ? 'bg-[#351814] text-[#f1d58a]' : 'bg-[#241310]/80 text-[#b99756]',
            )}
          >
            {isPinned ? <MdPushPin size={iconSize14} /> : <MdOutlinePushPin size={iconSize14} />}
          </button>
        </div>
      </div>
      <style jsx global>{`
        .sidebar-header .btn:focus-visible,
        .sidebar-header button:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.88),
            0 0 0 3px rgba(120, 24, 18, 0.44);
        }

        @media (min-width: 640px) {
          .sidebar-header .btn,
          .sidebar-header button {
            border: 1px solid rgba(143, 107, 51, 0.45);
            background: rgba(26, 16, 13, 0.65);
            color: #e3c687;
          }
        }
      `}</style>
    </div>
  );
};

export default SidebarHeader;
