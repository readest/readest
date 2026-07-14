import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a user
 * can mirror the library to Readest Cloud AND a file backend (WebDAV, Google
 * Drive, S3, OneDrive) at once. `pullLibrary` in useBooksSync.ts therefore has
 * four routing paths depending on which of {Readest Cloud, a file backend}
 * are enabled:
 *
 *   - both enabled:        the file pass runs, THEN the native pull also runs
 *   - file backend only:   the file pass runs, the native pull does not
 *   - Readest Cloud only:  the native pull runs, the file pass does not
 *   - neither (not covered here; nothing runs)
 *
 * `isReadestCloudEnabled` and `getActiveFileSyncBackends` are settable per
 * test (unlike demo-books-sync.test.tsx, which hardcodes them to the one
 * scenario where none of these branches can be observed) so every path, plus
 * the verbose-toast-fires-once invariant and the handleAutoSync mixed-fleet
 * probe gate, can actually be exercised.
 */

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
  generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  downloadBookCovers: vi.fn(async () => {}),
}));

const syncState = vi.hoisted(() => ({
  useSyncInited: true,
  syncedBooks: null as Book[] | null,
  syncBooks: vi.fn(async (_books?: Book[], _op?: string, _since?: number) => 0),
  // Kept falsy so the auto-sync effect's 'both' branch (which is not what
  // these tests are about) never fires and never contends with pullLibrary
  // over the shared isPullingRef guard. See the module doc comment above.
  lastSyncedAtBooks: 0,
}));

// Per-test-settable routing inputs, read by the mocked cloudSyncProvider
// functions below instead of being hardcoded to one scenario.
const routing = vi.hoisted(() => ({
  readestEnabled: true,
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runActiveFileLibrarySync = vi.hoisted(() => vi.fn(async () => ({ booksSynced: 1 })));

const checkMixedFleetOnce = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

vi.mock('@/context/SyncContext', () => ({
  useSyncContext: () => ({ syncClient: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => syncState,
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isReadestCloudEnabled: () => routing.readestEnabled,
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runActiveFileLibrarySync,
}));

vi.mock('@/services/sync/fleetDetection', () => ({
  checkMixedFleetOnce,
}));

const { useBooksSync } = await import('@/app/library/hooks/useBooksSync');
const { useLibraryStore } = await import('@/store/libraryStore');
const { eventDispatcher } = await import('@/utils/event');

beforeEach(() => {
  vi.clearAllMocks();
  syncState.syncedBooks = null;
  syncState.lastSyncedAtBooks = 0;
  routing.readestEnabled = true;
  routing.backends = [];
  useLibraryStore.setState({ library: [], libraryLoaded: true, isSyncing: false });
});

afterEach(() => {
  // Without this, a hook instance left mounted from a prior test can
  // re-render (its `pullLibrary` callback is unstable across renders because
  // the mocked useEnv returns a fresh `envConfig` object every time) when a
  // later test mutates the shared zustand stores, re-firing its effects with
  // that later test's routing values and polluting its mock call counts.
  cleanup();
});

describe('useBooksSync pullLibrary routing (issue #5062)', () => {
  it('runs both the file pass and the native pull when both providers are enabled', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    renderHook(() => useBooksSync());

    // The mount effect calls pullLibrary() once automatically; this is the
    // critical assertion — a check that only the file pass ran would not
    // catch a regression that returns before the native pull ever starts.
    await waitFor(() => expect(runActiveFileLibrarySync).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    const pullCalls = syncState.syncBooks.mock.calls.filter((call) => call[1] === 'pull');
    expect(pullCalls.length).toBeGreaterThan(0);
  });

  it('runs only the file pass when Readest Cloud is off and a file backend is on', async () => {
    routing.readestEnabled = false;
    routing.backends = ['webdav'];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(runActiveFileLibrarySync).toHaveBeenCalled());
    // Give any (incorrect) native call a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncState.syncBooks).not.toHaveBeenCalled();
  });

  it('runs only the native pull when Readest Cloud is on and no file backend is on', async () => {
    routing.readestEnabled = true;
    routing.backends = [];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());
    const pullCalls = syncState.syncBooks.mock.calls.filter((call) => call[1] === 'pull');
    expect(pullCalls.length).toBeGreaterThan(0);
    expect(runActiveFileLibrarySync).not.toHaveBeenCalled();
  });

  it('toasts exactly once for a verbose pull when both providers are enabled', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksSync());

    // Let the mount effect's non-verbose pullLibrary() call settle first so it
    // doesn't contend with the explicit call below over isPullingRef.
    await waitFor(() => expect(runActiveFileLibrarySync).toHaveBeenCalled());
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());

    dispatchSpy.mockClear();
    runActiveFileLibrarySync.mockClear();
    syncState.syncBooks.mockClear();

    await act(async () => {
      await result.current.pullLibrary(false, true);
    });

    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
  });
});

describe('useBooksSync handleAutoSync mixed-fleet probe gate (issue #5062)', () => {
  it('runs the mixed-fleet probe when Readest Cloud is off', async () => {
    routing.readestEnabled = false;
    routing.backends = ['webdav'];

    renderHook(() => useBooksSync());

    await waitFor(() => expect(checkMixedFleetOnce).toHaveBeenCalled());
  });

  it('does not run the mixed-fleet probe when Readest Cloud is on', async () => {
    routing.readestEnabled = true;
    routing.backends = [];

    renderHook(() => useBooksSync());

    // A probe warning "another device still syncs via Readest Cloud" is
    // meaningless while this device also syncs via Readest Cloud. Wait for
    // the native pull (which does run in this scenario) as a sync point
    // before asserting the probe never fired.
    await waitFor(() => expect(syncState.syncBooks).toHaveBeenCalled());
    expect(checkMixedFleetOnce).not.toHaveBeenCalled();
  });
});
