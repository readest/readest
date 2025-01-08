import React, { useState, useRef, useEffect } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { TTSController } from '@/services/tts/TTSController';
import { WebSpeechClient } from '@/services/tts';
import { getPopupPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { parseSSMLLang } from '@/utils/ssml';
import Popup from '@/components/Popup';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';

const POPUP_WIDTH = 260;
const POPUP_HEIGHT = 160;
const POPUP_PADDING = 10;

const TTSControl = () => {
  const _ = useTranslation();
  const { getView } = useReaderStore();
  const [isPlaying, setIsPlaying] = useState(false);
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
    eventDispatcher.on('speak', handleSpeak);
    return () => {
      eventDispatcher.off('speak', handleSpeak);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSpeak = async (event: CustomEvent) => {
    const { bookKey, ssml } = event.detail;
    const view = getView(bookKey);
    if (!view) return;

    try {
      const lang = parseSSMLLang(ssml) || 'en';
      const ttsClient = new WebSpeechClient();
      const ttsController = new TTSController(ttsClient, view, lang);
      ttsControllerRef.current = ttsController;
      ttsControllerRef.current.speak(ssml);
      setIsPlaying(true);
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        message: _('TTS not supported in this device'),
        type: 'error',
      });
      console.error(error);
    }
  };

  const handleTogglePlay = async () => {
    const ttsController = ttsControllerRef.current;
    if (!ttsController) return;

    if (isPlaying) {
      ttsController.pause();
      setIsPlaying(false);
    } else {
      ttsController.start();
      setIsPlaying(true);
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
      ttsController.stop();
      ttsControllerRef.current = null;
      setIsPlaying(false);
      setShowPanel(false);
    }
  };

  // rate range: 0.5 - 3, 1.0 is normal speed
  const handleSetRate = async (rate: number) => {
    const ttsController = ttsControllerRef.current;
    if (ttsController) {
      await ttsController.setRate(rate);
    }
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

  return (
    <div>
      {ttsControllerRef.current && (
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
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onBackward={handleBackward}
            onForward={handleForward}
            onStop={handleStop}
            onSetRate={handleSetRate}
          />
        </Popup>
      )}
    </div>
  );
};

export default TTSControl;
