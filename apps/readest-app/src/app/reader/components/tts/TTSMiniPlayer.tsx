import clsx from 'clsx';
import { useLayoutEffect, useState } from 'react';
import {
  MdAlarm,
  MdClose,
  MdKeyboardArrowLeft,
  MdKeyboardArrowRight,
  MdKeyboardDoubleArrowLeft,
  MdKeyboardDoubleArrowRight,
  MdOutlinePause,
  MdPauseCircleFilled,
  MdPlayArrow,
  MdPlayCircleFilled,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { formatPlaybackTime } from '@/utils/time';
import { TTSPlaybackInfo, usePlaybackInfo } from './usePlaybackInfo';
import { useCountdownLabel } from './useCountdownLabel';
import { formatRate } from './SpeedRuler';
import { getTTSMiniPlayerBottomOffset } from '../../utils/ttsMiniPlayerPosition';

// Playback-settings glyph: a hex nut whose top-right edge is left open so
// the current speed sits in the gap (podcast-player convention). The number
// juts past the icon box on purpose; the button reserves room for it.
const SpeedSettingsIcon = ({ size, label }: { size: number; label: string }) => (
  <span className='relative inline-flex shrink-0'>
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {/* Edges numbered clockwise from the top: the path starts two thirds
          into edge 2 (only its trailing third draws), runs through edges
          3-6, and stops at edge 1's midpoint (only its leading half draws).
          The opening between the two partial edges carries the speed label. */}
      <path d='M19.33 9.46 L20.8 12 L16.4 19.62 L7.6 19.62 L3.2 12 L7.6 4.38 L12 4.38' />
      <circle cx='12' cy='12' r='3.2' />
    </svg>
    <span className='absolute start-[56%] top-[5%] text-[9px] font-semibold leading-none tabular-nums'>
      {label}
    </span>
  </span>
);

type TTSMiniPlayerProps = {
  bookKey: string;
  isPlaying: boolean;
  isEink: boolean;
  hasTimeline: boolean;
  timeoutTimestamp: number;
  chapterRemainingSec: number | null;
  gridInsets: Insets;
  onTogglePlay: () => void;
  onBackward: (byMark: boolean) => void;
  onForward: (byMark: boolean) => void;
  onStop: () => void;
  onExpand: () => void;
  onGetPlaybackInfo: () => TTSPlaybackInfo | null;
};

// Persistent mini-player shown while a TTS session is active: passive
// progress line with buffer-ahead fill on the card's bottom edge and, per the
// ttsPlayerStyle setting, one of two card layouts. 'full' (the default) is
// the 0.11.18 card: book cover, book title, chapter + timestamps line, and a
// sentence-only transport with a filled play blob. 'minimal' is chrome-free —
// no cover, no titles, plain glyphs — with only the time info and the same
// paragraph/sentence transport vocabulary as the full player sheet (#5101 —
// the paragraph skips matter to eyes-off listeners).
const TTSMiniPlayer = ({
  bookKey,
  isPlaying,
  isEink,
  hasTimeline,
  timeoutTimestamp,
  chapterRemainingSec,
  gridInsets,
  onTogglePlay,
  onBackward,
  onForward,
  onStop,
  onExpand,
  onGetPlaybackInfo,
}: TTSMiniPlayerProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey, setHoveredBookKey, getViewSettings, bottomBarTab } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const playback = usePlaybackInfo({ bookKey, isEink, onGetPlaybackInfo });
  const timerLabel = useCountdownLabel(timeoutTimestamp);
  const iconSize14 = useResponsiveSize(14);
  const iconSize20 = useResponsiveSize(20);
  const iconSize26 = useResponsiveSize(26);
  const iconSize28 = useResponsiveSize(28);
  const iconSize40 = useResponsiveSize(40);

  const book = getBookData(bookKey)?.book;
  const sectionLabel = progress?.sectionLabel;

  // Stack above whatever occupies the bottom edge: the bottom bar (or its
  // expanded action panel) while it is shown, the footer info band once it is
  // dismissed, or a 16px resting offset. Mirrors FooterBar's mobile/desktop
  // layout split (see forceMobileLayout there) to pick the right bar height.
  const viewSettings = getViewSettings(bookKey);
  const barVisible = hoveredBookKey === bookKey;
  const safeAreaMargin = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
  const forceMobileLayout =
    !!appService?.isMobile && window.innerWidth >= 640 && window.innerWidth <= window.innerHeight;
  const usesMobileBar = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;

  // Distance from the bottom edge (safe-area margin excluded) to the top of
  // the expanded action panel, so the card rides above it. Measured from the
  // DOM because panel heights are content-driven and their anchor differs per
  // platform. The panels' paddings are constant and the slide is
  // transform-only, so subtracting the in-flight translate yields the settled
  // top edge even mid-animation.
  const [panelTopOffset, setPanelTopOffset] = useState(0);
  useLayoutEffect(() => {
    const cell = document.getElementById(`gridcell-${bookKey}`);
    const panel =
      barVisible && bottomBarTab ? cell?.querySelector(`.footerbar-${bottomBarTab}-mobile`) : null;
    const rect = panel?.getBoundingClientRect();
    if (!cell || !panel || !rect || rect.height === 0) {
      setPanelTopOffset(0);
      return;
    }
    const transform = getComputedStyle(panel).transform;
    const translateY = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
    const settledTop = rect.top - translateY;
    setPanelTopOffset(
      Math.max(0, Math.round(cell.getBoundingClientRect().bottom - settledTop - safeAreaMargin)),
    );
  }, [barVisible, bottomBarTab, bookKey, safeAreaMargin]);

  const bottomOffset = viewSettings
    ? getTTSMiniPlayerBottomOffset(viewSettings, { barVisible, usesMobileBar, panelTopOffset })
    : 16;
  const playerStyle = viewSettings?.ttsPlayerStyle ?? 'full';

  const { ready, position, total, measuredFraction } = playback;
  const forceHours = total >= 3600;
  const playedPct = ready && total > 0 ? Math.min((position / total) * 100, 100) : 0;
  const bufferedPct = ready ? Math.max(playedPct, Math.min(measuredFraction, 1) * 100) : 0;
  // The minimal style weights the two halves differently, so keep them split;
  // the full style joins them into the 0.11.18 "elapsed · -remaining" string.
  const elapsedLabel = hasTimeline && ready ? formatPlaybackTime(position, forceHours) : '';
  const remainingLabel =
    hasTimeline && ready ? `-${formatPlaybackTime(Math.max(total - position, 0), forceHours)}` : '';
  const timeLabel = elapsedLabel
    ? `${elapsedLabel} · ${remainingLabel}`
    : chapterRemainingSec !== null
      ? _('{{time}} left in chapter', { time: formatPlaybackTime(chapterRemainingSec) })
      : '';

  return (
    <div
      role='status'
      aria-label={`${_('Reading aloud')}: ${book?.title ?? ''}`}
      className={clsx(
        'absolute z-40 inset-x-4 sm:inset-x-0 sm:mx-auto sm:w-full sm:max-w-md',
        'pointer-events-auto transition-[bottom] duration-300',
      )}
      style={{
        bottom: `${bottomOffset}px`,
        marginBottom: `${safeAreaMargin}px`,
      }}
      onMouseEnter={() => !appService?.isMobile && setHoveredBookKey('')}
      onTouchStart={() => !appService?.isMobile && setHoveredBookKey('')}
    >
      <div className='not-eink:bg-base-300 eink-bordered relative overflow-hidden rounded-2xl shadow-lg'>
        {hasTimeline && (
          // E-ink has no legible grey tints: delineate the track with a crisp
          // 1px hairline, drop the buffer fill, and paint progress solid.
          <div
            aria-hidden='true'
            className={clsx(
              'audio-track not-eink:bg-neutral-content/15 absolute inset-x-0 bottom-0 h-[3px]',
              'eink:bg-base-100 eink:border-base-content eink:border-t eink:h-[5px]',
            )}
          >
            <div
              className='audio-buffered-part bg-base-content/35 eink:hidden absolute inset-y-0 left-0'
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className='audio-played-part not-eink:bg-primary eink:bg-base-content absolute inset-y-0 left-0'
              style={{ width: `${playedPct}%` }}
            />
          </div>
        )}
        {playerStyle === 'full' ? (
          <div className='text-base-content flex h-14 items-center gap-1 px-2'>
            <div
              role='button'
              tabIndex={0}
              onClick={onExpand}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onExpand();
              }}
              aria-label={_('Open Read Aloud player')}
              className='flex min-w-0 flex-1 cursor-pointer items-center gap-2'
            >
              {book?.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={book.coverImageUrl}
                  alt=''
                  className='h-10 w-10 shrink-0 rounded-lg object-cover'
                />
              ) : null}
              <div className='flex min-w-0 flex-col'>
                <span className='truncate text-sm'>{book?.title ?? ''}</span>
                {(sectionLabel || timeLabel) && (
                  <span className='text-base-content/70 truncate text-xs tabular-nums'>
                    {[sectionLabel, timeLabel].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </div>
            {timerLabel && (
              <span className='shrink-0 text-xs tabular-nums opacity-70'>{timerLabel}</span>
            )}
            <div dir='ltr' className='flex shrink-0 items-center gap-1'>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Previous Sentence')}
                onClick={() => onBackward(true)}
              >
                <MdSkipPrevious size={iconSize28} />
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-0.5'
                aria-label={isPlaying ? _('Pause') : _('Play')}
                onClick={onTogglePlay}
              >
                {isPlaying ? (
                  <MdPauseCircleFilled size={iconSize40} />
                ) : (
                  <MdPlayCircleFilled size={iconSize40} />
                )}
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Next Sentence')}
                onClick={() => onForward(true)}
              >
                <MdSkipNext size={iconSize28} />
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Stop reading aloud')}
                onClick={onStop}
              >
                <MdClose size={iconSize20} />
              </button>
            </div>
          </div>
        ) : (
          <div className='text-base-content flex h-14 items-center gap-2 pe-1 ps-1.5'>
            {/* Visible route into the full player: a settings glyph carrying
              the live speed as a superscript (the sheet is where speed and
              voice live). The time text expands too, but text alone reads
              as a label, not an affordance. */}
            <button
              type='button'
              aria-label={_('Playback settings')}
              onClick={onExpand}
              className='text-base-content/70 flex shrink-0 rounded-full p-1 pe-4'
            >
              <SpeedSettingsIcon
                size={iconSize26}
                label={formatRate(viewSettings?.ttsRate ?? 1.0)}
              />
            </button>
            <div
              role='button'
              tabIndex={0}
              onClick={onExpand}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onExpand();
              }}
              aria-label={_('Open Read Aloud player')}
              className='flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5'
            >
              {/* Centered in the flexible middle; elapsed carries the weight,
                  the remaining half stays dim. An armed sleep timer stacks on
                  its own line so it can never squeeze the time into
                  truncation. */}
              {elapsedLabel ? (
                <span className='flex min-w-0 items-baseline gap-1 text-sm tabular-nums'>
                  <span className='text-base-content truncate font-medium'>{elapsedLabel}</span>
                  <span className='text-base-content/60 shrink-0'>· {remainingLabel}</span>
                </span>
              ) : (
                timeLabel && (
                  <span className='text-base-content/60 truncate text-xs tabular-nums'>
                    {timeLabel}
                  </span>
                )
              )}
              {timerLabel && (
                <span className='text-base-content/60 flex shrink-0 items-center gap-0.5 text-xs tabular-nums'>
                  <MdAlarm size={iconSize14} aria-hidden='true' />
                  {timerLabel}
                </span>
              )}
            </div>
            <div dir='ltr' className='flex shrink-0 items-center'>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Previous Paragraph')}
                onClick={() => onBackward(false)}
              >
                <MdKeyboardDoubleArrowLeft size={iconSize26} />
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Previous Sentence')}
                onClick={() => onBackward(true)}
              >
                <MdKeyboardArrowLeft size={iconSize26} />
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={isPlaying ? _('Pause') : _('Play')}
                onClick={onTogglePlay}
              >
                {/* Same canvas size for both glyphs, or the row shifts on toggle. */}
                {isPlaying ? (
                  <MdOutlinePause size={iconSize26} />
                ) : (
                  <MdPlayArrow size={iconSize26} />
                )}
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Next Sentence')}
                onClick={() => onForward(true)}
              >
                <MdKeyboardArrowRight size={iconSize26} />
              </button>
              <button
                type='button'
                className='shrink-0 rounded-full p-1'
                aria-label={_('Next Paragraph')}
                onClick={() => onForward(false)}
              >
                <MdKeyboardDoubleArrowRight size={iconSize26} />
              </button>
              <button
                type='button'
                className='text-base-content/70 ms-0.5 shrink-0 rounded-full p-1'
                aria-label={_('Stop reading aloud')}
                onClick={onStop}
              >
                <MdClose size={iconSize20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TTSMiniPlayer;
