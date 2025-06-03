import clsx from 'clsx';
import React, { useEffect } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BiMoon, BiSun } from 'react-icons/bi';
import { TbSunMoon } from 'react-icons/tb';
import { MdZoomOut, MdZoomIn, MdCheck } from 'react-icons/md';
import { MdSync, MdSyncProblem } from 'react-icons/md';

import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { navigateToLogin } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { getMaxInlineSize } from '@/utils/config';
import { tauriHandleToggleFullScreen } from '@/utils/window';
import { saveViewSettings } from '../utils/viewSettingsHelper';
import MenuItem from '@/components/MenuItem';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onSetSettingsDialogOpen: (open: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({
  bookKey,
  setIsDropdownOpen,
  onSetSettingsDialogOpen,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { envConfig, appService } = useEnv();
  const { getConfig } = useBookDataStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const config = getConfig(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;

  const { themeMode, isDarkMode, setThemeMode } = useThemeStore();
  const [isScrolledMode, setScrolledMode] = useState(viewSettings!.scrolled);
  const [zoomLevel, setZoomLevel] = useState(viewSettings!.zoomLevel!);
  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings!.invertImgColorInDark,
  );

  const zoomIn = () => setZoomLevel((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM_LEVEL));
  const zoomOut = () => setZoomLevel((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM_LEVEL));
  const resetZoom = () => setZoomLevel(100);
  const toggleScrolledMode = () => setScrolledMode(!isScrolledMode);

  const openFontLayoutMenu = () => {
    setIsDropdownOpen?.(false);
    onSetSettingsDialogOpen(true);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const handleFullScreen = () => {
    tauriHandleToggleFullScreen();
    setIsDropdownOpen?.(false);
  };

  const handleSync = () => {
    if (!user) {
      navigateToLogin(router);
      setIsDropdownOpen?.(false);
    } else {
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
    }
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
    saveViewSettings(envConfig, bookKey, 'zoomLevel', zoomLevel, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark, true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  const lastSyncTime = Math.max(config?.lastSyncedAtConfig || 0, config?.lastSyncedAtNotes || 0);

  return (
    <div
      tabIndex={0}
      className='view-menu dropdown-content bgcolor-base-200 dropdown-right no-triangle border-base-200 z-20 mt-1 border shadow-2xl'
    >
      <div className={clsx('flex items-center justify-between rounded-md')}>
        <button
          onClick={zoomOut}
          className={clsx(
            'hover:bg-base-300 text-base-content rounded-full p-2',
            zoomLevel <= MIN_ZOOM_LEVEL && 'btn-disabled text-gray-400',
          )}
        >
          <MdZoomOut />
        </button>
        <button
          className={clsx(
            'hover:bg-base-300 text-base-content h-8 min-h-8 w-[50%] rounded-md p-1 text-center',
          )}
          onClick={resetZoom}
        >
          {zoomLevel}%
        </button>
        <button
          onClick={zoomIn}
          className={clsx(
            'hover:bg-base-300 text-base-content rounded-full p-2',
            zoomLevel >= MAX_ZOOM_LEVEL && 'btn-disabled text-gray-400',
          )}
        >
          <MdZoomIn />
        </button>
      </div>

      <hr className='border-base-300 my-1' />

      <MenuItem label={_('Font & Layout')} shortcut='Shift+F' onClick={openFontLayoutMenu} />

      <MenuItem
        label={_('Scrolled Mode')}
        shortcut='Shift+J'
        Icon={isScrolledMode ? MdCheck : undefined}
        onClick={toggleScrolledMode}
      />

      <hr className='border-base-300 my-1' />

      <MenuItem
        label={
          !user
            ? _('Sign in to Sync')
            : lastSyncTime
              ? _('Synced at {{time}}', {
                  time: new Date(lastSyncTime).toLocaleString(),
                })
              : _('Never synced')
        }
        Icon={user ? MdSync : MdSyncProblem}
        onClick={handleSync}
      />

      <hr className='border-base-300 my-1' />

      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
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
    </div>
  );
};

export default ViewMenu;
