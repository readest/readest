import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Book, BookConfig, BookNote } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

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

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: 'local-loc' }),
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
