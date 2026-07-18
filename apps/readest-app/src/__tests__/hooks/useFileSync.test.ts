import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor as waitForWithOptions } from '@testing-library/react';
import type { Book, BookConfig, BookNote } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import { FileSyncError } from '@/services/sync/file/provider';
import { eventDispatcher } from '@/utils/event';

const waitFor = <T>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a book
 * being read can mirror to several file-sync backends (WebDAV, Google Drive,
 * S3, OneDrive) at once. `useFileSync` used to be built around exactly one
 * active backend; these tests cover the multi-backend loop, in particular the
 * pull merge CHAIN — backend 2 must merge on top of what backend 1 already
 * merged, not the original local config, or backend 1's contribution is
 * silently dropped.
 */

const pushBookConfig = vi.fn(
  async (_book: Book, _config: BookConfig, _deviceId: string) => undefined,
);
const pullBookConfig = vi.fn(
  async (_book: Book, _config: BookConfig) => ({ applied: false }) as never,
);
const pushBookFile = vi.fn(async (_book: Book) => ({ uploaded: true }));
const pushBookCover = vi.fn(async (_book: Book) => ({ uploaded: true }));

vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: vi.fn(function (this: Record<string, unknown>) {
    this['pushBookConfig'] = pushBookConfig;
    this['pullBookConfig'] = pullBookConfig;
    this['pushBookFile'] = pushBookFile;
    this['pushBookCover'] = pushBookCover;
  }),
}));

vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: vi.fn(async () => ({}) as never),
}));

vi.mock('@/services/sync/file/appLocalStore', () => ({
  createAppLocalStore: vi.fn(() => ({}) as never),
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  canBackendRun: vi.fn(() => true),
}));

// Per-test-settable routing input: which backends are enabled right now.
const routing = vi.hoisted(() => ({
  backends: [] as FileSyncBackendKind[],
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  getActiveFileSyncBackends: () => routing.backends,
  settingsKeyForBackend: (kind: FileSyncBackendKind) => (kind === 'gdrive' ? 'googleDrive' : kind),
}));

vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'pro' }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Stable references across renders: a fresh object per call would make the
// engine-building effect (keyed in part on `appService`/`envConfig`) refire
// every render and loop forever.
const envMocks = vi.hoisted(() => ({ envConfig: {}, appService: {} }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => envMocks,
}));

vi.mock('@/app/reader/hooks/useWindowActiveChanged', () => ({
  useWindowActiveChanged: () => {},
}));

const settingsState = vi.hoisted(() => ({
  settings: {
    webdav: { enabled: true, serverUrl: 'https://dav.example', username: 'u', password: 'p' },
    googleDrive: { enabled: true },
  } as unknown as SystemSettings,
}));
const setSettingsMock = vi.fn((next: SystemSettings) => {
  settingsState.settings = next;
});
const saveSettingsMock = vi.fn(async () => {});

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = () => ({
    settings: settingsState.settings,
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
  });
  useSettingsStore.getState = () => ({
    settings: settingsState.settings,
    setSettings: setSettingsMock,
    saveSettings: saveSettingsMock,
  });
  return { useSettingsStore };
});

const makeBook = (): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'Book 1',
  sourceTitle: 'Book 1',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
});

const bookDataState = vi.hoisted(() => ({
  config: { updatedAt: 1, location: 'local-loc', booknotes: [] } as BookConfig,
}));
const getConfigMock = vi.fn((_key: string) => bookDataState.config);
const setConfigMock = vi.fn((_key: string, partial: Partial<BookConfig>) => {
  bookDataState.config = { ...bookDataState.config, ...partial };
});
const saveConfigMock = vi.fn(async () => {});
const getBookDataMock = vi.fn(() => ({ book: makeBook() }));

