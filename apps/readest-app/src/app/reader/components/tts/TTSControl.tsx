import clsx from 'clsx';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { TTSController, SILENCE_DATA } from '@/services/tts';
import { getPopupPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { parseSSMLLang } from '@/utils/ssml';
import { getOSPlatform } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
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
  const { getView, getViewSettings } = useReaderStore();
  const [bookKey, setBookKey] = useState<string>('');
  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [panelPosition, setPanelPosition] = useState<Position>();
  const [trianglePosition, setTrianglePosition] = useState<Position>();

  const popupWidth = useResponsiveSize(POPUP_WIDTH);
  const popupHeight = useResponsiveSize(POPUP_HEIGHT);
  const popupPadding = useResponsiveSize(POPUP_PADDING);

  const iconRef = useRef<HTMLDivElement>(null);
  const ttsControllerRef = useRef<TTSController | null>(null);

  // this enables WebAudio to play even when the mute toggle switch is ON
  const unblockAudio = () => {
    const audio = document.createElement('audio');
    audio.setAttribute('x-webkit-airplay', 'deny');
    audio.preload = 'auto';
    audio.loop = true;
    audio.src = SILENCE_DATA;
    audio.play();
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

  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey, range } = event.detail;
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    const bookData = getBookData(bookKey);
    if (!view || !viewSettings || !bookData) return;
    if (bookData.book?.format === 'PDF') {
      eventDispatcher.dispatch('toast', {
        message: _('TTS not supported for PDF'),
        type: 'warning',
      });
      return;
    }

    setBookKey(bookKey);

    if (ttsControllerRef.current) {
      ttsControllerRef.current.stop();
      ttsControllerRef.current = null;
    }
    setShowIndicator(true);

    try {
      if (getOSPlatform() === 'ios' || appService?.isIOSApp) {
        unblockAudio();
      }
      const ttsController = new TTSController(view);
      await ttsController.init();
      await ttsController.initViewTTS();
      const ssml = view.tts?.from(range);
      if (ssml) {
        const lang = parseSSMLLang(ssml) || 'en';
        setTtsLang(lang);
        setIsPlaying(true);

        ttsController.setLang(lang);
        ttsController.setRate(viewSettings.ttsRate);
        ttsController.setVoice(viewSettings.ttsVoice);
        ttsController.speak(ssml);
        ttsControllerRef.current = ttsController;
      }
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        message: _('TTS not supported in this device'),
        type: 'error',
      });
      console.error(error);
    }
  };

  const handleTTSStop = async (event: CustomEvent) => {
    const { bookKey: stopBookKey } = event.detail;
    if (bookKey === stopBookKey) {
      handleStop();
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

  const handleStop = async () => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.stop();
      ttsControllerRef.current = null;
      getView(bookKey)?.deselect();
      setIsPlaying(false);
      setShowPanel(false);
      setShowIndicator(false);
    }
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
    throttle(async (voice: string) => {
      const ttsController = ttsControllerRef.current;
      if (ttsController) {
        if (ttsController.state === 'playing') {
          await ttsController.stop();
          await ttsController.setVoice(voice);
          await ttsController.start();
        } else {
          await ttsController.setVoice(voice);
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

  const updatePanelPosition = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const windowRect = document.documentElement.getBoundingClientRect();

      const trianglePos = {
        dir: 'up',
        point: { x: rect.left + rect.width / 2, y: rect.top - 12 },
      } as Position;

      const popupPos = getPopupPosition(
        trianglePos,
        windowRect,
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
    setShowPanel((prev) => !prev);
  };

  const handleDismissPopup = () => {
    setShowPanel(false);
  };

  return (
    <div>
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
            'fixed right-6 h-12 w-12',
            appService?.hasSafeAreaInset
              ? 'bottom-[calc(env(safe-area-inset-bottom)+70px)]'
              : 'bottom-[70px] sm:bottom-14',
          )}
        >
          <TTSIcon isPlaying={isPlaying} onClick={togglePopup} />
        </div>
      )}
      {showPanel && panelPosition && trianglePosition && (
        <Popup
          width={popupWidth}
          height={popupHeight}
          position={panelPosition}
          trianglePosition={trianglePosition}
          className='bg-base-200 absolute flex shadow-lg'
        >
          <TTSPanel
            bookKey={bookKey}
            ttsLang={ttsLang}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onBackward={handleBackward}
            onForward={handleForward}
            onStop={handleStop}
            onSetRate={handleSetRate}
            onGetVoices={handleGetVoices}
            onSetVoice={handleSetVoice}
            onGetVoiceId={handleGetVoiceId}
          />
        </Popup>
      )}
    </div>
  );
};

export default TTSControl;
