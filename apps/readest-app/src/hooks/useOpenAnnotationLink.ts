import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { parseAnnotationDeepLink, AnnotationDeepLink } from '@/utils/deeplink';
import { useTranslation } from './useTranslation';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

/**
 * Listen for incoming deep links that target an annotation, and navigate the
 * reader to the corresponding book + CFI. Handles both:
 *   readest://book/{hash}/annotation/{id}?cfi=...
 *   https://web.readest.com/o/book/{hash}/annotation/{id}?cfi=...
 * and the legacy flat shape readest://annotation/{hash}/{id} (Readwise sync
 * before the migration).
 *
 * Cold-start vs. live: if the app is launched FROM the URL (cold-start), the
 * URL lives in getCurrent() and never fires on onOpenUrl. On warm/running
 * apps, it arrives via onOpenUrl (mobile) or the single-instance event
 * (Windows/Linux/macOS). We cover all three.
 *
 * Library-load deferral: book lookup needs `libraryLoaded` to be true. On
 * cold-start the hook may mount before the library hydrates, so we stash the
 * pending parsed link in a ref and process it once the store reports loaded.
 */
export function useOpenAnnotationLink() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const router = useRouter();
  const getBookByHash = useLibraryStore((s) => s.getBookByHash);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);

  const listened = useRef(false);
  const pending = useRef<AnnotationDeepLink | null>(null);
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const resolveAndNavigate = (parsed: AnnotationDeepLink) => {
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
      const queryParams = cfi ? `cfi=${encodeURIComponent(cfi)}` : undefined;
      navigateToReader(router, [bookHash], queryParams);
    };

    const handle = (url: string) => {
      const parsed = parseAnnotationDeepLink(url);
      if (!parsed) return false;
      // If the library hasn't finished loading yet, stash the link and let
      // the libraryLoaded effect below pick it up. Otherwise navigate now.
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed;
      } else {
        resolveAndNavigate(parsed);
      }
      return true;
    };

    if (listened.current) return;
    listened.current = true;

    if (!handledColdStart.current) {
      handledColdStart.current = true;
      getCurrent()
        .then((urls) => {
          if (!urls) return;
          for (const url of urls) {
            if (handle(url)) break;
          }
        })
        .catch(() => {
          // getCurrent() may reject on platforms without the plugin; the
          // listeners below cover live events.
        });
    }

    const unlistenSingleInstance = getCurrentWindow().listen<SingleInstancePayload>(
      'single-instance',
      ({ payload }) => {
        const url = payload.args?.[1];
        if (url) handle(url);
      },
    );

    const unlistenOpenUrl = onOpenUrl((urls) => {
      for (const url of urls) {
        if (handle(url)) break;
      }
    });

    return () => {
      unlistenSingleInstance.then((f) => f());
      unlistenOpenUrl.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    if (!libraryLoaded) return;
    const parsed = pending.current;
    if (!parsed) return;
    pending.current = null;

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
    const queryParams = cfi ? `cfi=${encodeURIComponent(cfi)}` : undefined;
    navigateToReader(router, [bookHash], queryParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded]);
}
