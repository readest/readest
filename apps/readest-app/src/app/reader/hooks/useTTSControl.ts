import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { TransformContext } from '@/services/transformers/types';
import { proofreadTransformer } from '@/services/transformers/proofread';
import { useTranslation } from '@/hooks/useTranslation';
import {
  ensureSharedAudioContext,
  TTSController,
  TTSHighlightOptions,
  TTSVoicesGroup,
} from '@/services/tts';
import { eventDispatcher } from '@/utils/event';
import { genSSMLRaw, parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/throttle';
import { isCfiInLocation } from '@/utils/cfi';
import { getLocale } from '@/utils/misc';
import { invokeUseBackgroundAudio } from '@/utils/bridge';
import { estimateTTSTime } from '@/utils/ttsTime';
import { releaseUnblockAudio, ttsMediaBridge, unblockAudio } from '@/services/tts/ttsMediaBridge';

interface UseTTSControlProps {
  bookKey: string;
  onRequestHidePanel?: () => void;
}

export const useTTSControl = ({ bookKey, onRequestHidePanel }: UseTTSControlProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { isDarkMode } = useThemeStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setViewSettings = useReaderStore((s) => s.setViewSettings);
  const setTTSEnabled = useReaderStore((s) => s.setTTSEnabled);
  const { getMergedRules } = useProofreadStore();

  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showTTSBar, setShowTTSBar] = useState(() => !!getViewSettings(bookKey)?.showTTSBar);
  const [showBackToCurrentTTSLocation, setShowBackToCurrentTTSLocation] = useState(false);

  const [timeoutOption, setTimeoutOption] = useState(0);
  const [timeoutTimestamp, setTimeoutTimestamp] = useState(0);
  const [timeoutFunc, setTimeoutFunc] = useState<ReturnType<typeof setTimeout> | null>(null);

  const followingTTSLocationRef = useRef(true);
  const sectionChangingTimestampRef = useRef(0);
  const previousSectionLabelRef = useRef<string | undefined>(undefined);
  const ttsControllerRef = useRef<TTSController | null>(null);
  const isStartingTTSRef = useRef(false);
  // Last broadcast playback state, so a follower engaging mid-session can be
  // replayed the current state on demand (see handleTTSSyncRequest).
  const playbackStateRef = useRef<'playing' | 'paused' | 'stopped'>('stopped');
  const [ttsController, setTtsController] = useState<TTSController | null>(null);
  const [ttsClientsInited, setTtsClientsInitialized] = useState(false);

  // Broadcast playback transitions on the app-wide bus so consumers that
  // can't read the hook-local isPlaying flag (RSVP, paragraph mode) can react.
  const emitPlaybackState = (state: 'playing' | 'paused' | 'stopped') => {
    playbackStateRef.current = state;
    eventDispatcher.dispatch('tts-playback-state', { bookKey, state });
  };

  // A follower (paragraph / RSVP mode) that engages mid-session asks the
  // controller to re-broadcast its current playback state and position, so it
  // can sync immediately instead of waiting for the next word/sentence boundary
  // (or forcing the user to stop and restart TTS inside the mode). Replays only
  // when a session actually exists (playing or paused).
  const handleTTSSyncRequest = (event: CustomEvent) => {
    const detail = event.detail as { bookKey?: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const state = playbackStateRef.current;
    if (state !== 'playing' && state !== 'paused') return;
    if (!ttsControllerRef.current) return;
    // Position first, then state: RSVP's 'paused' handler drops following, which
    // would discard a position arriving after it. Position-first lets the
    // follower sync the current word/paragraph before a (possibly paused) state
    // lands. Only the entering mode listens to these events, so the order is
    // deterministic. The live flow (separate emits) is unaffected.
    ttsControllerRef.current.redispatchPosition();
    emitPlaybackState(state);
  };

  const handleTTSForward = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; byMark?: boolean } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.forward(detail?.byMark ?? false);
    }
  };

  const handleTTSBackward = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; byMark?: boolean } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.backward(detail?.byMark ?? false);
    }
  };

  const handleTTSHighlightSentence = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const sentence = ttsControllerRef.current?.getSpokenSentence();
    if (!sentence) return;
    eventDispatcher.dispatch('create-tts-highlight', { bookKey, ...sentence });
  };

  // Set the TTS rate from the app bus. The RSVP overlay is full-screen, so its
  // rate picker can't reach the TTS panel; it dispatches `tts-set-rate` and we
  // reuse the same controller rate-change path the panel uses (handleSetRate,
  // defined below — stop→setRate→start while playing, throttled). Also persists
  // the value to viewSettings so it survives like a panel change.
  const handleTTSSetRate = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; rate?: number } | undefined;
    if (detail?.bookKey !== bookKey || typeof detail.rate !== 'number') return;
    const viewSettings = getViewSettings(bookKey);
    if (viewSettings) {
      viewSettings.ttsRate = detail.rate;
      setViewSettings(bookKey, viewSettings);
    }
    handleSetRate(detail.rate);
  };

  const handleTTSTogglePlay = async (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;
    if (ttsController.state === 'playing') {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    } else {
      setIsPlaying(true);
      setIsPaused(false);
      emitPlaybackState('playing');
      if (ttsController.state === 'paused') {
        await ttsController.resume();
      } else {
        await ttsController.start();
      }
    }
  };

  useEffect(() => {
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    eventDispatcher.on('tts-forward', handleTTSForward);
    eventDispatcher.on('tts-backward', handleTTSBackward);
    eventDispatcher.on('tts-toggle-play', handleTTSTogglePlay);
    eventDispatcher.on('tts-set-rate', handleTTSSetRate);
    eventDispatcher.on('tts-highlight-sentence', handleTTSHighlightSentence);
    eventDispatcher.on('tts-sync-request', handleTTSSyncRequest);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
      eventDispatcher.off('tts-forward', handleTTSForward);
      eventDispatcher.off('tts-backward', handleTTSBackward);
      eventDispatcher.off('tts-toggle-play', handleTTSTogglePlay);
      eventDispatcher.off('tts-set-rate', handleTTSSetRate);
      eventDispatcher.off('tts-highlight-sentence', handleTTSHighlightSentence);
      eventDispatcher.off('tts-sync-request', handleTTSSyncRequest);
      if (ttsControllerRef.current) {
        ttsControllerRef.current.shutdown();
        ttsControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controller event listeners (re-registered when ttsController changes)
  useEffect(() => {
    if (!ttsController || !bookKey) return;
    const handleNeedAuth = () => {
      eventDispatcher.dispatch('toast', {
        message: _('Please log in to use advanced TTS features'),
        type: 'error',
        timeout: 5000,
      });
    };

    const handleHighlightMark = (e: Event) => {
      const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
      const view = getView(bookKey);
      const progress = getProgress(bookKey);
      const viewSettings = getViewSettings(bookKey);
      const { location } = progress || {};
      if (!cfi || !view || !location || !viewSettings) return;

      viewSettings.ttsLocation = cfi;
      setViewSettings(bookKey, viewSettings);

      const hlContents = view.renderer.getContents();
      const hlPrimaryIdx = view.renderer.primaryIndex;
      const { doc, index: viewSectionIndex } = (hlContents.find((x) => x.index === hlPrimaryIdx) ??
        hlContents[0]) as {
        doc: Document;
        index?: number;
      };

      const { anchor, index: ttsSectionIndex } = view.resolveCFI(cfi);
      if (viewSectionIndex !== ttsSectionIndex) {
        // TTS crossed into a new section before the view caught up. The
        // `await onSectionChange` path in TTSController fires renderer.goTo
        // via handleSectionChange, but the new paginator's #goTo can resolve
        // before the visible page actually flips when the target section is
        // already preloaded as an adjacent view — leaving the user stuck on
        // the last page of the previous chapter while audio continues. Drive
        // navigation from the highlight cfi directly, stamping the timestamp
        // so the "back-to-TTS" button stays suppressed while progress.location
        // catches up. Skip only when the user is actively selecting text.
        if (hlContents.some(({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0)) {
          return;
        }
        sectionChangingTimestampRef.current = Date.now();
        followingTTSLocationRef.current = true;
        view.goTo?.(cfi);
        return;
      }

      if (!followingTTSLocationRef.current) return;

      if (hlContents.some(({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0)) {
        return;
      }

      const range = anchor(doc);
      if (!view.renderer.scrolled) {
        view.renderer.scrollToAnchor?.(range);
      } else {
        const rect = range.getBoundingClientRect();
        const { start, end, sideProp } = view.renderer;
        const rangeTop = rect[sideProp === 'height' ? 'y' : 'x'];
        const rangeBottom = rangeTop + rect[sideProp === 'height' ? 'height' : 'width'];

        const showHeader = viewSettings.showHeader;
        const showFooter = viewSettings.showFooter;
        const headerScrollOverlap = showHeader ? viewSettings.marginTopPx : 0;
        const footerScrollOverlap = showFooter ? viewSettings.marginBottomPx : 0;
        const scrollingOverlap = viewSettings.scrollingOverlap;
        const outOfView =
          rangeBottom > end - footerScrollOverlap - scrollingOverlap ||
          rangeTop < start + headerScrollOverlap + scrollingOverlap;
        if (outOfView) {
          view.renderer.scrollToAnchor?.(range);
        }
      }
    };

    // Word-level page following: turn the page as soon as the spoken word
    // moves off the visible page, instead of waiting for the next sentence's
    // mark. Only navigates when the word is outside the visible range, so
    // on-page words don't trigger relocations.
    const handleHighlightWord = (e: Event) => {
      const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
      const view = getView(bookKey);
      if (!cfi || !view || !followingTTSLocationRef.current) return;

      const hlContents = view.renderer.getContents();
      const hlPrimaryIdx = view.renderer.primaryIndex;
      const { doc, index: viewSectionIndex } = (hlContents.find((x) => x.index === hlPrimaryIdx) ??
        hlContents[0]) as { doc: Document; index?: number };

      const { anchor, index: ttsSectionIndex } = view.resolveCFI(cfi);
      // Cross-section navigation is driven by the sentence-level mark handler.
      if (viewSectionIndex !== ttsSectionIndex) return;
      if (hlContents.some(({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0)) return;

      const wordRange = anchor(doc);
      const visibleRange = getProgress(bookKey)?.range as Range | undefined;
      if (!wordRange || !visibleRange) return;

      try {
        const ahead = wordRange.compareBoundaryPoints(Range.END_TO_START, visibleRange) > 0;
        const behind = wordRange.compareBoundaryPoints(Range.START_TO_END, visibleRange) < 0;
        if (ahead || behind) {
          view.renderer.scrollToAnchor?.(wordRange);
        }
      } catch {
        // Ranges may briefly belong to different documents during a section
        // change; the mark handler takes over in that case.
      }
    };

    // Republish the controller's canonical position signal onto the app-wide
    // bus so paragraph mode + RSVP can follow TTS without touching the
    // controller. This MUST be its own listener: handleHighlightMark /
    // handleHighlightWord early-return on following-suppression and text
    // selection, which would silently stop the modes from following. The
    // forward fires on every controller 'tts-position', gated only by the
    // listener's lifecycle (it exists only while the controller does).
    const handlePosition = (e: Event) => {
      eventDispatcher.dispatch('tts-position', {
        bookKey,
        ...(e as CustomEvent).detail,
      });
    };

    // Lock-screen play/pause acts on the controller through the media
    // bridge; the panel derives its state from the controller, not from
    // local optimistic taps. Transit 'stopped' (every paragraph advance) is
    // ignored; terminal stops arrive via explicit stop paths.
    const handleStateChange = (e: Event) => {
      const { state } = (e as CustomEvent<{ state: string }>).detail;
      if (state === 'playing') {
        setIsPlaying(true);
        setIsPaused(false);
        emitPlaybackState('playing');
      } else if (state.includes('paused')) {
        setIsPlaying(false);
        setIsPaused(true);
        emitPlaybackState('paused');
      }
    };

    ttsController.addEventListener('tts-need-auth', handleNeedAuth);
    ttsController.addEventListener('tts-highlight-mark', handleHighlightMark);
    ttsController.addEventListener('tts-highlight-word', handleHighlightWord);
    ttsController.addEventListener('tts-position', handlePosition);
    ttsController.addEventListener('tts-state-change', handleStateChange);
    return () => {
      ttsController.removeEventListener('tts-need-auth', handleNeedAuth);
      ttsController.removeEventListener('tts-highlight-mark', handleHighlightMark);
      ttsController.removeEventListener('tts-highlight-word', handleHighlightWord);
      ttsController.removeEventListener('tts-position', handlePosition);
      ttsController.removeEventListener('tts-state-change', handleStateChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsController, bookKey]);

  // Location tracking — re-highlight when progress changes.
  // Reactive subscription via readerProgressStore so the effect below
  // re-runs on page turns without dragging in the whole readerStore.
  const progress = useBookProgress(bookKey);
  useEffect(() => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    const viewSettings = getViewSettings(bookKey);
    const ttsLocation = viewSettings?.ttsLocation;
    const { location } = progress || {};
    if (!location || !ttsLocation) return;

    // Check the actual highlighted position against the view. During
    // word-by-word playback the word can sit on a different page than the
    // sentence's ttsLocation (a sentence spanning a page break), so the word
    // position is the correct reference — otherwise the back-to-TTS button
    // wrongly appears after the view follows the word onto the next page.
    const highlightCfi = ttsController.getCurrentHighlightCfi() ?? ttsLocation;
    if (isCfiInLocation(highlightCfi, location)) {
      setShowBackToCurrentTTSLocation(false);
      // Word-aware re-apply: re-draws the current word during word-by-word
      // playback instead of redrawing the whole sentence over it.
      ttsController.reapplyCurrentHighlight();
    } else {
      const msSinceSectionChange = Date.now() - sectionChangingTimestampRef.current;
      if (msSinceSectionChange < 2000) return;
      setShowBackToCurrentTTSLocation(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Location tracking — keep followingTTSLocationRef in sync with showBackToCurrentTTSLocation
  useEffect(() => {
    if (showBackToCurrentTTSLocation) {
      followingTTSLocationRef.current = false;
    } else {
      followingTTSLocationRef.current = true;
    }
  }, [showBackToCurrentTTSLocation]);

  // Location tracking — handleBackToCurrentTTSLocation
  const handleBackToCurrentTTSLocation = () => {
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    const ttsLocation = viewSettings?.ttsLocation;
    if (!view || !ttsLocation) return;

    const resolved = view.resolveNavigation(ttsLocation);
    view.renderer.goTo?.(resolved);
  };

  const viewSettings = getViewSettings(bookKey);
  const bookData = getBookData(bookKey);
  const ttsTime = useMemo(() => {
    const rate = viewSettings?.ttsRate ?? 1;
    return estimateTTSTime(progress, rate);
  }, [progress, viewSettings?.ttsRate]);

  const getTTSTargetLang = useCallback((): string | null => {
    const vs = getViewSettings(bookKey);
    const ttsReadAloudText = vs?.ttsReadAloudText;
    if (vs?.translationEnabled && ttsReadAloudText === 'translated') {
      return vs?.translateTargetLang || getLocale();
    } else if (vs?.translationEnabled && ttsReadAloudText === 'source') {
      return bookData?.book?.primaryLanguage || '';
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookKey,
    getBookData,
    getViewSettings,
    viewSettings?.translationEnabled,
    viewSettings?.ttsReadAloudText,
    viewSettings?.translateTargetLang,
  ]);

  useEffect(() => {
    ttsControllerRef.current?.setTargetLang(getTTSTargetLang() || '');
  }, [getTTSTargetLang]);

  // SSML preprocessing
  const transformCtx: TransformContext = useMemo(
    () => ({
      bookKey,
      viewSettings: getViewSettings(bookKey)!,
      userLocale: getLocale(),
      isFixedLayout: bookData?.isFixedLayout || false,
      content: '',
      transformers: [],
      reversePunctuationTransform: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const preprocessSSMLForTTS = useCallback(
    async (ssml: string) => {
      const rules = getMergedRules(bookKey);
      const viewSettings = getViewSettings(bookKey)!;
      const ttsOnlyRules = rules.filter(
        (rule) =>
          rule.enabled && rule.onlyForTTS && (rule.scope === 'book' || rule.scope === 'library'),
      );
      if (ttsOnlyRules.length === 0) return ssml;

      transformCtx['content'] = ssml;
      transformCtx['viewSettings'] = viewSettings;
      ssml = await proofreadTransformer.transform(transformCtx, {
        docType: 'text/xml',
        onlyForTTS: true,
      });
      return ssml;
    },
    [bookKey, getMergedRules, getViewSettings, transformCtx],
  );

  // Section change callback
  const handleSectionChange = useCallback(
    async (sectionIndex: number) => {
      if (!followingTTSLocationRef.current) return;
      const view = getView(bookKey);
      const sections = view?.book.sections;
      if (!sections || sectionIndex < 0 || sectionIndex >= sections.length) return;
      sectionChangingTimestampRef.current = Date.now();
      const resolved = view.resolveNavigation(sectionIndex);
      // Await so TTSController's `await onSectionChange` doesn't proceed to
      // speak the new section before the view has finished navigating to it.
      await view.renderer.goTo?.(resolved);
    },
    [bookKey, getView],
  );

  // TTS highlight options
  const getTTSHighlightOptions = useCallback(
    (ttsHighlightOptions: TTSHighlightOptions, isEink: boolean) => {
      const einkBgColor = isDarkMode ? '#000000' : '#ffffff';
      const color = isEink ? einkBgColor : ttsHighlightOptions.color;
      return {
        ...ttsHighlightOptions,
        color,
      };
    },
    [isDarkMode],
  );

  useEffect(() => {
    const ttsHighlightOptions = viewSettings?.ttsHighlightOptions;
    if (ttsControllerRef.current && ttsHighlightOptions) {
      ttsControllerRef.current.updateHighlightOptions(
        getTTSHighlightOptions(ttsHighlightOptions, viewSettings!.isEink),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings?.ttsHighlightOptions, viewSettings?.isEink, getTTSHighlightOptions]);

  useEffect(() => {
    if (ttsControllerRef.current && viewSettings?.ttsHighlightGranularity) {
      ttsControllerRef.current.setHighlightGranularity(viewSettings.ttsHighlightGranularity);
    }
  }, [viewSettings?.ttsHighlightGranularity]);

  // handleStop (defined before handleTTSSpeak/handleTTSStop which reference it)
  const handleStop = useCallback(
    async (bookKey: string) => {
      const ttsController = ttsControllerRef.current;
      // Reset all UI/session state up front — including the TTS toggle
      // (ttsEnabled) and indicator that color the TTS icon — so disabling TTS
      // always takes effect immediately. The teardown below is best-effort and
      // must never block or skip these resets if it hangs or throws, which was
      // observed with iOS system TTS (Edge TTS was unaffected). See #4676.
      ttsControllerRef.current = null;
      setTtsController(null);
      setIsPlaying(false);
      emitPlaybackState('stopped');
      onRequestHidePanel?.();
      setShowIndicator(false);
      setShowBackToCurrentTTSLocation(false);
      previousSectionLabelRef.current = undefined;
      setTTSEnabled(bookKey, false);
      getView(bookKey)?.deselect();
      releaseUnblockAudio();

      // Tear down the controller, the lock-screen media session, and the
      // background-audio session best-effort and IN PARALLEL. The controller's
      // own shutdown can stall on iOS system TTS, and it must NOT gate the media
      // session / background-audio teardown — otherwise the lock-screen Now
      // Playing keeps running after TTS is disabled (Edge TTS was unaffected
      // because it never hits the stalling native path). See #4676.
      await Promise.all([
        ttsController
          ? Promise.resolve()
              .then(() => ttsController.shutdown())
              .catch((error) => console.warn('TTS shutdown failed:', error))
          : Promise.resolve(),
        appService?.isIOSApp
          ? invokeUseBackgroundAudio({ enabled: false }).catch(() => {})
          : Promise.resolve(),
        Promise.resolve()
          .then(() => ttsMediaBridge.unbind())
          .catch(() => {}),
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  // handleTTSSpeak / handleTTSStop (plain functions, registered once at mount via closure)
  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey, range, index, oneTime = false } = event.detail;
    if (bookKey !== ttsBookKey) return;
    // Guard against concurrent starts (e.g. rapid double-clicks on the TTS
    // icon). Without this, both invocations race past the `await`s below and
    // end up creating two TTSController instances that speak simultaneously.
    if (isStartingTTSRef.current) return;
    isStartingTTSRef.current = true;

    try {
      const view = getView(bookKey);
      const progress = getProgress(bookKey);
      const viewSettings = getViewSettings(bookKey);
      const bookData = getBookData(bookKey);
      const { location } = progress || {};
      if (!view || !progress || !viewSettings || !bookData || !bookData.book) return;
      const ttsSpeakRange = range as Range | null;
      let ttsFromRange = ttsSpeakRange;
      let ttsFromIndex = typeof index === 'number' ? index : null;
      if (!ttsFromRange && viewSettings.ttsLocation) {
        const ttsCfi = viewSettings.ttsLocation;
        if (isCfiInLocation(ttsCfi, location)) {
          const { index, anchor } = view.resolveCFI(ttsCfi);
          const { doc } = view.renderer.getContents().find((x) => x.index === index) || {};
          if (doc) {
            ttsFromRange = anchor(doc);
            ttsFromIndex = index;
          }
        }
      }

      if (!ttsFromIndex) {
        ttsFromIndex = progress.index;
      }

      if (!ttsFromRange && !bookData.isFixedLayout) {
        ttsFromRange = progress.range;
      }

      const currentSection = view.renderer.getContents().find((x) => x.index === ttsFromIndex);
      if (ttsFromRange && currentSection) {
        const ttsLocation = view.getCFI(currentSection?.index || 0, ttsFromRange);
        viewSettings.ttsLocation = ttsLocation;
        setViewSettings(bookKey, viewSettings);
        if (isCfiInLocation(ttsLocation, location)) {
          setShowBackToCurrentTTSLocation(false);
        }
      }

      const primaryLang = bookData.book.primaryLanguage;

      if (ttsControllerRef.current) {
        ttsControllerRef.current.stop();
        ttsControllerRef.current = null;
      }

      try {
        // Gesture-path audio unlocks, BEFORE any network/plugin await: WebKit
        // rejects AudioContext.resume() outside the user-gesture window, and
        // speak() itself only runs after preprocessing and preload fetches.
        // The silent keep-alive element runs on ALL platforms — desktop
        // Chromium only surfaces hardware media keys while an
        // HTMLMediaElement is playing, and Edge playback no longer has one.
        unblockAudio();
        void ensureSharedAudioContext();
        if (appService?.isIOSApp) {
          await invokeUseBackgroundAudio({ enabled: true });
        }
        setTtsClientsInitialized(false);

        setShowIndicator(true);
        const ttsController = new TTSController(
          appService,
          view,
          !!user?.id,
          preprocessSSMLForTTS,
          handleSectionChange,
        );
        ttsControllerRef.current = ttsController;
        setTtsController(ttsController);
        ttsMediaBridge
          .bind(ttsController, {
            bookKey,
            title: bookData.book.title,
            author: bookData.book.author,
            coverImageUrl: bookData.book.coverImageUrl || null,
            metadataMode: viewSettings.ttsMediaMetadata ?? 'sentence',
            getSectionLabel: () => getProgress(bookKey)?.sectionLabel,
          })
          .catch((err) => console.warn('TTS media bridge bind failed:', err));

        await ttsController.init();
        await ttsController.initViewTTS(ttsFromIndex);
        ttsController.updateHighlightOptions(
          getTTSHighlightOptions(viewSettings.ttsHighlightOptions, viewSettings.isEink),
        );
        ttsController.setHighlightGranularity(viewSettings.ttsHighlightGranularity ?? 'word');
        const ssml =
          oneTime && ttsSpeakRange
            ? genSSMLRaw(ttsSpeakRange.toString().trim())
            : ttsFromRange
              ? view.tts?.from(ttsFromRange)
              : view.tts?.start();
        if (ssml) {
          const lang = parseSSMLLang(ssml, primaryLang) || 'en';
          setIsPlaying(true);
          emitPlaybackState('playing');
          setTtsLang(lang);

          ttsController.setLang(lang);
          ttsController.setRate(viewSettings.ttsRate);
          ttsController.speak(ssml, oneTime, () => handleStop(bookKey));
          ttsController.setTargetLang(getTTSTargetLang() || '');
        }
        setTtsClientsInitialized(true);
        setTTSEnabled(bookKey, true);
      } catch (error) {
        eventDispatcher.dispatch('toast', {
          message: _('TTS not supported for this document'),
          type: 'error',
        });
        console.error(error);
      }
    } finally {
      isStartingTTSRef.current = false;
    }
  };

  const handleTTSStop = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey } = event.detail;
    if (ttsControllerRef.current && bookKey === ttsBookKey) {
      handleStop(bookKey);
    }
  };

  // Sentence-snapped seek used by the lock-screen scrubber and the panel.
  const handleSeekTo = useCallback(async (seconds: number) => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;
    await ttsController.seekToTime(seconds);
  }, []);

  const handleGetPlaybackInfo = useCallback(() => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return null;
    // Kick the lazy timeline build (off the playback critical path); the
    // first polls return null until it lands and the UI shows a
    // disabled/reserved row for that state.
    void ttsController.ensureTimeline();
    return ttsController.getPlaybackInfo();
  }, []);

  const handleSupportsPlaybackInfo = useCallback(() => {
    return ttsControllerRef.current?.supportsPlaybackInfo() ?? false;
  }, []);

  // Playback callbacks
  const handleTogglePlay = useCallback(async () => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    if (isPlaying) {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    } else if (isPaused) {
      setIsPlaying(true);
      setIsPaused(false);
      emitPlaybackState('playing');
      // start for forward/backward/setvoice-paused
      // set rate don't pause the tts
      if (ttsController.state === 'paused') {
        await ttsController.resume();
      } else {
        await ttsController.start();
      }
    }
  }, [isPlaying, isPaused]);

  const handleBackward = useCallback(async (byMark = false) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.backward(byMark);
    }
  }, []);

  const handleForward = useCallback(async (byMark = false) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.forward(byMark);
    }
  }, []);

  const handlePause = useCallback(async () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      setIsPlaying(false);
      setIsPaused(true);
      emitPlaybackState('paused');
      await ttsController.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rate/voice/timeout/bar controls
  // rate range: 0.5 - 3, 1.0 is normal speed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSetRate = useCallback(
    throttle(async (rate: number) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        if (ttsController.state === 'playing') {
          await ttsController.stop();
          await ttsController.setRate(rate);
          await ttsController.start();
        } else {
          await ttsController.setRate(rate);
        }
      }
    }, 3000),
    [],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSetVoice = useCallback(
    throttle(async (voice: string, lang: string) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        if (ttsController.state === 'playing') {
          await ttsController.stop();
          await ttsController.setVoice(voice, lang);
          await ttsController.start();
        } else {
          await ttsController.setVoice(voice, lang);
        }
      }
    }, 3000),
    [],
  );

  const handleGetVoices = async (lang: string): Promise<TTSVoicesGroup[]> => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      return ttsController.getVoices(lang);
    }
    return [];
  };

  const handleGetVoiceId = () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      return ttsController.getVoiceId();
    }
    return '';
  };

  const handleSelectTimeout = (bookKey: string, value: number) => {
    setTimeoutOption(value);
    if (timeoutFunc) {
      clearTimeout(timeoutFunc);
    }
    if (value > 0) {
      setTimeoutFunc(
        setTimeout(() => {
          handleStop(bookKey);
        }, value * 1000),
      );
      setTimeoutTimestamp(Date.now() + value * 1000);
    } else {
      setTimeoutTimestamp(0);
    }
  };

  const handleToggleTTSBar = () => {
    const viewSettings = getViewSettings(bookKey)!;
    viewSettings.showTTSBar = !viewSettings.showTTSBar;
    setShowTTSBar(viewSettings.showTTSBar);
    if (viewSettings.showTTSBar) {
      onRequestHidePanel?.();
    }
    setViewSettings(bookKey, viewSettings);
  };

  const refreshTtsLang = useCallback(() => {
    const speakingLang = ttsControllerRef.current?.getSpeakingLang();
    if (speakingLang) {
      setTtsLang(speakingLang);
    }
  }, []);

  return {
    isPlaying,
    isPaused,
    ttsLang,
    ttsClientsInited,
    isTTSActive: ttsController !== null,
    showIndicator,
    showTTSBar,
    showBackToCurrentTTSLocation,
    timeoutOption,
    timeoutTimestamp,
    chapterRemainingSec: ttsTime.chapterRemainingSec,
    bookRemainingSec: ttsTime.bookRemainingSec,
    finishAtTimestamp: ttsTime.finishAtTimestamp,
    handleTogglePlay,
    handleBackward,
    handleForward,
    handlePause,
    handleSetRate,
    handleSetVoice,
    handleGetVoices,
    handleGetVoiceId,
    handleSelectTimeout,
    handleToggleTTSBar,
    handleBackToCurrentTTSLocation,
    handleSeekTo,
    handleGetPlaybackInfo,
    handleSupportsPlaybackInfo,
    refreshTtsLang,
  };
};
