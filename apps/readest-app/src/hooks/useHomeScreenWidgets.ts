import { useEffect, useRef } from 'react';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { refreshBookshelfWidget } from '@/services/widget/bookshelfWidget';
import { refreshReadingWidget } from '@/services/widget/readingWidget';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getBookHashFromKey } from '@/services/tts/TTSSessionManager';
import { throttle } from '@/utils/throttle';
import { useTranslation } from './useTranslation';

/**
 * Publish the home-screen widget snapshots (Bookshelf and Currently Reading).
 * The widgets are only visible while the app is backgrounded, so we publish
 * (1) once the library is loaded, (2) whenever the app goes to the background,
 * (3) immediately on a TTS playback-state change (so controls appear/disappear),
 * (4) throttled on TTS position advances so the progress stays live while
 * speaking, and (5) when a widget is placed or reconfigured while the app is
 * running. Mounted on both the library and reader pages. Each refresh is
 * coalesced independently, so one never blocks the other.
 */
export function useHomeScreenWidgets() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const ttsRef = useRef({ active: false, playing: false, bookHash: '' });

  useEffect(() => {
    if (!appService?.isMobileApp) return;

    const publishNow = () => {
      const tts = ttsRef.current;
      const playback = tts.active
        ? { active: true, playing: tts.playing, bookHash: tts.bookHash }
        : undefined;
      void refreshBookshelfWidget(appService, _, playback);
      void refreshReadingWidget(appService, _, playback);
    };

    const publish = debounce(publishNow, 500);
    // `tts-position` fires continuously while speaking, so a trailing debounce
    // would never fire, and timers are unreliable once backgrounded. Publish on
    // the leading edge, at most once per interval.
    const publishPosition = throttle(publishNow, 5000, { emitLast: false });

    if (libraryLoaded) publish();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Flush now: the WebView may be suspended before a debounced timer
        // fires, and backgrounding is exactly when the widgets need the
        // latest reading progress.
        publish();
        publish.flush();
      }
    };

    const onPlaybackState = (event: CustomEvent) => {
      const detail = event.detail as { bookKey: string; state: 'playing' | 'paused' | 'stopped' };
      ttsRef.current = {
        active: detail.state !== 'stopped',
        playing: detail.state === 'playing',
        bookHash: getBookHashFromKey(detail.bookKey),
      };
      // Publish immediately so controls appear/disappear and the play/pause
      // icon flips without waiting for the next debounce cycle.
      publishNow();
    };

    let configuredListener: PluginListener | undefined;
    let unmounted = false;
    if (appService.isAndroidApp) {
      addPluginListener('native-bridge', 'bookshelf-widget-configured', publishNow)
        .then((listener) => {
          if (unmounted) void listener.unregister();
          else configuredListener = listener;
        })
        .catch((err) => console.warn('Failed to listen for widget configuration', err));
    }

    document.addEventListener('visibilitychange', onVisibility);
    eventDispatcher.on('tts-playback-state', onPlaybackState);
    eventDispatcher.on('tts-position', publishPosition);
    return () => {
      unmounted = true;
      void configuredListener?.unregister();
      document.removeEventListener('visibilitychange', onVisibility);
      eventDispatcher.off('tts-playback-state', onPlaybackState);
      eventDispatcher.off('tts-position', publishPosition);
      publish.cancel();
    };
  }, [appService, libraryLoaded, _]);
}
