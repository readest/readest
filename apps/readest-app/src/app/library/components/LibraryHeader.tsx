import clsx from 'clsx';
import React, { useRef } from 'react';
import { FaChevronDown, FaSearch } from 'react-icons/fa';
import { MdManageSearch } from 'react-icons/md';
import { PiPlus } from 'react-icons/pi';
import { PiSelectionAll, PiSelectionAllFill } from 'react-icons/pi';
import { PiDotsThreeCircle } from 'react-icons/pi';
import { MdOutlineMenu } from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibrarySearchConfig, LibrarySearchTarget } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import LibrarySearchOptionsMenu from './LibrarySearchOptionsMenu';
import ViewMenu from './ViewMenu';

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
  searchConfig: LibrarySearchConfig;
  onSearchConfigChange: (config: LibrarySearchConfig) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchTargetChange: (target: LibrarySearchTarget) => void;
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
  onSearchConfigChange,
  onSearchQueryChange,
  onSearchTargetChange,
}) => {
  const _ = useTranslation();
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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchQueryChange(e.target.value);
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
            {/* The icon doubles as the mode indicator and toggle: magnifier
                for book search, full-text glyph for content search. */}
            <div className='absolute inset-y-0 start-0 z-10 flex items-center'>
              <button
                type='button'
                aria-pressed={searchTarget === 'text'}
                aria-label={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                title={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                className={clsx(
                  'text-base-content/55 hover:text-base-content',
                  'not-eink:transition-colors ms-1.5 flex h-7 min-h-7 items-center justify-center',
                  'touch-target w-8 rounded-full bg-transparent duration-150',
                  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                )}
                onClick={() => onSearchTargetChange(searchTarget === 'text' ? 'books' : 'text')}
              >
                {searchTarget === 'text' ? (
                  <MdManageSearch className='h-5 w-5 -translate-y-[1px]' />
                ) : (
                  <FaSearch className='h-3.5 w-3.5' />
                )}
              </button>
            </div>
            <input
              type='text'
              value={searchQuery}
              placeholder={
                searchTarget === 'text'
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
                'search-input input h-9 w-full rounded-full pe-[30%] ps-10 sm:h-7',
                'bg-base-300/45 border-0',
                'font-sans text-sm font-light',
                'placeholder:text-base-content/50 truncate',
                'focus:outline-none focus:ring-0',
              )}
            />
            {searchTarget === 'text' && (
              <div
                className={clsx(
                  'not-eink:bg-base-300/70 not-eink:hover:bg-base-300 not-eink:transition-colors',
                  'absolute end-0 flex h-full w-9 items-center justify-center rounded-e-full duration-150',
                )}
              >
                <Dropdown
                  label={_('Search Options')}
                  className='dropdown-bottom dropdown-end'
                  menuClassName='no-triangle mt-1'
                  buttonClassName={clsx(
                    'btn btn-ghost h-full min-h-0 w-9 rounded-none rounded-e-full p-0',
                    '!bg-transparent hover:!bg-transparent',
                  )}
                  toggleButton={
                    <FaChevronDown role='none' className='text-base-content/50 h-3 w-3' />
                  }
                >
                  <LibrarySearchOptionsMenu
                    config={searchConfig}
                    onConfigChange={onSearchConfigChange}
                  />
                </Dropdown>
              </div>
            )}
          </div>
          <div
            className={clsx(
              'text-base-content/50 absolute flex items-center space-x-2 sm:space-x-4',
              searchTarget === 'text' ? 'end-14' : 'right-4',
            )}
          >
            {searchQuery && (
              <button
                type='button'
                onClick={() => onSearchQueryChange('')}
                className='text-base-content/40 hover:text-base-content/60 pe-1'
                aria-label={_('Clear Search')}
              >
                <IoMdCloseCircle className='h-4 w-4' />
              </button>
            )}
            {searchTarget !== 'text' && (
              <>
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
              </>
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
