import clsx from 'clsx';
import React from 'react';
import { IoIosList, IoMdCloseCircle } from 'react-icons/io';
import { HiArrowLongLeft, HiArrowLongRight } from 'react-icons/hi2';

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
  previousLabel,
  nextLabel,
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
  const iconSize18 = useResponsiveSize(18);
  const iconSize20 = useResponsiveSize(20);

  const showSection = appService?.isMobile || !viewSettings?.showHeader;

  return (
    <div
      className='results-nav-bar pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-between px-4 py-1'
      style={{
        top: gridInsets.top,
        right: gridInsets.right,
        bottom: gridInsets.bottom / 4,
        left: gridInsets.left,
      }}
    >
      {/* Top bar: Info */}
      <div className='bg-base-100 pointer-events-auto relative flex items-center justify-between overflow-hidden rounded-xl px-2 py-1 shadow-lg sm:gap-6'>
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

      {/* Bottom bar: Navigation buttons */}
      <div className='bg-base-200 pointer-events-auto flex items-center justify-between gap-6 rounded-xl px-4 py-0 shadow-lg'>
        <button
          title={previousTitle || _('Previous')}
          onClick={onPrevious}
          disabled={!hasPrevious}
          className={clsx(
            'btn btn-ghost flex h-auto min-h-0 flex-1 flex-col items-center gap-0 p-1 hover:bg-transparent',
            !hasPrevious && 'opacity-40 disabled:bg-transparent',
          )}
        >
          <HiArrowLongLeft size={iconSize18} className='text-base-content' />
          <span className='text-sm font-medium'>{previousLabel || _('Previous')}</span>
        </button>

        <button
          title={nextTitle || _('Next')}
          onClick={onNext}
          disabled={!hasNext}
          className={clsx(
            'btn btn-ghost flex h-auto min-h-0 flex-1 flex-col items-center gap-0 p-1 hover:bg-transparent',
            !hasNext && 'opacity-40 disabled:bg-transparent',
          )}
        >
          <HiArrowLongRight size={iconSize18} className='text-base-content' />
          <span className='text-sm font-medium'>{nextLabel || _('Next')}</span>
        </button>
      </div>
    </div>
  );
};

export default ContentNavBar;
