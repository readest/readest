import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import useTrafficLight from '@/hooks/useTrafficLight';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SidebarToggler from './SidebarToggler';
import BookmarkToggler from './BookmarkToggler';
import NotebookToggler from './NotebookToggler';
import SettingsToggler from './SettingsToggler';
import ViewMenu from './ViewMenu';

interface HeaderBarProps {
  bookKey: string;
  bookTitle: string;
  isTopLeft: boolean;
  isHoveredAnim: boolean;
  onCloseBook: (bookKey: string) => void;
  onSetSettingsDialogOpen: (open: boolean) => void;
}

const HeaderBar: React.FC<HeaderBarProps> = ({
  bookKey,
  bookTitle,
  isTopLeft,
  isHoveredAnim,
  onCloseBook,
  onSetSettingsDialogOpen,
}) => {
  const { appService } = useEnv();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { hoveredBookKey, setHoveredBookKey, bookKeys } = useReaderStore();
  const { isSideBarVisible } = useSidebarStore();

  const handleToggleDropdown = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    if (!isOpen) setHoveredBookKey('');
  };

  return (
    <div
      ref={headerRef}
      className={clsx(
        `header-bar absolute top-0 z-10 flex h-11 w-full items-center pr-4`,
        isTrafficLightVisible && isTopLeft && !isSideBarVisible ? 'pl-16' : 'pl-4',
        `shadow-xs bg-base-100 rounded-window-top-right transition-opacity duration-300`,
        !isSideBarVisible && 'rounded-window-top-left',
        isHoveredAnim && 'hover-bar-anim',
        hoveredBookKey === bookKey || isDropdownOpen ? `visible` : `opacity-0`,
        isDropdownOpen && 'header-bar-pinned',
      )}
      onMouseEnter={() => setHoveredBookKey(bookKey)}
      onMouseLeave={() => setHoveredBookKey('')}
    >
      <div className='sidebar-bookmark-toggler flex h-full items-center space-x-2 sm:space-x-4'>
        <SidebarToggler bookKey={bookKey} />
        <BookmarkToggler bookKey={bookKey} />
      </div>

      <div className='header-title pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex'>
        <h2 className='line-clamp-1 max-w-[80%] text-center text-xs font-semibold'>{bookTitle}</h2>
      </div>

      <div className='ml-auto flex h-full items-center space-x-2 sm:space-x-4'>
        <SettingsToggler />
        <NotebookToggler bookKey={bookKey} />
        <Dropdown
          className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
          buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
          toggleButton={<PiDotsThreeVerticalBold size={16} />}
          onToggle={handleToggleDropdown}
        >
          <ViewMenu bookKey={bookKey} onSetSettingsDialogOpen={onSetSettingsDialogOpen} />
        </Dropdown>

        <WindowButtons
          className='window-buttons flex h-full items-center'
          headerRef={headerRef}
          showMinimize={bookKeys.length == 1 && appService?.appPlatform !== 'web'}
          showMaximize={bookKeys.length == 1 && appService?.appPlatform !== 'web'}
          onClose={() => onCloseBook(bookKey)}
        />
      </div>
    </div>
  );
};

export default HeaderBar;
