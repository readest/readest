import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { BookSearchResult } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { useTheme } from '@/hooks/useTheme';
import SidebarHeader from './Header';
import SidebarContent from './Content';
import BookCard from './BookCard';
import useSidebar from '../../hooks/useSidebar';
import useDragBar from '../../hooks/useDragBar';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import useShortcuts from '@/hooks/useShortcuts';

const MIN_SIDEBAR_WIDTH = 0.05;
const MAX_SIDEBAR_WIDTH = 0.45;

const SideBar: React.FC<{
  onGoToLibrary: () => void;
}> = ({ onGoToLibrary }) => {
  const { updateAppTheme } = useTheme();
  const { settings } = useSettingsStore();
  const { sideBarBookKey } = useSidebarStore();
  const { getBookData } = useBookDataStore();
  const { getView } = useReaderStore();
  const [isSearchBarVisible, setIsSearchBarVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<BookSearchResult[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const {
    sideBarWidth,
    isSideBarPinned,
    isSideBarVisible,
    setSideBarVisible,
    handleSideBarResize,
    handleSideBarTogglePin,
  } = useSidebar(
    settings.globalReadSettings.sideBarWidth,
    window.innerWidth >= 640 ? settings.globalReadSettings.isSideBarPinned : false,
  );

  const onSearchEvent = async (event: CustomEvent) => {
    const { term } = event.detail;
    setSideBarVisible(true);
    setIsSearchBarVisible(true);
    setSearchTerm(term);
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
    eventDispatcher.on('search', onSearchEvent);
    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('search', onSearchEvent);
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragMove = (e: MouseEvent) => {
    const widthFraction = e.clientX / window.innerWidth;
    const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, widthFraction));
    handleSideBarResize(`${Math.round(newWidth * 10000) / 100}%`);
  };
  const { handleMouseDown } = useDragBar(handleDragMove);

  const handleClickOverlay = () => {
    setSideBarVisible(false);
  };

  const handleToggleSearchBar = () => {
    setIsSearchBarVisible((prev) => !prev);
    if (isSearchBarVisible) {
      setSearchResults(null);
      setSearchTerm('');
      getView(sideBarBookKey)?.clearSearch();
    }
  };

  useShortcuts({ onToggleSearchBar: handleToggleSearchBar }, [sideBarBookKey]);

  const handleSearchResultClick = (cfi: string) => {
    onNavigateEvent();
    getView(sideBarBookKey)?.goTo(cfi);
  };

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  if (!bookData || !bookData.book || !bookData.bookDoc) {
    return null;
  }
  const { book, bookDoc } = bookData;

  return isSideBarVisible ? (
    <>
      <div
        className={clsx(
          'sidebar-container bg-base-200 z-20 flex h-full min-w-60 select-none flex-col',
          isTauriAppPlatform() && 'rounded-window-top-left rounded-window-bottom-left',
          !isSideBarPinned && 'shadow-2xl',
        )}
        style={{
          width: `${sideBarWidth}`,
          maxWidth: `${MAX_SIDEBAR_WIDTH * 100}%`,
          position: isSideBarPinned ? 'relative' : 'absolute',
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .sidebar-container {
              width: 100%;
              min-width: 100%;
            }
          }
        `}</style>
        <div className='flex-shrink-0'>
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
              searchTerm={searchTerm}
              onSearchResultChange={setSearchResults}
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
        <div
          className='drag-bar absolute right-0 top-0 h-full w-0.5 cursor-col-resize'
          onMouseDown={handleMouseDown}
        ></div>
      </div>
      {!isSideBarPinned && (
        <div className='overlay fixed inset-0 z-10 bg-black/20' onClick={handleClickOverlay} />
      )}
    </>
  ) : null;
};

export default SideBar;
