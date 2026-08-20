import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { ABSEpisode, ABSMediaProgress } from '@/types/audiobookshelf';

// React StrictMode (dev-only, e.g. under `pnpm dev-web`) runs every effect
// through mount -> cleanup -> mount again on the SAME component instance
// (refs survive the replay; it is not a real unmount). This used to leave
// the player spinning forever: the ref-based "already opening" guard was set
// before the first await and never cleared, so the replayed effect saw
// "already opening" and returned early, while the FIRST run's own result was
// discarded by its own now-true `cancelled` flag - session state never got
// set. See src/app/player/page.tsx for the fix (an in-flight promise cached
// by book hash, joined by the replay instead of racing or no-op'ing).
//
// The fix for THAT bug introduced a second one, pinned by the third test
// below: reattaching `.then()` to the cached (by-then-settled) promise on
// every effect re-run is fine for `setSession` (idempotent - same object
// reference), but re-firing `start()` off a value frozen at claim time is
// not. The route used to subscribe to the WHOLE library store just to read
// one book by hash, which re-rendered it - and replayed this effect - on
// every unrelated store write, including this very session's own
// AbsProgressSyncer#cacheLocally call on pause/tick. That resumed playback
// the user had just paused. The fix reads the store directly instead of
// subscribing, keys the effect on the stable `id` string instead of the
// book's object reference, and checks the controller's CURRENT state before
// calling start() instead of a flag frozen at claim time.
const mocks = vi.hoisted(() => ({
  openAudiobookSession: vi.fn(),
  loadAbsEpisodes: vi.fn(),
  getSessionByHash: vi.fn(() => null as { bookKey: string; controller: unknown } | null),
  // A real listener set (not a mock fn) so tests can simulate the manager
  // firing 'session-changed' by just invoking every registered callback -
  // mirrors what ttsSessionManager.claim()/stopActive() do internally.
  sessionListeners: new Set<() => void>(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=h1'),
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/useLibrary', () => ({
  useLibrary: () => ({ libraryLoaded: true }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => undefined,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0 }, isRoundedWindow: false }),
}));

const appService = {};
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appService }, appService }),
}));

vi.mock('@/services/audiobook/openAudiobook', () => ({
  openAudiobookSession: mocks.openAudiobookSession,
  loadAbsEpisodes: mocks.loadAbsEpisodes,
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getSessionByHash: mocks.getSessionByHash,
    addEventListener: (_type: string, fn: () => void) => {
      mocks.sessionListeners.add(fn);
    },
    removeEventListener: (_type: string, fn: () => void) => {
      mocks.sessionListeners.delete(fn);
    },
  },
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/components/Spinner', () => ({
  default: ({ loading }: { loading: boolean }) => (loading ? <div data-testid='spinner' /> : null),
}));
// A bare stub (this route's own test focus is page.tsx, not PlayerView -
// see PlayerView.test.tsx for that), except for a hidden, text-free button
// that exercises page.tsx's onSelectEpisode prop the same way PlayerView's
// real embedded Episodes subview would - needed to pin the rate carried
// onto a freshly claimed episode controller (page.tsx's own job; see
// handleSelectEpisode). The button has no text content, so it does not
// change `.textContent` for the existing `player-view` assertions below.
vi.mock('@/app/player/components/PlayerView', () => ({
  default: ({
    bookKey,
    onSelectEpisode,
  }: {
    bookKey: string;
    onSelectEpisode: (episode: ABSEpisode) => void;
  }) => (
    <div data-testid='player-view'>
      {bookKey}
      <button
        type='button'
        aria-label='switch-episode'
        onClick={() => onSelectEpisode({ id: 'ep2' } as ABSEpisode)}
      />
    </div>
  ),
}));

// NOT mocked: this is the real store. The regression this file pins is
// specifically about how the route reacts to a genuine reactive write on
// it, which a flat (non-reactive) mock of useLibraryStore could not
// reproduce - a static "always the same object" mock is why this path went
// unexercised the first time around.
import { useLibraryStore } from '@/store/libraryStore';
import { navigateToLibrary } from '@/utils/nav';
import PlayerPage from '@/app/player/page';

const book: Book = {
  hash: 'h1',
  format: 'ABS',
  filePath: 'abs://srv1/item1',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  createdAt: 0,
  updatedAt: 0,
};

