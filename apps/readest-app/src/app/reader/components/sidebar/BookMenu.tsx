import clsx from 'clsx';
import React from 'react';
import Image from 'next/image';

import MenuItem from '@/components/MenuItem';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { useLibraryStore } from '@/store/libraryStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import useBooksManager from '../../hooks/useBooksManager';

interface BookMenuProps {
  menuClassName?: string;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const BookMenu: React.FC<BookMenuProps> = ({ menuClassName, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { getVisibleLibrary } = useLibraryStore();
  const { openParallelView } = useBooksManager();
  const { sideBarBookKey } = useSidebarStore();

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

  const isWebApp = isWebAppPlatform();

  return (
    <div
      tabIndex={0}
      className={clsx(
        'book-menu dropdown-content border-base-100 z-20 w-60 shadow-2xl',
        menuClassName,
      )}
    >
      <MenuItem label={_('Parallel Read')} noIcon>
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
      <MenuItem label={_('Export Annotations')} noIcon onClick={handleExportAnnotations} />
      <MenuItem label={_('Reload Page')} noIcon shortcut='Shift+R' onClick={handleReloadPage} />
      <hr className='border-base-200 my-1' />
      {isWebApp && <MenuItem label={_('Download Readest')} noIcon onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} noIcon onClick={showAboutReadest} />
    </div>
  );
};

export default BookMenu;
