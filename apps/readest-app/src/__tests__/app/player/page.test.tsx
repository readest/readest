import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';

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
  getSessionByHash: vi.fn(() => null as { bookKey: string; controller: unknown } | null),
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
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: { getSessionByHash: mocks.getSessionByHash },
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/components/Spinner', () => ({
  default: ({ loading }: { loading: boolean }) => (loading ? <div data-testid='spinner' /> : null),
}));
vi.mock('@/app/player/components/PlayerView', () => ({
  default: ({ bookKey }: { bookKey: string }) => <div data-testid='player-view'>{bookKey}</div>,
}));

// NOT mocked: this is the real store. The regression this file pins is
// specifically about how the route reacts to a genuine reactive write on
// it, which a flat (non-reactive) mock of useLibraryStore could not
// reproduce - a static "always the same object" mock is why this path went
// unexercised the first time around.
import { useLibraryStore } from '@/store/libraryStore';
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

describe('PlayerPage under React StrictMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByHash.mockReturnValue(null);
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
