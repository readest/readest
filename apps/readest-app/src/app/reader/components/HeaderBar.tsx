import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SidebarToggler from './SidebarToggler';
import BookmarkToggler from './BookmarkToggler';
import NotebookToggler from './NotebookToggler';
import SettingsToggler from './SettingsToggler';
import TranslationToggler from './TranslationToggler';
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
  const {
    isTrafficLightVisible,
    setTrafficLightVisibility,
    initializeTrafficLightStore,
    initializeTrafficLightListeners,
    cleanupTrafficLightListeners,
  } = useTrafficLightStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { bookKeys, hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { isSideBarVisible } = useSidebarStore();
  const iconSize16 = useResponsiveSize(16);

  const handleToggleDropdown = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    if (!isOpen) setHoveredBookKey('');
  };

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    initializeTrafficLightStore(appService);
    initializeTrafficLightListeners();
    setTrafficLightVisibility(true);
    return () => {
      cleanupTrafficLightListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    setTrafficLightVisibility(isSideBarVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSideBarVisible]);

  const isVisible = hoveredBookKey === bookKey || isDropdownOpen;

  return (
    <div
      className={clsx(
        'bg-base-100 absolute top-0 w-full',
        appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
      )}
    >
      <div
        className={clsx('absolute top-0 z-10 hidden h-11 w-full sm:flex')}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'bg-base-100 absolute left-0 right-0 top-0 z-10 h-[env(safe-area-inset-top)]',
          isVisible ? 'visible' : 'hidden',
        )}
        style={{
          height: systemUIVisible ? `max(env(safe-area-inset-top), ${statusBarHeight}px)` : '',
        }}
      />
      <div
        ref={headerRef}
        className={clsx(
          `header-bar bg-base-100 absolute top-0 z-10 flex h-11 w-full items-center pr-4`,
          `shadow-xs transition-[opacity,margin-top] duration-300`,
          isTrafficLightVisible && isTopLeft && !isSideBarVisible ? 'pl-16' : 'pl-4',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-top-left',
          isHoveredAnim && 'hover-bar-anim',
          isVisible ? 'pointer-events-auto visible' : 'pointer-events-none opacity-0',
          isDropdownOpen && 'header-bar-pinned',
        )}
        style={{
          marginTop: systemUIVisible
            ? `max(env(safe-area-inset-top), ${statusBarHeight}px)`
            : 'env(safe-area-inset-top)',
        }}
        onMouseLeave={() => !appService?.isMobile && setHoveredBookKey('')}
      >
        <div className='sidebar-bookmark-toggler z-20 flex h-full items-center gap-x-4'>
          <div className='hidden sm:flex'>
            <SidebarToggler bookKey={bookKey} />
          </div>
          <BookmarkToggler bookKey={bookKey} />
          <TranslationToggler bookKey={bookKey} />
        </div>

        <div className='header-title z-15 bg-base-100 pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex'>
          <h2 className='line-clamp-1 max-w-[50%] text-center text-xs font-semibold'>
            {bookTitle}
          </h2>
        </div>

        <div className='bg-base-100 z-20 ml-auto flex h-full items-center space-x-4'>
          <SettingsToggler />
          <NotebookToggler bookKey={bookKey} />
          <Dropdown
            className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
            buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
            toggleButton={<PiDotsThreeVerticalBold size={iconSize16} />}
            onToggle={handleToggleDropdown}
          >
            <ViewMenu bookKey={bookKey} onSetSettingsDialogOpen={onSetSettingsDialogOpen} />
          </Dropdown>

          <WindowButtons
            className='window-buttons flex h-full items-center'
            headerRef={headerRef}
            showMinimize={
              bookKeys.length == 1 && !isTrafficLightVisible && appService?.appPlatform !== 'web'
            }
            showMaximize={
              bookKeys.length == 1 && !isTrafficLightVisible && appService?.appPlatform !== 'web'
            }
            onClose={() => {
              setHoveredBookKey(null);
              onCloseBook(bookKey);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default HeaderBar;