vi.mock('@/store/bookDataStore', () => {
  const state = {
    getConfig: getConfigMock,
    setConfig: setConfigMock,
    saveConfig: saveConfigMock,
    getBookData: getBookDataMock,
  };
  const useBookDataStore = <R>(selector?: (s: typeof state) => R) =>
    selector ? selector(state) : (state as unknown as R);
  useBookDataStore.getState = () => state;
  return { useBookDataStore };
});

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => null,
    getViewsById: () => [],
    getViewState: () => ({ previewMode: false }),
  };
  const useReaderStore = <R>(selector?: (s: typeof state) => R) =>
    selector ? selector(state) : (state as unknown as R);
  useReaderStore.getState = () => state;
  return { useReaderStore };
});

// Mutable so lock tests can drive the real user path: dispatch the manual
// pull event, then change the location (a page turn) to make the open-book
// effect re-fire, instead of calling the uploaders directly.
const progressState = vi.hoisted(() => ({ location: 'local-loc' }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: progressState.location }),
}));

const { useFileSync } = await import('@/app/reader/hooks/useFileSync');

const noteA: BookNote = {
  id: 'a',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2/2:0)',
  note: '',
  createdAt: 1,
  updatedAt: 1,
};
const noteB: BookNote = {
  id: 'b',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/2:0)',
  note: '',
  createdAt: 2,
  updatedAt: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  routing.backends = ['webdav', 'gdrive'];
  settingsState.settings = {
    webdav: { enabled: true, serverUrl: 'https://dav.example', username: 'u', password: 'p' },
    googleDrive: { enabled: true },
  } as unknown as SystemSettings;
  bookDataState.config = { updatedAt: 1, location: 'local-loc', booknotes: [] };
  progressState.location = 'local-loc';
  pushBookConfig.mockResolvedValue(undefined);
  pullBookConfig.mockResolvedValue({ applied: false } as never);
  pushBookFile.mockResolvedValue({ uploaded: true });
  pushBookCover.mockResolvedValue({ uploaded: true });
});

afterEach(() => {
  cleanup();
});

describe('useFileSync across multiple backends (#5062)', () => {
  test('pulling from two backends chains the merges', async () => {
    // Backend 1 (webdav) merges in a newer location; backend 2 (gdrive) must
    // receive THAT config, not the original local one, so both mirrors'
    // data survives.
    pullBookConfig
      .mockResolvedValueOnce({
        applied: true,
        mergedConfig: { updatedAt: 2, location: 'from-webdav', booknotes: [noteA] },
        mergedNotes: [noteA],
      } as never)
      .mockResolvedValueOnce({
        applied: true,
        mergedConfig: { updatedAt: 3, location: 'from-webdav', booknotes: [noteA, noteB] },
        mergedNotes: [noteA, noteB],
      } as never);

    renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pullBookConfig).toHaveBeenCalledTimes(2));

    // The second call received the first call's merged output as its input,
    // not the original local config.
    expect(pullBookConfig.mock.calls[1]?.[1]).toMatchObject({ location: 'from-webdav' });
    expect(setConfigMock).toHaveBeenCalledWith(
      'h1-view1',
      expect.objectContaining({ booknotes: [noteA, noteB] }),
    );
  });

  test('pushes the config to every enabled backend', async () => {
    // The default pull resolves `applied: false` (empty remote), which makes
    // the open-pull effect fall through to an immediate push.
    renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));
  });

  test('one backend failing does not stop the other', async () => {
    pushBookConfig.mockRejectedValueOnce(new Error('drive down')).mockResolvedValueOnce(undefined);

    renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));
  });
});

/**
 * Review fixes on top of the initial multi-backend conversion: a single
 * boolean auth-notified guard re-firing forever, a cross-backend sub-toggle
 * leak in the pull chain, and three failure-isolation / lock-release paths
 * that were never pinned by a test.
 */
