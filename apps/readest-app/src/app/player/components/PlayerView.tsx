import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  MdAlarm,
  MdArrowBackIosNew,
  MdCheck,
  MdChevronRight,
  MdGraphicEq,
  MdMenuBook,
  MdOutlinePause,
  MdPlayArrow,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { TbRewindBackward15, TbRewindForward30 } from 'react-icons/tb';
import { IoArrowBack } from 'react-icons/io5';

import type { Book } from '@/types/book';
import type { ABSChapter } from '@/types/audiobookshelf';
import type { AudiobookController } from '@/services/audiobook/AudiobookController';
import { ttsSessionManager, TTS_STOP_AT_CHAPTER_END } from '@/services/tts/TTSSessionManager';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { formatPlaybackTime } from '@/utils/time';
import TTSScrubber from '@/app/reader/components/tts/TTSScrubber';
import SpeedRuler, { formatRate } from '@/app/reader/components/tts/SpeedRuler';
import { getTTSTimeoutOptions } from '@/app/reader/components/tts/TTSPlayerSheet';
import { useCountdownLabel } from '@/app/reader/components/tts/useCountdownLabel';

type PlayerSubView = 'main' | 'speed' | 'timer' | 'chapters';

interface PlayerViewProps {
  book: Book;
  bookKey: string;
  controller: AudiobookController;
  onGoBack: () => void;
}

