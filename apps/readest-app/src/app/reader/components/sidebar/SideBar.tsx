import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdKeyboardDoubleArrowLeft } from 'react-icons/md';
import { MdKeyboardDoubleArrowRight } from 'react-icons/md';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { usePanelResize } from '@/hooks/usePanelResize';
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
const DESKTOP_SIDEBAR_WIDTH = '112px';

const SideBar = ({}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey, setSideBarBookKey, getSearchNavState, setSearchTerm, clearSearch } =
    useSidebarStore();
  const searchNavState = sideBarBookKey ? getSearchNavState(sideBarBookKey) : null;
  const { searchTerm = '', searchResults = null } = searchNavState || {};
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const [isSearchBarVisible, setIsSearchBarVisible] = useState(false);
  const searchTermRef = useRef(searchTerm);
  const isMobile = window.innerWidth < 640;
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);
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
    const { isSideBarPinned } = useSidebarStore.getState();
    if (!isSideBarPinned) {
      setSideBarVisible(false);
    }
  };

  const {
    panelRef: sidebarRef,
    overlayRef,
    panelHeight: sidebarHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setSideBarVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  useEffect(() => {
    if (isSideBarVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
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

  const { handleResizeStart: handleHorizontalDragStart, handleResizeKeyDown: handleDragKeyDown } =
    usePanelResize({
      side: 'start',
      minWidth: MIN_SIDEBAR_WIDTH,
      maxWidth: MAX_SIDEBAR_WIDTH,
      getWidth: getSideBarWidth,
      onResize: handleSideBarResize,
    });

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

  if (!isSideBarVisible) {
    // Collapsed state: render a left-edge restore handle so the sidebar can
    // be reopened. The HeaderBar no longer carries a top-right toggler when
    // the sidebar is hidden, so this handle is the only desktop restore
    // entry point — it must always render.
    // pointer-events-auto on the button only; nothing else is overlaid.
    return (
      <button
        type='button'
        title={_('Show Sidebar')}
        aria-label={_('Show Sidebar')}
        data-testid='sidebar-restore-handle'
        onClick={() => setSideBarVisible(true)}
        className='citadel-sidebar-restore-tab absolute left-0 top-[58%] z-[46] hidden h-14 w-6 -translate-y-1/2 items-center justify-center sm:flex'
      >
        <MdKeyboardDoubleArrowRight size={18} />
        <style jsx>{`
          .citadel-sidebar-restore-tab {
            color: rgba(212, 168, 88, 0.92);
            background: linear-gradient(180deg, rgba(28, 18, 14, 0.98), rgba(12, 8, 7, 0.98));
            border: 1px solid rgba(168, 124, 64, 0.55);
            border-left: 0;
            border-radius: 0 12px 12px 0;
            box-shadow:
              0 12px 28px rgba(0, 0, 0, 0.5),
              0 0 22px rgba(126, 31, 25, 0.16),
              inset 0 1px 0 rgba(255, 237, 193, 0.06),
              inset 0 -1px 0 rgba(0, 0, 0, 0.36);
            transition:
              color 140ms ease,
              transform 140ms ease,
              background 140ms ease,
              border-color 140ms ease;
          }
          .citadel-sidebar-restore-tab:hover {
            color: rgba(243, 215, 140, 0.98);
            border-color: rgba(214, 168, 88, 0.85);
            background: linear-gradient(180deg, rgba(46, 22, 18, 0.98), rgba(20, 12, 10, 0.98));
            transform: translate(2px, -50%);
          }
          .citadel-sidebar-restore-tab:focus-visible {
            outline: none;
            box-shadow:
              0 0 0 1px rgba(201, 164, 90, 0.85),
              0 0 0 3px rgba(120, 24, 18, 0.4);
          }
        `}</style>
      </button>
    );
  }

  return (
    <>
      {!isSideBarPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        ref={sidebarRef}
        className={clsx(
          'sidebar-container flex min-w-60 select-none flex-col overflow-hidden sm:min-w-0 sm:overflow-visible',
          'full-height transition-[padding-top] duration-300',
          viewSettings?.isEink
            ? 'bg-base-100'
            : 'bg-[linear-gradient(180deg,rgba(24,16,13,0.98),rgba(13,9,8,1))] sm:bg-[linear-gradient(180deg,#1b100d_0%,#0c0807_100%)]',
          appService?.hasRoundedWindow && 'rounded-window-top-left rounded-window-bottom-left',
          isSideBarPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isSideBarPinned && viewSettings?.isEink && 'border-base-content border-e',
        )}
        role='navigation'
        aria-label={_('Sidebar')}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        data-search-visible={isSearchBarVisible}
        style={{
          width: isMobile ? '100%' : DESKTOP_SIDEBAR_WIDTH,
          maxWidth: isMobile ? '100%' : DESKTOP_SIDEBAR_WIDTH,
          position: isMobile ? 'fixed' : isSideBarPinned ? 'relative' : 'absolute',
          paddingTop: isFullHeightInMobile
            ? systemUIVisible
              ? `${Math.max(safeAreaInsets?.top || 0, statusBarHeight)}px`
              : `${safeAreaInsets?.top || 0}px`
            : '0px',
        }}
      >
        <style jsx>{`
          @media (min-width: 640px) {
            /* Floating rail: inset from the screen edge on all sides so it
               reads as a separate dark object, not a tall strip welded to
               the window frame. Full rounded corners. We override the
               full-height utility so margins don't overflow the viewport. */
            .sidebar-container {
              height: calc(100dvh - 36px) !important;
              max-height: calc(100dvh - 36px);
              margin: 18px 0 18px 16px;
              border-radius: 24px;
              padding: 0;
              border: 1px solid rgba(179, 137, 70, 0.72);
              box-sizing: border-box;
              background: linear-gradient(
                180deg,
                rgba(29, 25, 23, 0.98) 0%,
                rgba(20, 18, 17, 0.98) 38%,
                rgba(15, 14, 13, 1) 72%,
                rgba(10, 9, 9, 1) 100%
              );
              box-shadow:
                inset 0 0 0 1px rgba(230, 184, 92, 0.12),
                inset 0 18px 34px rgba(255, 210, 120, 0.035),
                0 12px 30px rgba(0, 0, 0, 0.45);
            }

            .sidebar-container > * {
              position: relative;
              z-index: 1;
            }

            .sidebar-container::before {
              content: none;
              pointer-events: none;
            }

            .sidebar-container::after {
              content: none;
              pointer-events: none;
            }

            .sidebar-container :global(.search-bar) {
              position: absolute;
              left: calc(100% + 24px);
              top: 24px;
              width: 376px;
              opacity: 0;
              transform: translateX(-12px);
              pointer-events: none;
              transition:
                opacity 180ms ease,
                transform 180ms ease;
              z-index: 7;
            }

            .sidebar-container :global(.search-bar .input),
            .sidebar-container :global(.search-bar input),
            .sidebar-container :global(.search-bar textarea) {
              border-color: rgba(201, 164, 90, 0.28);
              background: rgba(18, 12, 10, 0.96);
              color: #e4cfab;
              box-shadow:
                inset 0 1px 0 rgba(255, 237, 193, 0.05),
                inset 0 0 0 1px rgba(88, 64, 31, 0.14);
            }

            .sidebar-container[data-search-visible='true'] :global(.search-bar) {
              opacity: 1;
              transform: translateX(0);
              pointer-events: auto;
            }

            .sidebar-container :global(.sidebar-content) {
              position: absolute;
              left: calc(100% + 24px);
              top: 28px;
              bottom: 28px;
              width: 376px;
              max-height: calc(100dvh - 72px);
              border: 1px solid rgba(201, 164, 90, 0.34);
              border-radius: 28px;
              background:
                radial-gradient(circle at 18% 14%, rgba(117, 24, 17, 0.24), transparent 24%),
                radial-gradient(circle at 82% 72%, rgba(71, 16, 12, 0.16), transparent 26%),
                linear-gradient(180deg, rgba(19, 13, 11, 0.98), rgba(9, 7, 6, 0.98));
              box-shadow:
                0 24px 48px rgba(0, 0, 0, 0.4),
                0 0 0 1px rgba(95, 68, 31, 0.18),
                0 0 34px rgba(126, 31, 25, 0.24);
              opacity: 0;
              transform: translateX(-12px);
              pointer-events: none;
              transition:
                opacity 180ms ease,
                transform 180ms ease;
              z-index: 4;
            }

            .sidebar-container :global(.sidebar-content)::before {
              content: '';
              position: absolute;
              inset: 0;
              border-radius: inherit;
              border: 1px solid rgba(228, 190, 113, 0.08);
              box-shadow:
                inset 0 1px 0 rgba(255, 237, 193, 0.1),
                inset 0 0 0 1px rgba(88, 64, 31, 0.24),
                inset 0 18px 24px rgba(255, 237, 193, 0.02),
                inset 0 -28px 34px rgba(0, 0, 0, 0.34);
              pointer-events: none;
            }

            .sidebar-container:hover :global(.sidebar-content),
            .sidebar-container:focus-within :global(.sidebar-content) {
              opacity: 1;
              transform: translateX(0);
              pointer-events: auto;
            }

            .sidebar-container[data-search-visible='true'] :global(.sidebar-content) {
              opacity: 0;
              pointer-events: none;
            }

            .sidebar-container :global(.bottom-tab) {
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
              position: relative;
              padding-top: 14px;
              padding-bottom: 10px;
              background: linear-gradient(
                180deg,
                rgba(21, 19, 18, 0) 0%,
                rgba(17, 16, 15, 0.16) 54%,
                rgba(11, 10, 10, 0.22) 100%
              );
            }

            .sidebar-container :global(.bottom-tab)::before {
              content: '';
              position: absolute;
              inset: 0;
              background: linear-gradient(
                180deg,
                rgba(21, 19, 18, 0) 0%,
                rgba(17, 16, 15, 0.08) 62%,
                rgba(11, 10, 10, 0.14) 100%
              );
              pointer-events: none;
            }

            .sidebar-container :global(.bottom-tab)::after {
              content: '';
              position: absolute;
              left: 0;
              right: 0;
              bottom: 0;
              height: 120px;
              background: linear-gradient(
                180deg,
                rgba(21, 19, 18, 0) 0%,
                rgba(11, 10, 10, 0.14) 100%
              );
              pointer-events: none;
            }

            :global(.sidebar-container .sidebar-content + div) {
              border-top: 0 !important;
              background: transparent !important;
              box-shadow: none !important;
            }

            .sidebar-container :global(.os-scrollbar-handle) {
              background: rgba(176, 136, 72, 0.45);
            }

            .sidebar-container .citadel-rail-collapse-anchor {
              border: 1px solid rgba(207, 164, 84, 0.72);
              background-color: rgba(35, 29, 25, 0.98);
              background-image: linear-gradient(
                180deg,
                rgba(35, 29, 25, 0.98),
                rgba(16, 13, 12, 1)
              );
              color: rgba(246, 207, 126, 0.98);
              box-shadow:
                inset 0 1px 0 rgba(255, 220, 140, 0.12),
                0 0 14px rgba(196, 130, 50, 0.12);
              opacity: 1;
              transition:
                background 150ms ease,
                border-color 150ms ease,
                color 150ms ease,
                transform 150ms ease;
            }

            .sidebar-container .citadel-rail-collapse-anchor:hover {
              border-color: rgba(228, 190, 108, 0.8);
              background-image: linear-gradient(
                180deg,
                rgba(43, 35, 30, 0.98),
                rgba(18, 14, 13, 1)
              );
              color: rgba(246, 207, 126, 0.98);
            }

            .sidebar-container .citadel-rail-collapse-anchor:focus-visible {
              outline: none;
              box-shadow:
                0 0 0 1px rgba(201, 164, 90, 0.88),
                0 0 0 3px rgba(120, 24, 18, 0.36);
            }
          }
          @media (max-width: 640px) {
            .sidebar-container {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
              box-shadow:
                inset 0 1px 0 rgba(255, 237, 193, 0.06),
                0 -18px 40px rgba(0, 0, 0, 0.38);
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
            !isMobile && 'sm:hidden',
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
              className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <SidebarHeader
            bookKey={sideBarBookKey!}
            isPinned={isSideBarPinned}
            isSearchBarVisible={isSearchBarVisible}
            onClose={() => setSideBarVisible(false)}
            onTogglePin={handleSideBarTogglePin}
            onToggleSearchBar={handleToggleSearchBar}
          />
          <div
            className={clsx(
              'search-bar border-[#c9a45a]/28 rounded-[18px] border bg-[linear-gradient(180deg,rgba(20,13,11,0.98),rgba(11,8,7,0.98))] shadow-[0_18px_40px_rgba(0,0,0,0.34),0_0_22px_rgba(126,31,25,0.16)]',
              {
                'search-bar-visible': isSearchBarVisible,
              },
            )}
          >
            <SearchBar
              isVisible={isSearchBarVisible}
              bookKey={sideBarBookKey!}
              onHideSearchBar={handleHideSearchBar}
            />
          </div>
          <div className='border-b border-[#6a4d28]/30 px-3 sm:hidden'>
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
        <button
          type='button'
          title={_('Collapse Sidebar')}
          aria-label={_('Collapse Sidebar')}
          data-testid='sidebar-collapse-button'
          onClick={() => setSideBarVisible(false)}
          className='citadel-rail-collapse-anchor hidden items-center justify-center rounded-full sm:flex'
          style={{
            position: 'fixed',
            left: 72,
            bottom: 44,
            transform: 'translateX(-50%)',
            width: 42,
            height: 42,
            zIndex: 60,
            opacity: 1,
            pointerEvents: 'auto',
          }}
        >
          <MdKeyboardDoubleArrowLeft className='text-[20px]' />
        </button>
      </div>
    </>
  );
};

export default SideBar;
