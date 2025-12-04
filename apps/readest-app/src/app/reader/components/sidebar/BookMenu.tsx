import clsx from 'clsx';
import React from 'react';
import Image from 'next/image';

import { MdCheck } from 'react-icons/md';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { setKOSyncSettingsWindowVisible } from '@/app/reader/components/KOSyncSettings';
import { setReplacementRulesWindowVisible } from '@/app/reader/components/ReplacementRulesWindow';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';
import useBooksManager from '../../hooks/useBooksManager';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface BookMenuProps {
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const BookMenu: React.FC<BookMenuProps> = ({ menuClassName, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { bookKeys, getViewSettings, setViewSettings } = useReaderStore();
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
    }
    setTimeout(() => window.location.reload(), 100);
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
  const showReplacementRulesWindow = () => {
    setReplacementRulesWindowVisible(true);
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

  return (
    <Menu
      className={clsx('book-menu dropdown-content border-base-100 z-20 shadow-2xl', menuClassName)}
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
      <hr className='border-base-200 my-1' />
      <MenuItem label={_('KOReader Sync')} onClick={showKoSyncSettingsWindow} />
      <MenuItem label={_('Replacement Rules')} onClick={showReplacementRulesWindow} />
      {settings.kosync.enabled && (
        <>
          <MenuItem label={_('Push Progress')} onClick={handlePushKOSync} />
          <MenuItem label={_('Pull Progress')} onClick={handlePullKOSync} />
        </>
      )}
      <hr className='border-base-200 my-1' />
      <MenuItem label={_('Export Annotations')} onClick={handleExportAnnotations} />
      <MenuItem
        label={_('Sort TOC by Page')}
        Icon={isSortedTOC ? MdCheck : undefined}
        onClick={handleToggleSortTOC}
      />
      <MenuItem label={_('Reload Page')} shortcut='Shift+R' onClick={handleReloadPage} />
      <hr className='border-base-200 my-1' />
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </Menu>
  );
};

export default BookMenu;
