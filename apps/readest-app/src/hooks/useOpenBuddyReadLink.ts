import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent } from '@tauri-apps/plugin-deep-link';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { useAuth } from '@/context/AuthContext';
import { navigateToReader } from '@/utils/nav';
import { useTranslation } from './useTranslation';
import { useBuddyReadStore } from '@/store/buddyReadStore';
import { importShare } from '@/libs/share';
import { ensureSharedBookLocal } from '@/libs/shareImport';

let coldStartConsumed = false;

export interface BuddyReadDeepLink {
  buddyReadId: number;
  shareToken?: string | null;
}

export function parseBuddyReadDeepLink(urlStr: string): BuddyReadDeepLink | null {
  try {
    const url = new URL(urlStr);
    if (url.protocol === 'readest:') {
      if (url.host === 'buddy-read') {
        const id = url.searchParams.get('id') || url.pathname.split('/').pop();
        const shareToken = url.searchParams.get('shareToken') || url.searchParams.get('token');
        if (id && !isNaN(Number(id)))
          return { buddyReadId: Number(id), shareToken: shareToken || null };
      }
    } else {
      if (url.pathname.includes('/buddy-read/join') || url.pathname.includes('/buddy-read/')) {
        const id = url.searchParams.get('id') || url.pathname.split('/').pop();
        const shareToken = url.searchParams.get('shareToken') || url.searchParams.get('token');
        if (id && !isNaN(Number(id)))
          return { buddyReadId: Number(id), shareToken: shareToken || null };
      }
    }
  } catch {
    const match =
      urlStr.match(/buddy-read(?:\/join)?[\/?]id=(\d+)/) || urlStr.match(/buddy-read\/(\d+)/);
    if (match && match[1]) {
      const shareTokenMatch = urlStr.match(/shareToken=([^&]+)/) || urlStr.match(/token=([^&]+)/);
      return {
        buddyReadId: Number(match[1]),
        shareToken: shareTokenMatch ? shareTokenMatch[1] : null,
      };
    }
  }
  return null;
}

export function useOpenBuddyReadLink() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user } = useAuth();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const pending = useRef<BuddyReadDeepLink | null>(null);

  const handleBuddyReadLink = useCallback(
    async ({ buddyReadId, shareToken }: BuddyReadDeepLink) => {
      if (!user) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to join buddy reads'),
          timeout: 2500,
        });
        return;
      }
      if (!appService) return;

      try {
        const store = useBuddyReadStore.getState();

        let importedBookHash: string | null = null;
        if (shareToken) {
          try {
            eventDispatcher.dispatch('toast', {
              type: 'info',
              message: _('Importing shared book...'),
              timeout: 2000,
            });
            const result = await importShare(shareToken);
            const book = await ensureSharedBookLocal({
              token: shareToken,
              importResult: result,
              appService,
            });
            importedBookHash = book.hash;
          } catch (importErr) {
            console.error('Failed to auto-import book from shareToken:', importErr);
          }
        }

        // Join the buddy read
        await store.joinBuddyRead(buddyReadId);
        const details = await store.fetchBuddyReadDetails(buddyReadId);

        if (!details) {
          throw new Error(_('Could not retrieve buddy read details'));
        }

        // Check if the book is already in the library
        const library = useLibraryStore.getState().library || [];
        const existingBook = library.find(
          (b) =>
            (importedBookHash && b.hash === importedBookHash) ||
            b.title?.toLowerCase() === details.book_title?.toLowerCase(),
        );

        if (existingBook?.hash) {
          // Navigate directly to reader
          navigateToReader(router, [existingBook.hash]);
          eventDispatcher.dispatch('toast', {
            type: 'success',
            message: _('Joined buddy read successfully!'),
            timeout: 2500,
          });
        } else {
          // Show message to add the book first
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('Joined! Please add the book to your library to start reading.'),
            timeout: 5000,
          });
        }
      } catch (err: any) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: err.message || _('Could not join buddy read'),
          timeout: 3000,
        });
      }
    },
    [_, router, user, appService],
  );

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handle = (url: string) => {
      const parsed = parseBuddyReadDeepLink(url);
      if (!parsed) return;
      if (!useLibraryStore.getState().libraryLoaded) {
        pending.current = parsed;
        return;
      }
      void handleBuddyReadLink(parsed);
    };

    if (!coldStartConsumed) {
      coldStartConsumed = true;
      getCurrent()
        .then((urls) => urls?.forEach(handle))
        .catch(() => {});
    }

    const onIncoming = (event: CustomEvent) => {
      const { urls } = event.detail as { urls: string[] };
      urls.forEach(handle);
    };
    eventDispatcher.on('app-incoming-url', onIncoming);

    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
  }, [appService, handleBuddyReadLink]);

  useEffect(() => {
    if (!libraryLoaded || !pending.current) return;
    const parsed = pending.current;
    pending.current = null;
    void handleBuddyReadLink(parsed);
  }, [libraryLoaded, handleBuddyReadLink]);
}
