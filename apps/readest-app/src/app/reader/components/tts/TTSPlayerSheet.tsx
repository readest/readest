import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import {
  MdAlarm,
  MdArrowBackIosNew,
  MdCheck,
  MdKeyboardArrowLeft,
  MdKeyboardArrowRight,
  MdKeyboardDoubleArrowLeft,
  MdKeyboardDoubleArrowRight,
  MdOutlinePause,
  MdPlayArrow,
  MdOutlineFileDownload,
  MdChevronRight,
  MdExpandMore,
  MdSkipNext,
  MdSkipPrevious,
  MdTextDecrease,
  MdTextIncrease,
} from 'react-icons/md';
import { RiForward30Line, RiReplay15Line, RiVoiceAiFill } from 'react-icons/ri';
import { TbArrowBarToRight } from 'react-icons/tb';
import { useAppRouter } from '@/hooks/useAppRouter';
import { TTSVoicesGroup } from '@/services/tts';
import { MEDIA_OVERLAY_VOICE_ID } from '@/services/tts/mediaOverlay';
import type { TTSLoopState } from '@/services/tts/TTSController';
import { saveViewSettings } from '@/helpers/settings';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { isTTSCacheAllowed } from '@/utils/access';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { getLanguageName } from '@/utils/lang';
import { formatPlaybackTime } from '@/utils/time';
import Dialog from '@/components/Dialog';
import { PageInfo } from '@/types/book';
import { TTSPlaybackInfo } from './usePlaybackInfo';
import { useCountdownLabel } from './useCountdownLabel';
import TTSScrubber from './TTSScrubber';
import TTSLyricsView from './TTSLyricsView';
import BufferingRing from './BufferingRing';
import { TTSLyrics, useTTSLyrics } from './useTTSLyrics';
import { usePlayerResize } from './usePlayerResize';
import SpeedRuler, { formatRate } from './SpeedRuler';
import TTSChaptersView from './TTSChaptersView';
import { TTS_STOP_AT_CHAPTER_END } from '@/services/tts/TTSSessionManager';
import type { UseTTSDownloadsResult } from '@/app/reader/hooks/useTTSDownloads';

type SheetView = 'main' | 'speed' | 'voice' | 'timer' | 'chapters';

// Exported so the audiobook player route (src/app/player/components/PlayerView.tsx)
// can reuse the same sleep-timer preset list instead of duplicating it.
export const getTTSTimeoutOptions = (_: TranslationFunc) => {
  return [
    { label: _('No Timeout'), value: 0 },
    { label: _('End of Chapter'), value: TTS_STOP_AT_CHAPTER_END },
    { label: _('{{value}} minute', { value: 1 }), value: 60 },
    { label: _('{{value}} minutes', { value: 3 }), value: 180 },
    { label: _('{{value}} minutes', { value: 5 }), value: 300 },
    { label: _('{{value}} minutes', { value: 10 }), value: 600 },
    { label: _('{{value}} minutes', { value: 20 }), value: 1200 },
    { label: _('{{value}} minutes', { value: 30 }), value: 1800 },
    { label: _('{{value}} minutes', { value: 45 }), value: 2700 },
    { label: _('{{value}} hour', { value: 1 }), value: 3600 },
    { label: _('{{value}} hours', { value: 2 }), value: 7200 },
    { label: _('{{value}} hours', { value: 3 }), value: 10800 },
    { label: _('{{value}} hours', { value: 4 }), value: 14400 },
    { label: _('{{value}} hours', { value: 6 }), value: 21600 },
    { label: _('{{value}} hours', { value: 8 }), value: 28800 },
  ];
};