const PlayerView = ({ book, bookKey, controller, onGoBack }: PlayerViewProps) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const isEink = settings.globalViewSettings?.isEink ?? false;
  const iconSize18 = useResponsiveSize(18);
  const iconSize24 = useResponsiveSize(24);
  const iconSize28 = useResponsiveSize(28);
  const iconSize32 = useResponsiveSize(32);

  const [view, setView] = useState<PlayerSubView>('main');
  const [coverFailed, setCoverFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(controller.state === 'playing');
  const [currentChapter, setCurrentChapter] = useState<ABSChapter | null>(
    controller.getCurrentChapter(),
  );
  const [rate, setRate] = useState(controller.rate);
  const [timeoutOption, setTimeoutOption] = useState(() =>
    ttsSessionManager.getStopAtChapterEnd()
      ? TTS_STOP_AT_CHAPTER_END
      : (ttsSessionManager.getSleepTimer()?.timeoutSec ?? 0),
  );
  const [timeoutTimestamp, setTimeoutTimestamp] = useState(
    () => ttsSessionManager.getSleepTimer()?.firesAt ?? 0,
  );
  const timerLabel = useCountdownLabel(timeoutTimestamp);

  // Playback state: the controller is the single source of truth, and
  // 'tts-state-change' is the same event the lock screen / NowPlayingBar
  // relay off of.
  useEffect(() => {
    const update = () => setIsPlaying(controller.state === 'playing');
    update();
    controller.addEventListener('tts-state-change', update);
    return () => controller.removeEventListener('tts-state-change', update);
  }, [controller]);

  // Chapter line: 'tts-speak-mark' fires on every chapter boundary, seek,
  // and start, plus a ~15s tick while playing - good enough freshness for a
  // label, no need for a dedicated poll.
  //
  // The same event relays as the reader's 'tts-position' bus so the
  // scrubber's e-ink path stays live: usePlaybackInfo refreshes on a 1s
  // interval normally, but under isEink it deliberately skips that (no
  // frequent repaints on slow e-ink hardware) and instead refreshes ONLY on
  // a matching 'tts-position' event - a bus only useTTSControl's reader hook
  // otherwise emits. AudiobookController never emits it, so without this
  // relay the audiobook scrubber would paint once on mount and then freeze
  // under e-ink for the rest of the session. Reusing 'tts-speak-mark's
  // existing cadence (start/seek/chapter-change/~15s tick) keeps the same
  // coarse, e-ink-appropriate refresh rate rather than adding a 1s poll.
  useEffect(() => {
    const update = () => {
      setCurrentChapter(controller.getCurrentChapter());
      eventDispatcher.dispatch('tts-position', { bookKey, kind: 'sentence' });
    };
    update();
    controller.addEventListener('tts-speak-mark', update);
    return () => controller.removeEventListener('tts-speak-mark', update);
  }, [controller, bookKey]);

  // Leaving this route does NOT stop playback (the session survives
  // headless, same as closing the reader on a TTS session). Only a session
  // that ended elsewhere (sleep timer, NowPlayingBar's stop, natural end,
  // an error) should bounce the player back.
  useEffect(() => {
    const onSessionChanged = () => {
      if (!ttsSessionManager.getSessionByHash(book.hash)) onGoBack();
    };
    ttsSessionManager.addEventListener('session-changed', onSessionChanged);
    return () => ttsSessionManager.removeEventListener('session-changed', onSessionChanged);
  }, [book.hash, onGoBack]);

  const handleTogglePlay = () => {
    void (isPlaying ? controller.pause() : controller.start());
  };

  const handleSeek = async (seconds: number) => {
    await controller.seekToTime(seconds);
  };

  const handleSelectRate = (value: number) => {
    setRate(value);
    void controller.setRate(value);
  };

  const handleSelectTimeout = (value: number) => {
    setTimeoutOption(value);
    if (value === TTS_STOP_AT_CHAPTER_END) {
      ttsSessionManager.setStopAtChapterEnd(true);
      setTimeoutTimestamp(0);
    } else {
      ttsSessionManager.setStopAtChapterEnd(false);
      ttsSessionManager.setSleepTimer(value);
      setTimeoutTimestamp(value > 0 ? Date.now() + value * 1000 : 0);
    }
    setView('main');
  };

  const handleSelectChapter = (index: number) => {
    void controller.seekToChapter(index);
    setView('main');
  };

  const chapters = controller.getChapters();
  const timeoutOptions = getTTSTimeoutOptions(_);
  const timerCaption =
    timeoutOption === TTS_STOP_AT_CHAPTER_END
      ? _('End of Chapter')
      : timeoutOption > 0 && timerLabel
        ? timerLabel
        : _('Sleep Timer');

  const header =
    view === 'main' ? (
      <div className='relative flex h-12 w-full items-center px-2'>
        <button
          type='button'
          aria-label={_('Go Back')}
          onClick={onGoBack}
          className='btn btn-ghost btn-circle z-10 flex h-9 min-h-9 w-9'
        >
          <IoArrowBack size={iconSize24 * 0.85} className='rtl:rotate-180' />
        </button>
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-16 text-center'>
          <span className='line-clamp-1 text-sm font-semibold'>{book.title}</span>
          <span className='text-base-content/70 line-clamp-1 text-xs'>{book.author}</span>
        </div>
      </div>
    ) : (
      <div className='relative flex h-12 w-full items-center px-2'>
        <button
          type='button'
          aria-label={_('Go Back')}
          onClick={() => setView('main')}
          className='btn btn-ghost btn-circle z-10 flex h-9 min-h-9 w-9'
        >
          <MdArrowBackIosNew size={iconSize24 * 0.8} className='rtl:rotate-180' />
        </button>
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <span className='line-clamp-1 text-center font-semibold'>
            {view === 'speed' ? _('Speed') : view === 'chapters' ? _('Chapters') : _('Set Timeout')}
          </span>
        </div>
      </div>
    );

  return (
    <div className='bg-base-100 flex h-full w-full flex-col overflow-hidden'>
      {header}
      <div className='flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-6 pt-2'>
        {view === 'main' && (
          <>
            {book.coverImageUrl && !coverFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={book.coverImageUrl}
                alt=''
                className='not-eink:shadow-lg eink-bordered mt-4 h-56 w-56 rounded-2xl object-cover'
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <div className='eink-bordered bg-base-200 text-base-content/40 mt-4 flex h-56 w-56 items-center justify-center rounded-2xl'>
                <MdMenuBook size={iconSize32 * 1.5} />
              </div>
            )}
            <div className='flex w-full flex-col items-center gap-0.5 text-center'>
              <span className='line-clamp-2 text-lg font-semibold'>{book.title}</span>
              <span className='text-base-content/70 line-clamp-1 text-sm'>{book.author}</span>
              {currentChapter && (
                <span className='text-base-content/60 line-clamp-1 text-sm'>
                  {currentChapter.title}
                </span>
              )}
            </div>
            <div className='w-full max-w-md'>
              <TTSScrubber
                bookKey={bookKey}
                isEink={isEink}
                onSeek={handleSeek}
                onGetPlaybackInfo={() => controller.getPlaybackInfo()}
              />
            </div>
            <div dir='ltr' className='flex items-center justify-center gap-2'>
              <button
                type='button'
                className='rounded-full p-2'
                title={_('Previous Chapter')}
                aria-label={_('Previous Chapter')}
                onClick={() => void controller.backward()}
              >
                <MdSkipPrevious size={iconSize28} />
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={_('Back 15 Seconds')}
                aria-label={_('Back 15 Seconds')}
                onClick={() => void controller.backward(true)}
              >
                <TbRewindBackward15 size={iconSize24} />
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-circle mx-2 h-16 min-h-16 w-16'
                aria-label={isPlaying ? _('Pause') : _('Play')}
                onClick={handleTogglePlay}
              >
                {isPlaying ? (
                  <MdOutlinePause size={iconSize32} />
                ) : (
                  <MdPlayArrow size={iconSize32} />
                )}
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={_('Forward 30 Seconds')}
                aria-label={_('Forward 30 Seconds')}
                onClick={() => void controller.forward(true)}
              >
                <TbRewindForward30 size={iconSize24} />
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={_('Next Chapter')}
                aria-label={_('Next Chapter')}
                onClick={() => void controller.forward()}
              >
                <MdSkipNext size={iconSize28} />
              </button>
            </div>
            <div className='flex w-full max-w-md gap-2'>
              <button
                type='button'
                aria-label={_('Speed')}
                onClick={() => setView('speed')}
                className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
              >
                <span className='text-sm font-semibold tabular-nums'>{formatRate(rate)}</span>
                <span className='text-base-content/60 max-w-full truncate px-1 text-xs'>
                  {_('Speed')}
                </span>
              </button>
              <button
                type='button'
                aria-label={_('Sleep Timer')}
                onClick={() => setView('timer')}
                className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
              >
                <MdAlarm size={iconSize18} />
                <span className='text-base-content/60 max-w-full truncate px-1 text-xs tabular-nums'>
                  {timerCaption}
                </span>
              </button>
              {chapters.length > 0 && (
                <button
                  type='button'
                  aria-label={_('Chapters')}
                  onClick={() => setView('chapters')}
                  className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
                >
                  <MdChevronRight size={iconSize18} />
                  <span className='text-base-content/60 max-w-full truncate px-1 text-xs'>
                    {_('Chapters')}
                  </span>
                </button>
              )}
            </div>
          </>
        )}
        {view === 'speed' && (
          <div className='flex w-full max-w-md flex-col items-center pt-4'>
            <SpeedRuler rate={rate} onSelect={handleSelectRate} />
          </div>
        )}
        {view === 'timer' && (
          <div className='flex w-full max-w-md flex-col'>
            {timeoutOptions.map((option) => (
              <button
                key={option.value}
                type='button'
                onClick={() => handleSelectTimeout(option.value)}
                className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start'
              >
                <span className='flex h-6 w-6 items-center justify-center'>
                  {timeoutOption === option.value && <MdCheck className='text-base-content' />}
                </span>
                <span className='text-sm'>{option.label}</span>
              </button>
            ))}
          </div>
        )}
        {view === 'chapters' && (
          <div className='flex w-full max-w-md flex-col'>
            {chapters.map((chapter, index) => {
              const isActive = chapter === currentChapter;
              return (
                <button
                  key={chapter.id}
                  type='button'
                  onClick={() => handleSelectChapter(index)}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start',
                    isActive && 'eink-bordered not-eink:bg-base-200',
                  )}
                >
                  {isActive && (
                    <MdGraphicEq
                      className='text-base-content shrink-0'
                      aria-label={_('Now playing')}
                    />
                  )}
                  <span
                    className={clsx(
                      'line-clamp-1 min-w-0 flex-1 text-sm',
                      isActive && 'font-semibold',
                    )}
                  >
                    {chapter.title}
                  </span>
                  <span className='text-base-content/60 shrink-0 text-xs tabular-nums'>
                    {formatPlaybackTime(chapter.start)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerView;
