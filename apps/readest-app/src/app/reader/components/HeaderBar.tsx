import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';

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
  onCloseBook: (bookKey: string) => void;
}

const HeaderBar: React.FC<HeaderBarProps> = ({
  bookKey,
  bookTitle,
  isTopLeft,
  isHoveredAnim,
  gridInsets,
  onCloseBook,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { isTrafficLightVisible } = useTrafficLight();
  const { trafficLightInFullscreen, setTrafficLightVisibility } = useTrafficLightStore();
  const { bookKeys, hoveredBookKey } = useReaderStore();
  const { isDarkMode, systemUIVisible, statusBarHeight } = useThemeStore();
  const { isSideBarVisible } = useSidebarStore();
  const { getView, getViewSettings, setHoveredBookKey } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const view = getView(bookKey);
  const iconSize16 = useResponsiveSize(16);
  const headerRef = useRef<HTMLDivElement>(null);
  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;

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
    if (!isOpen) setHoveredBookKey('');
  };

  const handleAnnotationQuickActionSelect = (action: AnnotationToolType | null) => {
    if (viewSettings?.annotationQuickAction === action) action = null;
    saveViewSettings(envConfig, bookKey, 'annotationQuickAction', action, false, true);
  };

  useEffect(() => {
    if (!appService?.hasTrafficLight) return;
    if (isSideBarVisible) return;

    if (hoveredBookKey === bookKey && isTopLeft) {
      setTrafficLightVisibility(true, { x: 10, y: 20 });
    } else if (!hoveredBookKey) {
      setTrafficLightVisibility(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, isSideBarVisible, hoveredBookKey]);

  // Check if mouse is outside header area to avoid false positive event of MouseLeave when clicking inside header on Windows
  const isMouseOutsideHeader = useCallback((clientX: number, clientY: number) => {
    if (!headerRef.current) return true;

    const rect = headerRef.current.getBoundingClientRect();
    return (
      clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom
    );
  }, []);

  const isHeaderVisible = hoveredBookKey === bookKey || isDropdownOpen;
  const trafficLightInHeader =
    appService?.hasTrafficLight && !trafficLightInFullscreen && !isSideBarVisible && isTopLeft;

  return (
    <div
      className={clsx('bg-base-100 absolute top-0 w-full')}
      style={{
        paddingTop: appService?.hasSafeAreaInset ? `${gridInsets.top}px` : '0px',
      }}
    >
      <div
        role='none'
        className={clsx('absolute top-0 z-10 h-11 w-full', pointerInDoc && 'pointer-events-none')}
        onClick={() => setHoveredBookKey(bookKey)}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'bg-base-100 absolute left-0 right-0 top-0 z-10',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          isHeaderVisible ? 'visible' : 'hidden',
        )}
        style={{
          height: systemUIVisible ? `${Math.max(gridInsets.top, statusBarHeight)}px` : '0px',
        }}
      />
      <div
        ref={headerRef}
        role='group'
        aria-label={_('Header Bar')}
        className={clsx(
          `header-bar bg-base-100 absolute top-0 z-10 flex h-11 w-full items-center pr-4`,
          `shadow-xs transition-[opacity,margin-top] duration-300`,
          trafficLightInHeader ? 'pl-20' : 'pl-4',
          appService?.hasRoundedWindow && 'rounded-window-top-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-top-left',
          isHoveredAnim && 'hover-bar-anim',
          isHeaderVisible ? 'pointer-events-auto visible' : 'pointer-events-none opacity-0',
          isDropdownOpen && 'header-bar-pinned',
        )}
        style={{
          marginTop: systemUIVisible
            ? `${Math.max(gridInsets.top, statusBarHeight)}px`
            : `${gridInsets.top}px`,
        }}
        onFocus={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onMouseLeave={(e) => {
          if (!appService?.isMobile && isMouseOutsideHeader(e.clientX, e.clientY)) {
            setHoveredBookKey('');
          }
        }}
      >
        <div className='bg-base-100 sidebar-bookmark-toggler z-20 flex h-full items-center gap-x-4 pe-2'>
          <div className='hidden sm:flex'>
            <SidebarToggler bookKey={bookKey} />
          </div>
          <BookmarkToggler bookKey={bookKey} />
          <TranslationToggler bookKey={bookKey} />
          {enableAnnotationQuickActions && (
            <Dropdown
              label={
                annotationQuickAction
                  ? _('Disable Quick Action')
                  : _('Enable Quick Action on Selection')
              }
              className='exclude-title-bar-mousedown dropdown-bottom'
              buttonClassName={clsx(
                'btn btn-ghost h-8 min-h-8 w-8 p-0',
                viewSettings?.annotationQuickAction && 'bg-base-300/50',
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
          )}
        >
          <div
            aria-hidden='true'
            className={clsx(
              'line-clamp-1 text-center text-xs font-semibold',
              !windowButtonVisible && 'max-w-[50%]',
            )}
          >
            {bookTitle}
          </div>
        </div>

        <div className='bg-base-100 z-20 ml-auto flex h-full items-center space-x-4 ps-2'>
          <SettingsToggler bookKey={bookKey} />
          <NotebookToggler bookKey={bookKey} />
          <Dropdown
            label={_('View Options')}
            className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
            buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
            toggleButton={<PiDotsThreeVerticalBold size={iconSize16} />}
            onToggle={handleToggleDropdown}
          >
            <ViewMenu bookKey={bookKey} />
          </Dropdown>

          <WindowButtons
            className='window-buttons flex h-full items-center'
            headerRef={headerRef}
            showMinimize={bookKeys.length == 1 && windowButtonVisible}
            showMaximize={bookKeys.length == 1 && windowButtonVisible}
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
