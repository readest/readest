import clsx from 'clsx';
import React from 'react';
import { IoIosList, IoMdCloseCircle } from 'react-icons/io';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';

import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useReaderStore } from '@/store/readerStore';

interface ContentNavBarProps {
  bookKey: string;
  gridInsets: Insets;
  title: string;
  section?: string;
  progress?: number; // 0 to 1, where 1 means complete
  showListButton?: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  previousLabel?: string;
  nextLabel?: string;
  previousTitle?: string;
  nextTitle?: string;
  showResultsTitle?: string;
  closeTitle?: string;
  onShowResults?: () => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const ContentNavBar: React.FC<ContentNavBarProps> = ({
  bookKey,
  gridInsets,
  title,
  section,
  progress,
  showListButton = true,
  hasPrevious,
  hasNext,
  previousTitle,
  nextTitle,
  showResultsTitle,
  closeTitle,
  onShowResults,
  onClose,
  onPrevious,
  onNext,
}) => {
  const { appService } = useEnv();
  const _ = useTranslation();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const iconSize16 = useResponsiveSize(16);
  const iconSize20 = useResponsiveSize(20);

  const showSection = appService?.isMobile || !viewSettings?.showHeader;

  return (
    <div
      className='results-nav-bar pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-end'
      style={{
        top: gridInsets.top,
        right: gridInsets.right,
        bottom: gridInsets.bottom / 4,
        left: gridInsets.left,
      }}
    >
      <div className='mx-auto flex items-center justify-center px-4'>
        {/* Bottom bar: Navigation buttons and Info */}
        <div className='pointer-events-auto flex h-[52px] max-w-3xl items-center gap-2'>
          {/* Previous button */}
          <button
            title={previousTitle || _('Previous')}
            onClick={onPrevious}
            disabled={!hasPrevious}
            className={clsx(
              'flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all disabled:opacity-40',
              'bg-base-200 hover:bg-base-300 hover:disabled:bg-base-200',
            )}
          >
            <MdChevronLeft
              size={iconSize20}
              className={clsx('text-base-content', !hasPrevious && 'opacity-40')}
            />
          </button>

          {/* Info bar */}
          <div className='bg-base-100 relative flex flex-1 items-center justify-between overflow-hidden rounded-xl px-2 py-1 shadow-lg sm:gap-6'>
            {progress !== undefined && progress < 1 && (
              <div
                className='bg-base-200 absolute inset-y-0 left-0 transition-all duration-300'
                style={{ width: `${progress * 100}%` }}
              />
            )}
            {progress === 1 && <div className='bg-base-200 absolute inset-0' />}
            {showListButton && onShowResults ? (
              <button
                title={showResultsTitle || _('Show Results')}
                onClick={onShowResults}
                className='btn btn-ghost relative z-10 h-8 min-h-8 w-8 p-0 hover:bg-transparent'
              >
                <IoIosList size={iconSize20} className='text-base-content' />
              </button>
            ) : (
              <div className='relative z-10 w-8' />
            )}

            <div className='relative z-10 flex flex-1 flex-col items-center px-2'>
              <span className='line-clamp-1 text-sm font-medium'>{title}</span>
              {section && showSection && (
                <span className='text-base-content/70 line-clamp-1 text-xs'>{section}</span>
              )}
            </div>

            <button
              title={closeTitle || _('Close')}
              onClick={onClose}
              className='btn btn-ghost relative z-10 h-8 min-h-8 w-8 p-0 hover:bg-transparent'
            >
              <IoMdCloseCircle size={iconSize16} />
            </button>
          </div>

          {/* Next button */}
          <button
            title={nextTitle || _('Next')}
            onClick={onNext}
            disabled={!hasNext}
            className={clsx(
              'flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all',
              'bg-base-200 hover:bg-base-300 hover:disabled:bg-base-200',
            )}
          >
            <MdChevronRight
              size={iconSize20}
              className={clsx('text-base-content', !hasNext && 'opacity-40')}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContentNavBar;
