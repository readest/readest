'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSearch } from 'react-icons/fa';
import { IoMdCloseCircle } from 'react-icons/io';
import { IoChevronBack, IoChevronForward, IoHome, IoFilter, IoAdd } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useSettingsStore } from '@/store/settingsStore';
import { debounce } from '@/utils/debounce';
import WindowButtons from '@/components/WindowButtons';
import { closeOPDSBrowser } from '../utils/opdsClose';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import { OPDSFeed } from '@/types/opds';
import { useDropdownContext } from '@/context/DropdownContext';

interface NavigationProps {
  searchTerm?: string;
  onBack?: () => void;
  onForward?: () => void;
  onGoStart: () => void;
  onSearch: (queryTerm: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  hasSearch: boolean;
  feed?: OPDSFeed;
  baseURL?: string;
  resolveURL?: (url: string, base: string) => string;
  onNavigate?: (url: string) => void;
  onAddCatalog?: () => void;
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
  feed,
  baseURL,
  resolveURL,
  onNavigate,
  onAddCatalog,
}: NavigationProps) {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const viewSettings = settings.globalViewSettings;

  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { isTrafficLightVisible } = useTrafficLight(headerRef);

  const dropdownContext = useDropdownContext();

  useEffect(() => {
    setSearchQuery(searchTerm || '');
  }, [searchTerm]);

  useEffect(() => {
    if (hasSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [hasSearch]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');

    const handleMediaChange = (e: MediaQueryListEvent) => e.matches && dropdownContext?.closeAll();

    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, [dropdownContext]);

  const handleGoLibrary = useCallback(() => {
    closeOPDSBrowser(router, searchParams);
  }, [router, searchParams]);

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

  const hasFacets = feed?.facets && feed.facets.length > 0;

  return (
    <header
      ref={headerRef}
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
              className='btn btn-ghost btn-sm px-1 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-40'
              onClick={onBack}
              disabled={!canGoBack}
              title={_('Back')}
            >
              <IoChevronBack className='h-6 w-6' />
            </button>
          )}
          {onForward && (
            <button
              className='btn btn-ghost btn-sm px-1 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-40'
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

      <div className='justify-end gap-2 px-1 flex items-center'>
        {hasFacets ? (
          <div className='lg:hidden flex items-center'>
            <Dropdown
              label={_('Options')}
              className='dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost btn-sm px-2 flex items-center justify-center'
              toggleButton={<IoFilter className='h-5 w-5 text-base-content/85' />}
            >
              <Menu className='dropdown-content no-triangle border-base-300 bg-base-100 z-20 mt-1 min-w-[14rem] max-h-[70vh] overflow-y-auto rounded-lg border shadow-lg'>
                {onAddCatalog && (
                  <MenuItem
                    label={_('Add to My Catalogs')}
                    Icon={IoAdd}
                    onClick={onAddCatalog}
                    transient
                  />
                )}

                <div
                  className={clsx(
                    'flex flex-col',
                    onAddCatalog && 'mt-1 pt-1 border-t border-base-200',
                  )}
                >
                  {feed!.facets!.map((facet, i) => (
                    <div key={i} className='mb-2 last:mb-0'>
                      {facet.metadata?.title && (
                        <div className='px-4 py-2 text-xs font-semibold opacity-50 uppercase tracking-wider'>
                          {facet.metadata.title}
                        </div>
                      )}
                      {facet.links.map((link, j) => {
                        const isActiveMapped = link.rel?.includes('self');
                        const href = resolveURL ? resolveURL(link.href || '', baseURL || '') : '';
                        const labelText = link.title || _('Untitled');
                        const countText = link.properties?.numberOfItems
                          ? ` (${link.properties.numberOfItems})`
                          : '';

                        return (
                          <MenuItem
                            key={j}
                            label={`${labelText}${countText}`}
                            toggled={isActiveMapped}
                            onClick={() => {
                              if (onNavigate && href) onNavigate(href);
                            }}
                            transient
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Menu>
            </Dropdown>
          </div>
        ) : (
          onAddCatalog && (
            <div className='flex items-center'>
              <button
                className='btn btn-ghost btn-sm px-2 flex items-center justify-center'
                title={_('Add to My Catalogs')}
                aria-label={_('Add to My Catalogs')}
                onClick={onAddCatalog}
              >
                <IoAdd className='h-5 w-5 text-base-content/85' />
              </button>
            </div>
          )
        )}

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
