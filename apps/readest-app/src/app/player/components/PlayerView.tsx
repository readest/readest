import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  MdAlarm,
  MdCheck,
  MdChevronRight,
  MdGraphicEq,
  MdMenuBook,
  MdOutlinePause,
  MdPlayArrow,
  MdPodcasts,
  MdSkipNext,
  MdSkipPrevious,
} from 'react-icons/md';
import { TbRewindBackward15, TbRewindForward30 } from 'react-icons/tb';
import { IoArrowBack } from 'react-icons/io5';

import type { Book } from '@/types/book';
import type { ABSChapter, ABSEpisode, ABSMediaProgress } from '@/types/audiobookshelf';
import type { AudiobookController } from '@/services/audiobook/AudiobookController';
import { loadAbsEpisodes } from '@/services/audiobook/openAudiobook';
import { ttsSessionManager, TTS_STOP_AT_CHAPTER_END } from '@/services/tts/TTSSessionManager';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { formatPlaybackTime } from '@/utils/time';
import TTSScrubber from '@/app/reader/components/tts/TTSScrubber';
import SpeedRuler, { formatRate } from '@/app/reader/components/tts/SpeedRuler';
import { getTTSTimeoutOptions } from '@/app/reader/components/tts/TTSPlayerSheet';
import { useCountdownLabel } from '@/app/reader/components/tts/useCountdownLabel';
import Dialog from '@/components/Dialog';
import Spinner from '@/components/Spinner';
import EpisodesView from './EpisodesView';

type PlayerSubView = 'main' | 'speed' | 'timer' | 'chapters' | 'episodes';

interface PlayerViewProps {
  book: Book;
  bookKey: string;
  controller: AudiobookController;
  onGoBack: () => void;
  onSelectEpisode: (episode: ABSEpisode) => void;
  /**
   * The episode just tapped (from this view's own embedded Episodes
   * subview), while its claim is still in flight up in page.tsx. Owned by
   * the parent, not this component - only the parent's handleSelectEpisode
   * knows whether a claim actually succeeded, failed, or threw, so only it
   * can correctly clear this on every outcome (see page.tsx). This
   * component only ever READS it, to know when to leave the Episodes
   * subview and to relay it to EpisodesView for the row's busy indicator.
   */
  pendingEpisodeId: string | null;
}