type TTSPlayerSheetProps = {
  bookKey: string;
  isOpen: boolean;
  ttsLang: string;
  isPlaying: boolean;
  hasTimeline: boolean;
  // Paired audiobook: the transport skips 30s forward / 15s back through the
  // recording and moves by audiobook chapter instead of by sentence and
  // paragraph.
  audioTransport: boolean;
  timeoutOption: number;
  timeoutTimestamp: number;
  chapterRemainingSec: number | null;
  onClose: () => void;
  onTogglePlay: () => void;
  onBackward: (byMark: boolean) => void;
  onForward: (byMark: boolean) => void;
  loopState: TTSLoopState;
  onToggleLoop: () => void;
  onGetLyricLoopRange: () => { start: number; end: number } | null;
  onSetRate: (rate: number) => void;
  // The TTS clients finished initializing: until then there are no voices.
  clientsReady: boolean;
  onGetVoices: (lang: string) => Promise<TTSVoicesGroup[]>;
  onSetVoice: (voice: string, lang: string) => void;
  onGetVoiceId: () => string;
  onSelectTimeout: (bookKey: string, value: number) => void;
  onSeek: (seconds: number) => Promise<void>;
  onSeekPreview: (seconds: number) => void;
  onGetPlaybackInfo: () => TTSPlaybackInfo | null;
  // Lyric view (#5755). Present only when the engine aligns audio to the text;
  // supportsLyrics false keeps the cover player.
  supportsLyrics: boolean;
  // Playing, but nothing audible yet — the transport button wears a ring.
  buffering: boolean;
  onGetLyrics: () => Promise<TTSLyrics | null>;
  onGetActiveIndex: () => number;
  onGetLyricPage: (index: number) => Promise<PageInfo | null>;
  onPlayFromLyric: (index: number) => Promise<void>;
  downloads: UseTTSDownloadsResult;
  activeSectionIndex: number | null;
};

// Lyric line sizes (px) the A−/A+ buttons step through; 14 is the old text-sm.
const LYRIC_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 38];
const DEFAULT_LYRIC_FONT_SIZE = 14;
const LYRIC_FONT_SIZE_KEY = 'ttsLyricsFontSize';

