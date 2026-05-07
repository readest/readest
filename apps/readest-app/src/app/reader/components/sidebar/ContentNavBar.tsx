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
      className='results-nav-bar pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-end'
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
              'citadel-nav-button flex h-10 w-10 items-center justify-center rounded-full transition-all disabled:opacity-40',
            )}
          >
            <MdChevronLeft size={iconSize20} className={clsx(!hasPrevious && 'opacity-40')} />
          </button>

          {/* Info bar */}
          <div className='citadel-nav-info relative flex flex-1 items-center justify-between overflow-hidden rounded-xl px-2 py-1 sm:gap-6'>
            {progress !== undefined && progress < 1 && (
              <div
                className='citadel-nav-progress absolute inset-y-0 left-0 transition-all duration-300'
                style={{ width: `${progress * 100}%` }}
              />
            )}
            {progress === 1 && <div className='citadel-nav-progress absolute inset-0' />}
            {showListButton && onShowResults ? (
              <button
                title={showResultsTitle || _('Show Results')}
                onClick={onShowResults}
                className='citadel-nav-icon-btn relative z-10 flex h-8 min-h-8 w-8 items-center justify-center rounded-full p-0'
              >
                <IoIosList size={iconSize20} />
              </button>
            ) : (
              <div className='relative z-10 w-8' />
            )}

            <div className='relative z-10 flex flex-1 flex-col items-center px-2'>
              <span className='citadel-nav-title line-clamp-1 text-sm font-medium'>{title}</span>
              {section && showSection && (
                <span className='citadel-nav-section line-clamp-1 text-xs'>{section}</span>
              )}
            </div>

            <button
              title={closeTitle || _('Close')}
              onClick={onClose}
              className='citadel-nav-icon-btn relative z-10 flex h-8 min-h-8 w-8 items-center justify-center rounded-full p-0'
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
              'citadel-nav-button flex h-10 w-10 items-center justify-center rounded-full transition-all disabled:opacity-40',
            )}
          >
            <MdChevronRight size={iconSize20} className={clsx(!hasNext && 'opacity-40')} />
          </button>
        </div>
      </div>
      <style jsx>{`
        .citadel-nav-button {
          color: rgba(220, 184, 116, 0.92);
          background: linear-gradient(180deg, rgba(28, 18, 15, 0.96), rgba(14, 10, 9, 0.98));
          border: 1px solid rgba(168, 124, 64, 0.42);
          box-shadow:
            0 8px 18px rgba(0, 0, 0, 0.46),
            0 0 14px rgba(126, 31, 25, 0.16),
            inset 0 1px 0 rgba(255, 237, 193, 0.06),
            inset 0 -1px 0 rgba(0, 0, 0, 0.32);
        }
        .citadel-nav-button:hover:not(:disabled) {
          color: rgba(243, 215, 140, 0.98);
          border-color: rgba(201, 164, 90, 0.7);
          background: linear-gradient(180deg, rgba(46, 22, 18, 0.96), rgba(20, 12, 10, 0.98));
          box-shadow:
            0 10px 22px rgba(0, 0, 0, 0.5),
            0 0 18px rgba(168, 48, 16, 0.22),
            inset 0 1px 0 rgba(255, 237, 193, 0.08);
        }
        .citadel-nav-button:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.85),
            0 0 0 3px rgba(120, 24, 18, 0.4);
        }
        .citadel-nav-info {
          color: rgba(220, 184, 116, 0.94);
          background:
            radial-gradient(circle at 12% 50%, rgba(118, 30, 18, 0.18), transparent 36%),
            linear-gradient(180deg, rgba(22, 14, 12, 0.97), rgba(11, 8, 7, 0.99));
          border: 1px solid rgba(168, 124, 64, 0.42);
          box-shadow:
            0 12px 28px rgba(0, 0, 0, 0.5),
            0 0 22px rgba(126, 31, 25, 0.18),
            inset 0 1px 0 rgba(255, 237, 193, 0.06),
            inset 0 -1px 0 rgba(0, 0, 0, 0.34);
        }
        .citadel-nav-progress {
          background: linear-gradient(
            90deg,
            rgba(118, 30, 18, 0.42) 0%,
            rgba(168, 48, 18, 0.32) 60%,
            rgba(196, 158, 84, 0.18) 100%
          );
          box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.34);
        }
        .citadel-nav-icon-btn {
          color: rgba(196, 158, 90, 0.86);
          background: transparent;
          border: 0;
          transition:
            color 150ms ease,
            background-color 150ms ease;
        }
        .citadel-nav-icon-btn:hover {
          color: rgba(243, 215, 140, 0.98);
          background: rgba(46, 22, 18, 0.62);
        }
        .citadel-nav-icon-btn:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.85),
            0 0 0 3px rgba(120, 24, 18, 0.4);
        }
        .citadel-nav-title {
          color: rgba(243, 215, 140, 0.96);
          font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
          letter-spacing: 0.04em;
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
        }
        .citadel-nav-section {
          color: rgba(196, 158, 90, 0.74);
          font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
};

export default ContentNavBar;
