import clsx from 'clsx';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TTSController, SILENCE_DATA, TTSMark } from '@/services/tts';
import { getPopupPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/throttle';
import { invokeUseBackgroundAudio } from '@/utils/bridge';
import { CFI } from '@/libs/document';
import Popup from '@/components/Popup';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';

const POPUP_WIDTH = 282;
const POPUP_HEIGHT = 160;
const POPUP_PADDING = 10;

const TTSControl = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getProgress, getViewSettings } = useReaderStore();
  const { setViewSettings, setTTSEnabled } = useReaderStore();
  const [bookKey, setBookKey] = useState<string>('');
  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [panelPosition, setPanelPosition] = useState<Position>();
  const [trianglePosition, setTrianglePosition] = useState<Position>();

  const [timeoutOption, setTimeoutOption] = useState(0);
  const [timeoutTimestamp, setTimeoutTimestamp] = useState(0);
  const [timeoutFunc, setTimeoutFunc] = useState<ReturnType<typeof setTimeout> | null>(null);

  const viewSettings = getViewSettings(bookKey);
  const popupPadding = useResponsiveSize(POPUP_PADDING);
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const popupWidth = Math.min(maxWidth, useResponsiveSize(POPUP_WIDTH));
  const popupHeight = useResponsiveSize(POPUP_HEIGHT);

  const iconRef = useRef<HTMLDivElement>(null);
  const unblockerAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsControllerRef = useRef<TTSController | null>(null);
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
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('stop', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
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

  useEffect(() => {
    return () => {
      if (ttsControllerRef.current) {
        ttsControllerRef.current.kill();
        ttsControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    eventDispatcher.onSync('tts-is-speaking', handleQueryIsSpeaking);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
      eventDispatcher.offSync('tts-is-speaking', handleQueryIsSpeaking);
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
      if (appService?.isMobileApp && 'mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: mark.text,
          artist: sectionLabel || title,
          album: author,
          artwork: [{ src: coverImageUrl || '/icon.png', sizes: '512x512', type: 'image/png' }],
        });
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
    };

    ttsController.addEventListener('tts-speak-mark', handleSpeakMark);
    ttsController.addEventListener('tts-highlight-mark', handleHighlightMark);
    return () => {
      ttsController.removeEventListener('tts-speak-mark', handleSpeakMark);
      ttsController.removeEventListener('tts-highlight-mark', handleHighlightMark);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsController, bookKey]);

  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey, range } = event.detail;
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

    let ttsFromRange = range || progress.range;
    if (viewSettings.ttsLocation) {
      const { location } = progress;
      const ttsCfi = viewSettings.ttsLocation;
      const start = CFI.collapse(location);
      const end = CFI.collapse(location, true);
      if (CFI.compare(start, ttsCfi) * CFI.compare(end, ttsCfi) <= 0) {
        const { index, anchor } = view.resolveCFI(ttsCfi);
        const { doc } = view.renderer.getContents().find((x) => (x.index = index)) || {};
        if (doc) {
          ttsFromRange = anchor(doc) || ttsFromRange;
        }
      }
    }

    const primaryLang = bookData.book.primaryLanguage;
    setBookKey(bookKey);

    if (ttsControllerRef.current) {
      ttsControllerRef.current.stop();
      ttsControllerRef.current = null;
    }

    setTTSEnabled(bookKey, true);
    setShowIndicator(true);

    try {
      if (appService?.isIOSApp) {
        await invokeUseBackgroundAudio({ enabled: true });
      }
      if (appService?.isMobile) {
        unblockAudio();
      }
      setTtsClientsInitialized(false);
      const ttsController = new TTSController(view);
      await ttsController.init();
      await ttsController.initViewTTS();
      const ssml = view.tts?.from(ttsFromRange);
      if (ssml) {
        let lang = parseSSMLLang(ssml) || 'en';
        // We will not trust 'en' language from ssml, as it may be a fallback or hardcoded value
        if (lang === 'en' && primaryLang && primaryLang !== 'en') {
          lang = primaryLang.split('-')[0]!;
        }
        setIsPlaying(true);
        setTtsLang(lang);

        ttsController.setLang(lang);
        ttsController.setRate(viewSettings.ttsRate);
        ttsController.speak(ssml);
        ttsControllerRef.current = ttsController;
        setTtsController(ttsController);
      }
      setTtsClientsInitialized(true);
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        message: _('TTS not supported in this device'),
        type: 'error',
      });
      console.error(error);
    }
  };

  const handleTTSStop = async (event: CustomEvent) => {
    const { bookKey } = event.detail;
    if (ttsControllerRef.current) {
      handleStop(bookKey);
    }
  };

  const handleQueryIsSpeaking = () => {
    return !!ttsControllerRef.current;
  };

  const handleTogglePlay = async () => {
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
  };

  const handleBackward = async () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.backward();
    }
  };

  const handleForward = async () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.forward();
    }
  };

  const handleStop = async (bookKey: string) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.stop();
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
    setTTSEnabled(bookKey, false);
  };

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

  return (
    <>
      {showPanel && (
        <div
          className='fixed inset-0'
          onClick={handleDismissPopup}
          onContextMenu={handleDismissPopup}
        />
      )}
      {showIndicator && (
        <div
          ref={iconRef}
          className={clsx(
            'absolute h-12 w-12',
            viewSettings?.rtl ? 'left-6' : 'right-6',
            appService?.hasSafeAreaInset
              ? 'bottom-[calc(env(safe-area-inset-bottom)+70px)]'
              : 'bottom-[70px] sm:bottom-14',
          )}
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
          />
        </Popup>
      )}
    </>
  );
};

export default TTSControl;
