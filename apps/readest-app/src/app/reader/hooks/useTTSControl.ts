import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { TransformContext } from '@/services/transformers/types';
import { proofreadTransformer } from '@/services/transformers/proofread';
import { useTranslation } from '@/hooks/useTranslation';
import { TTSController, TTSMark, TTSHighlightOptions, TTSVoicesGroup } from '@/services/tts';
import { TauriMediaSession } from '@/libs/mediaSession';
import { eventDispatcher } from '@/utils/event';
import { genSSMLRaw, parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/throttle';
import { isCfiInLocation } from '@/utils/cfi';
import { getLocale } from '@/utils/misc';
import { invokeUseBackgroundAudio } from '@/utils/bridge';
import { estimateTTSTime } from '@/utils/ttsTime';
import { useTTSMediaSession } from './useTTSMediaSession';

interface UseTTSControlProps {
  bookKey: string;
  onRequestHidePanel?: () => void;
}

export const useTTSControl = ({ bookKey, onRequestHidePanel }: UseTTSControlProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { isDarkMode } = useThemeStore();
  const { getBookData } = useBookDataStore();
  const { getView, getProgress, getViewSettings } = useReaderStore();
  const { setViewSettings, setTTSEnabled } = useReaderStore();
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
  const ttsControllerRef = useRef<TTSController | null>(null);
  const [ttsController, setTtsController] = useState<TTSController | null>(null);
  const [ttsClientsInited, setTtsClientsInitialized] = useState(false);
  const ttsOnRef = useRef(false);

  const {
    mediaSessionRef,
    unblockAudio,
    releaseUnblockAudio,
    initMediaSession,
    deinitMediaSession,
  } = useTTSMediaSession({ bookKey });

  useEffect(() => {
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
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
    const bookData = getBookData(bookKey);
    if (!bookData || !bookData.book) return;
    const { title, author, coverImageUrl } = bookData.book;

    const handleNeedAuth = () => {
      eventDispatcher.dispatch('toast', {
        message: _('Please log in to use advanced TTS features'),
        type: 'error',
        timeout: 5000,
      });
    };

    const handleSpeakMark = (e: Event) => {
      const progress = getProgress(bookKey);
      const { sectionLabel } = progress || {};
      const mark = (e as CustomEvent<TTSMark>).detail;

      if (mediaSessionRef.current) {
        const mediaSession = mediaSessionRef.current;
        if (mediaSession instanceof TauriMediaSession) {
          mediaSession.updateMetadata({
            title: mark?.text || '',
            artist: sectionLabel || title,
            album: author,
            artwork: '',
          });
        } else {
          mediaSession.metadata = new MediaMetadata({
            title: mark?.text || '',
            artist: sectionLabel || title,
            album: author,
            artwork: [{ src: coverImageUrl || '/icon.png', sizes: '512x512', type: 'image/png' }],
          });
        }
      }
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

      if (!followingTTSLocationRef.current) return;

      const docs = view.renderer.getContents();
      if (docs.some(({ doc }) => (doc.getSelection()?.toString().length ?? 0) > 0)) {
        return;
      }

      const { doc, index: viewSectionIndex } = view.renderer.getContents()[0] as {
        doc: Document;
        index?: number;
      };

      const { anchor, index: ttsSectionIndex } = view.resolveCFI(cfi);
      if (viewSectionIndex !== ttsSectionIndex) {
        return;
      }

      const range = anchor(doc);
      if (!view.renderer.scrolled) {
        view.renderer.scrollToAnchor(range);
      } else {
        const rect = range.getBoundingClientRect();
        const { start, size, viewSize, sideProp } = view.renderer;
        const positionStart = rect[sideProp === 'height' ? 'y' : 'x'] + viewSettings.marginTopPx;
        const positionEnd = rect[sideProp === 'height' ? 'height' : 'width'] + positionStart;
        const offsetStart = view.book.dir === 'rtl' ? viewSize - positionStart : positionStart;
        const offsetEnd = view.book.dir === 'rtl' ? viewSize - positionEnd : positionEnd;

        const showHeader = viewSettings.showHeader;
        const showFooter = viewSettings.showFooter;
        const showBarsOnScroll = viewSettings.showBarsOnScroll;
        const headerScrollOverlap = showHeader && showBarsOnScroll ? 44 : 0;
        const footerScrollOverlap = showFooter && showBarsOnScroll ? 44 : 0;
        const scrollingOverlap = viewSettings.scrollingOverlap;
        const endInNextView = offsetEnd > start + size - footerScrollOverlap - scrollingOverlap;
        const startInPrevView = offsetStart < start + headerScrollOverlap + scrollingOverlap;
        if (endInNextView || startInPrevView) {
          const scrollTo = offsetStart - headerScrollOverlap - scrollingOverlap;
          view.renderer.scrollToAnchor(scrollTo / viewSize);
        }
      }
    };

    ttsController.addEventListener('tts-need-auth', handleNeedAuth);
    ttsController.addEventListener('tts-speak-mark', handleSpeakMark);
    ttsController.addEventListener('tts-highlight-mark', handleHighlightMark);
    return () => {
      ttsController.removeEventListener('tts-need-auth', handleNeedAuth);
      ttsController.removeEventListener('tts-speak-mark', handleSpeakMark);
      ttsController.removeEventListener('tts-highlight-mark', handleHighlightMark);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsController, bookKey]);

  // Location tracking — re-highlight when progress changes
  const progress = getProgress(bookKey);
  useEffect(() => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    const ttsLocation = viewSettings?.ttsLocation;
    const { location } = progress || {};
    if (!location || !ttsLocation) return;

    const ttsInCurrentLocation = isCfiInLocation(ttsLocation, location);
    if (ttsInCurrentLocation) {
      setShowBackToCurrentTTSLocation(false);
      const range = view?.tts?.getLastRange() as Range | null;
      if (range) {
        view?.tts?.highlight(range);
      }
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
      const bookData = getBookData(bookKey);
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
      view.renderer.goTo?.(resolved);
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
      ttsControllerRef.current.initViewTTS(
        getTTSHighlightOptions(ttsHighlightOptions, viewSettings!.isEink),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings?.ttsHighlightOptions, viewSettings?.isEink, getTTSHighlightOptions]);

  // handleStop (defined before handleTTSSpeak/handleTTSStop which reference it)
  const handleStop = useCallback(
    async (bookKey: string) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        await ttsController.shutdown();
        ttsControllerRef.current = null;
        setTtsController(null);
        getView(bookKey)?.deselect();
        setIsPlaying(false);
        onRequestHidePanel?.();
        setShowIndicator(false);
        setShowBackToCurrentTTSLocation(false);
      }
      if (appService?.isIOSApp) {
        await invokeUseBackgroundAudio({ enabled: false });
      }
      if (appService?.isMobile) {
        releaseUnblockAudio();
      }
      await deinitMediaSession();
      setTTSEnabled(bookKey, false);
      ttsOnRef.current = false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

  // handleTTSSpeak / handleTTSStop (plain functions, registered once at mount via closure)
  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey, range, oneTime = false } = event.detail;
    if (bookKey !== ttsBookKey) return;
    if (ttsOnRef.current) return;
    ttsOnRef.current = true;

    const view = getView(bookKey);
    const progress = getProgress(bookKey);
    const viewSettings = getViewSettings(bookKey);
    const bookData = getBookData(bookKey);
    if (!view || !progress || !viewSettings || !bookData || !bookData.book) return;
    if (bookData.book?.format === 'PDF') {
      eventDispatcher.dispatch('toast', {
        message: _('TTS not supported for PDF'),
        type: 'warning',
      });
      return;
    }

    const ttsSpeakRange = range as Range | null;
    let ttsFromRange = ttsSpeakRange;
    if (!ttsFromRange && viewSettings.ttsLocation) {
      const { location } = progress;
      const ttsCfi = viewSettings.ttsLocation;
      if (isCfiInLocation(ttsCfi, location)) {
        const { index, anchor } = view.resolveCFI(ttsCfi);
        const { doc } = view.renderer.getContents().find((x) => x.index === index) || {};
        if (doc) {
          ttsFromRange = anchor(doc);
        }
      }
    }
    if (!ttsFromRange) {
      ttsFromRange = progress.range;
    }

    const currentSection = view.renderer.getContents()[0];
    if (ttsFromRange && currentSection) {
      const ttsLocation = view.getCFI(currentSection?.index || 0, ttsFromRange);
      viewSettings.ttsLocation = ttsLocation;
      setViewSettings(bookKey, viewSettings);
    }

    const primaryLang = bookData.book.primaryLanguage;

    if (ttsControllerRef.current) {
      ttsControllerRef.current.stop();
      ttsControllerRef.current = null;
    }

    try {
      if (appService?.isIOSApp) {
        await invokeUseBackgroundAudio({ enabled: true });
      }
      if (appService?.isMobile) {
        unblockAudio();
      }
      await initMediaSession();
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

      await ttsController.init();
      await ttsController.initViewTTS(
        getTTSHighlightOptions(viewSettings.ttsHighlightOptions, viewSettings.isEink),
      );
      const ssml =
        oneTime && ttsSpeakRange
          ? genSSMLRaw(ttsSpeakRange.toString().trim())
          : view.tts?.from(ttsFromRange);
      if (ssml) {
        const lang = parseSSMLLang(ssml, primaryLang) || 'en';
        setIsPlaying(true);
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
  };

  const handleTTSStop = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey } = event.detail;
    if (ttsControllerRef.current && bookKey === ttsBookKey) {
      handleStop(bookKey);
    }
  };

  // Playback callbacks
  const handleTogglePlay = useCallback(async () => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    if (isPlaying) {
      setIsPlaying(false);
      setIsPaused(true);
      await ttsController.pause();
    } else if (isPaused) {
      setIsPlaying(true);
      setIsPaused(false);
      // start for forward/backward/setvoice-paused
      // set rate don't pause the tts
      if (ttsController.state === 'paused') {
        await ttsController.resume();
      } else {
        await ttsController.start();
      }
    }

    if (mediaSessionRef.current) {
      const mediaSession = mediaSessionRef.current;
      if (mediaSession instanceof TauriMediaSession) {
        await mediaSession.updatePlaybackState({ playing: !isPlaying });
      } else {
        mediaSession.playbackState = isPlaying ? 'paused' : 'playing';
      }
    }
  }, [isPlaying, isPaused, mediaSessionRef]);

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
      await ttsController.pause();
    }
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

  // Media session action handler effect
  useEffect(() => {
    const { current: mediaSession } = mediaSessionRef;
    if (mediaSession) {
      mediaSession.setActionHandler('play', () => {
        handleTogglePlay();
      });

      mediaSession.setActionHandler('pause', () => {
        handleTogglePlay();
      });

      mediaSession.setActionHandler('stop', () => {
        handlePause();
      });

      mediaSession.setActionHandler('seekforward', () => {
        handleForward(true);
      });

      mediaSession.setActionHandler('seekbackward', () => {
        handleBackward(true);
      });

      mediaSession.setActionHandler('nexttrack', () => {
        handleForward();
      });

      mediaSession.setActionHandler('previoustrack', () => {
        handleBackward();
      });
    }
  }, [handleTogglePlay, handlePause, handleForward, handleBackward, mediaSessionRef]);

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
    refreshTtsLang,
  };
};
