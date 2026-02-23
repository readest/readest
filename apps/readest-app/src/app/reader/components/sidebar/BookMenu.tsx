import clsx from 'clsx';
import React from 'react';
import Image from 'next/image';

import { MdCheck } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { navigateToLogin } from '@/utils/nav';
import { saveSysSettings } from '@/helpers/settings';
import { setKOSyncSettingsWindowVisible } from '@/app/reader/components/KOSyncSettings';
import { setReadwiseSettingsWindowVisible } from '@/app/reader/components/ReadwiseSettings';
import { setProofreadRulesVisibility } from '@/app/reader/components/ProofreadRules';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import useBooksManager from '../../hooks/useBooksManager';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface BookMenuProps {
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const BookMenu: React.FC<BookMenuProps> = ({ menuClassName, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const { bookKeys, recreateViewer, getViewSettings, setViewSettings } = useReaderStore();
  const { getVisibleLibrary } = useLibraryStore();
  const { openParallelView } = useBooksManager();
  const { sideBarBookKey } = useSidebarStore();
  const { parallelViews, setParallel, unsetParallel } = useParallelViewStore();
  const viewSettings = getViewSettings(sideBarBookKey!);

  const [isSortedTOC, setIsSortedTOC] = React.useState(viewSettings?.sortedTOC || false);

  const handleParallelView = (id: string) => {
    openParallelView(id);
    setIsDropdownOpen?.(false);
  };
  const handleReloadPage = () => {
    window.location.reload();
    setIsDropdownOpen?.(false);
  };
  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };
  const downloadReadest = () => {
    window.open(DOWNLOAD_READEST_URL, '_blank');
    setIsDropdownOpen?.(false);
  };
  const handleExportAnnotations = () => {
    eventDispatcher.dispatch('export-annotations', { bookKey: sideBarBookKey });
    setIsDropdownOpen?.(false);
  };
  const handleToggleSortTOC = () => {
    setIsSortedTOC((prev) => !prev);
    setIsDropdownOpen?.(false);
    if (sideBarBookKey) {
      const viewSettings = getViewSettings(sideBarBookKey)!;
      viewSettings.sortedTOC = !isSortedTOC;
      setViewSettings(sideBarBookKey, viewSettings);
      recreateViewer(envConfig, sideBarBookKey);
    }
  };
  const handleSetParallel = () => {
    setParallel(bookKeys);
    setIsDropdownOpen?.(false);
  };
  const handleUnsetParallel = () => {
    unsetParallel(bookKeys);
    setIsDropdownOpen?.(false);
  };
  const showKoSyncSettingsWindow = () => {
    setKOSyncSettingsWindowVisible(true);
    setIsDropdownOpen?.(false);
  };
  const showProofreadRulesWindow = () => {
    setProofreadRulesVisibility(true);
    setIsDropdownOpen?.(false);
  };
  const handlePullKOSync = () => {
    eventDispatcher.dispatch('pull-kosync', { bookKey: sideBarBookKey });
    setIsDropdownOpen?.(false);
  };
  const handlePushKOSync = () => {
    eventDispatcher.dispatch('push-kosync', { bookKey: sideBarBookKey });
    setIsDropdownOpen?.(false);
  };
  const showReadwiseSettingsWindow = () => {
    setReadwiseSettingsWindowVisible(true);
    setIsDropdownOpen?.(false);
  };
  const handlePushReadwise = () => {
    eventDispatcher.dispatch('readwise-push-all', { bookKey: sideBarBookKey });
    setIsDropdownOpen?.(false);
  };
  const toggleDiscordPresence = () => {
    const discordRichPresenceEnabled = !settings.discordRichPresenceEnabled;
    saveSysSettings(envConfig, 'discordRichPresenceEnabled', discordRichPresenceEnabled);
    setIsDropdownOpen?.(false);
    if (discordRichPresenceEnabled && !user) {
      navigateToLogin(router);
    }
  };

  return (
    <Menu
      className={clsx('book-menu dropdown-content z-20 shadow-2xl', menuClassName)}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('Parallel Read')}
        buttonClass={bookKeys.length > 1 ? 'lg:tooltip lg:tooltip-bottom' : ''}
        tooltip={parallelViews.length > 0 ? _('Disable') : bookKeys.length > 1 ? _('Enable') : ''}
        Icon={parallelViews.length > 0 && bookKeys.length > 1 ? MdCheck : undefined}
        onClick={
          parallelViews.length > 0
            ? handleUnsetParallel
            : bookKeys.length > 1
              ? handleSetParallel
              : undefined
        }
      >
        <ul className='max-h-60 overflow-y-auto'>
          {getVisibleLibrary()
            .filter((book) => !FIXED_LAYOUT_FORMATS.has(book.format))
            .filter((book) => !!book.downloadedAt)
            .slice(0, 20)
            .map((book) => (
              <MenuItem
                key={book.hash}
                Icon={
                  <Image
                    src={book.coverImageUrl!}
                    alt={book.title}
                    width={56}
                    height={80}
                    className='aspect-auto max-h-8 max-w-4 rounded-sm shadow-md'
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                }
                label={book.title}
                labelClass='max-w-36'
                onClick={() => handleParallelView(book.hash)}
              />
            ))}
        </ul>
      </MenuItem>
      {bookKeys.length > 1 &&
        (parallelViews.length > 0 ? (
          <MenuItem label={_('Exit Parallel Read')} onClick={handleUnsetParallel} />
        ) : (
          <MenuItem label={_('Enter Parallel Read')} onClick={handleSetParallel} />
        ))}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {settings.kosync.enabled ? (
        <MenuItem label={_('KOReader Sync')} detailsOpen={false} buttonClass='py-2'>
          <ul className='flex flex-col ps-1'>
            <MenuItem label={_('Config')} noIcon onClick={showKoSyncSettingsWindow} />
            <MenuItem label={_('Push Progress')} noIcon onClick={handlePushKOSync} />
            <MenuItem label={_('Pull Progress')} noIcon onClick={handlePullKOSync} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem label={_('KOReader Sync')} onClick={showKoSyncSettingsWindow} />
      )}
      {settings.readwise.enabled ? (
        <MenuItem label={_('Readwise Sync')} detailsOpen={false} buttonClass='py-2'>
          <ul className='flex flex-col ps-1'>
            <MenuItem label={_('Config')} noIcon onClick={showReadwiseSettingsWindow} />
            <MenuItem label={_('Push Highlights')} noIcon onClick={handlePushReadwise} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem label={_('Readwise Sync')} onClick={showReadwiseSettingsWindow} />
      )}
      {appService?.isDesktopApp && (
        <>
          <hr aria-hidden='true' className='border-base-200 my-1' />
          <MenuItem
            label={_('Show on Discord')}
            tooltip={_("Display what I'm reading on Discord")}
            toggled={settings.discordRichPresenceEnabled}
            onClick={toggleDiscordPresence}
          />
        </>
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Proofread')} onClick={showProofreadRulesWindow} />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Export Annotations')} onClick={handleExportAnnotations} />
      <MenuItem
        label={_('Sort TOC by Page')}
        Icon={isSortedTOC ? MdCheck : undefined}
        onClick={handleToggleSortTOC}
      />
      <MenuItem label={_('Reload Page')} shortcut='Shift+R' onClick={handleReloadPage} />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </Menu>
  );
};

export default BookMenu;
