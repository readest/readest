import clsx from 'clsx';
import { useLayoutEffect, useState } from 'react';
import { MdClose, MdPauseCircleFilled, MdPlayCircleFilled } from 'react-icons/md';
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
import { BsFastForwardFill, BsRewindFill } from 'react-icons/bs';
import { getTTSMiniPlayerBottomOffset } from '../../utils/ttsMiniPlayerPosition';

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
// progress line with buffer-ahead fill on the card's bottom edge, book info
// (tap to expand the full player sheet), sentence transport, and stop.
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
  const iconSize20 = useResponsiveSize(20);
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
              <BsRewindFill size={iconSize20} />
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
              <BsFastForwardFill size={iconSize20} />
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
      </div>
    </div>
  );
};

export default TTSMiniPlayer;
