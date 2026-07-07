import clsx from 'clsx';
import {
  MdClose,
  MdPauseCircleFilled,
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

// Reader text reserves this much bottom clearance while a session is active
// (card height + bottom gap); FoliateViewer consumes it via applyMarginAndGap.
export const TTS_MINI_PLAYER_CLEARANCE = 64;

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
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const playback = usePlaybackInfo({ bookKey, isEink, onGetPlaybackInfo });
  const timerLabel = useCountdownLabel(timeoutTimestamp);
  const iconSize20 = useResponsiveSize(20);
  const iconSize28 = useResponsiveSize(28);
  const iconSize40 = useResponsiveSize(40);

  const isVisible = hoveredBookKey !== bookKey;
  const book = getBookData(bookKey)?.book;
  const sectionLabel = progress?.sectionLabel;

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
        'absolute bottom-2 z-40 inset-x-2 sm:inset-x-0 sm:mx-auto sm:w-full sm:max-w-md',
        'transition-opacity duration-300',
        isVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{
        marginBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
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
      </div>
    </div>
  );
};

export default TTSMiniPlayer;
