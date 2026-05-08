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

const SidebarHeader: React.FC<{
  bookKey: string;
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ isPinned, isSearchBarVisible, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const { isTrafficLightVisible } = useTrafficLight();
  const iconSize14 = useResponsiveSize(14);
  const iconSize18 = useResponsiveSize(18);
  const iconSize22 = useResponsiveSize(22);

  return (
    <div
      className={clsx(
        'sidebar-header relative flex h-11 items-center justify-between pe-2 sm:h-[132px] sm:flex-col sm:justify-start sm:px-2.5 sm:pt-2.5',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-0' : 'ps-1.5 sm:ps-0',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8 sm:hidden sm:w-full sm:justify-center sm:pb-3'>
        <button
          title={_('Close')}
          onClick={onClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew size={iconSize22} />
        </button>
      </div>
      <div className='pointer-events-none hidden w-full flex-col items-center justify-center sm:flex'>
        <div className='sidebar-brand-panel relative flex w-full items-center justify-center rounded-[18px] px-2.5 pb-2.5 pt-3'>
          <div className='sidebar-brand-mark relative flex h-[50px] w-[82px] items-center justify-center overflow-visible'>
            <Image
              src='/citadel/citadel-logo.png'
              alt='Citadel'
              fill
              sizes='82px'
              className='object-contain p-0 opacity-100 brightness-[0.76] contrast-[1.3] saturate-[1.62]'
              priority={false}
            />
          </div>
        </div>
        <div className='sidebar-header-divider mt-2 hidden h-px w-[74%] sm:block' />
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
          .sidebar-header {
            border-bottom: none;
            padding-bottom: 4px;
          }

          .sidebar-header::before {
            content: '';
            position: absolute;
            left: 14px;
            right: 14px;
            bottom: 0;
            height: 1px;
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(112, 82, 40, 0.18) 18%,
              rgba(152, 117, 66, 0.26) 50%,
              rgba(112, 82, 40, 0.18) 82%,
              transparent 100%
            );
          }

          .sidebar-brand-panel {
            background:
              radial-gradient(circle at 50% 38%, rgba(118, 90, 40, 0.06), transparent 28%),
              linear-gradient(180deg, rgba(18, 13, 11, 0.74), rgba(11, 9, 8, 0.12));
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.012),
              inset 0 -1px 0 rgba(0, 0, 0, 0.16);
          }

          .sidebar-brand-panel::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            border: 1px solid rgba(76, 52, 24, 0.08);
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.02),
              inset 0 0 0 1px rgba(59, 39, 19, 0.04);
            pointer-events: none;
          }

          .sidebar-brand-mark {
            filter: drop-shadow(0 0 12px rgba(118, 90, 36, 0.08))
              drop-shadow(0 4px 12px rgba(0, 0, 0, 0.34));
          }

          .sidebar-header-divider {
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(101, 74, 35, 0.12) 22%,
              rgba(140, 108, 60, 0.2) 50%,
              rgba(101, 74, 35, 0.12) 78%,
              transparent 100%
            );
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.22);
          }

          .sidebar-header .btn,
          .sidebar-header button {
            border: 1px solid rgba(143, 107, 51, 0.26);
            background: rgba(21, 13, 11, 0.44);
            color: #d8b774;
            box-shadow:
              inset 0 1px 0 rgba(255, 237, 193, 0.03),
              inset 0 -1px 0 rgba(0, 0, 0, 0.24);
          }
        }
      `}</style>
    </div>
  );
};

export default SidebarHeader;
