import clsx from 'clsx';
import React, { useCallback } from 'react';
import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { viewPagination } from '../hooks/usePagination';
import { useBookDataStore } from '@/store/bookDataStore';

interface PageNavigationButtonsProps {
  bookKey: string;
  isDropdownOpen: boolean;
}

const PageNavigationButtons: React.FC<PageNavigationButtonsProps> = ({
  bookKey,
  isDropdownOpen,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getProgress, getViewSettings, hoveredBookKey } = useReaderStore();
  const bookData = getBookData(bookKey);
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const progress = getProgress(bookKey);
  const { section, pageinfo } = progress || {};
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const currentPage = pageInfo?.current;

  const isPageNavigationButtonsVisible =
    (hoveredBookKey === bookKey || isDropdownOpen) && viewSettings?.showPaginationButtons;

  const handleGoLeftPage = useCallback(() => {
    viewPagination(view, viewSettings, 'left', 'page');
  }, [view, viewSettings]);

  const handleGoLeftSection = useCallback(() => {
    viewPagination(view, viewSettings, 'left', 'section');
  }, [view, viewSettings]);

  const handleGoRightPage = useCallback(() => {
    viewPagination(view, viewSettings, 'right', 'page');
  }, [view, viewSettings]);

  const handleGoRightSection = useCallback(() => {
    viewPagination(view, viewSettings, 'right', 'section');
  }, [view, viewSettings]);

  const getLeftPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Next Page') : _('Previous Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  const getLeftSectionLabel = () => {
    return viewSettings?.rtl ? _('Next Section') : _('Previous Section');
  };

  const getRightPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Previous Page') : _('Next Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  const getRightSectionLabel = () => {
    return viewSettings?.rtl ? _('Previous Section') : _('Next Section');
  };

  return (
    <>
      {currentPage !== undefined && (
        <div className='sr-only' role='status' aria-live='polite' aria-atomic='true'>
          {_('Page {{number}}', { number: currentPage + 1 })}
        </div>
      )}

      <div
        className={clsx(
          'absolute left-2 -translate-y-1/2',
          'flex items-center gap-1',
          'transition-opacity duration-300',
          isPageNavigationButtonsVisible
            ? 'top-1/2 z-10 opacity-100'
            : `${appService?.isAndroidApp ? 'bottom-2' : 'pointer-events-none bottom-12'} opacity-0`,
        )}
      >
        <button
          onClick={handleGoLeftSection}
          className='flex h-20 w-20 items-center justify-center focus:outline-none'
          aria-hidden={false}
          aria-label={getLeftSectionLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <RiArrowLeftDoubleLine size={24} />
          </span>
        </button>
        <button
          onClick={handleGoLeftPage}
          className='flex h-20 w-20 items-center justify-center focus:outline-none'
          aria-hidden={false}
          aria-label={getLeftPageLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <IoChevronBack size={24} />
          </span>
        </button>
      </div>

      <div
        className={clsx(
          'absolute right-2 -translate-y-1/2',
          'flex items-center gap-1',
          'transition-opacity duration-300',
          isPageNavigationButtonsVisible
            ? 'top-1/2 z-10 opacity-100'
            : `${appService?.isAndroidApp ? 'bottom-2' : 'pointer-events-none bottom-12'} opacity-0`,
        )}
      >
        <button
          onClick={handleGoRightPage}
          className='flex h-20 w-20 items-center justify-center focus:outline-none'
          aria-hidden={false}
          aria-label={getRightPageLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <IoChevronForward size={24} />
          </span>
        </button>
        <button
          onClick={handleGoRightSection}
          className='flex h-20 w-20 items-center justify-center focus:outline-none'
          aria-hidden={false}
          aria-label={getRightSectionLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <RiArrowRightDoubleLine size={24} />
          </span>
        </button>
      </div>
    </>
  );
};

export default PageNavigationButtons;
