import clsx from 'clsx';
import React, { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSearch } from 'react-icons/fa';
import { PiPlus, PiSelectionAll, PiSelectionAllFill, PiDotsThreeCircle } from 'react-icons/pi';
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
import AppTitleBar from '@/components/AppTitleBar';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import ViewMenu from './ViewMenu';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onOpenCatalogManager: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onOpenCatalogManager,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();
  const { isTrafficLightVisible } = useTrafficLight();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('q') ?? '');

  const headerRef = useRef<HTMLDivElement>(null);
  const iconSize18 = useResponsiveSize(18);
  const { safeAreaInsets: insets } = useThemeStore();

  useShortcuts({
    onToggleSelectMode,
  });

  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (value) {
        params.set('q', value);
      } else {
        params.delete('q');
      }
      router.push(`?${params.toString()}`);
    }, 500),
    [searchParams, router],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    debouncedUpdateQueryParam(newQuery);
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.reduce(
    (acc, item) => acc + ('books' in item ? item.books.length : 1),
    0,
  );

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <AppTitleBar
      headerRef={headerRef}
      className={clsx(
        'citadel-library-topbar bg-transparent',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0 sm:pl-2',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : appService?.hasTrafficLight
            ? '-2px'
            : '0px',
      }}
      centerClassName='w-full'
      centerContent={
        <div className='flex w-full items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6'>
          <div className='exclude-title-bar-mousedown relative ml-auto flex w-full max-w-[360px] items-center'>
            <div className='relative flex h-9 w-full items-center'>
              <span className='absolute left-3 text-[#8c816d]'>
                <FaSearch className='h-3.5 w-3.5' />
              </span>
              <input
                type='text'
                value={searchQuery}
                placeholder={
                  currentBooksCount > 1
                    ? _('Search in {{count}} Book(s)...', { count: currentBooksCount })
                    : _('Search Books...')
                }
                onChange={handleSearchChange}
                spellCheck='false'
                className={clsx(
                  'search-input input h-9 w-full rounded-full border border-[rgba(185,133,44,0.34)] bg-[rgba(8,8,9,0.78)] pe-[31%] ps-9',
                  'font-sans text-sm font-normal text-[#ece1cf]',
                  'truncate placeholder:text-[#7b6f61]',
                  'shadow-[inset_0_1px_0_rgba(255,243,221,0.03)] backdrop-blur-sm',
                  'transition-[box-shadow,border-color,background-color] duration-200',
                  'focus:outline-none focus:ring-0',
                  'focus-visible:border-[rgba(212,170,92,0.7)] focus-visible:bg-[rgba(10,9,9,0.88)] focus-visible:shadow-[0_0_0_1px_rgba(185,133,44,0.14)]',
                )}
              />
            </div>
            <div className='absolute right-3 flex items-center rounded-full border border-[rgba(185,133,44,0.18)] bg-[rgba(10,10,10,0.72)] px-2 py-1 text-[#8c816d] backdrop-blur-sm sm:space-x-1'>
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    debouncedUpdateQueryParam('');
                  }}
                  className='pe-1 text-[#685d50] transition-colors hover:text-[#d2b27c]'
                  aria-label={_('Clear Search')}
                >
                  <IoMdCloseCircle className='h-4 w-4' />
                </button>
              )}
              <span className='mx-1 h-4 w-px bg-[rgba(185,133,44,0.16)]'></span>
              <Dropdown
                label={_('Import Books')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-center cursor-pointer'
                buttonClassName='flex h-6 min-h-6 w-6 touch-target items-center justify-center !bg-transparent p-0 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
              >
                <ImportMenu
                  onImportBooksFromFiles={onImportBooksFromFiles}
                  onImportBooksFromDirectory={onImportBooksFromDirectory}
                  onOpenCatalogManager={onOpenCatalogManager}
                />
              </Dropdown>
              {isMobile ? null : (
                <button
                  onClick={onToggleSelectMode}
                  aria-label={_('Select Books')}
                  title={_('Select Books')}
                  className='h-6 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                >
                  {isSelectMode ? (
                    <PiSelectionAllFill
                      role='button'
                      className='h-6 w-6 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                    />
                  ) : (
                    <PiSelectionAll
                      role='button'
                      className='h-6 w-6 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                    />
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
                className='h-8 min-h-8 w-[88px] rounded-full border border-[rgba(185,133,44,0.22)] bg-[rgba(10,10,10,0.68)] p-0 text-[#d7bc88] transition-colors hover:bg-[rgba(185,133,44,0.1)] sm:w-[96px]'
                aria-label={isSelectAll ? _('Deselect') : _('Select All')}
              >
                <span className='font-sans text-base font-normal sm:text-sm'>
                  {isSelectAll ? _('Deselect') : _('Select All')}
                </span>
              </button>
            </div>
          ) : (
            <div className='flex h-full items-center gap-x-1 rounded-full border border-[rgba(185,133,44,0.22)] bg-[rgba(9,9,9,0.74)] px-1.5 py-1 shadow-[0_10px_22px_rgba(0,0,0,0.18)] sm:gap-x-1.5'>
              <Link
                href='/'
                aria-label={_('Home')}
                title={_('Home')}
                className='inline-flex h-8 min-h-8 items-center rounded-full border border-[rgba(185,133,44,0.34)] px-3 text-[11px] font-medium uppercase tracking-[0.16em] text-[#d7bc88] transition-colors hover:bg-[rgba(185,133,44,0.1)]'
              >
                {_('Home')}
              </Link>
              <Dropdown
                label={_('View Menu')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
                buttonClassName='h-8 min-h-8 w-8 rounded-full p-0 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                toggleButton={<PiDotsThreeCircle role='none' size={iconSize18} />}
              >
                <ViewMenu />
              </Dropdown>
              <Dropdown
                label={_('Settings Menu')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
                buttonClassName='h-8 min-h-8 w-8 rounded-full p-0 text-[#8c816d] transition-colors hover:text-[#d2b27c]'
                toggleButton={<MdOutlineMenu role='none' size={iconSize18} />}
              >
                <SettingsMenu onPullLibrary={onPullLibrary} />
              </Dropdown>
              {appService?.hasWindowBar && (
                <WindowButtons
                  headerRef={headerRef}
                  className='gap-1 text-[#b9852c] [&_button:hover]:!bg-transparent [&_button:hover]:text-[#cfaa6a] [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:text-[#b9852c] [&_button]:!shadow-none [&_svg]:stroke-[#b9852c] [&_svg]:text-[#b9852c]'
                  showMinimize={windowButtonVisible}
                  showMaximize={windowButtonVisible}
                  showClose={windowButtonVisible}
                />
              )}
            </div>
          )}
        </div>
      }
    />
  );
};

export default LibraryHeader;
