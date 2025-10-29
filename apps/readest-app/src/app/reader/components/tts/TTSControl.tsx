import clsx from 'clsx';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TTSController, SILENCE_DATA, TTSMark } from '@/services/tts';
import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';
import { getPopupPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/throttle';
import { CFI } from '@/libs/document';
import { Insets } from '@/types/misc';
import { Overlay } from '@/components/Overlay';
import { fetchImageAsBase64 } from '@/utils/image';
import { invokeUseBackgroundAudio } from '@/utils/bridge';
import { getLocale } from '@/utils/misc';
import Popup from '@/components/Popup';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';
import TTSBar from './TTSBar';

const POPUP_WIDTH = 282;
const POPUP_HEIGHT = 160;
const POPUP_PADDING = 10;

interface TTSControlProps {
  bookKey: string;
  gridInsets: Insets;
}

const TTSControl: React.FC<TTSControlProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { hoveredBookKey, getView, getProgress, getViewSettings } = useReaderStore();
  const { setViewSettings, setTTSEnabled } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showTTSBar, setShowTTSBar] = useState(() => !!viewSettings?.showTTSBar);
  const [panelPosition, setPanelPosition] = useState<Position>();
  const [trianglePosition, setTrianglePosition] = useState<Position>();

  const [timeoutOption, setTimeoutOption] = useState(0);
  const [timeoutTimestamp, setTimeoutTimestamp] = useState(0);
  const [timeoutFunc, setTimeoutFunc] = useState<ReturnType<typeof setTimeout> | null>(null);

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showIndicatorWithinTimeout, setShowIndicatorWithinTimeout] = useState(true);

  const popupPadding = useResponsiveSize(POPUP_PADDING);
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const popupWidth = Math.min(maxWidth, useResponsiveSize(POPUP_WIDTH));
  const popupHeight = useResponsiveSize(POPUP_HEIGHT);

  const iconRef = useRef<HTMLDivElement>(null);
  const unblockerAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsControllerRef = useRef<TTSController | null>(null);
  const mediaSessionRef = useRef<TauriMediaSession | MediaSession | null>(null);
  const [ttsController, setTtsController] = useState<TTSController | null>(null);
  const [ttsClientsInited, setTtsClientsInitialized] = useState(false);

  // this enables WebAudio to play even when the mute toggle switch is ON
  const unblockAudio = () => {
    if (unblockerAudioRef.current) return;
    unblockerAudioRef.current = document.createElement('audio');
    unblockerAudioRef.current.setAttribute('x-webkit-airplay', 'deny');
    unblockerAudioRef.current.addEventListener('play', () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
      }
    });
    unblockerAudioRef.current.preload = 'auto';
    unblockerAudioRef.current.loop = true;
    unblockerAudioRef.current.src = SILENCE_DATA;
    unblockerAudioRef.current.play();
  };

  const releaseUnblockAudio = () => {
    if (!unblockerAudioRef.current) return;
    try {
      unblockerAudioRef.current.pause();
      unblockerAudioRef.current.currentTime = 0;
      unblockerAudioRef.current.removeAttribute('src');
      unblockerAudioRef.current.src = '';
      unblockerAudioRef.current.load();
      unblockerAudioRef.current = null;
      console.log('Unblock audio released');
    } catch (err) {
      console.warn('Error releasing unblock audio:', err);
    }
  };

  const initMediaSession = async () => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    mediaSessionRef.current = mediaSession;

    if (mediaSession instanceof TauriMediaSession) {
      const bookData = getBookData(bookKey);
      const progress = getProgress(bookKey);
      if (!bookData || !bookData.book) return;
      const { title, author, coverImageUrl } = bookData.book;
      const { sectionLabel } = progress || {};

      let artworkImage = '/icon.png';
      try {
        artworkImage = await fetchImageAsBase64(coverImageUrl || '/icon.png');
      } catch {
        artworkImage = await fetchImageAsBase64('/icon.png');
      }

      await mediaSession.setActive({
        active: true,
        keepAppInForeground: settings.alwaysInForeground,
        notificationTitle: _('Read Aloud'),
        notificationText: _('Ready to read aloud'),
        foregroundServiceTitle: _('Read Aloud'),
        foregroundServiceText: _('Ready to read aloud'),
      });
      mediaSession.updateMetadata({
        title: title,
        artist: sectionLabel || title,
        album: author,
        artwork: artworkImage,
      });
    }
  };

  const deinitMediaSession = async () => {
    if (mediaSessionRef.current && mediaSessionRef.current instanceof TauriMediaSession) {
      await mediaSessionRef.current.setActive({
        active: false,
        keepAppInForeground: settings.alwaysInForeground,
      });
    }
    mediaSessionRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (ttsControllerRef.current) {
        ttsControllerRef.current.shutdown();
        ttsControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ttsController || !bookKey) return;
    const bookData = getBookData(bookKey);
    if (!bookData || !bookData.book) return;
    const { title, author, coverImageUrl } = bookData.book;

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
      const range = (e as CustomEvent<Range>).detail;
      const view = getView(bookKey);
      const progress = getProgress(bookKey);
      const viewSettings = getViewSettings(bookKey);
      if (!range || !view || !progress || !viewSettings) return;

      const { location } = progress;
      const { index } = view.resolveCFI(location);
      const cfi = view?.getCFI(index, range);
      if (cfi) {
        viewSettings.ttsLocation = cfi || '';
        setViewSettings(bookKey, viewSettings);
      }

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

    ttsController.addEventListener('tts-speak-mark', handleSpeakMark);
    ttsController.addEventListener('tts-highlight-mark', handleHighlightMark);
    return () => {
      ttsController.removeEventListener('tts-speak-mark', handleSpeakMark);
      ttsController.removeEventListener('tts-highlight-mark', handleHighlightMark);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsController, bookKey]);

  const getTTSTargetLang = useCallback((): string | null => {
    const ttsReadAloudText = viewSettings?.ttsReadAloudText;
    if (viewSettings?.translationEnabled && ttsReadAloudText === 'translated') {
      return viewSettings?.translateTargetLang || getLocale();
    } else if (viewSettings?.translationEnabled && ttsReadAloudText === 'source') {
      const bookData = getBookData(bookKey);
      return bookData?.book?.primaryLanguage || '';
    }
    return null;
  }, [
    bookKey,
    getBookData,
    viewSettings?.translationEnabled,
    viewSettings?.ttsReadAloudText,
    viewSettings?.translateTargetLang,
  ]);

  useEffect(() => {
    ttsControllerRef.current?.setTargetLang(getTTSTargetLang() || '');
  }, [getTTSTargetLang]);

  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey: ttsBookKey, range } = event.detail;
    if (bookKey !== ttsBookKey) return;

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

    let ttsFromRange = range;
    if (!ttsFromRange && viewSettings.ttsLocation) {
      const { location } = progress;
      const ttsCfi = viewSettings.ttsLocation;
      const start = CFI.collapse(location);
      const end = CFI.collapse(location, true);
      if (CFI.compare(start, ttsCfi) * CFI.compare(end, ttsCfi) <= 0) {
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
      const ttsController = new TTSController(appService, view);
      await ttsController.init();
      await ttsController.initViewTTS(viewSettings.ttsHighlightOptions);
      const ssml = view.tts?.from(ttsFromRange);
      if (ssml) {
        const lang = parseSSMLLang(ssml, primaryLang) || 'en';
        setIsPlaying(true);
        setTtsLang(lang);

        ttsController.setLang(lang);
        ttsController.setRate(viewSettings.ttsRate);
        ttsController.speak(ssml);
        ttsController.setTargetLang(getTTSTargetLang() || '');
        ttsControllerRef.current = ttsController;
        setTtsController(ttsController);
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
      await ttsController.pause();
    }
  }, []);

  const handleStop = useCallback(
    async (bookKey: string) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        await ttsController.shutdown();
        ttsControllerRef.current = null;
        setTtsController(null);
        getView(bookKey)?.deselect();
        setIsPlaying(false);
        setShowPanel(false);
        setShowIndicator(false);
      }
      if (appService?.isIOSApp) {
        await invokeUseBackgroundAudio({ enabled: false });
      }
      if (appService?.isMobile) {
        releaseUnblockAudio();
      }
      await deinitMediaSession();
      setTTSEnabled(bookKey, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService],
  );

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

  const handleGetVoices = async (lang: string) => {
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
      setShowPanel(false);
    }
    setViewSettings(bookKey, viewSettings);
  };

  const updatePanelPosition = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const parentRect =
        iconRef.current.parentElement?.getBoundingClientRect() ||
        document.documentElement.getBoundingClientRect();

      const trianglePos = {
        dir: 'up',
        point: { x: rect.left + rect.width / 2 - parentRect.left, y: rect.top - 12 },
      } as Position;

      const popupPos = getPopupPosition(
        trianglePos,
        parentRect,
        popupWidth,
        popupHeight,
        popupPadding,
      );

      setPanelPosition(popupPos);
      setTrianglePosition(trianglePos);
    }
  };

  const togglePopup = () => {
    updatePanelPosition();
    if (!showPanel && ttsControllerRef.current) {
      const speakingLang = ttsControllerRef.current.getSpeakingLang() || ttsLang;
      setTtsLang(speakingLang);
    }
    setShowPanel((prev) => !prev);
  };

  const handleDismissPopup = () => {
    setShowPanel(false);
  };

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
  }, [handleTogglePlay, handlePause, handleForward, handleBackward]);

  useEffect(() => {
    if (!iconRef.current || !showPanel) return;
    const parentElement = iconRef.current.parentElement;
    if (!parentElement) return;

    const resizeObserver = new ResizeObserver(() => {
      updatePanelPosition();
    });
    resizeObserver.observe(parentElement);
    return () => {
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPanel]);

  useEffect(() => {
    if (hoveredBookKey) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const showTimeout = setTimeout(() => {
        setShowIndicatorWithinTimeout(true);
      }, 100);
      hoverTimeoutRef.current = showTimeout;
    } else {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const hideTimeout = setTimeout(() => {
        setShowIndicatorWithinTimeout(false);
      }, 5000);
      hoverTimeoutRef.current = hideTimeout;
    }

    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [hoveredBookKey]);

  useEffect(() => {
    const ttsHighlightOptions = viewSettings?.ttsHighlightOptions;
    if (ttsControllerRef.current && ttsHighlightOptions) {
      ttsControllerRef.current.initViewTTS(ttsHighlightOptions);
    }
  }, [viewSettings?.ttsHighlightOptions]);

  return (
    <>
      {showPanel && <Overlay onDismiss={handleDismissPopup} />}
      {(showPanel || (showIndicator && showIndicatorWithinTimeout)) && (
        <div
          ref={iconRef}
          className={clsx(
            'absolute h-12 w-12',
            'transition-transform duration-300',
            viewSettings?.rtl ? 'left-8' : 'right-6',
            !appService?.hasSafeAreaInset && 'bottom-[70px] sm:bottom-14',
          )}
          style={{
            bottom: appService?.hasSafeAreaInset
              ? `${(safeAreaInsets?.bottom || 0) * 0.33 + (hoveredBookKey ? 70 : 52)}px`
              : undefined,
          }}
        >
          <TTSIcon isPlaying={isPlaying} ttsInited={ttsClientsInited} onClick={togglePopup} />
        </div>
      )}
      {showPanel && panelPosition && trianglePosition && ttsClientsInited && (
        <Popup
          width={popupWidth}
          height={popupHeight}
          position={panelPosition}
          trianglePosition={trianglePosition}
          className='bg-base-200 flex shadow-lg'
        >
          <TTSPanel
            bookKey={bookKey}
            ttsLang={ttsLang}
            isPlaying={isPlaying}
            timeoutOption={timeoutOption}
            timeoutTimestamp={timeoutTimestamp}
            onTogglePlay={handleTogglePlay}
            onBackward={handleBackward}
            onForward={handleForward}
            onSetRate={handleSetRate}
            onGetVoices={handleGetVoices}
            onSetVoice={handleSetVoice}
            onGetVoiceId={handleGetVoiceId}
            onSelectTimeout={handleSelectTimeout}
            onToogleTTSBar={handleToggleTTSBar}
          />
        </Popup>
      )}
      {showIndicator && showTTSBar && ttsClientsInited && (
        <TTSBar
          bookKey={bookKey}
          isPlaying={isPlaying}
          onBackward={handleBackward}
          onTogglePlay={handleTogglePlay}
          onForward={handleForward}
          gridInsets={gridInsets}
        />
      )}
    </>
  );
};

export default TTSControl;
