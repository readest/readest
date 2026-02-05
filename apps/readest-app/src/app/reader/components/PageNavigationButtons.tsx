import clsx from 'clsx';
import React, { useCallback } from 'react';
import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
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

  const handleGoRightPage = useCallback(() => {
    viewPagination(view, viewSettings, 'right', 'page');
  }, [view, viewSettings]);

  const getLeftPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Next Page') : _('Previous Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  const getRightPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Previous Page') : _('Next Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  return (
    <>
      {currentPage !== undefined && (
        <div className='sr-only' role='status' aria-live='polite' aria-atomic='true'>
          {_('Page {{number}}', { number: currentPage + 1 })}
        </div>
      )}

      <button
        onClick={handleGoLeftPage}
        className={clsx(
          'absolute left-2 top-1/2 z-10 -translate-y-1/2',
          'flex h-20 w-20 items-center justify-center',
          'transition-opacity duration-300',
          'focus:opacity-100 focus:outline-none',
          isPageNavigationButtonsVisible ? 'opacity-100' : 'opacity-0',
        )}
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

      <button
        onClick={handleGoRightPage}
        className={clsx(
          'absolute right-2 top-1/2 z-10 -translate-y-1/2',
          'flex h-20 w-20 items-center justify-center',
          'transition-opacity duration-300',
          'focus:opacity-100 focus:outline-none',
          isPageNavigationButtonsVisible ? 'opacity-100' : 'opacity-0',
        )}
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
    </>
  );
};

export default PageNavigationButtons;
