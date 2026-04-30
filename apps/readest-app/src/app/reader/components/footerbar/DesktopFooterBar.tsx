import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { FaHeadphones } from 'react-icons/fa6';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatProgress } from '@/utils/progress';
import { FooterBarChildProps } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  progressFraction,
  navigationHandlers,
  forceMobileLayout,
  onSpeakText,
}) => {
  const _ = useTranslation();
  const { hoveredBookKey, getView, getViewState, getProgress, getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const progressStyle = viewSettings?.progressStyle || 'percentage';

  const [progressValue, setProgressValue] = React.useState(
    progressValid ? progressFraction * 100 : 0,
  );

  const { section, pageinfo } = progress || {};
  const template = progressStyle === 'fraction' ? '{current} / {total}' : '{percent}%';
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const progressInfo = formatProgress(pageInfo?.current, pageInfo?.total, template, false, 'en', 0);

  const rangeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hoveredBookKey !== bookKey) {
      if (rangeInputRef.current && document.activeElement === rangeInputRef.current) {
        rangeInputRef.current.blur();
      }
    }
  }, [hoveredBookKey, bookKey]);

  useEffect(() => {
    if (progressValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressValue(progressFraction * 100);
    }
  }, [progressValid, progressFraction]);

  const handleProgressChange = useCallback(
    (value: number) => {
      setProgressValue(value);
      navigationHandlers.onProgressChange(value);
    },
    [navigationHandlers],
  );

  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  return (
    <div
      className={clsx(
        'hidden h-10 w-full items-center gap-x-3 overflow-x-auto px-5 text-[#efd5a0]',
        !forceMobileLayout && 'sm:flex',
      )}
      style={{
        bottom: isMobile ? `${gridInsets.bottom * 0.33}px` : '0px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowLeftDoubleLine />,
            <RiArrowRightDoubleLine />,
          )}
          onClick={navigationHandlers.onPrevSection}
          label={_('Previous Section')}
        />
      )}
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowLeftSLine />, <RiArrowRightSLine />)}
          onClick={navigationHandlers.onPrevPage}
          label={_('Previous Page')}
        />
      )}
      <Button
        icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoBackLine />, <RiArrowGoForwardLine />)}
        onClick={navigationHandlers.onGoBack}
        label={_('Go Back')}
        disabled={!view?.history.canGoBack}
      />
      <Button
        icon={getNavigationIcon(viewSettings?.rtl, <RiArrowGoForwardLine />, <RiArrowGoBackLine />)}
        onClick={navigationHandlers.onGoForward}
        label={_('Go Forward')}
        disabled={!view?.history.canGoForward}
      />
      {progressValid && (
        <span
          title={_('Reading Progress')}
          aria-label={`${_('Reading Progress')}: ${Math.round(progressFraction * 100)}%`}
          className='mx-1 min-w-[72px] text-nowrap text-center font-serif text-xs uppercase tracking-[0.14em] text-[#f2ddb0]'
        >
          <span aria-hidden='true'>{progressInfo}</span>
        </span>
      )}
      <input
        ref={rangeInputRef}
        type='range'
        className='citadel-progress-range text-base-content mx-2 min-w-0 flex-1 accent-[#b99a58]'
        min={0}
        max={100}
        aria-label={_('Jump to Location')}
        value={progressValue}
        onChange={(e) => handleProgressChange(parseInt(e.target.value, 10))}
      />
      <Button
        icon={<FaHeadphones className={viewState?.ttsEnabled ? 'text-blue-500' : ''} />}
        onClick={onSpeakText!}
        label={_('Speak')}
      />
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowRightSLine />, <RiArrowLeftSLine />)}
          onClick={navigationHandlers.onNextPage}
          label={_('Next Page')}
        />
      )}
      {!viewSettings?.showPaginationButtons && (
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowRightDoubleLine />,
            <RiArrowLeftDoubleLine />,
          )}
          onClick={navigationHandlers.onNextSection}
          label={_('Next Section')}
        />
      )}
      <style jsx global>{`
        .footer-bar button {
          border-radius: 0.5rem;
          border: 1px solid rgba(183, 145, 76, 0.48);
          background: rgba(35, 22, 18, 0.86);
          color: #f0d39a;
        }

        .footer-bar button:hover {
          background: rgba(56, 33, 28, 0.96);
        }

        .footer-bar button:focus-visible,
        .footer-bar input:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.9),
            0 0 0 3px rgba(120, 24, 18, 0.42);
        }

        .footer-bar .citadel-progress-range {
          height: 5px;
          margin-top: 1px;
        }

        .footer-bar .citadel-progress-range::-webkit-slider-runnable-track {
          height: 5px;
          border-radius: 9999px;
          background: linear-gradient(90deg, rgba(128, 95, 43, 0.88), rgba(92, 68, 34, 0.94));
          box-shadow:
            inset 0 0 0 1px rgba(217, 183, 109, 0.08),
            0 0 0 1px rgba(35, 24, 18, 0.35);
        }

        .footer-bar .citadel-progress-range::-webkit-slider-thumb {
          margin-top: -4px;
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          border: 1px solid rgba(243, 219, 164, 0.94);
          background: #e1c488;
          box-shadow:
            0 0 10px rgba(133, 31, 22, 0.18),
            0 0 0 2px rgba(83, 56, 24, 0.18);
          -webkit-appearance: none;
        }

        .footer-bar .citadel-progress-range::-moz-range-track {
          height: 5px;
          border-radius: 9999px;
          background: linear-gradient(90deg, rgba(128, 95, 43, 0.88), rgba(92, 68, 34, 0.94));
        }

        .footer-bar .citadel-progress-range::-moz-range-thumb {
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          border: 1px solid rgba(243, 219, 164, 0.94);
          background: #e1c488;
          box-shadow:
            0 0 10px rgba(133, 31, 22, 0.18),
            0 0 0 2px rgba(83, 56, 24, 0.18);
        }

        .footer-bar svg {
          filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.3));
        }
      `}</style>
    </div>
  );
};

export default DesktopFooterBar;
