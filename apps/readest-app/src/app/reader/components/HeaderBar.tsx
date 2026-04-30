import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { VscLibrary } from 'react-icons/vsc';

import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSpatialNavigation } from '@/app/reader/hooks/useSpatialNavigation';
import { getHighlightColorHex } from '../utils/annotatorUtil';
import { annotationToolQuickActions } from './annotator/AnnotationTools';
import { AnnotationToolType } from '@/types/annotator';
import { saveViewSettings } from '@/helpers/settings';
import { HighlighterIcon } from '@/components/HighlighterIcon';
import Dropdown from '@/components/Dropdown';
import WindowButtons from '@/components/WindowButtons';
import QuickActionMenu from './annotator/QuickActionMenu';
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
  gridInsets: Insets;
  screenInsets: Insets;
  onCloseBook: (bookKey: string) => void;
  onGoToLibrary: () => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const HeaderBar: React.FC<HeaderBarProps> = ({
  bookKey,
  bookTitle,
  isTopLeft,
  isHoveredAnim,
  gridInsets,
  screenInsets,
  onCloseBook,
  onGoToLibrary,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { isTrafficLightVisible } = useTrafficLight();
  const { trafficLightInFullscreen, setTrafficLightVisibility } = useTrafficLightStore();
  const { bookKeys, hoveredBookKey } = useReaderStore();
  const { isDarkMode, systemUIVisible, statusBarHeight } = useThemeStore();
  const { isSideBarVisible, getIsSideBarVisible } = useSidebarStore();
  const { getView, getViewSettings, setHoveredBookKey } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [headerWidth, setHeaderWidth] = useState(0);
  const view = getView(bookKey);
  const iconSize16 = useResponsiveSize(16);
  const iconSize18 = useResponsiveSize(18);
  const headerRef = useRef<HTMLDivElement>(null);

  const docs = view?.renderer.getContents() ?? [];
  const pointerInDoc = docs.some(({ doc }) => doc?.body?.style.cursor === 'pointer');

  const enableAnnotationQuickActions = viewSettings?.enableAnnotationQuickActions;
  const annotationQuickActionButton =
    annotationToolQuickActions.find(
      (button) => button.type === viewSettings?.annotationQuickAction,
    ) || annotationToolQuickActions[0]!;
  const annotationQuickAction = viewSettings?.annotationQuickAction;
  const AnnotationToolQuickActionIcon = annotationQuickActionButton.Icon;
  const highlightStyle = settings.globalReadSettings.highlightStyle;
  const highlightColor = settings.globalReadSettings.highlightStyles[highlightStyle];
  const highlightHexColor = getHighlightColorHex(settings, highlightColor);

  const handleToggleDropdown = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    onDropdownOpenChange?.(isOpen);
    if (!isOpen) setHoveredBookKey('');
  };

  const handleAnnotationQuickActionSelect = (action: AnnotationToolType | null) => {
    if (viewSettings?.annotationQuickAction === action) action = null;
    saveViewSettings(envConfig, bookKey, 'annotationQuickAction', action, false, true);
  };

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;

    if (hoveredBookKey === bookKey && isTopLeft) {
      setTrafficLightVisibility(true, { x: 10, y: 20 });
    } else if (!hoveredBookKey) {
      setTimeout(() => {
        if (!getIsSideBarVisible()) {
          setTrafficLightVisibility(false);
        }
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, hoveredBookKey]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderWidth(entry.contentRect.width);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Check if mouse is outside header area to avoid false positive event of MouseLeave when clicking inside header on Windows
  const isMouseOutsideHeader = useCallback((clientX: number, clientY: number) => {
    if (!headerRef.current) return true;

    const rect = headerRef.current.getBoundingClientRect();
    return (
      clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom
    );
  }, []);

  const isHeaderCompact = headerWidth > 0 && headerWidth < 350;
  const insets = window.innerWidth < 640 ? screenInsets : gridInsets;
  const isHeaderVisible = hoveredBookKey === bookKey || isDropdownOpen;

  useSpatialNavigation(headerRef, isHeaderVisible);
  const trafficLightInHeader =
    appService?.hasTrafficLight && !trafficLightInFullscreen && !isSideBarVisible && isTopLeft;
  const windowButtonVisible =
    appService?.hasWindowBar && !isTrafficLightVisible && !trafficLightInHeader;

  return (
    <div
      className={clsx(
        'left-0 top-0 w-full',
        isHeaderVisible && 'bg-base-100',
        window.innerWidth < 640 ? 'fixed z-20' : 'absolute',
      )}
      style={{
        paddingTop: appService?.hasSafeAreaInset ? `${insets.top}px` : '0px',
      }}
    >
      <div
        role='none'
        tabIndex={-1}
        className={clsx('absolute top-0 z-10 h-11 w-full', pointerInDoc && 'pointer-events-none')}
        onClick={() => setHoveredBookKey(bookKey)}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'absolute left-0 right-0 top-0 z-10 bg-[#140d0b]/90',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          isHeaderVisible ? 'visible' : 'hidden',
        )}
        style={{
          height: systemUIVisible ? `${Math.max(insets.top, statusBarHeight)}px` : '0px',
        }}
      />
      <div
        ref={headerRef}
        role='banner'
        aria-label={_('Header Bar')}
        className={clsx(
          `header-bar border-[#d2b374]/48 absolute top-0 z-10 flex h-[42px] w-full items-center rounded-[18px] border bg-[linear-gradient(180deg,rgba(34,23,19,0.97),rgba(17,12,10,0.94))] pr-3 text-[#e6c98f] shadow-[0_14px_34px_rgba(0,0,0,0.34),0_0_18px_rgba(117,24,17,0.16)]`,
          `transition-[opacity,margin-top] duration-300`,
          trafficLightInHeader ? 'pl-20' : isSideBarVisible ? 'ps-4' : 'ps-4 sm:ps-2.5',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-top-left',
          isHoveredAnim && 'hover-bar-anim',
          isHeaderVisible ? 'pointer-events-auto visible' : 'pointer-events-none opacity-0',
          isDropdownOpen && 'header-bar-pinned',
        )}
        style={{
          marginTop: systemUIVisible
            ? `${Math.max(insets.top, statusBarHeight)}px`
            : `${insets.top}px`,
        }}
        onFocus={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onMouseLeave={(e) => {
          if (!appService?.isMobile && isMouseOutsideHeader(e.clientX, e.clientY)) {
            setHoveredBookKey('');
          }
        }}
      >
        <div className='header-tools-start bg-base-100 sidebar-bookmark-toggler z-20 flex h-full min-w-0 items-center gap-x-3 pe-2.5 max-[350px]:gap-x-2'>
          <div
            className='flex min-w-0 items-center gap-x-2.5 overflow-x-auto max-[350px]:gap-x-2'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {!isSideBarVisible && (
              <div className='hidden sm:flex'>
                <SidebarToggler bookKey={bookKey} />
              </div>
            )}
            <button
              title={_('Go to Library')}
              className='btn btn-ghost border-[#b18b4a]/52 bg-[#231613]/88 hidden h-7 min-h-7 w-7 rounded-md border p-0 text-[#f0d39a] hover:bg-[#31201b] sm:flex'
              onClick={onGoToLibrary}
            >
              <VscLibrary size={iconSize18} className='fill-current' />
            </button>
            <BookmarkToggler bookKey={bookKey} />
            <TranslationToggler bookKey={bookKey} />
          </div>
          {enableAnnotationQuickActions && (
            <Dropdown
              label={
                annotationQuickAction
                  ? _('Disable Quick Action')
                  : _('Enable Quick Action on Selection')
              }
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-center'
              menuClassName='!relative'
              buttonClassName={clsx(
                'btn btn-ghost h-7 min-h-7 w-7 p-0',
                'rounded-md border border-[#b18b4a]/52 bg-[#231613]/88 text-[#f0d39a] hover:bg-[#31201b]',
                viewSettings?.annotationQuickAction && 'bg-[#4a221c]/92',
              )}
              toggleButton={
                annotationQuickAction === 'highlight' || annotationQuickAction === null ? (
                  <HighlighterIcon
                    size={iconSize16}
                    tipColor={annotationQuickAction === null ? '#8F8F8F' : highlightHexColor}
                    tipStyle={{
                      opacity: annotationQuickAction === null ? 0.5 : 0.8,
                      mixBlendMode: isDarkMode ? 'screen' : 'multiply',
                    }}
                  />
                ) : (
                  <AnnotationToolQuickActionIcon size={iconSize16} />
                )
              }
              onToggle={handleToggleDropdown}
            >
              <QuickActionMenu
                selectedAction={viewSettings.annotationQuickAction}
                onActionSelect={handleAnnotationQuickActionSelect}
              />
            </Dropdown>
          )}
        </div>

        <div
          role='contentinfo'
          aria-label={_('Title') + ' - ' + bookTitle}
          className={clsx(
            'header-title z-15 bg-base-100 pointer-events-none hidden flex-1 items-center justify-center sm:flex',
            !windowButtonVisible && 'absolute inset-0',
            isHeaderCompact && '!hidden',
          )}
        >
          <div
            aria-hidden='true'
            className={clsx(
              'line-clamp-1 text-center font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-[#e3c687]',
              'drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]',
              !windowButtonVisible && 'max-w-[50%]',
            )}
          >
            {bookTitle}
          </div>
        </div>

        <div className='header-tools-end z-20 ms-auto flex h-full min-w-max items-center gap-x-2.5 bg-transparent ps-2.5 max-[350px]:gap-x-2'>
          {!isHeaderCompact && <SettingsToggler bookKey={bookKey} />}
          <NotebookToggler bookKey={bookKey} />
          <Dropdown
            label={_('View Options')}
            className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
            buttonClassName='btn btn-ghost h-7 min-h-7 w-7 rounded-md border border-[#b18b4a]/52 bg-[#231613]/88 p-0 text-[#f0d39a] hover:bg-[#31201b]'
            toggleButton={<PiDotsThreeVerticalBold size={iconSize16} />}
            onToggle={handleToggleDropdown}
          >
            <ViewMenu bookKey={bookKey} />
          </Dropdown>
          <WindowButtons
            className='window-buttons flex items-center'
            headerRef={headerRef}
            showMinimize={bookKeys.length == 1 && windowButtonVisible}
            showMaximize={bookKeys.length == 1 && windowButtonVisible}
            closeButtonLabel={_('Close Book')}
            onClose={() => {
              setHoveredBookKey(null);
              onCloseBook(bookKey);
            }}
          />
        </div>
      </div>
      <style jsx global>{`
        .header-bar .btn {
          box-shadow: none;
        }

        .header-bar .btn:focus-visible,
        .header-bar button:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.9),
            0 0 0 3px rgba(120, 24, 18, 0.45);
        }

        .header-bar .header-tools-start,
        .header-bar .header-tools-end,
        .header-bar .header-title {
          background: transparent;
        }

        .header-bar .window-buttons button,
        .header-bar .sidebar-bookmark-toggler button {
          border-radius: 0.5rem;
          border: 1px solid rgba(177, 139, 74, 0.52);
          background: rgba(35, 22, 19, 0.88);
          color: #f0d39a;
        }

        .header-bar .window-buttons button:hover,
        .header-bar .sidebar-bookmark-toggler button:hover {
          background: rgba(49, 32, 27, 0.96);
        }

        .header-bar::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow:
            inset 0 1px 0 rgba(255, 236, 190, 0.12),
            inset 0 0 0 1px rgba(96, 70, 34, 0.22);
          pointer-events: none;
        }
      `}</style>
    </div>
  );
};

export default HeaderBar;
