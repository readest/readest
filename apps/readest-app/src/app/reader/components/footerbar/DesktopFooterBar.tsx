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
        'hidden h-8 w-full items-center gap-x-4 overflow-x-auto px-4',
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
          className='mx-2 text-nowrap text-center text-sm'
        >
          <span aria-hidden='true'>{progressInfo}</span>
        </span>
      )}
      <input
        ref={rangeInputRef}
        type='range'
        className='text-base-content mx-2 min-w-0 flex-1'
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
    </div>
  );
};

export default DesktopFooterBar;
