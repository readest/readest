import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { TTSController } from '@/services/tts/TTSController';
import { getPopupPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { parseSSMLLang } from '@/utils/ssml';
import { throttle } from '@/utils/ui';
import Popup from '@/components/Popup';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';

const POPUP_WIDTH = 282;
const POPUP_HEIGHT = 160;
const POPUP_PADDING = 10;

const TTSControl = () => {
  const _ = useTranslation();
  const { getView, getViewSettings } = useReaderStore();
  const [bookKey, setBookKey] = useState<string>('');
  const [ttsLang, setTtsLang] = useState<string>('en');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [panelPosition, setPanelPosition] = useState<Position>();
  const [trianglePosition, setTrianglePosition] = useState<Position>();

  const iconRef = useRef<HTMLDivElement>(null);
  const ttsControllerRef = useRef<TTSController | null>(null);

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
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTTSSpeak = async (event: CustomEvent) => {
    const { bookKey, range } = event.detail;
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    if (!view || !viewSettings) return;

    setBookKey(bookKey);

    if (ttsControllerRef.current) {
      ttsControllerRef.current.stop();
      ttsControllerRef.current = null;
    }
    setShowIndicator(true);

    try {
      const ttsController = new TTSController(view);
      await ttsController.init();
      await ttsController.initViewTTS();
      const ssml = view.tts?.from(range);
      if (ssml) {
        ttsController.setRate(viewSettings.ttsRate);
        ttsController.setVoice(viewSettings.ttsVoice);
        ttsController.speak(ssml);
        ttsControllerRef.current = ttsController;

        const lang = parseSSMLLang(ssml) || 'en';
        setTtsLang(lang);
        setIsPlaying(true);
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
    const { bookKey } = event.detail;
    if (bookKey === bookKey) {
      handleStop();
    }
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
    }, 2000),
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
    }, 2000),
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
        POPUP_WIDTH,
        POPUP_HEIGHT,
        POPUP_PADDING,
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
        <div ref={iconRef} className='absolute bottom-12 right-6 h-12 w-12'>
          <TTSIcon isPlaying={isPlaying} onClick={togglePopup} />
        </div>
      )}
      {showPanel && panelPosition && trianglePosition && (
        <Popup
          width={POPUP_WIDTH}
          height={POPUP_HEIGHT}
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
