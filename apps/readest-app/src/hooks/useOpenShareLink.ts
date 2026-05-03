import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { useAuth } from '@/context/AuthContext';
import { navigateToReader } from '@/utils/nav';
import { ShareApiError, confirmDownload, importShare } from '@/libs/share';
import { ensureSharedBookLocal } from '@/libs/shareImport';
import { parseShareDeepLink, type ShareDeepLink } from '@/utils/share';
import { useTranslation } from './useTranslation';

// Module-scoped flag matches the useOpenAnnotationLink pattern. Tauri's
// getCurrent() keeps returning the launch URL for the entire app session, so
// without this every remount would re-process the cold-start URL.
let coldStartConsumed = false;

/**
 * Receive book share deep links and import the book into the user's library.
 *
 * Architecture:
 *   - useOpenWithBooks owns the Tauri URL channels and re-broadcasts every
 *     URL as the 'app-incoming-url' event. This hook subscribes for warm /
 *     live deliveries.
 *   - For cold-start, getCurrent() is read once at module scope.
 *   - Library-load deferral: on cold-start the URL may arrive before the
 *     library store hydrates. Stash and replay once libraryLoaded.
 *
 * Supported URL shapes (see src/utils/share.ts):
 *   readest://share/{token}
 *   https://web.readest.com/s/{token}
 *
 * Auth-gated paths:
 *   - Logged-in: POST /api/share/[token]/import (server-side R2 byte-copy),
 *     navigate to the new fileId in the reader at the sharer's cfi.
 *   - Logged-out: surface a toast directing the user to the web landing
 *     page where they can download anonymously. We don't try to do an
 *     anonymous download here — the in-app library is the user's space and
 *     a logged-out import has nowhere to land.
 */
export function useOpenShareLink() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user } = useAuth();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const pending = useRef<ShareDeepLink | null>(null);

  const handleShareLink = useCallback(
    async ({ token }: ShareDeepLink) => {
      if (!user) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to import shared books'),
          timeout: 2500,
        });
        return;
      }
      if (!appService) return;
      try {
        const result = await importShare(token);
        // The /import endpoint only creates rows + R2 bytes server-side; the
        // local library is unchanged. Make sure the local library has both the
        // Book entry and the bytes on disk before navigating, otherwise
        // `getBookByHash` returns undefined and the reader throws "Book not
        // found". See src/libs/shareImport.ts for the three branches.
        await ensureSharedBookLocal({ token, importResult: result, appService });
        // Best-effort analytics ping; doesn't affect UX.
        confirmDownload(token);

        const queryParams = result.cfi ? `cfi=${encodeURIComponent(result.cfi)}` : undefined;
        navigateToReader(router, [result.bookHash], queryParams);

        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: result.alreadyOwned ? _('Already in your library') : _('Added to your library'),
          timeout: 2500,
        });
      } catch (err) {
        const message =
          err instanceof ShareApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : _('Could not import shared book');
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message,
          timeout: 3000,
        });
      }
    },
    [_, router, user, appService],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string) => {
      const parsed = parseShareDeepLink(url);
      if (!parsed) return;
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed;
        return;
      }
      void handleShareLink(parsed);
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
  }, [appService, handleShareLink]);

  // Replay any deferred deep link once the library hydrates.
  useEffect(() => {
    if (!libraryLoaded || !pending.current) return;
    const parsed = pending.current;
    pending.current = null;
    void handleShareLink(parsed);
  }, [libraryLoaded, handleShareLink]);
}
