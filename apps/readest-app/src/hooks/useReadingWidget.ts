import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { refreshReadingWidget } from '@/services/widget/readingWidget';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from './useTranslation';

/**
 * Publish the home-screen reading-widget snapshot. The widget is only visible
 * while the app is backgrounded, so we publish (1) once the library is loaded,
 * (2) whenever the app goes to the background, (3) immediately on a TTS
 * playback-state change (so controls appear/disappear), and (4) throttled on
 * TTS position advances so the progress percent stays live while speaking.
 * Mounted on both the library and reader pages.
 */
export function useReadingWidget() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const ttsRef = useRef<{ active: boolean; playing: boolean }>({
    active: false,
    playing: false,
  });

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    const labels = {
      // The widget intentionally shows no section header (minimal UI), so the
      // section title is left empty.
      sectionTitle: '',
      emptyTitle: _('Your books will appear here'),
    };

    const publishNow = () => {
      const tts = ttsRef.current;
      void refreshReadingWidget(
        appService,
        labels,
        tts.active ? { active: true, playing: tts.playing } : undefined,
      );
    };

    const publish = debounce(publishNow, 500);
    // Leading interval throttle for TTS position. `tts-position` fires
    // continuously while speaking, so a trailing debounce would perpetually
    // reset its timer and never fire; and a pending setTimeout is unreliable
    // once the app is backgrounded (the OS throttles background timers).
    // Publish immediately, then at most once per interval, synchronously inside
    // the event handler.
    const TTS_POSITION_PUBLISH_INTERVAL = 5000;
    let lastPositionPublishAt = 0;

    if (libraryLoaded) publish();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Flush now: the WebView may be suspended before a debounced timer
        // fires, and backgrounding is exactly when the widget needs the latest
        // reading progress.
        publish();
        publish.flush();
      }
    };

    const onPlaybackState = (event: CustomEvent) => {
      const detail = event.detail as { bookKey: string; state: 'playing' | 'paused' | 'stopped' };
      ttsRef.current = {
        active: detail.state !== 'stopped',
        playing: detail.state === 'playing',
      };
      // Publish immediately so controls appear/disappear and the play/pause
      // icon flips without waiting for the next debounce cycle.
      publishNow();
    };

    const onPosition = () => {
      // Re-read the app-level book progress (the same value as the reader's
      // progress bar) and re-publish. Leading throttle: publish immediately,
      // then at most once per interval, synchronously so it still fires while
      // the app is backgrounded.
      const now = Date.now();
      if (now - lastPositionPublishAt < TTS_POSITION_PUBLISH_INTERVAL) return;
      lastPositionPublishAt = now;
      publishNow();
    };

    document.addEventListener('visibilitychange', onVisibility);
    eventDispatcher.on('tts-playback-state', onPlaybackState);
    eventDispatcher.on('tts-position', onPosition);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      eventDispatcher.off('tts-playback-state', onPlaybackState);
      eventDispatcher.off('tts-position', onPosition);
      publish.cancel();
    };
  }, [appService, libraryLoaded, _]);
}
