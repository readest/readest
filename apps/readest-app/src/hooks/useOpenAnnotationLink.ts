import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { parseAnnotationDeepLink, AnnotationDeepLink } from '@/utils/deeplink';
import { useTranslation } from './useTranslation';

// Module-scoped — survives hook remounts (library → reader → library on
// book close). Tauri's getCurrent() keeps returning the launch URL for the
// lifetime of the app session, so without this flag every remount would
// re-process the cold-start URL and navigate back to the deep-link target
// in a loop.
let coldStartConsumed = false;

/**
 * Receive annotation deep links and navigate the reader accordingly.
 *
 * Architecture:
 *   - useOpenWithBooks owns the Tauri URL channels (onOpenUrl,
 *     single-instance, shared-intent, open-files) and re-broadcasts every
 *     URL as the 'app-incoming-url' event. This hook subscribes to that
 *     event for the warm-start / live path.
 *   - For cold-start (app launched FROM the URL), getCurrent() is read
 *     once at module scope. useOpenWithBooks doesn't do this — its
 *     channels only fire for live deliveries.
 *   - Library-load deferral: on cold-start the URL may arrive before the
 *     library store has hydrated. Stash and replay once libraryLoaded.
 *
 * Supported URL shapes (see src/utils/deeplink.ts):
 *   readest://book/{hash}/annotation/{id}?cfi=...
 *   https://web.readest.com/o/book/{hash}/annotation/{id}?cfi=...
 *   readest://annotation/{hash}/{id}            (legacy Readwise sync)
 *
 * Already-open shortcut: if the target book has a mounted view, jump in
 * place via view.goTo(cfi). router.push to the same /reader path with a
 * different cfi query does NOT re-run the reader's init effect, so
 * navigation alone wouldn't move the view in that case.
 */
export function useOpenAnnotationLink() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const getBookByHash = useLibraryStore((s) => s.getBookByHash);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const pending = useRef<AnnotationDeepLink | null>(null);

  const resolveAndNavigate = useCallback(
    (parsed: AnnotationDeepLink) => {
      const { bookHash, cfi } = parsed;
      const book = getBookByHash(bookHash);
      if (!book) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Book not in your library'),
          timeout: 2500,
        });
        return;
      }

      const { viewStates, setPreviewMode } = useReaderStore.getState();
      const openEntry = Object.entries(viewStates).find(
        ([key, state]) => key.startsWith(bookHash) && state.view,
      );
      if (openEntry) {
        const [bookKey, state] = openEntry;
        if (cfi) {
          state.view!.goTo(cfi);
          setPreviewMode(bookKey, true);
        }
        return;
      }

      const queryParams = cfi ? `cfi=${encodeURIComponent(cfi)}` : undefined;
      navigateToReader(router, [bookHash], queryParams);
    },
    [_, getBookByHash, router],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string) => {
      const parsed = parseAnnotationDeepLink(url);
      if (!parsed) return;
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed;
        return;
      }
      resolveAndNavigate(parsed);
    };

    if (!coldStartConsumed) {
      coldStartConsumed = true;
      getCurrent()
        .then((urls) => urls?.forEach(handle))
        .catch(() => {
          // Plugin not available on this platform — live channel still works.
        });
    }

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach(handle);
    };
    eventDispatcher.on('app-incoming-url', onIncoming);

    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService, resolveAndNavigate]);

  // Replay any deferred deep link once the library hydrates.
  useEffect(() => {
    if (!libraryLoaded || !pending.current) return;
    const parsed = pending.current;
    pending.current = null;
    resolveAndNavigate(parsed);
  }, [libraryLoaded, resolveAndNavigate]);
}
