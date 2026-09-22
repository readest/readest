'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import type { Book } from '@/types/book';
import { useAppLockStore } from '@/store/appLockStore';
import { useLibraryStore } from '@/store/libraryStore';
import { getInitializedAppService, isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { isAudiobook } from '@/utils/audiobook';
import { eventDispatcher } from '@/utils/event';
import { isMainAppWindow } from '@/utils/window';
import { getConfigFilename } from '@/utils/book';

// The browse tree is served by an exported MediaBrowserService, which any
// installed app is allowed to bind. Keep the published slice deliberately
// small — the most recently updated books, not the whole shelf — so a media
// client that connects only ever sees what the car actually needs.
export const MAX_CAR_MEDIA_BOOKS = 10;

export interface CarMediaBook {
  hash: string;
  title: string;
  author: string;
  isAudiobook: boolean;
  format: Book['format'];
  coverHash: string | null;
  artworkReady: boolean;
}

interface AndroidAutoPlaybackSource {
  sourcePath: string | null;
  configPath: string | null;
}

interface AndroidAutoPlaybackSourceState {
  key: string | null;
  sources: Map<string, AndroidAutoPlaybackSource>;
}

type CoverThumbnail = { coverHash: string | null; url: string };

export const getCarMediaLibraryBooks = (
  library: Book[],
  coverThumbnails: Map<string, CoverThumbnail> = new Map(),
): CarMediaBook[] =>
  library
    .filter(
      (book) =>
        !book.deletedAt &&
        // `downloadedAt` never syncs (types/book.ts), so a row that arrived
        // from the cloud carries `undefined`, not `null`. Testing `!== null`
        // admits every one of them and the car offers books with no bytes on
        // this device; match the truthiness test used everywhere else.
        (!!book.downloadedAt || !!book.filePath || !!book.url || book.format === 'ABS'),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CAR_MEDIA_BOOKS)
    .map((book) => {
      const { hash, title, author, coverHash } = book;
      const normalizedCoverHash = coverHash ?? null;
      const thumbnail = coverThumbnails.get(hash);
      return {
        hash,
        title,
        author,
        isAudiobook: isAudiobook(book),
        format: book.format,
        coverHash: normalizedCoverHash,
        artworkReady: !!thumbnail && thumbnail.coverHash === normalizedCoverHash,
      };
    });

export const getCarMediaPlaybackSourceKey = (
  library: Book[],
  publishedBooks: CarMediaBook[],
): string => {
  const booksByHash = new Map(library.map((book) => [book.hash, book]));
  const sourceKeys = publishedBooks.map(({ hash, format }) => {
    const book = booksByHash.get(hash);
    return [
      hash,
      format,
      book?.filePath ?? null,
      book?.url ?? null,
      book?.downloadedAt ?? null,
    ] as const;
  });
  sourceKeys.sort(([leftHash], [rightHash]) => leftHash.localeCompare(rightHash));
  return JSON.stringify(sourceKeys);
};

const CarMediaLibraryBridge = () => {
  const library = useLibraryStore((state) => state.library);
  const libraryLoaded = useLibraryStore((state) => state.libraryLoaded);
  const coverThumbnails = useLibraryStore((state) => state.coverThumbnails);
  const isLockInitialized = useAppLockStore((state) => state.isInitialized);
  const isUnlocked = useAppLockStore((state) => state.isUnlocked);
  const [selectionListenerReady, setSelectionListenerReady] = useState(false);
  const [playbackSourceState, setPlaybackSourceState] = useState<AndroidAutoPlaybackSourceState>({
    key: null,
    sources: new Map(),
  });

  // App Lock exists to keep the shelf away from whoever is holding the phone.
  // The car browse tree has to disappear with it — and because the native side
  // persists the last published list, locking has to publish an empty one
  // rather than simply stop publishing.
  const locked = !isLockInitialized || !isUnlocked;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const baseCarMediaBooks = useMemo(
    () => (locked ? [] : getCarMediaLibraryBooks(library, coverThumbnails)),
    [coverThumbnails, library, locked],
  );
  const carMediaBooks = useMemo(
    () =>
      baseCarMediaBooks.map((book) => ({
        ...book,
        sourcePath: playbackSourceState.sources.get(book.hash)?.sourcePath ?? null,
        configPath: playbackSourceState.sources.get(book.hash)?.configPath ?? null,
      })),
    [baseCarMediaBooks, playbackSourceState.sources],
  );
  const booksJson = useMemo(() => JSON.stringify(carMediaBooks), [carMediaBooks]);
  const publishedBooksRef = useRef(carMediaBooks);
  publishedBooksRef.current = carMediaBooks;

  // `library` gets a fresh array reference on every progress save — that is
  // every page turn and every TTS paragraph advance — and `coverThumbnails`
  // gets a fresh Map for each thumbnail that lands. Key the artwork effect on
  // the identity of the published set so neither storm re-requests thumbnails.
  const artworkKey = useMemo(
    () => carMediaBooks.map((book) => `${book.hash}:${book.coverHash ?? ''}`).join(','),
    [carMediaBooks],
  );
  const playbackSourceKey = useMemo(
    () => getCarMediaPlaybackSourceKey(library, baseCarMediaBooks),
    [baseCarMediaBooks, library],
  );

  useEffect(() => {
    if (locked || !libraryLoaded || !isTauriAppPlatform() || getOSPlatform() !== 'android') return;

    // Android Auto artwork must be exposed as a local content:// URI. Reuse
    // Readest's bounded JPEG thumbnail cache rather than parceling full cover
    // bitmaps through the media browser. Thumbnail-ready events update the
    // store above, which republishes the library and refreshes the car UI.
    const appService = getInitializedAppService();
    if (!appService?.supportsCoverThumbnailOptimization) return;
    const selectedHashes = new Set(publishedBooksRef.current.map((book) => book.hash));
    for (const book of useLibraryStore.getState().library) {
      if (selectedHashes.has(book.hash)) appService.requestCoverThumbnail(book);
    }
  }, [artworkKey, libraryLoaded, locked]);

  useEffect(() => {
    if (locked || !libraryLoaded || !isTauriAppPlatform() || getOSPlatform() !== 'android') return;
    const appService = getInitializedAppService();
    if (!appService) return;

    let cancelled = false;
    const currentLibrary = useLibraryStore.getState().library;
    void Promise.all(
      publishedBooksRef.current.map(async ({ hash }) => {
        const book = currentLibrary.find((candidate) => candidate.hash === hash);
        if (!book) return [hash, { sourcePath: null, configPath: null }] as const;
        const [sourcePath, configPath] = await Promise.all([
          appService.resolveNativeBookFilePath(book).catch((error) => {
            console.warn(`Failed to resolve Android Auto source for ${hash}:`, error);
            return null;
          }),
          appService.resolveFilePath(getConfigFilename(book), 'Books').catch(() => null),
        ]);
        return [hash, { sourcePath, configPath }] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) {
          setPlaybackSourceState({ key: playbackSourceKey, sources: new Map(entries) });
        }
      })
      .catch((error) => console.warn('Failed to resolve Android Auto book paths:', error));

    return () => {
      cancelled = true;
    };
  }, [libraryLoaded, locked, playbackSourceKey]);

  useEffect(() => {
    if (!libraryLoaded || !isTauriAppPlatform()) return;
    const platform = getOSPlatform();
    if (!['android', 'ios'].includes(platform)) return;
    if (
      platform === 'android' &&
      (!selectionListenerReady || (!locked && playbackSourceState.key !== playbackSourceKey))
    )
      return;
    void invoke('plugin:native-tts|update_media_library', {
      payload: { booksJson },
    }).catch((error) => console.warn('Failed to update car media library:', error));
  }, [
    booksJson,
    libraryLoaded,
    locked,
    playbackSourceKey,
    playbackSourceState.key,
    selectionListenerReady,
  ]);

  useEffect(() => {
    if (!isMainAppWindow() || !isTauriAppPlatform() || getOSPlatform() !== 'android') return;

    let listener: PluginListener | undefined;
    let cancelled = false;
    void addPluginListener(
      'native-tts',
      'media-session-play-book',
      ({ bookHash }: { bookHash?: string }) => {
        if (!bookHash || lockedRef.current) return;
        // Hand the selection to the shared deep-link path (useOpenBookLink):
        // it defers until the library has hydrated, downloads a cloud-only
        // book before opening it, routes an audiobook to the player, and
        // switches an already-mounted reader in place. Re-implementing any of
        // that here would be a second, untested copy of it.
        const book = useLibraryStore.getState().getBookByHash(bookHash);
        const autoplay = !book || !isAudiobook(book);
        const query = autoplay ? '?autoplay=tts' : '';
        const url = `readest://book/${encodeURIComponent(bookHash)}${query}`;
        eventDispatcher.dispatch('app-incoming-url', { urls: [url] });
      },
    )
      .then((registered) => {
        if (cancelled) {
          void registered.unregister();
        } else {
          listener = registered;
          // update_media_library installs the native-to-WebView event bridge
          // and drains any book selected while the process was cold. Publish
          // only after this listener exists so that one-shot event cannot be
          // lost during startup.
          setSelectionListenerReady(true);
        }
      })
      .catch((error) => console.warn('Failed to listen for Android Auto selections:', error));

    return () => {
      cancelled = true;
      void listener?.unregister();
    };
  }, []);

  return null;
};

export default CarMediaLibraryBridge;
