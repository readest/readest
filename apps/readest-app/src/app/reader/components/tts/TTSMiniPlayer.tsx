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
  MdPlayArrow,
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
      <path d='M19.33 10.66 L20.8 13.2 L16.4 20.82 L7.6 20.82 L3.2 13.2 L7.6 5.58 L12 5.58' />
      <circle cx='12' cy='13.2' r='3.2' />
    </svg>
    <span className='absolute start-[56%] top-[6%] text-[9px] font-semibold leading-none tabular-nums'>
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
// progress line with buffer-ahead fill on the card's bottom edge, chapter +
// time info (tap to expand the full player sheet), and the same
// paragraph/sentence transport vocabulary as the full player (#5101 — the
// paragraph skips matter to eyes-off listeners). Deliberately chrome-free:
// no cover, no book title, plain glyph buttons.
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
  const iconSize22 = useResponsiveSize(22);
  const iconSize28 = useResponsiveSize(28);

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

  const { ready, position, total, measuredFraction } = playback;
  const forceHours = total >= 3600;
  const playedPct = ready && total > 0 ? Math.min((position / total) * 100, 100) : 0;
  const bufferedPct = ready ? Math.max(playedPct, Math.min(measuredFraction, 1) * 100) : 0;
  const timeLabel =
    hasTimeline && ready
      ? `${formatPlaybackTime(position, forceHours)} · -${formatPlaybackTime(
          Math.max(total - position, 0),
          forceHours,
        )}`
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
        <div className='text-base-content flex h-14 items-center gap-2 pe-1 ps-1.5'>
          {/* Visible route into the full player: a settings glyph carrying
              the live speed as a superscript (the sheet is where speed and
              voice live). The chapter text expands too, but text alone
              reads as a label, not an affordance. */}
          <button
            type='button'
            aria-label={_('Playback settings')}
            onClick={onExpand}
            className='text-base-content/70 flex shrink-0 rounded-full p-1 pe-4'
          >
            <SpeedSettingsIcon size={iconSize22} label={formatRate(viewSettings?.ttsRate ?? 1.0)} />
          </button>
          <div
            role='button'
            tabIndex={0}
            onClick={onExpand}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onExpand();
            }}
            aria-label={_('Open Read Aloud player')}
            className='flex min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5'
          >
            <span className='truncate text-sm font-medium'>
              {sectionLabel || book?.title || ''}
            </span>
            {(timeLabel || timerLabel) && (
              <span className='text-base-content/60 flex items-center gap-1.5 text-xs tabular-nums'>
                {timeLabel && <span className='truncate'>{timeLabel}</span>}
                {timerLabel && (
                  <span className='flex shrink-0 items-center gap-0.5'>
                    <MdAlarm size={iconSize14} aria-hidden='true' />
                    {timerLabel}
                  </span>
                )}
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
              <MdKeyboardDoubleArrowLeft size={iconSize20} />
            </button>
            <button
              type='button'
              className='shrink-0 rounded-full p-1'
              aria-label={_('Previous Sentence')}
              onClick={() => onBackward(true)}
            >
              <MdKeyboardArrowLeft size={iconSize22} />
            </button>
            <button
              type='button'
              className='shrink-0 rounded-full p-1'
              aria-label={isPlaying ? _('Pause') : _('Play')}
              onClick={onTogglePlay}
            >
              {/* Same canvas size for both glyphs, or the row shifts on toggle. */}
              {isPlaying ? <MdOutlinePause size={iconSize28} /> : <MdPlayArrow size={iconSize28} />}
            </button>
            <button
              type='button'
              className='shrink-0 rounded-full p-1'
              aria-label={_('Next Sentence')}
              onClick={() => onForward(true)}
            >
              <MdKeyboardArrowRight size={iconSize22} />
            </button>
            <button
              type='button'
              className='shrink-0 rounded-full p-1'
              aria-label={_('Next Paragraph')}
              onClick={() => onForward(false)}
            >
              <MdKeyboardDoubleArrowRight size={iconSize20} />
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
      </div>
    </div>
  );
};

export default TTSMiniPlayer;