// Full player sheet: cover, chapter, scrubber, transport, and one compact
// row of speed / voice / sleep-timer buttons that drill into in-sheet
// sub-views (dropdowns clip inside the dialog's scroll container).
const TTSPlayerSheet = ({
  bookKey,
  isOpen,
  ttsLang,
  isPlaying,
  hasTimeline,
  audioTransport,
  timeoutOption,
  timeoutTimestamp,
  chapterRemainingSec,
  onClose,
  onTogglePlay,
  onBackward,
  onForward,
  loopState,
  onToggleLoop,
  onGetLyricLoopRange,
  onSetRate,
  clientsReady,
  onGetVoices,
  onSetVoice,
  onGetVoiceId,
  onSelectTimeout,
  onSeek,
  onSeekPreview,
  onGetPlaybackInfo,
  supportsLyrics,
  buffering,
  onGetLyrics,
  onGetActiveIndex,
  onGetLyricPage,
  onPlayFromLyric,
  downloads,
  activeSectionIndex,
}: TTSPlayerSheetProps) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);

  // Offline audio (pre-downloading Read Aloud audio per chapter) is a premium
  // feature: any paid plan can use it; free / signed-out users see the row with
  // a Premium badge that routes to the upgrade page instead of the per-chapter
  // download controls. Mirrors the cloud-sync paywall in IntegrationsPanel.
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const isDownloadPremium = isTTSCacheAllowed(userProfilePlan ?? 'free', customizationPurchased);
  // Only badge users who can't use it yet: signed out (known at once), or a
  // resolved plan without the feature. Suppress it while a signed-in user's
  // plan is still loading so it never flashes at an entitled user.
  const premiumBadge =
    !user || (userProfilePlan !== undefined && !isDownloadPremium) ? _('Premium') : undefined;

  // A book can carry a coverImageUrl that no longer resolves (cover never
  // extracted, file pruned). A broken <img> still occupies its h-32 box, so
  // drop it from the layout entirely rather than leaving a blank band above
  // the title.
  const [coverFailed, setCoverFailed] = useState(false);
  const [view, setView] = useState<SheetView>('main');
  const [voiceGroups, setVoiceGroups] = useState<TTSVoicesGroup[]>([]);
  const [rate, setRate] = useState(viewSettings?.ttsRate ?? 1.0);
  const [selectedVoice, setSelectedVoice] = useState('');
  // The voice list is an accordion: at most one group open. Until the reader
  // taps a header, the group of the voice in use (else the first) is open;
  // tapping the open header folds it (null: all folded).
  const [pickedGroup, setPickedGroup] = useState<string | null | undefined>(undefined);
  const openGroup =
    pickedGroup !== undefined
      ? pickedGroup
      : (voiceGroups.find((group) => group.voices.some((voice) => voice.id === selectedVoice))
          ?.id ?? voiceGroups[0]?.id);
  const timerLabel = useCountdownLabel(timeoutTimestamp);
  const iconSize18 = useResponsiveSize(18);
  const iconSize24 = useResponsiveSize(24);
  const iconSize28 = useResponsiveSize(28);
  const iconSize32 = useResponsiveSize(32);

  const book = getBookData(bookKey)?.book;
  const sectionLabel = useMemo(() => {
    if (activeSectionIndex === null || activeSectionIndex < 0) {
      return progress?.sectionLabel;
    }

    const chapter = downloads.chapters.find(
      ({ startSection, endSection }) =>
        Number.isInteger(startSection) &&
        Number.isInteger(endSection) &&
        startSection >= 0 &&
        endSection > startSection &&
        activeSectionIndex >= startSection &&
        activeSectionIndex < endSection,
    );
    const chapterLabel = chapter?.label.trim();
    return chapterLabel || _('Section {{index}}', { index: activeSectionIndex + 1 });
  }, [_, activeSectionIndex, downloads.chapters, progress?.sectionLabel]);
  const isEink = viewSettings?.isEink ?? false;
  const pauseAfterSentence = viewSettings?.ttsPauseAfterSentence ?? false;
  const coverImage = book?.coverImageUrl && !coverFailed ? book.coverImageUrl : null;
  const resize = usePlayerResize();
  // Storage is best-effort (it throws when the browser blocks it): the size
  // still works for this session, it just isn't remembered.
  const [lyricFontSize, setLyricFontSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(LYRIC_FONT_SIZE_KEY));
      return LYRIC_FONT_SIZES.includes(stored) ? stored : DEFAULT_LYRIC_FONT_SIZE;
    } catch {
      return DEFAULT_LYRIC_FONT_SIZE;
    }
  });
  const stepLyricFontSize = (step: 1 | -1) => {
    const next = LYRIC_FONT_SIZES[LYRIC_FONT_SIZES.indexOf(lyricFontSize) + step];
    if (next === undefined) return;
    setLyricFontSize(next);
    try {
      localStorage.setItem(LYRIC_FONT_SIZE_KEY, String(next));
    } catch {}
  };

  const lyrics = useTTSLyrics({
    bookKey,
    enabled: supportsLyrics && isOpen,
    onGetLyrics,
    onGetActiveIndex,
  });
  // Committed up front on capability alone so the sheet does not flip layouts a
  // frame after opening; `unavailable` only pulls it back for the sections that
  // genuinely have no sheet to show (empty, or too long to render).
  const showLyrics = supportsLyrics && !lyrics.unavailable;
  // Re-read when the loop changes or the sheet moves to another section.
  const loopRange = useMemo(
    () => (loopState === 'off' ? null : onGetLyricLoopRange()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loopState, lyrics.lines],
  );

  // Books with recorded narration expose it as a voice; while it is playing
  // there is nothing to pre-download, since the audio ships with the book.
  const hasNarrationVoice = voiceGroups.some((group) =>
    group.voices.some((voice) => voice.id === MEDIA_OVERLAY_VOICE_ID),
  );
  const isNarrating = selectedVoice === MEDIA_OVERLAY_VOICE_ID;

  // Fresh open: land on the main view with current rate/voice.
  useEffect(() => {
    if (!isOpen) return;
    setView('main');
    setRate(getViewSettings(bookKey)?.ttsRate ?? 1.0);
    setSelectedVoice(onGetVoiceId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Opened while the clients initialized: pick up the voice once they are
  // ready, without leaving the view the user is on.
  useEffect(() => {
    if (isOpen && clientsReady) setSelectedVoice(onGetVoiceId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsReady]);

  useEffect(() => {
    if (!isOpen) return;
    // A request superseded by a newer one (the clients became ready, the
    // language changed) must not overwrite its result.
    let current = true;
    const fetchVoices = async () => {
      const groups = await onGetVoices(ttsLang);
      if (!current) return;
      const voicesCount = groups.reduce((acc, group) => acc + group.voices.length, 0);
      if (!groups || voicesCount === 0) {
        setVoiceGroups([
          {
            id: 'no-voices',
            name: _('Voices for {{lang}}', { lang: getLanguageName(ttsLang) }),
            voices: [],
          },
        ]);
      } else {
        setVoiceGroups(groups);
      }
    };
    fetchVoices();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ttsLang, clientsReady]);

  const handleSelectRate = (value: number) => {
    setRate(value);
    // The pauses are derived from the rate and persisted by onSetRate's handler
    // — every entry point that changes the rate has to re-derive them, so only
    // one of them may own it (#5750).
    onSetRate(value);

    const vs = getViewSettings(bookKey)!;
    vs.ttsRate = value;
    setViewSettings(bookKey, vs);
    // Read the store fresh at call time: a `settings` captured at render goes
    // stale if anything else persisted settings since this sheet mounted.
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    settings.globalViewSettings.ttsRate = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleSelectVoice = (voice: string, lang: string) => {
    onSetVoice(voice, lang);
    setSelectedVoice(voice);
    const vs = getViewSettings(bookKey)!;
    vs.ttsVoice = voice;
    // Remember per book whether the reader wants its own narrator or a
    // synthetic voice; ttsVoice alone can't say, since it inherits the global
    // default. Only written for books that offer narration at all.
    if (hasNarrationVoice) {
      vs.ttsUseNarration = voice === MEDIA_OVERLAY_VOICE_ID;
    }
    setViewSettings(bookKey, vs);
    setView('main');
  };

  const handleSelectTimeout = (value: number) => {
    onSelectTimeout(bookKey, value);
    setView('main');
  };

  // Entitled users drill into the per-chapter download view; everyone else is
  // routed to the upgrade page (or sign-in), the sheet closing first so the
  // navigation isn't hidden behind it.
  // Signed in, to the plans on the user page; signed out, to sign in first.
  const handleUpgrade = () => {
    onClose();
    if (user) navigateToProfile(router);
    else navigateToLogin(router);
  };

  const handleOpenDownloads = () => {
    if (isDownloadPremium) setView('chapters');
    else handleUpgrade();
  };

  const timeoutOptions = getTTSTimeoutOptions(_);
  const currentVoiceName = voiceGroups
    .flatMap((group) => group.voices)
    .find((voice) => voice.id === selectedVoice)?.name;
  // Armed timer shows its live countdown on the button; the chapter-end mode
  // has no countdown so it just names itself; otherwise the button falls
  // back to naming the feature (the alarm icon already carries the
  // affordance).
  const timerCaption =
    timeoutOption === TTS_STOP_AT_CHAPTER_END
      ? _('End of Chapter')
      : timeoutOption > 0 && timerLabel
        ? timerLabel
        : _('Sleep Timer');

  // The main view carries no header label (the content speaks for itself and
  // vertical space is tight); sub-views keep the back button and their title.
  // Desktop hides the drag handle and has no swipe-to-dismiss, so the main
  // view floats the standard dialog close pill over its top-right corner.
  // Transport labels by step size: sentence and paragraph for speech, time
  // skip and audiobook chapter for a paired recording.
  const prevLargeLabel = audioTransport ? _('Previous Chapter') : _('Previous Paragraph');
  const prevSmallLabel = audioTransport ? _('Back 15 Seconds') : _('Previous Sentence');
  const nextSmallLabel = audioTransport ? _('Forward 30 Seconds') : _('Next Sentence');
  const nextLargeLabel = audioTransport ? _('Next Chapter') : _('Next Paragraph');
  const loopLabel =
    loopState === 'off'
      ? _('Set Repeat Start (A)')
      : loopState === 'a'
        ? _('Set Repeat End (B)')
        : _('Clear A-B Repeat');
  const modeButtonClass = (active: boolean) =>
    clsx(
      'flex h-9 min-w-9 items-center justify-center rounded-full px-1.5',
      active ? 'bg-base-300 eink-bordered' : 'text-base-content/60',
    );

  const header =
    view === 'main' ? (
      <button
        type='button'
        aria-label={_('Close')}
        onClick={onClose}
        className='bg-base-300/65 btn btn-ghost btn-circle absolute end-3 top-1 z-10 hidden h-6 min-h-6 w-6 focus:outline-hidden sm:flex'
      >
        <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
          <path
            fill='currentColor'
            d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
          />
        </svg>
      </button>
    ) : (
      <div className='relative flex h-11 w-full items-center px-1'>
        <button
          type='button'
          aria-label={_('Go Back')}
          onClick={() => setView('main')}
          className='btn btn-ghost btn-circle z-10 flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-hidden'
        >
          <MdArrowBackIosNew size={iconSize24 * 0.8} className='rtl:rotate-180' />
        </button>
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <span className='line-clamp-1 text-center font-bold'>
            {view === 'speed'
              ? _('Speed')
              : view === 'voice'
                ? _('Select Voice')
                : view === 'chapters'
                  ? _('Offline Audio')
                  : _('Set Timeout')}
          </span>
        </div>
      </div>
    );

  return (
    <Dialog
      id='tts_player_sheet'
      isOpen={isOpen}
      // The lyric sheet needs room to read as one: at the cover player's 0.65
      // it collapses to two or three visible lines.
      snapHeight={showLyrics ? 0.8 : 0.65}
      title={_('Read Aloud')}
      header={header}
      // The voice list keeps one height, so folding a group never resizes the
      // sheet; the other views fit their content. A size dragged out with the
      // corner grip (usePlayerResize) overrides both, up to the whole window.
      boxClassName={clsx(
        'sm:max-h-[min(var(--tts-player-h,85%),100%)]! sm:w-[var(--tts-player-w,420px)]! sm:min-w-0! sm:max-w-full!',
        view === 'voice' ? 'sm:h-[var(--tts-player-h,85%)]!' : 'sm:h-[var(--tts-player-h,auto)]!',
      )}
      contentClassName='px-4! sm:px-4! mt-[-4px]'
      onClose={onClose}
    >
      {view === 'main' && (
        // sm:pt-4 keeps the cover clear of the box's rounded top edge on
        // desktop, where the mobile drag handle (and its clearance) is
        // hidden; on mobile the handle already provides the gap.
        <div
          className={clsx(
            'flex w-full flex-col items-center gap-4 pb-4 sm:pt-4',
            // The lyric sheet is the one element here that can take whatever
            // height is left, so it claims it — and the transport below stays
            // put instead of being pushed into a scroll.
            showLyrics && (resize.sized ? 'h-full' : 'h-full sm:h-auto'),
          )}
        >
          {/* With lyrics the artwork steps aside into a thumbnail row so the
              transcript gets the vertical space; without them the cover keeps
              the full-width billing it has always had. */}
          <div
            className={clsx(
              'flex w-full min-w-0',
              showLyrics ? 'flex-row items-center gap-3' : 'flex-col items-center gap-4',
            )}
          >
            {coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImage}
                alt=''
                className={clsx(
                  'not-eink:shadow-lg eink-bordered w-auto shrink-0 rounded-xl object-cover',
                  showLyrics ? 'h-12' : 'h-32',
                )}
                onError={() => setCoverFailed(true)}
              />
            )}
            <div
              className={clsx(
                'flex min-w-0 flex-col gap-0.5',
                showLyrics ? 'flex-1 items-start text-start' : 'w-full items-center text-center',
              )}
            >
              <span className='line-clamp-1 w-full font-semibold'>{book?.title ?? ''}</span>
              {sectionLabel && (
                <span className='text-base-content/70 line-clamp-1 w-full text-sm'>
                  {sectionLabel}
                </span>
              )}
            </div>
            {showLyrics && (
              // sm:me-8 clears the desktop close button in the box's top-end corner.
              <div className='flex shrink-0 items-center self-end sm:me-8'>
                {(
                  [
                    [-1, _('Decrease font size'), MdTextDecrease],
                    [1, _('Increase font size'), MdTextIncrease],
                  ] as const
                ).map(([step, label, Icon]) => (
                  <button
                    key={step}
                    type='button'
                    aria-label={label}
                    title={label}
                    disabled={
                      LYRIC_FONT_SIZES[LYRIC_FONT_SIZES.indexOf(lyricFontSize) + step] === undefined
                    }
                    onClick={() => stepLyricFontSize(step)}
                    className='text-base-content/70 hover:text-base-content disabled:text-base-content/25 flex items-end px-1.5 pt-2 leading-none'
                  >
                    <Icon size={iconSize18} />
                  </button>
                ))}
              </div>
            )}
          </div>
          {showLyrics && (
            <TTSLyricsView
              fill={resize.sized}
              fontSize={lyricFontSize}
              lines={lyrics.lines}
              activeIndex={lyrics.activeIndex}
              loopRange={loopRange}
              buffering={buffering}
              isEink={isEink}
              onGetLyricPage={onGetLyricPage}
              onPlayFrom={onPlayFromLyric}
            />
          )}
          {hasTimeline ? (
            <TTSScrubber
              bookKey={bookKey}
              isEink={isEink}
              onSeek={onSeek}
              onSeekPreview={onSeekPreview}
              onGetPlaybackInfo={onGetPlaybackInfo}
            />
          ) : (
            chapterRemainingSec !== null && (
              <span className='text-base-content/70 text-xs'>
                {_('{{time}} left in chapter', { time: formatPlaybackTime(chapterRemainingSec) })}
              </span>
            )
          )}
          <div dir='ltr' className='flex w-full items-center justify-between'>
            {/* Sentence-by-sentence and A-B repeat step by sentence, which a
                paired audiobook does not have. */}
            {!audioTransport && (
              <button
                type='button'
                className={modeButtonClass(pauseAfterSentence)}
                title={_('Pause After Each Sentence')}
                aria-label={_('Pause After Each Sentence')}
                aria-pressed={pauseAfterSentence}
                onClick={() =>
                  saveViewSettings(
                    envConfig,
                    bookKey,
                    'ttsPauseAfterSentence',
                    !pauseAfterSentence,
                    false,
                    false,
                  )
                }
              >
                <TbArrowBarToRight size={iconSize18} />
              </button>
            )}
            <div className='flex flex-1 items-center justify-center gap-1'>
              <button
                type='button'
                className='rounded-full p-2'
                title={prevLargeLabel}
                aria-label={prevLargeLabel}
                onClick={() => onBackward(false)}
                disabled={!clientsReady}
              >
                {audioTransport ? (
                  <MdSkipPrevious size={iconSize24} />
                ) : (
                  <MdKeyboardDoubleArrowLeft size={iconSize24} />
                )}
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={prevSmallLabel}
                aria-label={prevSmallLabel}
                onClick={() => onBackward(true)}
                disabled={!clientsReady}
              >
                {audioTransport ? (
                  <RiReplay15Line size={iconSize24} />
                ) : (
                  <MdKeyboardArrowLeft size={iconSize28} />
                )}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-circle relative mx-2 h-14 min-h-14 w-14'
                aria-label={isPlaying ? _('Pause') : _('Play')}
                aria-busy={buffering}
                onClick={onTogglePlay}
                disabled={!clientsReady}
              >
                {isPlaying ? (
                  <MdOutlinePause size={iconSize32} />
                ) : (
                  <MdPlayArrow size={iconSize32} />
                )}
                {/* Inside the button's edge, so it reads against the fill rather
                  than against whatever the sheet puts behind it. */}
                {buffering && <BufferingRing size={50} isEink={isEink} />}
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={nextSmallLabel}
                aria-label={nextSmallLabel}
                onClick={() => onForward(true)}
                disabled={!clientsReady}
              >
                {audioTransport ? (
                  <RiForward30Line size={iconSize24} />
                ) : (
                  <MdKeyboardArrowRight size={iconSize28} />
                )}
              </button>
              <button
                type='button'
                className='rounded-full p-2'
                title={nextLargeLabel}
                aria-label={nextLargeLabel}
                onClick={() => onForward(false)}
                disabled={!clientsReady}
              >
                {audioTransport ? (
                  <MdSkipNext size={iconSize24} />
                ) : (
                  <MdKeyboardDoubleArrowRight size={iconSize24} />
                )}
              </button>
            </div>
            {!audioTransport && (
              <button
                type='button'
                className={modeButtonClass(loopState !== 'off')}
                title={loopLabel}
                aria-label={loopLabel}
                onClick={onToggleLoop}
              >
                <span className='text-sm font-semibold'>
                  A-<span className={clsx(loopState === 'a' && 'opacity-40')}>B</span>
                </span>
              </button>
            )}
          </div>
          <div className='flex w-full gap-2'>
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
              aria-label={_('Voice')}
              onClick={() => setView('voice')}
              className='not-eink:bg-base-200 eink-bordered flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl'
            >
              <RiVoiceAiFill size={iconSize18} />
              <span className='text-base-content/60 max-w-full truncate px-1 text-xs'>
                {currentVoiceName ? _(currentVoiceName) : _('Voice')}
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
          </div>
          {!isNarrating && downloads.supported && downloads.chapters.length > 0 && (
            <button
              type='button'
              aria-label={_('Offline Audio')}
              onClick={handleOpenDownloads}
              className='not-eink:bg-base-200 eink-bordered flex w-full items-center gap-3 rounded-xl px-3 py-2.5'
            >
              <MdOutlineFileDownload size={iconSize24} className='shrink-0' />
              <div className='flex min-w-0 flex-1 flex-col items-start'>
                <span className='text-sm font-semibold'>{_('Offline Audio')}</span>
                <span className='text-base-content/60 line-clamp-1 text-start text-xs'>
                  {premiumBadge
                    ? _('Download chapters for offline playback')
                    : _('{{done}} of {{total}} downloaded', {
                        done: downloads.chapters.filter((c) => downloads.statusOf(c) === 'complete')
                          .length,
                        total: downloads.chapters.length,
                      })}
                </span>
              </div>
              {premiumBadge && (
                <span className='badge badge-sm badge-ghost shrink-0'>{premiumBadge}</span>
              )}
              <MdChevronRight size={iconSize24} className='shrink-0 rtl:rotate-180' />
            </button>
          )}
        </div>
      )}
      {view === 'chapters' && (
        <TTSChaptersView
          downloads={downloads}
          activeSectionIndex={activeSectionIndex}
          isEink={isEink}
        />
      )}
      {view === 'speed' && (
        <div className='flex w-full flex-col items-center pb-4 pt-2'>
          <SpeedRuler rate={rate} onSelect={handleSelectRate} />
        </div>
      )}
      {view === 'voice' && (
        <div className='flex w-full flex-col pb-4'>
          {voiceGroups.map((voiceGroup) => {
            const collapsed = voiceGroup.id !== openGroup;
            // The group holding the voice in use stands out, and names it
            // while folded (open, its check mark already shows it).
            const current = voiceGroup.voices.find((voice) => voice.id === selectedVoice);
            return (
              <div key={voiceGroup.id}>
                <button
                  type='button'
                  aria-expanded={!collapsed}
                  onClick={() => setPickedGroup(collapsed ? voiceGroup.id : null)}
                  className={clsx(
                    'flex w-full items-center gap-1 px-2 py-1 text-start text-sm sm:text-xs',
                    current ? 'text-base-content font-semibold' : 'text-base-content/60',
                  )}
                >
                  <span className='flex-1'>
                    {/* A single-voice group (a book's own narrator) would otherwise
                      read "Narration: 1 voices". */}
                    {voiceGroup.voices.length === 1
                      ? _(voiceGroup.name)
                      : _('{{engine}}: {{count}} voices', {
                          engine: _(voiceGroup.name),
                          count: voiceGroup.voices.length,
                        })}
                  </span>
                  {collapsed && current && (
                    <span className='max-w-[50%] shrink-0 truncate'>{_(current.name)}</span>
                  )}
                  <MdExpandMore
                    className={clsx('shrink-0', collapsed && '-rotate-90 rtl:rotate-90')}
                  />
                </button>
                {!collapsed &&
                  voiceGroup.voices.map((voice) => (
                    <button
                      key={`${voiceGroup.id}-${voice.id}`}
                      type='button'
                      // A premium voice the plan lacks stays tappable: it
                      // leads to the upgrade instead of speaking.
                      disabled={voice.disabled && !voice.tier}
                      onClick={() =>
                        voice.disabled ? handleUpgrade() : handleSelectVoice(voice.id, voice.lang)
                      }
                      className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start'
                    >
                      <span className='flex h-6 w-6 items-center justify-center'>
                        {selectedVoice === voice.id && <MdCheck className='text-base-content' />}
                      </span>
                      <span
                        className={clsx(
                          'overflow-hidden text-ellipsis text-base sm:text-sm',
                          voice.disabled && 'text-base-content/40',
                        )}
                      >
                        {_(voice.name)}
                      </span>
                      {voice.variant && (
                        <span className='badge badge-sm badge-ghost ms-auto shrink-0'>
                          {voice.variant === 'multilingual' ? _('Multilingual') : _('Expressive')}
                        </span>
                      )}
                      {voice.tier && (
                        <span
                          className={clsx(
                            'badge badge-sm badge-ghost shrink-0',
                            !voice.variant && 'ms-auto',
                          )}
                        >
                          {voice.tier === 'pro' ? _('Pro') : _('Plus')}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      )}
      {view === 'timer' && (
        <div className='flex w-full flex-col pb-4'>
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
              <span className='text-base sm:text-sm'>{option.label}</span>
            </button>
          ))}
        </div>
      )}
      {/* Pointer-only affordance in the box's bottom-end corner (it is the
          containing block: the body wrapper is not positioned). */}
      <div
        {...resize.gripProps}
        data-tts-player-resize
        aria-hidden
        className='text-base-content/40 absolute bottom-1 end-1 z-20 hidden h-4 w-4 cursor-nwse-resize touch-none sm:block rtl:cursor-nesw-resize'
      >
        <svg viewBox='0 0 16 16' className='h-full w-full rtl:-scale-x-100'>
          <path
            d='M15 6 6 15M15 11l-4 4'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
        </svg>
      </div>
    </Dialog>
  );
};

export default TTSPlayerSheet;
