import clsx from 'clsx';
import React from 'react';
import { GiBookshelf } from 'react-icons/gi';
import { FiSearch } from 'react-icons/fi';
import { MdOutlineMenu, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { MdArrowBackIosNew } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Dropdown from '@/components/Dropdown';
import BookMenu from './BookMenu';

const SidebarHeader: React.FC<{
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onGoToLibrary: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ isPinned, isSearchBarVisible, onGoToLibrary, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const { isTrafficLightVisible } = useTrafficLight();
  const iconSize14 = useResponsiveSize(14);
  const iconSize18 = useResponsiveSize(18);
  const iconSize22 = useResponsiveSize(22);

  return (
    <div
      className={clsx(
        'sidebar-header flex h-11 items-center justify-between pe-2',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-20' : 'ps-1.5',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8'>
        <button
          title={_('Close')}
          onClick={onClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew size={iconSize22} />
        </button>
        <button
          title={_('Go to Library')}
          className='btn btn-ghost hidden h-8 min-h-8 w-8 p-0 sm:flex'
          onClick={onGoToLibrary}
        >
          <GiBookshelf className='fill-base-content' />
        </button>
      </div>
      <div className='flex min-w-24 max-w-32 items-center justify-between sm:size-[70%]'>
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
          className={clsx(
            window.innerWidth < 640 && 'dropdown-end',
            'dropdown-bottom flex justify-center',
          )}
          menuClassName={window.innerWidth < 640 ? 'no-triangle mt-1' : 'dropdown-center mt-1'}
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
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
              isPinned ? 'bg-base-300' : 'bg-base-300/65',
            )}
          >
            {isPinned ? <MdPushPin size={iconSize14} /> : <MdOutlinePushPin size={iconSize14} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarHeader;
