import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookTransferActions } from '@/app/library/hooks/useBookTransferActions';
import { isTauriAppPlatform } from '@/services/environment';
import { LibraryGroupByType } from '@/types/settings';
import { isAudiobook } from '@/utils/audiobook';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import {
  parseAnnotationDeepLink,
  parseBookDeepLink,
  parseWidgetEditShelfDeepLink,
  parseWidgetGroupDeepLink,
} from '@/utils/deeplink';
import { setPendingTTSAutoplay } from '@/utils/ttsAutoplay';
import { isMainAppWindow } from '@/utils/window';
import { markLaunchUrl } from '@/utils/deeplinkConsume';
import { useMakeBookAvailable } from './useMakeBookAvailable';
import { useTranslation } from './useTranslation';

// A link tap has nothing to show download progress on, so the download plumbing
// gets no-op sinks (module-scoped: `makeBookAvailable` is memoized on them).
const noop = () => {};

// Module-scoped: getCurrent() keeps returning the launch URL for the whole
// session, so without this every remount (library <-> reader) would re-read it.
let coldStartConsumed = false;

/** A recognised deep link: how to dedupe it and what opening it does. */
interface LaunchLink {
  /** Keys the launch-URL replay marker for this kind of link. */
  id: string;
  /** Held until the library has hydrated. */
  needsLibrary: boolean;
  open: () => void | Promise<void>;
}

/**
 * Releases the Library's blank-placeholder gate (checkPendingLaunchLink). Call
 * only when staying on the Library - router.push() doesn't block until the
 * route swaps, so releasing it on a navigate-away would flash the Library's
 * real content first. Those paths rely on the unmount release below.
 */
const releaseLaunchLinkGate = () => useLibraryStore.getState().setCheckPendingLaunchLink(false);

/**
 * Every deep link the app opens on launch or while running; mount once per
 * route. useOpenWithBooks owns the Tauri URL channels and re-broadcasts each URL
 * as the 'app-incoming-url' event. This reads the cold-start URL once, handles
 * live ones, holds a link that needs the library until it has loaded, and keeps
 * the Library blank until it is known whether any link claimed the launch.
 *
 *   readest://book/{hash}                                  a widget or Android Auto tap
 *   readest://book/{hash}/annotation/{id}?cfi=...          a highlight (also the https form
 *   readest://annotation/{hash}/{id}                        and the legacy Readwise one)
 *   readest://widget-group/{groupBy}/{groupId}             a "browse groups" tile tap
 *   readest://widget-edit-shelf/{shelfId}                  the configure dialog's Edit button
 */