const PlayerView = ({
  book,
  bookKey,
  controller,
  onGoBack,
  onSelectEpisode,
  pendingEpisodeId,
}: PlayerViewProps) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const isEink = settings.globalViewSettings?.isEink ?? false;
  const iconSize18 = useResponsiveSize(18);
  const iconSize24 = useResponsiveSize(24);
  const iconSize28 = useResponsiveSize(28);
  const iconSize32 = useResponsiveSize(32);

  const [view, setView] = useState<PlayerSubView>('main');
  const [episodesData, setEpisodesData] = useState<{
    episodes: ABSEpisode[];
    progressByEpisodeId: Map<string, ABSMediaProgress>;
  } | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(controller.state === 'playing');
  const [currentChapter, setCurrentChapter] = useState<ABSChapter | null>(
    controller.getCurrentChapter(),
  );
  const [rate, setRate] = useState(controller.rate);
  // Episode switch replaces the whole controller instance (page.tsx swaps
  // in a freshly claimed one - see handleSelectEpisode), not just its
  // internal state, so the `useState` initializer above only ever runs
  // once and never re-reads the new controller's rate on its own. Without
  // this, the display would stay frozen on the OUTGOING controller's rate
  // until some other rate-changing interaction happened to call setRate.
  useEffect(() => {
    setRate(controller.rate);
  }, [controller]);
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
  // an error) should bounce the player back - except for a podcast episode,
  // whose end the player route itself handles by falling back to this
  // show's episode list (see page.tsx), not the library.
  useEffect(() => {
    const onSessionChanged = () => {
      if (ttsSessionManager.getSessionByHash(book.hash)) return;
      if (controller.getEpisodeId()) return;
      onGoBack();
    };
    ttsSessionManager.addEventListener('session-changed', onSessionChanged);
    return () => ttsSessionManager.removeEventListener('session-changed', onSessionChanged);
  }, [book.hash, controller, onGoBack]);

  // The embedded Episodes subview loads (and reloads, for fresh progress)
  // each time it's opened, mirroring how the main scrubber always reflects
  // the controller's current position rather than a cached snapshot. Resets
  // to null (Spinner) synchronously on every open rather than leaving the
  // previous open's snapshot on screen while the fresh fetch is in flight -
  // a re-open must never show stale progress as if it were current. The
  // `cancelled` flag is the standard guard against a stale fetch's result
  // landing after a newer open (or StrictMode's dev-only replay) superseded
  // it; unlike the mount effect in page.tsx, there is no "guard set before
  // the first await and never cleared" failure mode here to work around, so
  // the plain flag (not a promise cache) is enough.
  useEffect(() => {
    if (view !== 'episodes') return;
    let cancelled = false;
    setEpisodesData(null);
    (async () => {
      const activeAppService = appService ?? (await envConfig.getAppService());
      const result = await loadAbsEpisodes(activeAppService, book);
      if (!cancelled) setEpisodesData(result);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, book]);

  // Once the parent hands down a controller for the tapped episode (a fresh
  // claim landing, or the reuse path resolving instantly for an already-
  // playing episode), leave the Episodes subview for the transport view.
  // Keyed on the controller's OWN episodeId rather than firing eagerly from
  // the tap itself, so a still-in-flight claim for a DIFFERENT episode
  // leaves the subview showing its pending row instead of flashing the
  // previous episode's transport. Does NOT clear `pendingEpisodeId` itself
  // (that's the parent's job, via page.tsx's own matching effect - see its
  // comment) - this only reacts to it, the same prop a failed claim also
  // clears to reset the busy row without ever switching views.
  useEffect(() => {
    if (pendingEpisodeId && controller.getEpisodeId() === pendingEpisodeId) {
      setView('main');
    }
  }, [controller, pendingEpisodeId]);

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
  const episodeId = controller.getEpisodeId();
  // A podcast episode's title lives on the controller's source, not on
  // `book` (the show); falls back to the show for a plain audiobook.
  const headingTitle = episodeId ? controller.getTitle() : book.title;
  const headingSubtitle = episodeId ? book.title : book.author;
  const timeoutOptions = getTTSTimeoutOptions(_);
  const timerCaption =
    timeoutOption === TTS_STOP_AT_CHAPTER_END
      ? _('End of Chapter')
      : timeoutOption > 0 && timerLabel
        ? timerLabel
        : _('Sleep Timer');

  // The four pickers (speed / sleep timer / chapters / episodes) no longer
  // replace this view - they open in a Dialog sheet over it (snapHeight on
  // mobile presents it as a bottom action sheet with the standard drag bar;
  // desktop gets the Dialog's own default centered-modal presentation, same
  // as Settings and the reader's TTSPlayerSheet). The transport below stays
  // mounted the whole time, so dismissing the sheet (drag down / scrim tap /
  // back) just returns to it without any view-switch flicker.
  const pickerTitle =
    view === 'speed'
      ? _('Speed')
      : view === 'chapters'
        ? _('Chapters')
        : view === 'episodes'
          ? _('Episodes')
          : _('Set Timeout');

  const header = (
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
        <span className='line-clamp-1 text-sm font-semibold'>{headingTitle}</span>
        <span className='text-base-content/70 line-clamp-1 text-xs'>{headingSubtitle}</span>
      </div>
    </div>
  );

  return (
    <div className='bg-base-100 flex h-full w-full flex-col overflow-hidden'>
      {header}
      <div className='flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-6 pt-2'>
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
          <span className='line-clamp-2 text-lg font-semibold'>{headingTitle}</span>
          <span className='text-base-content/70 line-clamp-1 text-sm'>{headingSubtitle}</span>
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
            {isPlaying ? <MdOutlinePause size={iconSize32} /> : <MdPlayArrow size={iconSize32} />}
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
          {episodeId && (
            <button
              type='button'
              aria-label={_('Episodes')}
              onClick={() => setView('episodes')}
              className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
            >
              <MdPodcasts size={iconSize18} />
              <span className='text-base-content/60 max-w-full truncate px-1 text-xs'>
                {_('Episodes')}
              </span>
            </button>
          )}
        </div>
      </div>
      <Dialog
        id='player_picker_sheet'
        isOpen={view !== 'main'}
        onClose={() => setView('main')}
        snapHeight={0.6}
        title={pickerTitle}
      >
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
        {view === 'episodes' &&
          (episodesData ? (
            <EpisodesView
              episodes={episodesData.episodes}
              progressByEpisodeId={episodesData.progressByEpisodeId}
              activeEpisodeId={episodeId}
              pendingEpisodeId={pendingEpisodeId ?? undefined}
              // Sets pendingEpisodeId itself (page.tsx's handleSelectEpisode)
              // before the claim starts - this component only reacts to that
              // prop (see the pending-controller effect above), it never
              // sets it, so no local wrapper is needed here.
              onSelectEpisode={onSelectEpisode}
            />
          ) : (
            <Spinner loading />
          ))}
      </Dialog>
    </div>
  );
};

export default PlayerView;
