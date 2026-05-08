import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
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
const DESKTOP_SIDEBAR_WIDTH = '7.75rem';

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
        className='citadel-sidebar-restore-tab absolute left-0 top-1/2 z-[46] hidden h-16 w-6 -translate-y-1/2 items-center justify-center sm:flex'
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
            .sidebar-container {
              border-radius: 0 32px 32px 0;
              padding: 10px 10px 18px 7px;
              border-right-width: 0;
              background:
                radial-gradient(circle at 82% 18%, rgba(148, 28, 22, 0.22), transparent 24%),
                radial-gradient(circle at 78% 56%, rgba(92, 20, 16, 0.12), transparent 30%),
                radial-gradient(circle at 82% 88%, rgba(52, 14, 12, 0.18), transparent 32%),
                linear-gradient(180deg, rgba(25, 15, 14, 0.99), rgba(8, 7, 7, 1));
              box-shadow:
                inset -18px 0 28px rgba(0, 0, 0, 0.44),
                inset 12px 0 20px rgba(0, 0, 0, 0.32),
                inset 0 1px 0 rgba(255, 237, 193, 0.035),
                26px 0 54px rgba(0, 0, 0, 0.4);
            }

            .sidebar-container > * {
              position: relative;
              z-index: 1;
            }

            .sidebar-container::before {
              content: '';
              position: absolute;
              inset: 8px 8px 12px 8px;
              border-radius: 28px;
              background:
                radial-gradient(circle at 74% 26%, rgba(122, 22, 18, 0.18), transparent 18%),
                linear-gradient(
                  180deg,
                  rgba(68, 18, 15, 0.24) 0%,
                  rgba(24, 16, 15, 0.94) 14%,
                  rgba(13, 10, 9, 0.98) 62%,
                  rgba(6, 6, 6, 1) 100%
                );
              box-shadow:
                inset -1px 0 0 rgba(206, 166, 92, 0.56),
                inset -3px 0 0 rgba(106, 75, 31, 0.32),
                inset -10px 0 16px rgba(148, 104, 36, 0.1),
                inset 8px 0 16px rgba(0, 0, 0, 0.32),
                inset 0 1px 0 rgba(255, 236, 190, 0.08),
                inset 0 -110px 84px rgba(0, 0, 0, 0.46),
                inset 0 60px 84px rgba(94, 20, 17, 0.12),
                0 0 0 1px rgba(88, 60, 26, 0.24);
              pointer-events: none;
            }

            .sidebar-container::after {
              content: '';
              position: absolute;
              inset: 8px 8px 12px 8px;
              border-radius: 28px;
              background:
                linear-gradient(180deg, transparent 0%, transparent 56%, rgba(0, 0, 0, 0.5) 100%),
                linear-gradient(
                  90deg,
                  rgba(0, 0, 0, 0.18) 0%,
                  transparent 7%,
                  transparent 95%,
                  rgba(193, 154, 84, 0.08) 97%,
                  rgba(233, 202, 128, 0.12) 100%
                ),
                linear-gradient(
                  90deg,
                  transparent 0%,
                  transparent 95%,
                  rgba(0, 0, 0, 0.28) 97%,
                  rgba(0, 0, 0, 0.1) 100%
                ),
                radial-gradient(circle at 78% 28%, rgba(136, 24, 19, 0.12), transparent 18%),
                radial-gradient(circle at 82% 54%, rgba(96, 18, 14, 0.1), transparent 20%);
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
              top: 112px;
              bottom: 24px;
              width: 376px;
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
              justify-content: flex-start;
              position: relative;
              padding-top: 10px;
              padding-bottom: 8px;
              background:
                radial-gradient(circle at 68% 12%, rgba(128, 24, 19, 0.1), transparent 18%),
                linear-gradient(180deg, rgba(72, 18, 15, 0.14), transparent 22%),
                linear-gradient(180deg, rgba(12, 8, 7, 0.08), rgba(10, 8, 8, 0.34));
            }

            .sidebar-container :global(.bottom-tab)::before {
              content: '';
              position: absolute;
              inset: 0 6px 6px;
              border-radius: 18px 18px 24px 24px;
              background:
                linear-gradient(180deg, rgba(44, 14, 12, 0.16), transparent 14%),
                linear-gradient(180deg, rgba(16, 11, 10, 0.98), rgba(10, 8, 8, 0.98));
              box-shadow:
                inset 0 1px 0 rgba(255, 237, 193, 0.028),
                inset 0 -24px 30px rgba(0, 0, 0, 0.32);
              pointer-events: none;
            }

            .sidebar-container :global(.bottom-tab)::after {
              content: '';
              display: block;
              flex: 1;
              min-height: 172px;
              margin: 14px 8px 0 14px;
              border-radius: 0 0 18px 18px;
              background:
                radial-gradient(circle at 26% 0%, rgba(112, 24, 18, 0.14), transparent 30%),
                linear-gradient(
                  180deg,
                  rgba(74, 18, 15, 0.1),
                  rgba(44, 14, 12, 0.04) 26%,
                  rgba(9, 7, 7, 0) 44%
                ),
                linear-gradient(180deg, rgba(10, 7, 6, 0), rgba(3, 3, 3, 0.42) 100%);
              box-shadow: inset 0 28px 40px rgba(0, 0, 0, 0.26);
              pointer-events: none;
            }

            .sidebar-container :global(.os-scrollbar-handle) {
              background: rgba(176, 136, 72, 0.45);
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
      </div>
    </>
  );
};

export default SideBar;
