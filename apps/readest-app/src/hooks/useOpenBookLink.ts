import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { parseBookDeepLink } from '@/utils/deeplink';
import { useTranslation } from './useTranslation';

// Module-scoped: survives hook remounts (library <-> reader). getCurrent()
// keeps returning the launch URL for the session, so without this guard every
// remount would re-read the cold-start URL.
let coldStartConsumed = false;

/**
 * Receive `readest://book/{hash}` deep links (home-screen widget taps) and open
 * the book in the reader. Subscribes to the shared 'app-incoming-url' event for
 * live taps and reads getCurrent() once for cold start, deferring until the
 * library has hydrated.
 */
export function useOpenBookLink() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const getBookByHash = useLibraryStore((s) => s.getBookByHash);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const pending = useRef<string | null>(null);

  const resolveAndNavigate = useCallback(
    (bookHash: string) => {
      const book = getBookByHash(bookHash);
      if (!book) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Book not in your library'),
          timeout: 2500,
        });
        return;
      }
      // If a reader is already mounted, switch in place via useBooksManager: it
      // focuses the book if it is already open (checked against the live
      // bookKeys) or replaces the open book(s) with it otherwise. A plain
      // navigateToReader does not re-init an already-mounted reader.
      if (window.location.pathname.startsWith('/reader')) {
        eventDispatcher.dispatch('open-book-in-reader', { bookHash });
        return;
      }

      // No reader mounted (library / cold start) - navigate fresh.
      navigateToReader(router, [bookHash]);
    },
    [_, getBookByHash, router],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string, coldStart = false) => {
      const parsed = parseBookDeepLink(url);
      if (!parsed) return;
      // Dedupe ONLY the cold-start path. The OS persists the launch deep link
      // and re-delivers it via getCurrent() on every reader reload, which would
      // re-open the book in a loop. Live taps (app-incoming-url) are genuine
      // user actions and must always be processed. sessionStorage survives
      // reloads (module state does not).
      if (coldStart) {
        try {
          if (sessionStorage.getItem('consumedColdStartBookUrl') === url) return;
          sessionStorage.setItem('consumedColdStartBookUrl', url);
        } catch {
          // sessionStorage unavailable - proceed.
        }
      }
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed.bookHash;
        return;
      }
      resolveAndNavigate(parsed.bookHash);
    };

    if (!coldStartConsumed) {
      coldStartConsumed = true;
      getCurrent()
        .then((urls) => urls?.forEach((u) => handle(u, true)))
        .catch(() => {});
    }

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach((u) => handle(u));
    };
    eventDispatcher.on('app-incoming-url', onIncoming);
    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService, resolveAndNavigate]);

  useEffect(() => {
    if (!libraryLoaded || !pending.current) return;
    const bookHash = pending.current;
    pending.current = null;
    resolveAndNavigate(bookHash);
  }, [libraryLoaded, resolveAndNavigate]);
}