export function useOpenLaunchLinks() {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const getBookByHash = useLibraryStore((s) => s.getBookByHash);
  const updateBook = useLibraryStore((s) => s.updateBook);
  const { handleBookDownload } = useBookTransferActions(envConfig, appService, updateBook, noop);
  const makeBookAvailable = useMakeBookAvailable({ setLoading: noop, handleBookDownload });

  // Opens a book, at `cfi` when given. Every branch that stays put releases the
  // Library gate; the ones that navigate away rely on its unmount release.
  const openBook = async (bookHash: string, cfi?: string) => {
    try {
      const book = getBookByHash(bookHash);
      if (!book) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Book not in your library'),
          timeout: 2500,
        });
        releaseLaunchLinkGate();
        return;
      }
      // A streaming audiobook has no document: always open it in the player,
      // before the reader checks (an in-place switch would hang on the spinner).
      if (isAudiobook(book)) {
        router.push(`/player?id=${bookHash}`);
        return;
      }

      // Only bookKeys are displayed; viewStates keeps stale detached views, and
      // a goTo on one would leave the reader stuck (#4887).
      if (cfi) {
        const { viewStates, bookKeys, setPreviewMode } = useReaderStore.getState();
        const openKey = bookKeys.find((key) => key.startsWith(bookHash) && viewStates[key]?.view);
        if (openKey) {
          viewStates[openKey]!.view!.goTo(cfi);
          setPreviewMode(openKey, true);
          return;
        }
      }

      // A cloud-synced book can arrive with no file; fetch it first, as a
      // library tap does, or the reader hangs on the spinner.
      if (!(await makeBookAvailable(book))) {
        releaseLaunchLinkGate();
        return;
      }

      // A mounted reader doesn't re-init on router.push, so switch the book in
      // place (useBooksManager focuses it if open), carrying the cfi.
      if (window.location.pathname.startsWith('/reader')) {
        eventDispatcher.dispatch('open-book-in-reader', { bookHash, cfi });
        return;
      }

      // No reader mounted: navigate fresh (FoliateViewer reads ?cfi= at init).
      if (cfi) navigateToReader(router, [bookHash], `cfi=${encodeURIComponent(cfi)}`);
      else navigateToReader(router, [bookHash]);
    } catch (err) {
      // A throw must still release the gate, or it stays blank forever.
      releaseLaunchLinkGate();
      throw err;
    }
  };

  const match = (url: string): LaunchLink | null => {
    const book = parseBookDeepLink(url);
    if (book) {
      return {
        id: 'launchBookUrls',
        needsLibrary: true,
        open: () => {
          // Android Auto cold-resume: start read-aloud once this book's view inits.
          if (book.autoplay) setPendingTTSAutoplay(book.bookHash);
          return openBook(book.bookHash);
        },
      };
    }
    const annotation = parseAnnotationDeepLink(url);
    if (annotation) {
      return {
        id: 'launchAnnotationUrls',
        needsLibrary: true,
        open: () => openBook(annotation.bookHash, annotation.cfi),
      };
    }
    const group = parseWidgetGroupDeepLink(url);
    if (group) {
      return {
        id: 'launchWidgetLinkUrls',
        needsLibrary: false,
        open: () => {
          const axes: string[] = Object.values(LibraryGroupByType);
          if (group.groupBy !== LibraryGroupByType.None && axes.includes(group.groupBy)) {
            router.push(
              `/library?groupBy=${group.groupBy}&group=${encodeURIComponent(group.groupId)}`,
            );
          }
          // A group opens within the Library, which never unmounts to release the gate.
          releaseLaunchLinkGate();
        },
      };
    }
    const editShelf = parseWidgetEditShelfDeepLink(url);
    if (editShelf) {
      return {
        id: 'launchWidgetEditShelfUrls',
        needsLibrary: false,
        open: () => {
          // `t` is a per-tap nonce: BookshelvesDialog's editBookshelf handling
          // is one-shot (an initial-tab lookup, not a reactive render like
          // groupBy/group above), so without a value that's guaranteed to
          // differ from last time, a repeat tap for the same shelf - or one
          // that arrives while the dialog is already open on a different
          // shelf - wouldn't be seen as a change and would be dropped.
          router.push(
            `/library?editBookshelf=${encodeURIComponent(editShelf.shelfId)}&t=${Date.now()}`,
          );
          // Opens within the Library, which never unmounts to release the gate.
          releaseLaunchLinkGate();
        },
      };
    }
    return null;
  };

  // Always the latest closures, so their identity never re-subscribes the listener.
  const matchRef = useRef(match);
  matchRef.current = match;
  const pending = useRef<LaunchLink['open'] | null>(null);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);

  useEffect(() => releaseLaunchLinkGate, []);

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    // Returns whether `url` was a link taken over (queued or opened).
    const handle = (url: string, coldStart = false): boolean => {
      const link = matchRef.current(url);
      if (!link) return false;
      // Dedupe ONLY the cold-start path: getCurrent() re-reports the launch URL
      // to every fresh document (#6104). Live taps always run; they are only recorded.
      const fresh = markLaunchUrl(link.id, url);
      if (coldStart && !fresh) return false;
      if (link.needsLibrary && !useLibraryStore.getState().libraryLoaded) {
        pending.current = link.open;
        return true;
      }
      void link.open();
      return true;
    };

    // Only the launch window reads the cold-start URL; a window spawned later
    // would replay it over the book the user just opened (#6104).
    if (!coldStartConsumed && isMainAppWindow()) {
      coldStartConsumed = true;
      getCurrent()
        .then((urls) => {
          const taken = (urls ?? []).map((u) => handle(u, true)).some(Boolean);
          // On Android a live delivery may already have queued the launch URL, which
          // dedupes here as a replay, so `taken` alone can't say nothing is pending.
          if (!taken && !pending.current) releaseLaunchLinkGate();
        })
        .catch(releaseLaunchLinkGate);
    }

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach((u) => handle(u));
    };
    eventDispatcher.on('app-incoming-url', onIncoming);
    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService]);

  useEffect(() => {
    if (!libraryLoaded || !pending.current) return;
    const open = pending.current;
    pending.current = null;
    void open();
  }, [libraryLoaded]);
}
