'use client';

import clsx from 'clsx';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import type { Book } from '@/types/book';
import type { AudiobookController } from '@/services/audiobook/AudiobookController';
import { openAudiobookSession } from '@/services/audiobook/openAudiobook';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLibrary } from '@/hooks/useLibrary';
import { useTheme } from '@/hooks/useTheme';
import { useLibraryStore } from '@/store/libraryStore';
import { useThemeStore } from '@/store/themeStore';
import { isAudiobook } from '@/utils/audiobook';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { Toast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import PlayerView from './components/PlayerView';

type AudiobookSession = { bookKey: string; controller: AudiobookController };
type OpenResult = { result: AudiobookSession | null };

const PlayerRoute = () => {
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { libraryLoaded } = useLibrary();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  useTheme({ systemUIVisible: false });

  const id = searchParams?.get('id') ?? '';

  // Local copy, set once per genuine `id` change inside the effect below -
  // NOT a reactive subscription to the library store. Title/author/cover
  // never meaningfully change mid-session, and subscribing to the whole
  // store here (as an earlier version of this route did) re-rendered on
  // EVERY unrelated library write, including this very session's own
  // AbsProgressSyncer#cacheLocally call on pause/tick - which handed the
  // open effect below (keyed on book identity) a fresh `book` reference
  // every ~15s and, worse, on every pause, and caused it to replay.
  const [book, setBook] = useState<Book | undefined>(undefined);
  const [session, setSession] = useState<AudiobookSession | null>(null);
  // Caches the in-flight open by book hash rather than a bare boolean/ref
  // flag. React StrictMode's dev-only effect -> cleanup -> effect replay
  // keeps this ref alive across the cycle (unlike a real unmount), so a
  // boolean guard set before the first await and never cleared left the
  // replayed effect seeing "already opening" and returning early forever,
  // while the first run's own result was discarded by its own `cancelled`
  // flag - the session never reached state and the route spun on the
  // spinner permanently. Caching the promise itself means the replay joins
  // the SAME open instead of either silently no-op'ing or racing a second,
  // independent claim for the same book.
  const openingRef = useRef<{ hash: string; promise: Promise<OpenResult> } | null>(null);

  useEffect(() => {
    if (!libraryLoaded) return;
    // Read fresh rather than subscribing: this effect must key ONLY on `id`
    // (see the `book` state comment above) or the same re-render storm that
    // caused the frozen-session bug this replaced would just move here.
    const resolvedBook = id ? useLibraryStore.getState().getBookByHash(id) : undefined;
    if (!resolvedBook) {
      navigateToLibrary(router);
      return;
    }
    if (!isAudiobook(resolvedBook)) {
      // A deep link must not reach the document loader with a streaming
      // audiobook stub - route it to the reader for whatever it actually is.
      navigateToReader(router, [resolvedBook.hash]);
      return;
    }
    setBook(resolvedBook);

    if (openingRef.current?.hash !== resolvedBook.hash) {
      openingRef.current = {
        hash: resolvedBook.hash,
        promise: (async (): Promise<OpenResult> => {
          const activeAppService = appService ?? (await envConfig.getAppService());
          const result = await openAudiobookSession({
            appService: activeAppService,
            book: resolvedBook,
          });
          return { result };
        })(),
      };
    }

    let cancelled = false;
    openingRef.current.promise.then(({ result }) => {
      if (cancelled) return;
      if (!result) {
        navigateToLibrary(router);
        return;
      }
      setSession(result);
      // `.then()` can fire again for an ALREADY-SETTLED promise (StrictMode's
      // replay reattaches to it rather than racing a second claim - see the
      // ref comment above), so this can run well after the session was
      // claimed. Gating on the controller's CURRENT state instead of a flag
      // frozen at claim time is what makes that safe: 'stopped' only ever
      // means "never started" for an AudiobookController (unlike TTS, it is
      // not a transient mid-playback value here), so this fires start()
      // exactly once, on first open, and never resumes audio the user has
      // since paused.
      if (result.controller.state === 'stopped') {
        void result.controller.start();
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, libraryLoaded]);

  const handleGoBack = () => {
    // A direct deep link (external share, cold app start) has nowhere for
    // router.back() to land - it would either no-op or exit the app/webview.
    // Mirrors the same window.history.length check src/app/error.tsx uses.
    if (window.history.length > 1) {
      router.back();
    } else {
      navigateToLibrary(router);
    }
  };

  return (
    <div
      className={clsx(
        'bg-base-100 full-height relative select-none overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
      style={{
        paddingTop: `${safeAreaInsets?.top || 0}px`,
        paddingBottom: `${safeAreaInsets?.bottom || 0}px`,
      }}
    >
      {libraryLoaded && book && isAudiobook(book) && session ? (
        <PlayerView
          book={book}
          bookKey={session.bookKey}
          controller={session.controller}
          onGoBack={handleGoBack}
        />
      ) : (
        <Spinner loading />
      )}
      <Toast />
    </div>
  );
};

const PlayerPage = () => {
  return (
    <Suspense fallback={<div className='full-height bg-base-100' />}>
      <PlayerRoute />
    </Suspense>
  );
};

export default PlayerPage;
