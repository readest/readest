import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { FaHeadphones } from 'react-icons/fa6';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { MdPlayArrow, MdOutlinePause, MdReplay10, MdForward10 } from 'react-icons/md';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatProgress } from '@/utils/progress';
import { FooterBarChildProps } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  progressFraction,
  navigationHandlers,
  forceMobileLayout,
  onSpeakText,
  audiobookPlayer,
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
        'hidden h-11 w-full items-center gap-x-3 overflow-x-auto px-5 text-[#e0c189]',
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
          className='mx-1 min-w-[92px] text-nowrap text-center font-serif text-[11px] uppercase tracking-[0.18em] text-[#dfbb79]'
        >
          <span aria-hidden='true'>{progressInfo}</span>
        </span>
      )}
      <input
        ref={rangeInputRef}
        type='range'
        className='citadel-progress-range text-base-content mx-2 min-w-0 flex-1 accent-[#c49f59]'
        min={0}
        max={100}
        aria-label={_('Jump to Location')}
        value={progressValue}
        onChange={(e) => handleProgressChange(parseInt(e.target.value, 10))}
      />

      {/* Compact audiobook controls — only when an audiobook file is attached */}
      {audiobookPlayer && (
        <div className='flex shrink-0 items-center gap-x-1'>
          <span className='mx-1 h-4 w-px bg-[rgba(100,74,34,0.3)]' aria-hidden='true' />
          {audiobookPlayer.loadError ? (
            <span
              className='text-nowrap text-[10px] text-[#c47a5a]'
              title={audiobookPlayer.fileName || 'Audiobook'}
            >
              {_('Audio error')}
            </span>
          ) : (
            <>
              {/* TODO: when sync-map is available, page-turn handlers can seek audio to the mapped timestamp here */}
              <button
                onClick={audiobookPlayer.onSkipBack}
                disabled={!audiobookPlayer.isLoaded}
                title={_('Skip Back 10s')}
                aria-label={_('Skip Back 10s')}
                className='p-1.5'
              >
                <MdReplay10 />
              </button>
              <button
                onClick={audiobookPlayer.onTogglePlay}
                disabled={!audiobookPlayer.isLoaded}
                title={audiobookPlayer.isPlaying ? _('Pause') : _('Play')}
                aria-label={audiobookPlayer.isPlaying ? _('Pause') : _('Play')}
                className='p-1.5'
              >
                {audiobookPlayer.isPlaying ? <MdOutlinePause /> : <MdPlayArrow />}
              </button>
              <button
                onClick={audiobookPlayer.onSkipForward}
                disabled={!audiobookPlayer.isLoaded}
                title={_('Skip Forward 10s')}
                aria-label={_('Skip Forward 10s')}
                className='p-1.5'
              >
                <MdForward10 />
              </button>
              <input
                type='range'
                className='audiobook-inline-seek mx-1 w-[70px]'
                min={0}
                max={audiobookPlayer.duration > 0 ? audiobookPlayer.duration : 1}
                step={1}
                value={
                  Number.isFinite(audiobookPlayer.currentTime) ? audiobookPlayer.currentTime : 0
                }
                disabled={!audiobookPlayer.isLoaded}
                onChange={(e) => audiobookPlayer.onSeek(parseFloat(e.target.value))}
                title={audiobookPlayer.fileName || 'Audiobook'}
                aria-label={_('Audio Seek')}
              />
              <span
                className='text-nowrap font-mono text-[10px] tabular-nums text-[#b89a60]'
                title={audiobookPlayer.fileName}
              >
                {formatAudioTime(audiobookPlayer.currentTime)} /{' '}
                {formatAudioTime(audiobookPlayer.duration)}
              </span>
            </>
          )}
        </div>
      )}

      <Button
        icon={
          <FaHeadphones className={viewState?.ttsEnabled ? 'text-[#f0d6a0]' : 'text-[#d8bc85]'} />
        }
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
        /* Engraved button — pressed into the frame rather than floating above it */
        .footer-bar button {
          border-radius: 0.5rem;
          border: 1px solid rgba(100, 74, 34, 0.2);
          background: linear-gradient(180deg, rgba(14, 9, 7, 0.62), rgba(9, 6, 5, 0.54));
          color: #c6a467;
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.28),
            inset 0 1px 0 rgba(255, 232, 186, 0.03),
            inset 0 -1px 0 rgba(0, 0, 0, 0.32);
        }

        .footer-bar button:hover {
          border-color: rgba(145, 112, 54, 0.26);
          background: linear-gradient(180deg, rgba(32, 20, 13, 0.82), rgba(18, 12, 9, 0.76));
          color: #dcc088;
          box-shadow:
            inset 0 1px 3px rgba(0, 0, 0, 0.18),
            inset 0 1px 0 rgba(255, 220, 160, 0.06),
            0 0 0 1px rgba(120, 90, 40, 0.12);
        }

        .footer-bar button:focus-visible,
        .footer-bar input:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.9),
            0 0 0 3px rgba(120, 24, 18, 0.42);
        }

        .footer-bar .citadel-progress-range {
          height: 7px;
          margin-top: 1px;
          border-radius: 9999px;
          position: relative;
          z-index: 1;
        }

        /* Antique carved-channel track — dark groove with a faint brass-edge catch */
        .footer-bar .citadel-progress-range::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 9999px;
          background: linear-gradient(180deg, rgba(6, 4, 2, 0.95) 0%, rgba(16, 10, 6, 0.82) 100%);
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.62),
            inset 0 1px 0 rgba(0, 0, 0, 0.7),
            0 0 0 1px rgba(42, 28, 10, 0.48),
            0 1px 0 rgba(180, 140, 58, 0.1);
        }

        /* Worn-brass thumb — muted antiqued gold, clearly readable */
        .footer-bar .citadel-progress-range::-webkit-slider-thumb {
          margin-top: -5px;
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          border: 1px solid rgba(185, 148, 88, 0.55);
          background: linear-gradient(180deg, #c8a04a 0%, #7e5520 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 220, 140, 0.16),
            0 2px 5px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(38, 24, 10, 0.32);
          -webkit-appearance: none;
        }

        .footer-bar .citadel-progress-range::-moz-range-track {
          height: 6px;
          border-radius: 9999px;
          background: linear-gradient(180deg, rgba(6, 4, 2, 0.95) 0%, rgba(16, 10, 6, 0.82) 100%);
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.62),
            0 0 0 1px rgba(42, 28, 10, 0.48);
        }

        .footer-bar .citadel-progress-range::-moz-range-thumb {
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          border: 1px solid rgba(185, 148, 88, 0.55);
          background: linear-gradient(180deg, #c8a04a 0%, #7e5520 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 220, 140, 0.16),
            0 2px 5px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(38, 24, 10, 0.32);
        }

        /* Audiobook inline seek — same carved track, slightly narrower thumb */
        .footer-bar .audiobook-inline-seek {
          height: 6px;
          border-radius: 9999px;
          accent-color: #c49f59;
          cursor: pointer;
          position: relative;
          z-index: 1;
        }

        .footer-bar .audiobook-inline-seek::-webkit-slider-runnable-track {
          height: 5px;
          border-radius: 9999px;
          background: linear-gradient(180deg, rgba(6, 4, 2, 0.95) 0%, rgba(16, 10, 6, 0.82) 100%);
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.62),
            inset 0 1px 0 rgba(0, 0, 0, 0.7),
            0 0 0 1px rgba(42, 28, 10, 0.48),
            0 1px 0 rgba(180, 140, 58, 0.1);
        }

        .footer-bar .audiobook-inline-seek::-webkit-slider-thumb {
          margin-top: -4px;
          height: 12px;
          width: 12px;
          border-radius: 9999px;
          border: 1px solid rgba(185, 148, 88, 0.55);
          background: linear-gradient(180deg, #c8a04a 0%, #7e5520 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 220, 140, 0.16),
            0 2px 5px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(38, 24, 10, 0.32);
          -webkit-appearance: none;
        }

        .footer-bar .audiobook-inline-seek::-moz-range-track {
          height: 5px;
          border-radius: 9999px;
          background: linear-gradient(180deg, rgba(6, 4, 2, 0.95) 0%, rgba(16, 10, 6, 0.82) 100%);
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.62),
            0 0 0 1px rgba(42, 28, 10, 0.48);
        }

        .footer-bar .audiobook-inline-seek::-moz-range-thumb {
          height: 12px;
          width: 12px;
          border-radius: 9999px;
          border: 1px solid rgba(185, 148, 88, 0.55);
          background: linear-gradient(180deg, #c8a04a 0%, #7e5520 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 220, 140, 0.16),
            0 2px 5px rgba(0, 0, 0, 0.45),
            0 0 0 2px rgba(38, 24, 10, 0.32);
        }

        .footer-bar .audiobook-inline-seek:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .footer-bar svg {
          filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.3));
        }

        .footer-bar button[disabled] {
          border-color: rgba(126, 101, 58, 0.14);
          background: rgba(20, 14, 11, 0.14);
          color: rgba(190, 162, 109, 0.52);
          box-shadow: none;
        }
      `}</style>
    </div>
  );
};

export default DesktopFooterBar;
