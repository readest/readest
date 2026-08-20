import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';

// Defect A (see the pause-investigation report's "unrelated defects" section):
// pressing the Android system Back button while /player is open used to reach
// Kotlin's default handler (no JS-side back-key interception was ever
// acquired for this route) and finish() the whole activity, killing
// background playback. The reader route avoids this by acquiring back-key
// interception and routing 'Back' through its own in-app navigation - the
// player route must do the same, reusing the header back button's
// handleGoBack (which already floors at navigateToLibrary when there is
// nothing to pop back to, matching the deep-link-with-no-history case this
// test pins).
const mocks = vi.hoisted(() => ({
  openAudiobookSession: vi.fn(),
  loadAbsEpisodes: vi.fn(),
  getSessionByHash: vi.fn(() => null as { bookKey: string; controller: unknown } | null),
  acquireBackKeyInterception: vi.fn(),
  releaseBackKeyInterception: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=h1'),
}));

const routerBack = vi.fn();
vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: routerBack }),
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

const appService: { isAndroidApp: boolean } = { isAndroidApp: true };
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
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

// The device store owns the native back-key interception plumbing (acquire
// re-installs window.onNativeKeyDown -> interceptKeys IPC call, which has no
// native side in this test environment). Only the acquire/release calls
// themselves are asserted here; the JS routing decision made once a 'Back'
// event actually arrives is exercised through the real eventDispatcher below.
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: mocks.acquireBackKeyInterception,
    releaseBackKeyInterception: mocks.releaseBackKeyInterception,
  }),
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

import { useLibraryStore } from '@/store/libraryStore';
import { navigateToLibrary } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
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

describe('PlayerPage — Android system Back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appService.isAndroidApp = true;
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.openAudiobookSession.mockResolvedValue({
      bookKey: 'h1-abc123',
      controller: {
        kind: 'audiobook',
        state: 'stopped',
        start: vi.fn().mockResolvedValue(undefined),
      },
    });
    useLibraryStore.getState().setLibrary([book]);
  });

  afterEach(() => {
    cleanup();
    useLibraryStore.getState().setLibrary([]);
  });

  it('acquires native back-key interception on mount and releases it on unmount', async () => {
    const { unmount } = render(<PlayerPage />);
    await waitFor(() => expect(mocks.acquireBackKeyInterception).toHaveBeenCalledTimes(1));

    expect(mocks.releaseBackKeyInterception).not.toHaveBeenCalled();
    unmount();
    expect(mocks.releaseBackKeyInterception).toHaveBeenCalledTimes(1);
  });

  it('routes a native Back event to the library instead of leaving it for the OS default', async () => {
    render(<PlayerPage />);
    await waitFor(() => expect(mocks.acquireBackKeyInterception).toHaveBeenCalledTimes(1));

    // Simulates the JS-side event MainActivity.kt's onNativeKeyDown("Back", 4)
    // forwards once interception is acquired. jsdom's window.history has
    // nothing to pop (length 1), the same as a cold deep-link launch - so
    // this must floor at navigateToLibrary exactly like the header back
    // button's handleGoBack does, not fall through to the OS default
    // (finish the activity).
    eventDispatcher.dispatchSync('native-key-down', { keyName: 'Back', keyCode: 4 });

    expect(navigateToLibrary).toHaveBeenCalledTimes(1);
    expect(routerBack).not.toHaveBeenCalled();
  });

  it('does not acquire back-key interception outside the Android app', async () => {
    appService.isAndroidApp = false;
    render(<PlayerPage />);
    await waitFor(() => expect(mocks.openAudiobookSession).toHaveBeenCalledTimes(1));

    expect(mocks.acquireBackKeyInterception).not.toHaveBeenCalled();
  });
});
