'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaSearch } from 'react-icons/fa';
import { IoMdCloseCircle } from 'react-icons/io';
import { IoChevronBack, IoChevronForward, IoHome } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useSettingsStore } from '@/store/settingsStore';
import { navigateToLibrary } from '@/utils/nav';
import { debounce } from '@/utils/debounce';
import WindowButtons from '@/components/WindowButtons';

interface NavigationProps {
  searchTerm?: string;
  onBack?: () => void;
  onForward?: () => void;
  onGoStart: () => void;
  onSearch: (queryTerm: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  hasSearch: boolean;
}

export function Navigation({
  searchTerm,
  onBack,
  onForward,
  onGoStart,
  onSearch,
  canGoBack,
  canGoForward,
  hasSearch = false,
}: NavigationProps) {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const viewSettings = settings.globalViewSettings;

  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { isTrafficLightVisible } = useTrafficLight();

  useEffect(() => {
    setSearchQuery(searchTerm || '');
  }, [searchTerm]);

  useEffect(() => {
    if (hasSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [hasSearch]);

  const handleGoLibrary = useCallback(() => {
    navigateToLibrary(router, 'opds=true', {}, true);
  }, [router]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      if (value) {
        onSearch(value);
      }
    }, 1000),
    [onSearch],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    debouncedUpdateQueryParam(newQuery);
  };

  return (
    <header
      className={clsx(
        'navbar min-h-0 px-2',
        'flex h-[48px] w-full items-center',
        appService?.isMobile ? '' : 'bg-base-100',
      )}
    >
      <div className={clsx('justify-start gap-1 sm:gap-3', isTrafficLightVisible && '!pl-16')}>
        <div className='flex gap-1'>
          {onBack && (
            <button
              className='btn btn-ghost btn-sm px-1 disabled:bg-transparent'
              onClick={onBack}
              disabled={!canGoBack}
              title={_('Back')}
            >
              <IoChevronBack className='h-6 w-6' />
            </button>
          )}
          {onForward && (
            <button
              className='btn btn-ghost btn-sm px-1 disabled:bg-transparent'
              onClick={onForward}
              disabled={!canGoForward}
              title={_('Forward')}
            >
              <IoChevronForward className='h-6 w-6' />
            </button>
          )}
        </div>
        <button className='btn btn-ghost btn-sm px-1' onClick={onGoStart} title={_('Home')}>
          <IoHome className='h-5 w-5' />
        </button>
      </div>

      <div className='flex-grow px-3 sm:px-5'>
        <div className='relative flex w-full items-center'>
          <span className='text-base-content/50 absolute left-3'>
            <FaSearch className='h-4 w-4' />
          </span>
          <input
            type='text'
            ref={inputRef}
            value={searchQuery}
            placeholder={_('Search in OPDS Catalog...')}
            disabled={!hasSearch}
            onChange={handleSearchChange}
            spellCheck='false'
            className={clsx(
              'input rounded-badge h-9 w-full pl-10 pr-4 sm:h-7',
              viewSettings?.isEink
                ? 'border-1 border-base-content focus:border-base-content'
                : 'bg-base-300/45 border-none',
              'font-sans text-sm font-light',
              'placeholder:text-base-content/50 truncate',
              'focus:outline-none focus:ring-0',
            )}
          />
          <div className='text-base-content/50 absolute right-2 flex items-center space-x-2 sm:space-x-4'>
            {searchQuery && (
              <button
                type='button'
                onClick={() => {
                  setSearchQuery('');
                  onGoStart();
                }}
                className='text-base-content/40 hover:text-base-content/60 pe-1'
                aria-label={_('Clear Search')}
              >
                <IoMdCloseCircle className='h-4 w-4' />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className='justify-end gap-2 px-1'>
        <WindowButtons
          className='window-buttons flex h-full items-center'
          onClose={() => {
            handleGoLibrary();
          }}
        />
      </div>
    </header>
  );
}
