import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToLibrary, navigateToReader, showLibraryWindow } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { partialMD5 } from '@/utils/md5';
import { shouldOpenTransient } from '@/helpers/openWith';

/**
 * Handle "Open with Readest" file imports. Consumes the `app-incoming-url`
 * event published by `useAppUrlIngress`, filters URLs that look like a file
 * (file://, content://, or plain path), and routes them to the library.
 *
 * Non-file URL shapes (https, readest://, data:, blob:) are skipped here
 * — other consumers (e.g. `useOpenAnnotationLink`) act on those.
 *
 * Mount this hook alongside `useAppUrlIngress` so the ingress dispatcher is
 * actually running when URLs arrive.
 *
 * Two routing modes by `action`, gated by the `autoImportBooksOnOpen` setting
 * (see `shouldOpenTransient`):
 *
 *   `'VIEW'` with auto-import OFF (Android only — user picked Readest from the
 *   system "Open with" chooser for an epub/pdf): open the file as a transient
 *   book without importing it. We first hash the file ourselves and check the
 *   in-memory library:
 *     - if a non-deleted entry with the same hash already exists, jump
 *       straight into the reader on that entry — no `importBook` call, so the
 *       managed `Books/<hash>/` filePath, createdAt and reading progress are
 *       all preserved untouched;
 *     - otherwise call `appService.importBook` with `transient: true`, which
 *       creates an ephemeral `Book` (with `deletedAt` set and `filePath`
 *       pointing at the original URI) without writing to `Books/<hash>/` or
 *       uploading to the cloud, then navigate to the reader on that hash.
 *
 *   `'SEND'` / undefined (iOS / macOS / desktop / Android share-sheet
 *   capture), and `'VIEW'` with auto-import ON: push the URLs through
 *   `window.OPEN_WITH_FILES` so `library/page.tsx::processOpenWithFiles`
 *   does a full ingest + cloud upload — the file lands in the library and
 *   syncs, which is what a "Send to Readest" share (and an opt-in "Open
 *   with" import) is meant to honour.
 */
