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

  const headerIconButtonClassName =
    'flex h-8 w-8 items-center justify-center rounded-[5px] border border-transparent bg-transparent p-0 text-[#8c816d] transition-colors hover:border-white/[0.06] hover:bg-[rgba(20,16,12,0.18)] hover:text-[#c99535]';

  const compactHeaderIconButtonClassName =
    'flex h-6 min-h-6 w-6 touch-target items-center justify-center rounded-[4px] border border-transparent !bg-transparent p-0 text-[#8c816d] transition-colors hover:border-white/[0.06] hover:bg-[rgba(20,16,12,0.16)] hover:text-[#c99535]';

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
        <div className='flex w-full items-center justify-end gap-2 px-4 sm:gap-2.5 sm:px-6'>
          <div className='exclude-title-bar-mousedown relative flex w-full max-w-[320px] items-center'>
            <div className='relative flex h-8 w-full items-center'>
              <span className='absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-[#8f887b]'>
                <FaSearch className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
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
                  'search-input input h-8 w-full rounded-[6px] border border-white/[0.06] bg-[rgba(8,8,9,0.16)] py-0 pe-[76px] ps-9',
                  'font-sans text-sm font-normal tracking-normal text-[#e8dfd0]',
                  'truncate placeholder:text-[#766f65]',
                  'shadow-[inset_0_1px_0_rgba(255,248,235,0.02)] backdrop-blur-[1px]',
                  'transition-[border-color,background-color] duration-200',
                  'focus:outline-none focus:ring-0 focus-visible:border-[rgba(155,106,30,0.62)] focus-visible:shadow-none',
                  'sm:pe-[82px] sm:ps-10',
                )}
              />
            </div>

            <div className='absolute right-2 flex items-center gap-1 text-[#8c816d]'>
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    debouncedUpdateQueryParam('');
                  }}
                  className='flex h-6 w-6 items-center justify-center rounded-[4px] text-[#685d50] transition-colors hover:text-[#c99535]'
                  aria-label={_('Clear Search')}
                >
                  <IoMdCloseCircle className='h-4 w-4' />
                </button>
              )}
              <Dropdown
                label={_('Import Books')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-center cursor-pointer'
                buttonClassName={compactHeaderIconButtonClassName}
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
                  className='flex h-6 w-6 items-center justify-center rounded-[4px] text-[#8c816d] transition-colors hover:text-[#c99535]'
                >
                  {isSelectMode ? (
                    <PiSelectionAllFill role='button' className='h-5 w-5' />
                  ) : (
                    <PiSelectionAll role='button' className='h-5 w-5' />
                  )}
                </button>
              )}
            </div>
          </div>

          {isSelectMode ? (
            <div className='flex h-full shrink-0 items-center'>
              <button
                onClick={isSelectAll ? onDeselectAll : onSelectAll}
                className='inline-flex h-8 shrink-0 items-center rounded-[5px] border border-[rgba(155,106,30,0.78)] bg-[rgba(8,8,9,0.14)] px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#b9852c] backdrop-blur-[1px] transition-colors hover:border-[#b9852c] hover:bg-[rgba(20,16,12,0.22)] hover:text-[#c99535] sm:px-4'
                aria-label={isSelectAll ? _('Deselect') : _('Select All')}
              >
                {isSelectAll ? _('Deselect') : _('Select All')}
              </button>
            </div>
          ) : (
            <div className='exclude-title-bar-mousedown flex h-full shrink-0 items-center gap-2 sm:gap-2.5'>
              <Link
                href='/'
                aria-label={_('Home')}
                title={_('Home')}
                className='exclude-title-bar-mousedown inline-flex h-8 shrink-0 items-center rounded-[5px] border border-[rgba(155,106,30,0.78)] bg-[rgba(8,8,9,0.14)] px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#b9852c] backdrop-blur-[1px] transition-colors hover:border-[#b9852c] hover:bg-[rgba(20,16,12,0.22)] hover:text-[#c99535] sm:px-4'
              >
                {_('Home')}
              </Link>
              <Dropdown
                label={_('View Menu')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
                buttonClassName={headerIconButtonClassName}
                toggleButton={<PiDotsThreeCircle role='none' size={iconSize18} />}
              >
                <ViewMenu />
              </Dropdown>
              <Dropdown
                label={_('Settings Menu')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
                buttonClassName={headerIconButtonClassName}
                toggleButton={<MdOutlineMenu role='none' size={iconSize18} />}
              >
                <SettingsMenu onPullLibrary={onPullLibrary} />
              </Dropdown>
              {appService?.hasWindowBar && (
                <WindowButtons
                  headerRef={headerRef}
                  className='gap-1 pr-0 text-[#b9852c] [&_button:hover]:!bg-transparent [&_button:hover]:text-[#c99535] [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:text-[#b9852c] [&_button]:!shadow-none [&_svg]:stroke-[#b9852c] [&_svg]:text-[#b9852c]'
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
