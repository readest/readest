import clsx from 'clsx';
import React from 'react';
import Image from 'next/image';

import { MdCheck } from 'react-icons/md';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import useBooksManager from '../../hooks/useBooksManager';
import MenuItem from '@/components/MenuItem';

interface BookMenuProps {
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const BookMenu: React.FC<BookMenuProps> = ({ menuClassName, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getVisibleLibrary } = useLibraryStore();
  const { openParallelView } = useBooksManager();
  const { sideBarBookKey } = useSidebarStore();
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

  const isWebApp = isWebAppPlatform();

  return (
    <div
      tabIndex={0}
      className={clsx('book-menu dropdown-content border-base-100 z-20 shadow-2xl', menuClassName)}
    >
      <MenuItem label={_('Parallel Read')}>
        <ul className='max-h-60 overflow-y-auto'>
          {getVisibleLibrary()
            .filter((book) => book.format !== 'PDF' && book.format !== 'CBZ')
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
      <MenuItem label={_('Export Annotations')} onClick={handleExportAnnotations} />
      <MenuItem
        label={_('Sort TOC by Page')}
        Icon={isSortedTOC ? MdCheck : undefined}
        onClick={handleToggleSortTOC}
      />
      <MenuItem label={_('Reload Page')} shortcut='Shift+R' onClick={handleReloadPage} />
      <hr className='border-base-200 my-1' />
      {isWebApp && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </div>
  );
};

export default BookMenu;
