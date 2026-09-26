import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { refreshBookshelfWidget } from '@/services/widget/bookshelfWidget';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getBookHashFromKey } from '@/services/tts/TTSSessionManager';
import { throttle } from '@/utils/throttle';
import { useTranslation } from './useTranslation';

/**
 * Publish the home-screen bookshelf-widget snapshot. The widget is only visible
 * while the app is backgrounded, so we publish (1) once the library is loaded,
 * (2) whenever the app goes to the background, (3) immediately on a TTS
 * playback-state change (so controls appear/disappear), and (4) throttled on
 * TTS position advances so the progress percent stays live while speaking.
 * Mounted on both the library and reader pages.
 */
export function useBookshelfWidget() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const ttsRef = useRef({ active: false, playing: false, bookHash: '' });

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    const emptyTitle = _('Your books will appear here');

    const publishNow = () => {
      const tts = ttsRef.current;
      void refreshBookshelfWidget(
        appService,
        emptyTitle,
        tts.active ? { active: true, playing: tts.playing, bookHash: tts.bookHash } : undefined,
      );
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
        bookHash: getBookHashFromKey(detail.bookKey),
      };
      // Publish immediately so controls appear/disappear and the play/pause
      // icon flips without waiting for the next debounce cycle.
      publishNow();
    };

    document.addEventListener('visibilitychange', onVisibility);
    eventDispatcher.on('tts-playback-state', onPlaybackState);
    eventDispatcher.on('tts-position', publishPosition);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      eventDispatcher.off('tts-playback-state', onPlaybackState);
      eventDispatcher.off('tts-position', publishPosition);
      publish.cancel();
    };
  }, [appService, libraryLoaded, _]);
}
