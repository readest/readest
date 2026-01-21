import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { useEnv } from '@/context/EnvContext';
import { DragKey, useDrag } from '@/hooks/useDrag';
import { useThemeStore } from '@/store/themeStore';
import { Overlay } from '@/components/Overlay';
import useShortcuts from '@/hooks/useShortcuts';
import SidebarHeader from './Header';
import SidebarContent from './Content';
import BookCard from './BookCard';
import useSidebar from '../../hooks/useSidebar';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';

const MIN_SIDEBAR_WIDTH = 0.05;
const MAX_SIDEBAR_WIDTH = 0.45;

const VELOCITY_THRESHOLD = 0.5;

const SideBar: React.FC<{
  onGoToLibrary: () => void;
}> = ({ onGoToLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { updateAppTheme, safeAreaInsets } = useThemeStore();
  const { settings } = useSettingsStore();
  const { sideBarBookKey, setSideBarBookKey, getSearchNavState, setSearchTerm, clearSearch } =
    useSidebarStore();
  const searchNavState = sideBarBookKey ? getSearchNavState(sideBarBookKey) : null;
  const { searchTerm = '', searchResults = null } = searchNavState || {};
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const [isSearchBarVisible, setIsSearchBarVisible] = useState(false);
  const searchTermRef = useRef(searchTerm);
  const sidebarHeight = useRef(1.0);
  const isMobile = window.innerWidth < 640;
  const {
    sideBarWidth,
    isSideBarPinned,
    isSideBarVisible,
    getSideBarWidth,
    setSideBarVisible,
    handleSideBarResize,
    handleSideBarTogglePin,
  } = useSidebar(
    settings.globalReadSettings.sideBarWidth,
    isMobile ? false : settings.globalReadSettings.isSideBarPinned,
  );

  const onSearchEvent = async (event: CustomEvent) => {
    const { term, bookKey } = event.detail;
    setSideBarVisible(true);
    setSideBarBookKey(bookKey);
    setIsSearchBarVisible(true);
    if (term !== undefined && term !== null) {
      setSearchTerm(bookKey, term);
    }
  };

  const onNavigateEvent = async () => {
    const pinButton = document.querySelector('.sidebar-pin-btn');
    const isPinButtonHidden = !pinButton || window.getComputedStyle(pinButton).display === 'none';
    if (isPinButtonHidden) {
      setSideBarVisible(false);
    }
  };

  useEffect(() => {
    if (isSideBarVisible) {
      updateAppTheme('base-200');
    } else {
      updateAppTheme('base-100');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSideBarVisible]);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  useEffect(() => {
    eventDispatcher.on('search-term', onSearchEvent);
    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('search-term', onSearchEvent);
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerticalDragMove = (data: { clientY: number }) => {
    if (!isMobile) return;

    const heightFraction = data.clientY / window.innerHeight;
    const newTop = Math.max(0.0, Math.min(1, heightFraction));
    sidebarHeight.current = newTop;

    const sidebar = document.querySelector('.sidebar-container') as HTMLElement;
    const overlay = document.querySelector('.overlay') as HTMLElement;

    if (sidebar && overlay) {
      sidebar.style.top = `${newTop * 100}%`;
      overlay.style.opacity = `${1 - heightFraction}`;
    }
  };

  const handleVerticalDragEnd = (data: { velocity: number; clientY: number }) => {
    const sidebar = document.querySelector('.sidebar-container') as HTMLElement;
    const overlay = document.querySelector('.overlay') as HTMLElement;

    if (!sidebar || !overlay) return;

    if (
      data.velocity > VELOCITY_THRESHOLD ||
      (data.velocity >= 0 && data.clientY >= window.innerHeight * 0.5)
    ) {
      const transitionDuration = 0.15 / Math.max(data.velocity, 0.5);
      sidebar.style.transition = `top ${transitionDuration}s ease-out`;
      sidebar.style.top = '100%';
      overlay.style.transition = `opacity ${transitionDuration}s ease-out`;
      overlay.style.opacity = '0';
      setTimeout(() => setSideBarVisible(false), 300);
      if (appService?.hasHaptics) {
        impactFeedback('medium');
      }
    } else {
      sidebar.style.transition = 'top 0.3s ease-out';
      sidebar.style.top = '0%';
      overlay.style.transition = 'opacity 0.3s ease-out';
      overlay.style.opacity = '0.8';
      if (appService?.hasHaptics) {
        impactFeedback('medium');
      }
    }
  };

  const handleHorizontalDragMove = (data: { clientX: number }) => {
    const widthFraction = data.clientX / window.innerWidth;
    const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, widthFraction));
    handleSideBarResize(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const handleHorizontalDragKeyDown = (data: { key: DragKey; step: number }) => {
    const currentWidth = parseFloat(getSideBarWidth()) / 100;
    let newWidth = currentWidth;

    if (data.key === 'ArrowLeft') {
      newWidth = Math.max(MIN_SIDEBAR_WIDTH, currentWidth - data.step);
    } else if (data.key === 'ArrowRight') {
      newWidth = Math.min(MAX_SIDEBAR_WIDTH, currentWidth + data.step);
    }
    handleSideBarResize(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const handleVerticalDragKeyDown = () => {};

  const { handleDragStart: handleVerticalDragStart } = useDrag(
    handleVerticalDragMove,
    handleVerticalDragKeyDown,
    handleVerticalDragEnd,
  );
  const { handleDragStart: handleHorizontalDragStart, handleDragKeyDown } = useDrag(
    handleHorizontalDragMove,
    handleHorizontalDragKeyDown,
  );

  const handleClickOverlay = () => {
    setSideBarVisible(false);
  };

  const handleToggleSearchBar = () => {
    setIsSearchBarVisible((prev) => {
      if (prev) handleHideSearchBar();
      return !prev;
    });
  };

  const handleShowSearchBar = useCallback(() => {
    setTimeout(() => {
      setSideBarVisible(true);
      setIsSearchBarVisible(true);
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHideSearchBar = useCallback(() => {
    setIsSearchBarVisible(false);
    setTimeout(() => {
      if (sideBarBookKey) clearSearch(sideBarBookKey);
    }, 100);
    getView(sideBarBookKey)?.clearSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey, clearSearch]);

  const handleHideSideBar = useCallback(() => {
    if (searchTermRef.current) {
      handleHideSearchBar();
    } else if (!isSideBarPinned) {
      setSideBarVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBarBookKey, isSideBarPinned]);

  useShortcuts({ onShowSearchBar: handleShowSearchBar, onEscape: handleHideSideBar }, [
    handleHideSideBar,
  ]);

  const handleSearchResultClick = (cfi: string) => {
    onNavigateEvent();
    getView(sideBarBookKey)?.goTo(cfi);
  };

  if (!sideBarBookKey) return null;

  const viewSettings = getViewSettings(sideBarBookKey);
  const bookData = getBookData(sideBarBookKey);
  if (!bookData || !bookData.book || !bookData.bookDoc) {
    return null;
  }
  const { book, bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  return isSideBarVisible ? (
    <>
      {!isSideBarPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        className={clsx(
          'sidebar-container flex min-w-60 select-none flex-col',
          'full-height transition-[padding-top] duration-300',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.hasRoundedWindow && 'rounded-window-top-left rounded-window-bottom-left',
          isSideBarPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isSideBarPinned && viewSettings?.isEink && 'border-base-content border-e',
        )}
        role='group'
        aria-label={_('Sidebar')}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: `${sideBarWidth}`,
          maxWidth: `${MAX_SIDEBAR_WIDTH * 100}%`,
          position: isSideBarPinned ? 'relative' : 'absolute',
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .sidebar-container {
              width: 100%;
              min-width: 100%;
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
            .sidebar-container.open {
              top: 0%;
            }
            .overlay {
              transition: opacity 0.3s ease-in-out;
            }
          }
        `}</style>
        <div
          className={clsx(
            'drag-bar absolute -right-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-1',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize Sidebar')}
          aria-orientation='horizontal'
          aria-valuenow={parseFloat(sideBarWidth)}
          onMouseDown={handleHorizontalDragStart}
          onTouchStart={handleHorizontalDragStart}
          onKeyDown={handleDragKeyDown}
        ></div>
        <div className='flex-shrink-0'>
          {isMobile && (
            <div
              role='slider'
              tabIndex={0}
              aria-label={_('Resize Sidebar')}
              aria-orientation='vertical'
              aria-valuenow={sidebarHeight.current}
              className='drag-handle flex h-10 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <SidebarHeader
            isPinned={isSideBarPinned}
            isSearchBarVisible={isSearchBarVisible}
            onGoToLibrary={onGoToLibrary}
            onClose={() => setSideBarVisible(false)}
            onTogglePin={handleSideBarTogglePin}
            onToggleSearchBar={handleToggleSearchBar}
          />
          <div
            className={clsx('search-bar', {
              'search-bar-visible': isSearchBarVisible,
            })}
          >
            <SearchBar
              isVisible={isSearchBarVisible}
              bookKey={sideBarBookKey!}
              onHideSearchBar={handleHideSearchBar}
            />
          </div>
          <div className='border-base-300/50 border-b px-3'>
            <BookCard book={book} />
          </div>
        </div>
        {isSearchBarVisible && searchResults ? (
          <SearchResults
            bookKey={sideBarBookKey!}
            results={searchResults}
            onSelectResult={handleSearchResultClick}
          />
        ) : (
          <SidebarContent bookDoc={bookDoc} sideBarBookKey={sideBarBookKey!} />
        )}
      </div>
    </>
  ) : null;
};

export default SideBar;