// Same hash as `book` - the route's `id` is fixed to 'h1' by the
// next/navigation mock above, so every fixture must resolve through it.
const podcastBook: Book = {
  hash: 'h1',
  format: 'ABS',
  filePath: 'abs://srv1/show1',
  title: 'The Daily Show',
  author: 'A Network',
  absMediaType: 'podcast',
  createdAt: 0,
  updatedAt: 0,
};

const episode1: ABSEpisode = { id: 'ep1', title: 'Episode One', publishedAt: 2000, duration: 600 };
const episode2: ABSEpisode = { id: 'ep2', title: 'Episode Two', publishedAt: 1000, duration: 500 };

describe('PlayerPage under React StrictMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
    useLibraryStore.getState().setLibrary([book]);
  });

  afterEach(() => {
    cleanup();
    useLibraryStore.getState().setLibrary([]);
  });

  it('resolves the session and renders the player through StrictMode double-invoked effects', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    mocks.openAudiobookSession.mockResolvedValue({
      bookKey: 'h1-abc123',
      controller: { kind: 'audiobook', state: 'stopped', start },
    });

    render(
      <StrictMode>
        <PlayerPage />
      </StrictMode>,
    );

    // Pre-fix, this never settles: the spinner spins forever and
    // openAudiobookSession's result is discarded by the stale `cancelled`
    // flag from the replayed effect's own (never-cleared) guard.
    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    expect(screen.getByTestId('player-view').textContent).toBe('h1-abc123');

    // Exactly one open, and exactly one start() - not a second independent
    // claim, and not a second (frozen-flag) resume - racing the first.
    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not resume playback when a library-store write hands the route a new book reference for the same hash', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const controller: { kind: 'audiobook'; state: string; start: typeof start } = {
      kind: 'audiobook',
      state: 'stopped',
      start,
    };
    mocks.openAudiobookSession.mockResolvedValue({ bookKey: 'h1-abc123', controller });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    // The user taps pause in the player - the controller's own state moves
    // out of 'stopped' before anything else happens.
    controller.state = 'paused';

    // AbsProgressSyncer#cacheLocally writes a NEW book object for the SAME
    // hash into the library store unconditionally on pause (and every ~15s
    // tick while playing) - via the real store, so a component that still
    // subscribed reactively to it (as the pre-fix route did) would actually
    // re-render from this, the same way it would in production.
    act(() => {
      useLibraryStore.getState().setLibrary([{ ...book, progress: [10, 100] }]);
    });

    // Give any effect replay a chance to run and any reattached promise
    // handler a chance to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerPage with a podcast show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.sessionListeners.clear();
    useLibraryStore.getState().setLibrary([podcastBook]);
  });

  afterEach(() => {
    cleanup();
    useLibraryStore.getState().setLibrary([]);
  });

  it('renders the Episodes view without claiming a session or navigating away', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    expect(screen.getByText('Episode Two')).toBeTruthy();
    expect(screen.queryByTestId('player-view')).toBeNull();
    expect(mocks.openAudiobookSession).not.toHaveBeenCalled();
    expect(navigateToLibrary).not.toHaveBeenCalled();
  });

  it('adopts an already-live session for the show directly into the transport view', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    mocks.getSessionByHash.mockReturnValue({
      bookKey: 'h1-live',
      controller: { kind: 'audiobook', state: 'playing', start, getEpisodeId: () => 'ep1' },
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    expect(screen.getByTestId('player-view').textContent).toBe('h1-live');
    expect(mocks.openAudiobookSession).not.toHaveBeenCalled();
    expect(mocks.loadAbsEpisodes).not.toHaveBeenCalled();
    // Adopting a live session must not restart playback the user may have
    // already paused.
    expect(start).not.toHaveBeenCalled();
  });

  it('claims a session for the tapped episode and auto-starts it', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    const start = vi.fn().mockResolvedValue(undefined);
    mocks.openAudiobookSession.mockResolvedValue({
      bookKey: 'h1-ep1',
      controller: { kind: 'audiobook', state: 'stopped', start, getEpisodeId: () => 'ep1' },
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    expect(mocks.openAudiobookSession).toHaveBeenCalledWith(
      expect.objectContaining({ book: podcastBook, episodeId: 'ep1' }),
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('carries the previous rate onto a newly claimed episode controller when switching episodes', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    const controller1 = {
      kind: 'audiobook',
      state: 'stopped',
      rate: 1,
      start: vi.fn().mockResolvedValue(undefined),
      setRate: vi.fn().mockResolvedValue(undefined),
      getEpisodeId: () => 'ep1',
    };
    const controller2 = {
      kind: 'audiobook',
      state: 'stopped',
      rate: 1,
      start: vi.fn().mockResolvedValue(undefined),
      setRate: vi.fn().mockResolvedValue(undefined),
      getEpisodeId: () => 'ep2',
    };
    mocks.openAudiobookSession
      .mockResolvedValueOnce({ bookKey: 'h1-ep1', controller: controller1 })
      .mockResolvedValueOnce({ bookKey: 'h1-ep2', controller: controller2 });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));
    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());

    // The controller (not this route) owns rate; this simulates the user
    // having bumped playback speed to 1.5x while episode one was playing.
    controller1.rate = 1.5;

    fireEvent.click(screen.getByLabelText('switch-episode'));

    await waitFor(() => expect(screen.getByTestId('player-view').textContent).toBe('h1-ep2'));
    // The new controller's clock always starts at 1x - without carrying the
    // old rate over, the switch would silently drop back to 1x.
    expect(controller2.setRate).toHaveBeenCalledWith(1.5);
  });

  it('does not call setRate on the very first episode claim (no prior controller)', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    const setRate = vi.fn().mockResolvedValue(undefined);
    mocks.openAudiobookSession.mockResolvedValue({
      bookKey: 'h1-ep1',
      controller: {
        kind: 'audiobook',
        state: 'stopped',
        rate: 1,
        start: vi.fn().mockResolvedValue(undefined),
        setRate,
        getEpisodeId: () => 'ep1',
      },
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    expect(setRate).not.toHaveBeenCalled();
  });

  it('applies the outgoing controller rate at claim-resolution time, not tap time', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    const controller1 = {
      kind: 'audiobook',
      state: 'stopped',
      rate: 1,
      start: vi.fn().mockResolvedValue(undefined),
      setRate: vi.fn().mockResolvedValue(undefined),
      getEpisodeId: () => 'ep1',
    };
    const controller2 = {
      kind: 'audiobook',
      state: 'stopped',
      rate: 1,
      start: vi.fn().mockResolvedValue(undefined),
      setRate: vi.fn().mockResolvedValue(undefined),
      getEpisodeId: () => 'ep2',
    };
    mocks.openAudiobookSession.mockResolvedValueOnce({
      bookKey: 'h1-ep1',
      controller: controller1,
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));
    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());

    let resolveSecondClaim!: (value: { bookKey: string; controller: typeof controller2 }) => void;
    mocks.openAudiobookSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecondClaim = resolve;
      }),
    );

    fireEvent.click(screen.getByLabelText('switch-episode'));

    // The user changes speed on the OUTGOING (episode one) controller while
    // the episode-two claim is still in flight - a rate captured at tap
    // time (before this) would miss it.
    controller1.rate = 1.75;

    await act(async () => {
      resolveSecondClaim({ bookKey: 'h1-ep2', controller: controller2 });
    });

    await waitFor(() => expect(screen.getByTestId('player-view').textContent).toBe('h1-ep2'));
    expect(controller2.setRate).toHaveBeenCalledWith(1.75);
  });

  it('returns to the Episodes view with refreshed progress once the episode session ends', async () => {
    const finishedProgress: ABSMediaProgress = {
      libraryItemId: 'show1',
      episodeId: 'ep1',
      currentTime: 600,
      duration: 600,
      isFinished: true,
      lastUpdate: 0,
    };
    mocks.loadAbsEpisodes
      .mockResolvedValueOnce({ episodes: [episode1], progressByEpisodeId: new Map() })
      .mockResolvedValueOnce({
        episodes: [episode1],
        progressByEpisodeId: new Map([['ep1', finishedProgress]]),
      });
    const start = vi.fn().mockResolvedValue(undefined);
    mocks.openAudiobookSession.mockResolvedValue({
      bookKey: 'h1-ep1',
      controller: { kind: 'audiobook', state: 'stopped', start, getEpisodeId: () => 'ep1' },
    });

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));
    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());

    // The live session ends elsewhere (natural end, error, or user stop).
    mocks.getSessionByHash.mockReturnValue(null);
    act(() => {
      mocks.sessionListeners.forEach((fn) => fn());
    });

    await waitFor(() => expect(screen.queryByTestId('player-view')).toBeNull());
    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    expect(mocks.loadAbsEpisodes).toHaveBeenCalledTimes(2);
  });

  it('bounces to the library when the adopted session ends and the episode refetch fails', async () => {
    // Adopting a live session skips episode loading entirely (asserted
    // above), so `episodes` is still null when this session ends - the
    // route has nothing to fall back to except a fresh loadAbsEpisodes
    // call. If that call also fails (server gone, fetch error), the route
    // must not just swallow it and sit on the bare spinner forever.
    const start = vi.fn().mockResolvedValue(undefined);
    mocks.getSessionByHash.mockReturnValue({
      bookKey: 'h1-live',
      controller: { kind: 'audiobook', state: 'playing', start, getEpisodeId: () => 'ep1' },
    });
    mocks.loadAbsEpisodes.mockResolvedValue(null);

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());

    mocks.getSessionByHash.mockReturnValue(null);
    act(() => {
      mocks.sessionListeners.forEach((fn) => fn());
    });

    await waitFor(() => expect(navigateToLibrary).toHaveBeenCalledTimes(1));
  });

  it('ignores a second episode tap while a claim is already in flight', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    let resolveClaim!: (value: {
      bookKey: string;
      controller: {
        kind: 'audiobook';
        state: string;
        start: () => Promise<void>;
        getEpisodeId: () => string;
      };
    }) => void;
    mocks.openAudiobookSession.mockReturnValue(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));
    fireEvent.click(screen.getByText('Episode Two'));

    // Let any (incorrectly) fired second claim's microtasks start.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Pre-fix: two taps before the first claim settles put two full claims
    // in flight (two getItemExpanded fetches, two server sessions). Only
    // the first tap's claim must have gone out.
    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);
    expect(mocks.openAudiobookSession).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: 'ep1' }),
    );

    const start = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      resolveClaim({
        bookKey: 'h1-ep1',
        controller: { kind: 'audiobook', state: 'stopped', start, getEpisodeId: () => 'ep1' },
      });
    });

    await waitFor(() => expect(screen.getByTestId('player-view')).toBeTruthy());
    // Still just the one claim - the guard must have cleared after settling
    // rather than leaving the route permanently locked out, but nothing here
    // re-tapped, so no second claim should exist either.
    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);
  });

  it('clears the pending row and allows a retap when the claim fails', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    // A failed claim (episode not found, connection error) already toasts
    // and resolves null - openAudiobookSession never rejects for this.
    let resolveClaim!: (value: null) => void;
    mocks.openAudiobookSession.mockReturnValue(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));

    // Confirms the row actually went busy first - a route that never wires
    // pendingEpisodeId through would trivially "clear" a row that was never
    // marked busy in the first place.
    expect(screen.getByText('Episode One').closest('button')?.getAttribute('aria-busy')).toBe(
      'true',
    );

    await act(async () => {
      resolveClaim(null);
    });

    // Pre-fix: nothing ever cleared pendingEpisodeId on a null result, so
    // the tapped row stayed aria-busy="true" forever.
    await waitFor(() =>
      expect(screen.getByText('Episode One').closest('button')?.getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
    expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1);

    // Retapping must actually go out - not silently swallowed by a
    // re-entrancy guard that never cleared.
    fireEvent.click(screen.getByText('Episode One'));
    await waitFor(() => expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(2));
  });

  it('shows the pending state on the route-level Episodes list while a claim is in flight', async () => {
    mocks.loadAbsEpisodes.mockResolvedValue({
      episodes: [episode1, episode2],
      progressByEpisodeId: new Map(),
    });
    let resolveClaim!: (value: null) => void;
    mocks.openAudiobookSession.mockReturnValue(
      new Promise((resolve) => {
        resolveClaim = resolve;
      }),
    );

    render(<PlayerPage />);

    await waitFor(() => expect(screen.getByText('Episode One')).toBeTruthy());
    fireEvent.click(screen.getByText('Episode One'));

    expect(screen.getByText('Episode One').closest('button')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    // Only the tapped row is busy, not every row in the list.
    expect(screen.getByText('Episode Two').closest('button')?.getAttribute('aria-busy')).toBe(
      'false',
    );

    await act(async () => {
      resolveClaim(null);
      await Promise.resolve();
    });
  });
});
