import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { Insets } from '@/types/misc';
import { eventDispatcher } from '@/utils/event';
import TTSMiniPlayer from './TTSMiniPlayer';
import TTSPlayerSheet from './TTSPlayerSheet';

interface TTSControlProps {
  bookKey: string;
  gridInsets: Insets;
}

const TTSControl: React.FC<TTSControlProps> = ({ bookKey, gridInsets }) => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const { getViewSettings } = useReaderStore();

  const [showPlayerSheet, setShowPlayerSheet] = useState(false);
  const backButtonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shouldMountBackButton, setShouldMountBackButton] = useState(false);
  const [isBackButtonVisible, setIsBackButtonVisible] = useState(false);

  const tts = useTTSControl({
    bookKey,
    onRequestHidePanel: () => setShowPlayerSheet(false),
  });

  const isEink = getViewSettings(bookKey)?.isEink ?? false;
  const hasTimeline = tts.ttsClientsInited && tts.handleSupportsPlaybackInfo();

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

  const handleExpand = () => {
    tts.refreshTtsLang();
    setShowPlayerSheet(true);
  };

  const handleStop = () => {
    eventDispatcher.dispatch('tts-stop', { bookKey });
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
              'not-eink:bg-base-300 eink-bordered whitespace-nowrap rounded-full px-4 py-2 font-sans text-sm shadow-lg',
              safeAreaInsets?.top ? 'h-11' : 'h-9',
            )}
          >
            {_('Back to TTS Location')}
          </button>
        </div>
      )}
      {/* One surface at a time: the sheet replaces the mini player while open. */}
      {tts.showIndicator && tts.ttsClientsInited && !showPlayerSheet && (
        <TTSMiniPlayer
          bookKey={bookKey}
          isPlaying={tts.isPlaying}
          isEink={isEink}
          hasTimeline={hasTimeline}
          timeoutTimestamp={tts.timeoutTimestamp}
          chapterRemainingSec={tts.chapterRemainingSec}
          gridInsets={gridInsets}
          onTogglePlay={tts.handleTogglePlay}
          onBackward={tts.handleBackward}
          onForward={tts.handleForward}
          onStop={handleStop}
          onExpand={handleExpand}
          onGetPlaybackInfo={tts.handleGetPlaybackInfo}
        />
      )}
      {tts.ttsClientsInited && showPlayerSheet && (
        <TTSPlayerSheet
          bookKey={bookKey}
          isOpen={showPlayerSheet}
          ttsLang={tts.ttsLang}
          isPlaying={tts.isPlaying}
          hasTimeline={hasTimeline}
          timeoutOption={tts.timeoutOption}
          timeoutTimestamp={tts.timeoutTimestamp}
          chapterRemainingSec={tts.chapterRemainingSec}
          onClose={() => setShowPlayerSheet(false)}
          onTogglePlay={tts.handleTogglePlay}
          onBackward={tts.handleBackward}
          onForward={tts.handleForward}
          onSetRate={tts.handleSetRate}
          onGetVoices={tts.handleGetVoices}
          onSetVoice={tts.handleSetVoice}
          onGetVoiceId={tts.handleGetVoiceId}
          onSelectTimeout={tts.handleSelectTimeout}
          onSeek={tts.handleSeekTo}
          onGetPlaybackInfo={tts.handleGetPlaybackInfo}
        />
      )}
    </>
  );
};

export default TTSControl;
