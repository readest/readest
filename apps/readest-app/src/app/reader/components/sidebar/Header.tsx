import clsx from 'clsx';
import React from 'react';
import { GiBookshelf } from 'react-icons/gi';
import { FiSearch } from 'react-icons/fi';
import { MdOutlineMenu, MdOutlinePushPin, MdPushPin } from 'react-icons/md';

import useTrafficLight from '@/hooks/useTrafficLight';
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
  const { isTrafficLightVisible } = useTrafficLight();
  return (
    <div
      className={clsx(
        'sidebar-header flex h-11 items-center justify-between pr-2',
        isTrafficLightVisible ? 'pl-20' : 'pl-1.5',
      )}
    >
      <div className='flex items-center'>
        <button className='btn btn-ghost h-8 min-h-8 w-8 p-0' onClick={onGoToLibrary}>
          <GiBookshelf size={20} className='fill-base-content' />
        </button>
      </div>
      <div className='flex size-[70%] min-w-24 max-w-32 items-center justify-between'>
        <button
          onClick={onToggleSearchBar}
          className={clsx(
            'btn btn-ghost left-0 h-8 min-h-8 w-8 p-0',
            isSearchBarVisible ? 'bg-base-300' : '',
          )}
        >
          <FiSearch size={18} className='text-base-content' />
        </button>
        <Dropdown
          className={clsx(
            window.innerWidth < 640 && 'dropdown-end',
            'dropdown-bottom flex justify-center',
          )}
          menuClassName={window.innerWidth < 640 ? 'no-triangle mt-1' : 'dropdown-center mt-3'}
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
          toggleButton={<MdOutlineMenu size={20} className='fill-base-content' />}
        >
          <BookMenu />
        </Dropdown>
        <div className='right-0 flex h-8 w-8 items-center justify-center'>
          <button
            onClick={onTogglePin}
            className={clsx(
              'sidebar-pin-btn btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
              isPinned ? 'bg-base-300' : 'bg-base-300/65',
            )}
          >
            {isPinned ? <MdPushPin size={14} /> : <MdOutlinePushPin size={14} />}
          </button>
          <button
            onClick={onClose}
            className={'bg-base-300/65 btn btn-ghost btn-circle h-6 min-h-6 w-6 sm:hidden'}
          >
            <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
              <path
                fill='currentColor'
                d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarHeader;
