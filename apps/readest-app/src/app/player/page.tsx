'use client';

import clsx from 'clsx';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IoArrowBack } from 'react-icons/io5';

import type { Book } from '@/types/book';
import type { AudiobookController } from '@/services/audiobook/AudiobookController';
import type { ABSEpisode } from '@/types/audiobookshelf';
import { loadAbsEpisodes, openAudiobookSession } from '@/services/audiobook/openAudiobook';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useLibrary } from '@/hooks/useLibrary';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useThemeStore } from '@/store/themeStore';
import { isAudiobook } from '@/utils/audiobook';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { Toast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import PlayerView from './components/PlayerView';
import EpisodesView from './components/EpisodesView';

type AudiobookSession = { bookKey: string; controller: AudiobookController };
type OpenResult = { result: AudiobookSession | null };
type EpisodesData = Awaited<ReturnType<typeof loadAbsEpisodes>>;
type EpisodesResult = { result: EpisodesData };

const PlayerRoute = () => {
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { libraryLoaded } = useLibrary();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const _ = useTranslation();
  const iconSize24 = useResponsiveSize(24);
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
  // A podcast show's episode list + each episode's server progress, for the
  // route's own Episodes view - shown before any episode is claimed, and
  // again once a claimed episode's session ends (see the session-ended
  // effect below). Irrelevant for a plain audiobook.
  const [episodes, setEpisodes] = useState<EpisodesData>(null);
  // The episode most recently tapped (from either Episodes view - this
  // route's own, or PlayerView's embedded one), while its claim is still in
  // flight. Owned here rather than by either Episodes-view consumer because
  // only this component knows the claim's OUTCOME (success, "episode not
  // found"/connection-error null, or a thrown rejection) - a consumer-owned
  // copy has no way to learn a failure happened and clear its own busy row.
  // Cleared in exactly two places: immediately on a failed/thrown claim
  // (handleSelectEpisode below - nothing will ever "match" for a claim that
  // never succeeded), or by the effect further below once the new session's
  // controller actually reports the tapped episode - kept a full render
  // apart from `setSession` on purpose (see that effect's comment).
  const [pendingEpisodeId, setPendingEpisodeId] = useState<string | null>(null);
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
  // Same StrictMode-safe caching, for the podcast episode-list fetch.
  const episodesRef = useRef<{ hash: string; promise: Promise<EpisodesResult> } | null>(null);

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

    if (resolvedBook.absMediaType === 'podcast') {
      // A podcast show has no book-level session - only a chosen episode
      // does (openAudiobookSession returns null, without claiming or
      // toasting, for a podcast with no episodeId). Auto-claiming here like
      // a plain audiobook would just silently no-op and, worse, used to
      // trip the null-result bounce below and send a fresh podcast open
      // straight back to the library. Instead: adopt a live session for
      // this show if one is already playing, or load the episode list and
      // wait for the user to pick - no claim happens until they do.
      const liveSession = ttsSessionManager.getSessionByHash(resolvedBook.hash);
      if (liveSession && liveSession.controller.kind === 'audiobook') {
        setSession({
          bookKey: liveSession.bookKey,
          controller: liveSession.controller as AudiobookController,
        });
        return;
      }

      if (episodesRef.current?.hash !== resolvedBook.hash) {
        episodesRef.current = {
          hash: resolvedBook.hash,
          promise: (async (): Promise<EpisodesResult> => {
            const activeAppService = appService ?? (await envConfig.getAppService());
            const result = await loadAbsEpisodes(activeAppService, resolvedBook);
            return { result };
          })(),
        };
      }

      let cancelled = false;
      episodesRef.current.promise.then(({ result }) => {
        if (cancelled) return;
        if (!result) {
          navigateToLibrary(router);
          return;
        }
        setEpisodes(result);
      });

      return () => {
        cancelled = true;
      };
    }

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

  // A podcast episode's session ending (natural end, error, user stop) must
  // fall back to this show's episode list, not bounce the whole route to
  // the library the way a plain audiobook's PlayerView#onGoBack does - the
  // user is still mid-show, just between episodes. Only listens while a
  // podcast session is actually live, so an unrelated session ending
  // elsewhere doesn't spuriously refetch this show's episodes. A failed
  // refetch (server gone, fetch error - already toasted inside
  // loadAbsEpisodes) bounces to the library exactly like the initial-load
  // path below: swallowing it would strand the route on the bare spinner
  // fallback forever, since `episodes` would never become non-null again.
  useEffect(() => {
    if (!book || book.absMediaType !== 'podcast' || !session) return;
    // Latches after the first "this show's session is gone" observation so
    // a later, unrelated 'session-changed' (e.g. a different book stealing
    // the single session slot) can't fire the refetch a second time before
    // this effect's own `setSession(null)` above has a chance to make
    // `session` falsy and unsubscribe it on the next render.
    let didEnd = false;
    const onSessionChanged = () => {
      if (didEnd) return;
      if (ttsSessionManager.getSessionByHash(book.hash)) return;
      didEnd = true;
      setSession(null);
      void (async () => {
        const activeAppService = appService ?? (await envConfig.getAppService());
        const result = await loadAbsEpisodes(activeAppService, book);
        if (result) {
          setEpisodes(result);
        } else {
          navigateToLibrary(router);
        }
      })();
    };
    ttsSessionManager.addEventListener('session-changed', onSessionChanged);
    return () => ttsSessionManager.removeEventListener('session-changed', onSessionChanged);
  }, [book, session, appService, envConfig, router]);

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

  // Without this, the Android system Back button falls through to Kotlin's
  // default handler, which finishes the whole activity instead of navigating
  // - killing background audio with it (the session manager and media
  // session support headless playback fine; only the route never asked for
  // Back to be routed through JS). Reuses the same shared hook the reader and
  // the OPDS browser route already rely on for this, and the same
  // handleGoBack the header back button uses, so Back and the header button
  // always agree.
  useKeyDownActions({ onCancel: handleGoBack });

  // Guards against a double tap (or a tap on a second row before the first
  // claim lands) putting two full claims in flight at once - two
  // getItemExpanded fetches, two server-side listening sessions, and the
  // loser's start() briefly audible before its session gets torn down by
  // the winner's claim(). While any claim is in flight, further taps (on
  // any episode, not just the one already in flight) are no-ops; the ref
  // clears once the claim settles, success or failure, so a failed claim
  // doesn't lock the route out of retrying.
  const claimingEpisodeRef = useRef(false);

  const handleSelectEpisode = (episode: ABSEpisode) => {
    if (!book || claimingEpisodeRef.current) return;
    claimingEpisodeRef.current = true;
    setPendingEpisodeId(episode.id);
    void (async () => {
      try {
        const activeAppService = appService ?? (await envConfig.getAppService());
        const result = await openAudiobookSession({
          appService: activeAppService,
          book,
          episodeId: episode.id,
        });
        if (!result) {
          // The claim failed (episode not found, connection error - both
          // already toasted inside openAudiobookSession); `session` will
          // never update to match, so the effect below would wait forever.
          // Clear the busy state here instead.
          setPendingEpisodeId(null);
          return;
        }
        // Read the OUTGOING controller's rate at APPLY time, not at tap
        // time: `session` (this closure's, unaffected by any later
        // re-render) still references the pre-claim controller, but its
        // rate is a live read off the clock - reading it only now catches a
        // user speed change made on that controller while this claim was in
        // flight, which a rate captured before the first await would have
        // missed. A freshly claimed controller's clock always starts at 1x
        // - without carrying the old rate over, switching episodes would
        // silently drop playback back to 1x while PlayerView kept showing
        // the old rate until its own controller-swap effect re-synced (see
        // PlayerView.tsx). undefined when there is no prior controller (the
        // very first episode claim).
        const previousRate = session?.controller.rate;
        if (previousRate !== undefined && previousRate !== result.controller.rate) {
          void result.controller.setRate(previousRate);
        }
        setSession(result);
        if (result.controller.state === 'stopped') {
          void result.controller.start();
        }
        // On success, pendingEpisodeId is deliberately left set here - the
        // effect below clears it once `session.controller.getEpisodeId()`
        // actually equals it, which is the SAME condition PlayerView's own
        // effect uses to leave its Episodes subview for the transport view.
        // Both must observe the match in the same render; clearing it
        // immediately here would race PlayerView's effect and leave it
        // stuck showing the episode list forever after a successful claim.
      } catch {
        setPendingEpisodeId(null);
      } finally {
        claimingEpisodeRef.current = false;
      }
    })();
  };

  // See handleSelectEpisode's success-path comment above for why this is a
  // separate effect rather than an inline clear.
  useEffect(() => {
    if (pendingEpisodeId && session?.controller.getEpisodeId() === pendingEpisodeId) {
      setPendingEpisodeId(null);
    }
  }, [session, pendingEpisodeId]);

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
          onSelectEpisode={handleSelectEpisode}
          pendingEpisodeId={pendingEpisodeId}
        />
      ) : libraryLoaded && book && isAudiobook(book) && !session && episodes ? (
        <div className='bg-base-100 flex h-full w-full flex-col overflow-hidden'>
          <div className='relative flex h-12 w-full items-center px-2'>
            <button
              type='button'
              aria-label={_('Go Back')}
              onClick={handleGoBack}
              className='btn btn-ghost btn-circle z-10 flex h-9 min-h-9 w-9'
            >
              <IoArrowBack size={iconSize24 * 0.85} className='rtl:rotate-180' />
            </button>
            <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-16 text-center'>
              <span className='line-clamp-1 text-sm font-semibold'>{book.title}</span>
              <span className='text-base-content/70 line-clamp-1 text-xs'>{_('Episodes')}</span>
            </div>
          </div>
          <div className='flex w-full flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-6 pt-2'>
            <EpisodesView
              episodes={episodes.episodes}
              progressByEpisodeId={episodes.progressByEpisodeId}
              pendingEpisodeId={pendingEpisodeId ?? undefined}
              onSelectEpisode={handleSelectEpisode}
            />
          </div>
        </div>
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
