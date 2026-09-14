import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookTransferActions } from '@/app/library/hooks/useBookTransferActions';
import { useMakeBookAvailable } from './useMakeBookAvailable';
import { isTauriAppPlatform } from '@/services/environment';
import { isAudiobook } from '@/utils/audiobook';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { parseBookDeepLink } from '@/utils/deeplink';
import { setPendingTTSAutoplay } from '@/utils/ttsAutoplay';
import { isMainAppWindow } from '@/utils/window';
import { markLaunchUrl } from '@/utils/deeplinkConsume';
import { useTranslation } from './useTranslation';

// Module-scoped: survives hook remounts (library <-> reader). getCurrent()
// keeps returning the launch URL for the session, so without this guard every
// remount would re-read the cold-start URL.
let coldStartConsumed = false;

// A widget tap has no shelf item to put a spinner or a progress overlay on, so
// the download plumbing below gets stable no-op sinks. Module-scoped so their
// identity never changes: `makeBookAvailable` is memoized on them, and a fresh
// closure per render would re-subscribe the deep-link listener every render.
const noop = () => {};

/**
 * Receive `readest://book/{hash}` deep links (home-screen widget taps) and open
 * the book in the reader. Subscribes to the shared 'app-incoming-url' event for
 * live taps and reads getCurrent() once for cold start, deferring until the
 * library has hydrated.
 */
export function useOpenBookLink() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const getBookByHash = useLibraryStore((s) => s.getBookByHash);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const pending = useRef<string | null>(null);
  const [, setTransferProgress] = useState<{ [key: string]: number }>({});
  const { handleBookDownload } = useBookTransferActions(
    envConfig,
    appService,
    updateBook,
    setTransferProgress,
  );
  const makeBookAvailable = useMakeBookAvailable({ setLoading: noop, handleBookDownload });

  const resolveAndNavigate = useCallback(
    async (bookHash: string) => {
      const book = getBookByHash(bookHash);
      if (!book) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Book not in your library'),
          timeout: 2500,
        });
        return;
      }
      // A streaming audiobook has no document to load - it always opens in
      // the player, the same as a library tap on it (useOpenBook.ts). This
      // must come before the reader-mounted check below: switching it into
      // an already-mounted reader in place would drive initViewState down
      // the document-loader path a streaming ABS book has no file for, and
      // the reader hangs on the spinner.
      if (isAudiobook(book)) {
        router.push(`/player?id=${bookHash}`);
        return;
      }
      // The widget lists whatever is currently being read, and on a second
      // device that set includes cloud-synced books that arrived as metadata +
      // progress with no file blob. Fetch the file before opening anything -
      // exactly what a library tap does via useOpenBook - otherwise the reader
      // (or the in-place switch below) drives loadBookContent at a path that
      // does not exist and dies on the spinner.
      if (!(await makeBookAvailable(book))) return;

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
    [_, getBookByHash, makeBookAvailable, router],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string, coldStart = false) => {
      const parsed = parseBookDeepLink(url);
      if (!parsed) return;
      // Android Auto cold-resume: remember to start read-aloud once this book's
      // view inits (consumed in useBooksManager). Harmless if it never opens.
      if (parsed.autoplay) setPendingTTSAutoplay(parsed.bookHash);
      // Dedupe ONLY the cold-start path. The OS persists the launch deep link
      // and getCurrent() re-reports it to every fresh document for the whole
      // app run (#6104). Live taps (app-incoming-url) are genuine user actions
      // and must always be processed - they are only recorded, so a later
      // reload re-reporting one of them is recognised as a replay.
      const fresh = markLaunchUrl('launchBookUrls', url);
      if (coldStart && !fresh) return;
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed.bookHash;
        return;
      }
      void resolveAndNavigate(parsed.bookHash);
    };

    // Only the launch window reads the cold-start URL: it stays in the plugin's
    // process-global state forever, and a reader window spawned later would
    // otherwise treat it as its own cold start and replace the book the user
    // just clicked with the deep-linked one (#6104).
    if (!coldStartConsumed && isMainAppWindow()) {
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
    void resolveAndNavigate(bookHash);
  }, [libraryLoaded, resolveAndNavigate]);
}