describe('useFileSync review fixes', () => {
  test('one backend pull failing does not stop the other from applying (no break in the catch)', async () => {
    // webdav's pull throws; gdrive's must still run and its merge must still
    // land in the applied config — a `break` in the catch would abort the
    // loop after webdav and gdrive would never be called.
    pullBookConfig.mockRejectedValueOnce(new Error('webdav down')).mockResolvedValueOnce({
      applied: true,
      mergedConfig: { updatedAt: 2, location: 'from-gdrive', booknotes: [] },
    } as never);

    renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pullBookConfig).toHaveBeenCalledTimes(2));
    expect(setConfigMock).toHaveBeenCalledWith(
      'h1-view1',
      expect.objectContaining({ location: 'from-gdrive' }),
    );
  });

  // These four tests drive the real user path instead of calling the
  // uploaders directly: `handlePull` (the manual "Sync now" pull bridge)
  // resets `lastPulledAtRef` / `hasPulledOnce` but does NOT touch the upload
  // locks, so the open-book effect re-firing on the next `progress.location`
  // change (a page turn) re-runs `pushBookFileNow` / `pushBookCoverNow` with
  // the locks intact — a genuine "tap Sync now, then turn a page" flow.
  // Every `pullBookConfig` call is made to reject so `lastPulledAtRef` stays
  // 0 and the `OPEN_PULL_SKIP_MS` gate never blocks the re-run; no fake
  // timers needed.

  test('a failed book-file upload releases the backend lock so a later attempt retries', async () => {
    routing.backends = ['webdav'];
    settingsState.settings = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav.example',
        username: 'u',
        password: 'p',
        syncBooks: true,
      },
    } as unknown as SystemSettings;
    pullBookConfig.mockRejectedValue(new Error('remote unreachable'));
    pushBookFile.mockRejectedValueOnce(new Error('network blip'));

    const { rerender } = renderHook(() => useFileSync('h1-view1'));

    // The natural book-open flow drives the first (failing) attempt.
    await waitFor(() => expect(pushBookFile).toHaveBeenCalledTimes(1));

    // Tap "Sync now", then turn a page.
    await eventDispatcher.dispatch('pull-file-sync', { bookKey: 'h1-view1' });
    progressState.location = 'local-loc-2';
    rerender();

    // Must retry because the failed attempt released its own lock.
    await waitFor(() => expect(pushBookFile).toHaveBeenCalledTimes(2));
  });

  test('a backend that uploaded its book file successfully is not re-uploaded on a later attempt', async () => {
    routing.backends = ['webdav'];
    settingsState.settings = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav.example',
        username: 'u',
        password: 'p',
        syncBooks: true,
      },
    } as unknown as SystemSettings;
    pullBookConfig.mockRejectedValue(new Error('remote unreachable'));
    // Default mock resolves { uploaded: true } — the natural attempt succeeds.

    const { rerender } = renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pushBookFile).toHaveBeenCalledTimes(1));

    // Tap "Sync now", then turn a page.
    await eventDispatcher.dispatch('pull-file-sync', { bookKey: 'h1-view1' });
    progressState.location = 'local-loc-2';
    rerender();

    // The second push cycle has been entered (proxy signal for the re-fired
    // effect having run), then flush any remaining microtasks.
    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Still 1 — the lock from the successful attempt stays set.
    expect(pushBookFile).toHaveBeenCalledTimes(1);
  });

  test('a failed cover upload releases the backend lock so a later attempt retries', async () => {
    routing.backends = ['webdav'];
    pullBookConfig.mockRejectedValue(new Error('remote unreachable'));
    pushBookCover.mockRejectedValueOnce(new Error('network blip'));

    const { rerender } = renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pushBookCover).toHaveBeenCalledTimes(1));

    // Tap "Sync now", then turn a page.
    await eventDispatcher.dispatch('pull-file-sync', { bookKey: 'h1-view1' });
    progressState.location = 'local-loc-2';
    rerender();

    await waitFor(() => expect(pushBookCover).toHaveBeenCalledTimes(2));
  });

  test('a backend that uploaded its cover successfully is not re-uploaded on a later attempt', async () => {
    routing.backends = ['webdav'];
    pullBookConfig.mockRejectedValue(new Error('remote unreachable'));
    // Default mock resolves { uploaded: true } — the natural attempt succeeds.

    const { rerender } = renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pushBookCover).toHaveBeenCalledTimes(1));

    // Tap "Sync now", then turn a page.
    await eventDispatcher.dispatch('pull-file-sync', { bookKey: 'h1-view1' });
    progressState.location = 'local-loc-2';
    rerender();

    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Still 1 — the lock from the successful attempt stays set.
    expect(pushBookCover).toHaveBeenCalledTimes(1);
  });

  test('the expired-session hint fires once per backend across many push cycles while a sibling keeps succeeding', async () => {
    routing.backends = ['webdav', 'gdrive'];
    // Engines are built in `activeKinds` order (webdav, then gdrive), and
    // every push cycle calls pushBookConfig once per engine in that fixed
    // order — so odd calls are webdav (kept healthy) and even calls are
    // gdrive (kept expired).
    let callIndex = 0;
    pushBookConfig.mockImplementation(async () => {
      callIndex += 1;
      if (callIndex % 2 === 0) {
        throw new FileSyncError('Drive session expired', 'AUTH_FAILED');
      }
      return undefined;
    });

    const hints: string[] = [];
    const onHint = (e: CustomEvent) => {
      const detail = e.detail as { message?: string } | undefined;
      if (detail?.message) hints.push(detail.message);
    };
    eventDispatcher.on('hint', onHint);

    const { result } = renderHook(() => useFileSync('h1-view1'));

    // Cycle 1: the natural book-open flow (default pull resolves
    // `applied: false`, which falls through to an immediate push).
    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));

    // Cycles 2 and 3, driven directly instead of waiting on the 15s debounce.
    await act(async () => {
      await result.current.pushNow();
    });
    await act(async () => {
      await result.current.pushNow();
    });

    eventDispatcher.off('hint', onHint);

    expect(pushBookConfig).toHaveBeenCalledTimes(6);
    const expiredHints = hints.filter((m) => m === 'Google Drive session expired');
    expect(expiredHints).toHaveLength(1);
  });

  test('a backend with syncNotes false does not contribute its remote notes even when a sibling wants notes', async () => {
    routing.backends = ['webdav', 'gdrive'];
    settingsState.settings = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav.example',
        username: 'u',
        password: 'p',
        syncNotes: false,
      },
      googleDrive: { enabled: true, syncNotes: true },
    } as unknown as SystemSettings;

    // webdav's remote contributes noteA; gdrive's mock mirrors the real
    // engine's union-merge behaviour (it merges what it's handed with its own
    // remote note), so if noteA had leaked past webdav's opt-out it would
    // show up here too.
    pullBookConfig
      .mockImplementationOnce(
        async () =>
          ({
            applied: true,
            mergedConfig: { updatedAt: 2, location: 'local-loc', booknotes: [noteA] },
            mergedNotes: [noteA],
          }) as never,
      )
      .mockImplementationOnce(
        async (_book: Book, config: BookConfig) =>
          ({
            applied: true,
            mergedConfig: {
              updatedAt: 3,
              location: 'local-loc',
              booknotes: [...(config.booknotes ?? []), noteB],
            },
            mergedNotes: [...(config.booknotes ?? []), noteB],
          }) as never,
      );

    renderHook(() => useFileSync('h1-view1'));

    await waitFor(() => expect(pullBookConfig).toHaveBeenCalledTimes(2));
    expect(setConfigMock).toHaveBeenCalledWith(
      'h1-view1',
      expect.objectContaining({ booknotes: [noteB] }),
    );
  });

  test('a push cycle across two backends stamps lastSyncedAt in a single settings save, not one per backend', async () => {
    // Default routing (`beforeEach`) already enables two backends (webdav, gdrive).
    const { result } = renderHook(() => useFileSync('h1-view1'));

    // Let the natural book-open flow settle before isolating a single cycle.
    await waitFor(() => expect(pushBookConfig).toHaveBeenCalledTimes(2));
    saveSettingsMock.mockClear();

    await act(async () => {
      await result.current.pushNow();
    });

    expect(pushBookConfig).toHaveBeenCalledTimes(4);
    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
  });
});
