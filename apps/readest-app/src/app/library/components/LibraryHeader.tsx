import clsx from 'clsx';
import React, { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FaSearch } from 'react-icons/fa';
import { FaChevronDown } from 'react-icons/fa';
import { PiPlus } from 'react-icons/pi';
import { PiSelectionAll, PiSelectionAllFill } from 'react-icons/pi';
import { PiDotsThreeCircle } from 'react-icons/pi';
import { MdOutlineMenu } from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { debounce } from '@/utils/debounce';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import ViewMenu from './ViewMenu';
import LibrarySearchMenu, { type LibrarySearchTarget } from './LibrarySearchMenu';
import type { BookSearchConfig } from '@/types/book';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onImportBookFromNovelUrl?: () => void;
  onOpenCatalogManager: () => void;
  onOpenFeeds: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  searchQuery: string;
  searchTarget: LibrarySearchTarget;
  searchConfig: BookSearchConfig;
  onSearchQueryChange: (query: string) => void;
  onSearchTargetChange: (target: LibrarySearchTarget) => void;
  onSearchConfigChange: (config: BookSearchConfig) => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onImportBookFromNovelUrl,
  onOpenCatalogManager,
  onOpenFeeds,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
  searchQuery,
  searchTarget,
  searchConfig,
  onSearchQueryChange,
  onSearchTargetChange,
  onSearchConfigChange,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();

  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);
  const { safeAreaInsets: insets } = useThemeStore();

  useShortcuts({
    onToggleSelectMode,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      const params = new URLSearchParams(window.location.search);
      if (value) {
        params.set('q', value);
      } else {
        params.delete('q');
      }
      router.push(`?${params.toString()}`);
    }, 500),
    [router],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    onSearchQueryChange(newQuery);
    debouncedUpdateQueryParam(newQuery.trim());
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.length;

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex h-[52px] w-full items-center py-2 pr-4 sm:h-[44px]',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0 sm:pl-2',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div className='flex w-full items-center justify-between space-x-6 sm:space-x-12'>
        <div className='exclude-title-bar-mousedown relative flex w-full items-center pl-4'>
          <div className='relative flex h-9 w-full items-center sm:h-7'>
            <Dropdown
              label={_('Search Options')}
              className='dropdown-bottom dropdown-start'
              containerClassName='absolute inset-y-0 start-0 z-10 items-center'
              buttonClassName='text-base-content/50 flex h-9 min-h-9 items-center gap-0.5 bg-transparent ps-3 pe-1 sm:h-7 sm:min-h-7'
              toggleButton={
                <>
                  <FaSearch className='h-4 w-4' />
                  <FaChevronDown className='h-2.5 w-2.5' />
                </>
              }
            >
              <LibrarySearchMenu
                target={searchTarget}
                config={searchConfig}
                onTargetChange={onSearchTargetChange}
                onConfigChange={onSearchConfigChange}
              />
            </Dropdown>
            <input
              type='text'
              value={searchQuery}
              placeholder={
                searchTarget === 'contents'
                  ? _('Search contents in {{count}} Book(s)...', { count: currentBooksCount })
                  : currentBooksCount > 1
                    ? _('Search in {{count}} Book(s)...', {
                        count: currentBooksCount,
                      })
                    : _('Search Books...')
              }
              onChange={handleSearchChange}
              spellCheck='false'
              className={clsx(
                'search-input input h-9 w-full rounded-full pr-[30%] ps-12 sm:h-7',
                'bg-base-300/45 border-0',
                'font-sans text-sm font-light',
                'placeholder:text-base-content/50 truncate',
                'focus:outline-none focus:ring-0',
              )}
            />
          </div>
          <div className='text-base-content/50 absolute right-4 flex items-center space-x-2 sm:space-x-4'>
            {searchQuery && (
              <button
                type='button'
                onClick={() => {
                  onSearchQueryChange('');
                  debouncedUpdateQueryParam('');
                }}
                className='text-base-content/40 hover:text-base-content/60 pe-1'
                aria-label={_('Clear Search')}
              >
                <IoMdCloseCircle className='h-4 w-4' />
              </button>
            )}
            <span className='bg-base-content/50 mx-2 h-4 w-[0.5px]'></span>
            <Dropdown
              label={_('Import Books')}
              className={clsx(
                'exclude-title-bar-mousedown dropdown-bottom dropdown-center cursor-pointer',
              )}
              buttonClassName='p-0 h-6 min-h-6 w-6 flex touch-target items-center justify-center !bg-transparent'
              toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
            >
              <ImportMenu
                onImportBooksFromFiles={onImportBooksFromFiles}
                onImportBooksFromDirectory={onImportBooksFromDirectory}
                onImportBookFromUrl={onImportBookFromUrl}
                onImportBookFromNovelUrl={onImportBookFromNovelUrl}
                onOpenCatalogManager={onOpenCatalogManager}
                onOpenFeeds={onOpenFeeds}
              />
            </Dropdown>
            {isMobile ? null : (
              <button
                onClick={onToggleSelectMode}
                aria-label={_('Select Books')}
                title={_('Select Books')}
                className='h-6'
              >
                {isSelectMode ? (
                  <PiSelectionAllFill role='button' className='text-base-content/60 h-6 w-6' />
                ) : (
                  <PiSelectionAll role='button' className='text-base-content/60 h-6 w-6' />
                )}
              </button>
            )}
          </div>
        </div>
        {isSelectMode ? (
          <div
            className={clsx(
              'flex h-full items-center',
              'w-max-[72px] w-min-[72px] sm:w-max-[80px] sm:w-min-[80px]',
            )}
          >
            <button
              onClick={isSelectAll ? onDeselectAll : onSelectAll}
              className='btn btn-ghost text-base-content/85 h-8 min-h-8 w-[72px] p-0 sm:w-[80px]'
              aria-label={isSelectAll ? _('Deselect') : _('Select All')}
            >
              <span className='font-sans text-base font-normal sm:text-sm whitespace-nowrap truncate'>
                {isSelectAll ? _('Deselect') : _('Select All')}
              </span>
            </button>
          </div>
        ) : (
          <div className='flex h-full items-center gap-x-2 sm:gap-x-4'>
            <Dropdown
              label={_('View Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<PiDotsThreeCircle role='none' size={iconSize18} />}
            >
              <ViewMenu />
            </Dropdown>
            <Dropdown
              label={_('Settings Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<MdOutlineMenu role='none' size={iconSize18} />}
            >
              <SettingsMenu onPullLibrary={onPullLibrary} />
            </Dropdown>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={windowButtonVisible}
                showMaximize={windowButtonVisible}
                showClose={windowButtonVisible}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryHeader;
