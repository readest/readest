import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { getPopupPosition, Position } from '@/utils/sel';
import { Insets } from '@/types/misc';
import { Overlay } from '@/components/Overlay';
import Popup from '@/components/Popup';
import TTSPanel from './TTSPanel';
import TTSIcon from './TTSIcon';
import TTSBar from './TTSBar';

const POPUP_WIDTH = 282;
const POPUP_HEIGHT = 206;
const POPUP_PADDING = 10;

interface TTSControlProps {
  bookKey: string;
  gridInsets: Insets;
}

const TTSControl: React.FC<TTSControlProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { hoveredBookKey, getViewSettings } = useReaderStore();

  const viewSettings = getViewSettings(bookKey);

  const [showPanel, setShowPanel] = useState(false);
  const [panelPosition, setPanelPosition] = useState<Position>();
  const [trianglePosition, setTrianglePosition] = useState<Position>();

  const iconRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showIndicatorWithinTimeout, setShowIndicatorWithinTimeout] = useState(true);

  const [shouldMountBackButton, setShouldMountBackButton] = useState(false);
  const [isBackButtonVisible, setIsBackButtonVisible] = useState(false);

  const popupPadding = useResponsiveSize(POPUP_PADDING);
  const maxWidth = window.innerWidth - 2 * popupPadding;
  const popupWidth = Math.min(maxWidth, useResponsiveSize(POPUP_WIDTH));
  const popupHeight = useResponsiveSize(POPUP_HEIGHT);

  const tts = useTTSControl({
    bookKey,
    onRequestHidePanel: () => setShowPanel(false),
  });

  useEffect(() => {
    if (tts.showBackToCurrentTTSLocation) {
      setShouldMountBackButton(true);
      const fadeInTimeout = setTimeout(() => {
        setIsBackButtonVisible(true);
      }, 10);
      return () => clearTimeout(fadeInTimeout);
    } else {
      setIsBackButtonVisible(false);
      if (backButtonTimeoutRef.current) {
        clearTimeout(backButtonTimeoutRef.current);
      }
      backButtonTimeoutRef.current = setTimeout(() => {
        setShouldMountBackButton(false);
      }, 300);
      return;
    }
  }, [tts.showBackToCurrentTTSLocation]);

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
    if (tts.showTTSBar) {
      setShowPanel(false);
    }
  }, [tts.showTTSBar]);

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
    if (!showPanel && tts.isTTSActive) {
      tts.refreshTtsLang();
    }
    setShowPanel((prev) => !prev);
  };

  const handleDismissPopup = () => {
    setShowPanel(false);
  };

  return (
    <>
      {shouldMountBackButton && (
        <div
          className={clsx(
            'absolute left-1/2 top-0 z-50 -translate-x-1/2',
            'transition-opacity duration-300',
            isBackButtonVisible ? 'opacity-100' : 'opacity-0',
            safeAreaInsets?.top ? '' : 'py-1',
          )}
          style={{
            top: `${safeAreaInsets?.top || 0}px`,
          }}
        >
          <button
            onClick={tts.handleBackToCurrentTTSLocation}
            className={clsx(
              'not-eink:bg-base-300 eink-bordered rounded-full px-4 py-2 font-sans text-sm shadow-lg',
              safeAreaInsets?.top ? 'h-11' : 'h-9',
            )}
          >
            {_('Back to TTS Location')}
          </button>
        </div>
      )}
      {showPanel && <Overlay onDismiss={handleDismissPopup} />}
      {(showPanel || (tts.showIndicator && showIndicatorWithinTimeout)) && (
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
          <TTSIcon
            isPlaying={tts.isPlaying}
            ttsInited={tts.ttsClientsInited}
            onClick={togglePopup}
          />
        </div>
      )}
      {showPanel && panelPosition && trianglePosition && tts.ttsClientsInited && (
        <Popup
          width={popupWidth}
          height={popupHeight}
          position={panelPosition}
          trianglePosition={trianglePosition}
          className='bg-base-200 flex shadow-lg'
          onDismiss={handleDismissPopup}
        >
          <TTSPanel
            bookKey={bookKey}
            ttsLang={tts.ttsLang}
            isPlaying={tts.isPlaying}
            timeoutOption={tts.timeoutOption}
            timeoutTimestamp={tts.timeoutTimestamp}
            chapterRemainingSec={tts.chapterRemainingSec}
            bookRemainingSec={tts.bookRemainingSec}
            finishAtTimestamp={tts.finishAtTimestamp}
            onTogglePlay={tts.handleTogglePlay}
            onBackward={tts.handleBackward}
            onForward={tts.handleForward}
            onSetRate={tts.handleSetRate}
            onGetVoices={tts.handleGetVoices}
            onSetVoice={tts.handleSetVoice}
            onGetVoiceId={tts.handleGetVoiceId}
            onSelectTimeout={tts.handleSelectTimeout}
            onToogleTTSBar={tts.handleToggleTTSBar}
          />
        </Popup>
      )}
      {tts.showIndicator && tts.showTTSBar && tts.ttsClientsInited && (
        <TTSBar
          bookKey={bookKey}
          isPlaying={tts.isPlaying}
          bookRemainingSec={tts.bookRemainingSec}
          onBackward={tts.handleBackward}
          onTogglePlay={tts.handleTogglePlay}
          onForward={tts.handleForward}
          gridInsets={gridInsets}
        />
      )}
    </>
  );
};

export default TTSControl;
