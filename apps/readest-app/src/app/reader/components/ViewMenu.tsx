import clsx from 'clsx';
import React, { useEffect } from 'react';
import { useState } from 'react';
import { BiMoon, BiSun } from 'react-icons/bi';
import { TbSunMoon } from 'react-icons/tb';
import { MdZoomOut, MdZoomIn, MdCheck } from 'react-icons/md';
import { IoMdExpand } from 'react-icons/io';
import { TbArrowAutofitWidth } from 'react-icons/tb';

import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { eventDispatcher } from '@/utils/event';
import { getMaxInlineSize } from '@/utils/config';
import { saveViewSettings } from '@/helpers/settings';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({ bookKey, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getBookData } = useBookDataStore();
  const { setSettingsDialogOpen, setSettingsDialogBookKey } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;

  const { themeMode, isDarkMode, setThemeMode } = useThemeStore();
  const [isScrolledMode, setScrolledMode] = useState(viewSettings!.scrolled);
  const [isParagraphMode, setParagraphMode] = useState(
    viewSettings?.paragraphMode?.enabled ?? false,
  );
  const [zoomLevel, setZoomLevel] = useState(viewSettings!.zoomLevel!);
  const [zoomMode, setZoomMode] = useState(viewSettings!.zoomMode!);
  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings!.invertImgColorInDark,
  );

  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM_LEVEL));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM_LEVEL));
  const resetZoom = () => setZoomLevel(100);
  const toggleScrolledMode = () => setScrolledMode(!isScrolledMode);
  const toggleParagraphMode = () => {
    setParagraphMode(!isParagraphMode);
    eventDispatcher.dispatch('toggle-paragraph-mode', { bookKey });
    setIsDropdownOpen?.(false);
  };

  const openFontLayoutMenu = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogBookKey(bookKey);
    setSettingsDialogOpen(true);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const handleStartRSVP = () => {
    setIsDropdownOpen?.(false);
    eventDispatcher.dispatch('rsvp-start', { bookKey });
  };

  useEffect(() => {
    if (isScrolledMode === viewSettings!.scrolled) return;
    viewSettings!.scrolled = isScrolledMode;
    getView(bookKey)?.renderer.setAttribute('flow', isScrolledMode ? 'scrolled' : 'paginated');
    getView(bookKey)?.renderer.setAttribute(
      'max-inline-size',
      `${getMaxInlineSize(viewSettings)}px`,
    );
    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings!));
    setViewSettings(bookKey, viewSettings!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrolledMode]);

  useEffect(() => {
    if (zoomLevel === viewSettings.zoomLevel) return;
    saveViewSettings(envConfig, bookKey, 'zoomLevel', zoomLevel, true, true);
    if (bookData.bookDoc?.rendition?.layout === 'pre-paginated') {
      getView(bookKey)?.renderer.setAttribute('scale-factor', zoomLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (zoomMode === viewSettings.zoomMode) return;
    viewSettings.zoomMode = zoomMode;
    getView(bookKey)?.renderer.setAttribute('zoom', zoomMode);
    setViewSettings(bookKey, viewSettings);
    saveViewSettings(envConfig, bookKey, 'zoomMode', zoomMode, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomMode]);

  return (
    <Menu
      className={clsx(
        'view-menu dropdown-content dropdown-right no-triangle z-20 mt-1.5 border',
        'bgcolor-base-200 shadow-2xl',
      )}
      style={{
        maxWidth: `${window.innerWidth - 40}px`,
        marginRight: window.innerWidth < 640 ? '-36px' : '0px',
      }}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {bookData.bookDoc?.rendition?.layout === 'pre-paginated' && (
        <>
          <div
            title={_('Zoom Level')}
            className={clsx('flex items-center justify-between rounded-md')}
          >
            <button
              title={_('Zoom Out')}
              onClick={zoomOut}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                zoomLevel <= MIN_ZOOM_LEVEL && 'btn-disabled text-gray-400',
              )}
            >
              <MdZoomOut />
            </button>
            <button
              title={_('Reset Zoom')}
              className={clsx(
                'hover:bg-base-300 text-base-content h-8 min-h-8 w-[50%] rounded-md p-1 text-center',
              )}
              onClick={resetZoom}
            >
              {Math.round(zoomLevel)}%
            </button>
            <button
              title={_('Zoom In')}
              onClick={zoomIn}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                zoomLevel >= MAX_ZOOM_LEVEL && 'btn-disabled text-gray-400',
              )}
            >
              <MdZoomIn />
            </button>
          </div>
          <div
            title={_('Zoom Mode')}
            className={clsx('my-2 flex items-center justify-center gap-2 rounded-md')}
          >
            <button
              title={_('Fit Page')}
              onClick={setZoomMode.bind(null, 'fit-page')}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                zoomMode === 'fit-page' && 'bg-base-300/75',
              )}
            >
              <IoMdExpand />
            </button>
            <button
              title={_('Fit Width')}
              onClick={setZoomMode.bind(null, 'fit-width')}
              className={clsx(
                'hover:bg-base-300 text-base-content rounded-full p-2',
                zoomMode === 'fit-width' && 'bg-base-300/75',
              )}
            >
              <TbArrowAutofitWidth />
            </button>
          </div>
          <hr aria-hidden='true' className='border-base-300 my-1' />
        </>
      )}

      <MenuItem label={_('Font & Layout')} shortcut='Shift+F' onClick={openFontLayoutMenu} />

      <MenuItem
        label={_('Scrolled Mode')}
        shortcut='Shift+J'
        Icon={isScrolledMode ? MdCheck : undefined}
        onClick={toggleScrolledMode}
      />

      <hr aria-hidden='true' className='border-base-300 my-1' />

      <MenuItem
        label={_('Paragraph Mode')}
        shortcut='Shift+P'
        Icon={isParagraphMode ? MdCheck : undefined}
        onClick={toggleParagraphMode}
        disabled={bookData.isFixedLayout}
      />

      <MenuItem
        label={_('Speed Reading Mode')}
        onClick={handleStartRSVP}
        disabled={bookData.isFixedLayout}
      />

      <MenuItem
        label={
          themeMode === 'dark'
            ? _('Dark Mode')
            : themeMode === 'light'
              ? _('Light Mode')
              : _('Auto Mode')
        }
        Icon={themeMode === 'dark' ? BiMoon : themeMode === 'light' ? BiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <MenuItem
        label={_('Invert Image In Dark Mode')}
        disabled={!isDarkMode}
        Icon={invertImgColorInDark ? MdCheck : undefined}
        onClick={() => setInvertImgColorInDark(!invertImgColorInDark)}
      />
    </Menu>
  );
};

export default ViewMenu;
