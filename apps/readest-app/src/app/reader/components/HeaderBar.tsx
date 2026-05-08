import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VscLibrary } from 'react-icons/vsc';

import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSpatialNavigation } from '@/app/reader/hooks/useSpatialNavigation';
import { getHighlightColorHex } from '../utils/annotatorUtil';
import { annotationToolQuickActions } from './annotator/AnnotationTools';
import { AnnotationToolType } from '@/types/annotator';
import { saveViewSettings } from '@/helpers/settings';
import { HighlighterIcon } from '@/components/HighlighterIcon';
import Dropdown from '@/components/Dropdown';
import QuickActionMenu from './annotator/QuickActionMenu';
import BookmarkToggler from './BookmarkToggler';
import TranslationToggler from './TranslationToggler';

interface HeaderBarProps {
  bookKey: string;
  bookTitle: string;
  isTopLeft: boolean;
  isHoveredAnim: boolean;
  gridInsets: Insets;
  screenInsets: Insets;
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
  onGoToLibrary,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { trafficLightInFullscreen, setTrafficLightVisibility } = useTrafficLightStore();
  const { hoveredBookKey } = useReaderStore();
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

  return (
    <div
      className={clsx('left-0 top-0 w-full', window.innerWidth < 640 ? 'fixed z-20' : 'absolute')}
      style={{
        paddingTop: appService?.hasSafeAreaInset ? `${insets.top}px` : '0px',
      }}
    >
      <div
        role='none'
        tabIndex={-1}
        className={clsx('absolute top-0 z-10 h-10 w-full', pointerInDoc && 'pointer-events-none')}
        onClick={() => setHoveredBookKey(bookKey)}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'absolute left-0 right-0 top-0 z-10 bg-[linear-gradient(180deg,rgba(12,8,7,0.74),rgba(10,7,6,0.24))]',
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
          `header-bar absolute top-0 z-10 flex h-[40px] w-full items-center pr-2 text-[#cfb07a]`,
          `transition-[opacity,margin-top] duration-300`,
          trafficLightInHeader ? 'pl-20' : isSideBarVisible ? 'ps-3.5' : 'ps-3.5 sm:ps-2.5',
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
        <div className='header-tools-start bg-base-100 sidebar-bookmark-toggler z-20 flex h-full min-w-0 items-center gap-x-1.5 pe-2 max-[350px]:gap-x-1'>
          <div
            className='flex min-w-0 items-center gap-x-2 overflow-x-auto max-[350px]:gap-x-1.5'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {/* Restore-sidebar entry point now lives as a left-edge handle on
                the reader frame (see sidebar/SideBar.tsx). The old top-right
                toggler used to land here next to the Aa cluster — that
                placement was dropped per the design reference. */}
            <button
              title={_('Go to Library')}
              className='btn btn-ghost hidden h-7 min-h-7 w-7 rounded-md border border-[#a07a3c]/40 bg-[#1a110d]/80 p-0 text-[#dab572] hover:bg-[#2a1812]/90 hover:text-[#f1d58a] sm:flex'
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
                'rounded-md border border-[#7d592f]/18 bg-[#130d0b]/54 text-[#c29d63] hover:bg-[#231714]/74 hover:text-[#e1c48d]',
                viewSettings?.annotationQuickAction &&
                  'border-[#8e6541]/26 bg-[#281510]/72 text-[#e5c882]',
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
            'header-title z-15 bg-base-100 pointer-events-none absolute inset-0 hidden items-center justify-center sm:flex',
            isHeaderCompact && '!hidden',
          )}
        >
          <div
            aria-hidden='true'
            className={clsx(
              'line-clamp-1 text-center font-serif text-[8px] font-semibold uppercase tracking-[0.24em] text-[#c4a368]',
              'drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]',
              'max-w-[50%]',
            )}
          >
            {bookTitle}
          </div>
        </div>
      </div>
      <style jsx global>{`
        .header-bar .btn {
          box-shadow: none;
        }

        .header-bar .header-tools-start > button,
        .header-bar .header-tools-start .btn {
          transition:
            background-color 140ms ease,
            border-color 140ms ease,
            color 140ms ease,
            transform 140ms ease;
        }

        .header-bar .btn:focus-visible,
        .header-bar button:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.9),
            0 0 0 3px rgba(120, 24, 18, 0.45);
        }

        .header-bar .header-tools-start,
        .header-bar .header-title {
          background: transparent;
        }

        /* Left-cluster (sidebar/bookmark) — vibrant engraved gold style */
        .header-bar .sidebar-bookmark-toggler button {
          border-radius: 0.5rem;
          border: 1px solid rgba(168, 124, 64, 0.46);
          background: linear-gradient(180deg, rgba(26, 17, 13, 0.95), rgba(14, 10, 8, 0.92));
          color: #dab572;
          box-shadow:
            inset 0 1px 0 rgba(255, 237, 193, 0.06),
            inset 0 -1px 0 rgba(0, 0, 0, 0.36),
            0 4px 10px rgba(0, 0, 0, 0.35);
        }

        .header-bar .sidebar-bookmark-toggler button:hover {
          border-color: rgba(214, 168, 88, 0.78);
          background: linear-gradient(180deg, rgba(46, 26, 20, 0.96), rgba(22, 14, 11, 0.94));
          color: #f1d58a;
        }

        .header-bar .header-title {
          letter-spacing: 0.14em;
        }

        .header-bar .header-title::before,
        .header-bar .header-title::after {
          content: '';
          width: 18px;
          height: 1px;
          margin: 0 8px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(225, 188, 106, 0.14) 34%,
            rgba(225, 188, 106, 0.4) 100%
          );
          display: inline-block;
          vertical-align: middle;
        }

        .header-bar .header-title::after {
          transform: scaleX(-1);
        }

        .header-bar .btn .text-base-content,
        .header-bar button .text-base-content {
          color: currentColor;
        }
      `}</style>
    </div>
  );
};

export default HeaderBar;