export function useOpenWithBooks() {
  const router = useRouter();
  const { appService } = useEnv();
  const { setCheckOpenWithBooks } = useLibraryStore();

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const isFirstWindow = async () => {
      const allWindows = await getAllWindows();
      const currentWindow = getCurrentWindow();
      const sortedWindows = allWindows.sort((a, b) => a.label.localeCompare(b.label));
      return sortedWindows[0]?.label === currentWindow.label;
    };

    const normalizeUrls = (urls: string[]): string[] => {
      const filePaths: string[] = [];
      for (let url of urls) {
        if (url.startsWith('file://')) {
          url = appService?.isIOSApp ? decodeURI(url) : decodeURI(url.replace('file://', ''));
        }
        if (!/^(https?:|data:|blob:|readest:)/i.test(url)) {
          filePaths.push(url);
        }
      }
      return filePaths;
    };

    const openTransient = async (filePaths: string[]) => {
      // For each file, first try to recognise it as a book the user has
      // already imported (hash match in the live library). If yes, we route
      // straight to the reader without ever calling importBook — that avoids
      // mutating the managed entry's filePath / createdAt (importBook in
      // transient mode unconditionally rewrites filePath to the incoming
      // content:// URI and bumps createdAt, both of which we want to keep
      // untouched for already-imported books).
      //
      // Only files that are NOT in the library go through importBook in
      // transient mode, which creates an ephemeral Book (deletedAt set,
      // filePath pointing at the original URI) without writing Books/<hash>/
      // or uploading to the cloud. We also setLibrary so the reader's
      // initViewState (which looks the book up via getBookByHash) can find
      // the ephemeral entry.
      const { setLibrary, getBookByHash, libraryLoaded } = useLibraryStore.getState();
      // Load the real library from disk before building any transient entry.
      // On a cold-start "Open with" the store may not be populated yet; importing
      // onto an empty in-memory library would (a) miss the hash-match for an
      // already-imported book and (b) let the library page's cached-skip persist
      // an empty library, wiping library.json. Loading first makes the store
      // reflect disk (and marks it loaded) so neither happens.
      let library = useLibraryStore.getState().library;
      if (!libraryLoaded) {
        library = await appService.loadLibraryBooks();
        setLibrary(library);
      }
      const bookIds: string[] = [];
      let libraryMutated = false;

      for (const file of filePaths) {
        try {
          // Lightweight pre-check: hash the file and look it up. A miss here
          // means we still have to fall back to importBook because we need
          // its full metadata-extraction + ephemeral entry creation.
          let existingHash: string | undefined;
          try {
            const fileobj = await appService.openFile(file, 'None');
            try {
              existingHash = await partialMD5(fileobj);
            } finally {
              const closable = fileobj as File & { close?: () => Promise<void> };
              if (closable.close) await closable.close();
            }
          } catch (e) {
            // Path/permission issue — let importBook surface the real error.
            console.warn('Pre-hash failed, falling back to transient import:', file, e);
          }

          if (existingHash) {
            const existing = getBookByHash(existingHash);
            if (existing && !existing.deletedAt) {
              bookIds.push(existing.hash);
              continue;
            }
          }

          const book = await appService.importBook(file, library, { transient: true });
          if (book) {
            bookIds.push(book.hash);
            // importBook may have mutated `library` (added the ephemeral
            // entry, or — for a hash hit on a previously-deleted entry —
            // refreshed an existing one); either way we want store sync.
            libraryMutated = true;
          }
        } catch (e) {
          console.warn('Failed to open file transiently:', file, e);
        }
      }

      if (bookIds.length === 0) return;
      if (libraryMutated) {
        setLibrary(library);
      }
      // Defensive: only navigate if the reader will actually be able to
      // resolve the book via getBookByHash (managed entries are already in
      // the store; ephemeral entries are after the setLibrary above).
      const reachable = bookIds.filter((h) => !!getBookByHash(h));
      if (reachable.length > 0) {
        navigateToReader(router, reachable);
      }
    };

    const handle = async (urls: string[], action?: 'VIEW' | 'SEND') => {
      const filePaths = normalizeUrls(urls);
      if (filePaths.length === 0) return;

      // Read the persisted setting from disk rather than the settings store:
      // on a cold-start "Open with" the store may not be hydrated yet (it's
      // seeded by the library page's init effect, which races the queued
      // intent replay), and an unhydrated store would wrongly fall back to a
      // transient open for a user who has auto-import on.
      const settings = await appService.loadSettings();

      // Android "Open with" with auto-import off → straight to reader, no
      // library write. When auto-import is on, fall through to the library
      // ingest path below so the file is copied into the managed library
      // and synced (the default on mobile).
      if (shouldOpenTransient(action, settings.autoImportBooksOnOpen)) {
        // If a reader is already mounted, ignore the second tap rather
        // than try to swap books underneath it. The in-place URL swap
        // would otherwise leave ReaderContent's init effect (gated by
        // an isInitiating ref + empty deps) stuck on the previous book
        // and the user would see the spinner hang. The user can close
        // the current book to return to the library, then re-open the
        // new one — same UX as most OS image viewers.
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/reader')) {
          console.log('Ignoring Open-with VIEW intent: reader already active');
          return;
        }
        await openTransient(filePaths);
        return;
      }

      if (appService?.hasWindow && settings.openBookInNewWindow) {
        if (await isFirstWindow()) {
          showLibraryWindow(appService, filePaths);
        }
      } else {
        window.OPEN_WITH_FILES = filePaths;
        setCheckOpenWithBooks(true);
        navigateToLibrary(router, `reload=${Date.now()}`);
      }
    };

    const onIncoming = (event: CustomEvent) => {
      const { urls, action } = event.detail as { urls: string[]; action?: 'VIEW' | 'SEND' };
      handle(urls, action);
    };
    eventDispatcher.on('app-incoming-url', onIncoming);

    return () => {
      eventDispatcher.off('app-incoming-url', onIncoming);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
