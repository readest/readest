import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import type { SystemSettings } from '@/types/settings';

const syncLibrary = vi.fn().mockResolvedValue({ booksSynced: 0 });
const pushBookFile = vi.fn().mockResolvedValue({ uploaded: true });
const pushBookCover = vi.fn().mockResolvedValue({ uploaded: true });
const downloadBookFile = vi.fn().mockResolvedValue(true);

vi.mock('@/services/sync/file/providerRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/file/providerRegistry')>();
  return {
    ...actual,
    createFileSyncProvider: vi.fn(async () => ({}) as never),
  };
});

vi.mock('@/services/sync/file/appLocalStore', () => ({
  createAppLocalStore: vi.fn(() => ({}) as never),
}));

vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: vi.fn(function (this: Record<string, unknown>) {
    this['syncLibrary'] = syncLibrary;
    this['pushBookFile'] = pushBookFile;
    this['pushBookCover'] = pushBookCover;
    this['downloadBookFile'] = downloadBookFile;
  }),
}));

import {
  runActiveFileBookDownload,
  runActiveFileBookUpload,
  runActiveFileLibrarySync,
} from '@/services/sync/file/runLibrarySync';
import type { Book } from '@/types/book';

const makeBook = (hash: string): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
});

const translationFn = (key: string, params?: Record<string, string | number>) => {
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  }
  return key;
};

const envConfig = {
  getAppService: vi.fn(async () => ({ saveSettings: vi.fn() }) as never),
} as never;

const setProvider = (patch: Partial<SystemSettings>): void => {
  useSettingsStore.setState({
    settings: {
      version: 1,
      webdav: { enabled: false },
      googleDrive: { enabled: false },
      ...patch,
    } as SystemSettings,
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  syncLibrary.mockClear().mockResolvedValue({ booksSynced: 0 });
  useFileSyncStore.setState({ byKind: {}, activeKind: null, lastErrorByKind: {} });
  useLibraryStore.setState({ library: [], libraryLoaded: true } as never);
});

describe('runActiveFileLibrarySync', () => {
  test('returns false without syncing when readest is the provider', async () => {
    setProvider({});
    expect(await runActiveFileLibrarySync(envConfig, translationFn)).toBe(false);
    expect(syncLibrary).not.toHaveBeenCalled();
  });

  test('runs the engine for the active provider and clears lastError on success', async () => {
    setProvider({
      webdav: { enabled: true, deviceId: 'd1', syncBooks: true, strategy: 'silent' },
    } as Partial<SystemSettings>);
    useFileSyncStore.getState().setLastError('webdav', 'stale error');

    expect(await runActiveFileLibrarySync(envConfig, translationFn)).toBe(true);

    expect(syncLibrary).toHaveBeenCalledTimes(1);
    const [, options] = syncLibrary.mock.calls[0]!;
    expect(options.syncBooks).toBe(true);
    expect(options.deviceId).toBe('d1');
    expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBeNull();
    // Mutex released.
    expect(useFileSyncStore.getState().activeKind).toBeNull();
  });

  test('records lastError and releases the mutex when the engine fails', async () => {
    setProvider({
      webdav: { enabled: true, deviceId: 'd1' },
    } as Partial<SystemSettings>);
    syncLibrary.mockRejectedValueOnce(new Error('server unreachable'));

    expect(await runActiveFileLibrarySync(envConfig, translationFn)).toBe(false);

    expect(useFileSyncStore.getState().lastErrorByKind.webdav).toContain('server unreachable');
    expect(useFileSyncStore.getState().activeKind).toBeNull();
  });

  test('skips when the library has not loaded (would push an empty index)', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    useLibraryStore.setState({ libraryLoaded: false } as never);
    expect(await runActiveFileLibrarySync(envConfig, translationFn)).toBe(false);
    expect(syncLibrary).not.toHaveBeenCalled();
  });

  test('skips when another backend holds the library-sync mutex', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    useFileSyncStore.getState().beginSync('gdrive', 'busy');
    expect(await runActiveFileLibrarySync(envConfig, translationFn)).toBe(false);
    expect(syncLibrary).not.toHaveBeenCalled();
  });
});

// The Book Details / bookshelf cloud buttons route here when a third-party
// provider is selected, instead of the (gated) Readest Cloud transfer queue.
describe('runActiveFileBookUpload', () => {
  test('returns false without touching the engine when readest is the provider', async () => {
    setProvider({});
    expect(await runActiveFileBookUpload(envConfig, makeBook('h1'))).toBe(false);
    expect(pushBookFile).not.toHaveBeenCalled();
  });

  test('pushes the file (plus cover) for the active provider', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(await runActiveFileBookUpload(envConfig, makeBook('h1'))).toBe(true);
    expect(pushBookFile).toHaveBeenCalledTimes(1);
    expect(pushBookCover).toHaveBeenCalledTimes(1);
  });

  test('treats an already-mirrored file as success', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    pushBookFile.mockResolvedValueOnce({ uploaded: false, reason: 'remote-matches' });
    expect(await runActiveFileBookUpload(envConfig, makeBook('h1'))).toBe(true);
  });

  test('fails when the book has no local source', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    pushBookFile.mockResolvedValueOnce({ uploaded: false, reason: 'no-source' });
    expect(await runActiveFileBookUpload(envConfig, makeBook('h1'))).toBe(false);
  });

  test('returns false instead of throwing when the engine fails', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    pushBookFile.mockRejectedValueOnce(new Error('server unreachable'));
    expect(await runActiveFileBookUpload(envConfig, makeBook('h1'))).toBe(false);
  });
});

describe('runActiveFileBookDownload', () => {
  test('returns false without touching the engine when readest is the provider', async () => {
    setProvider({});
    expect(await runActiveFileBookDownload(envConfig, makeBook('h1'))).toBe(false);
    expect(downloadBookFile).not.toHaveBeenCalled();
  });

  test('downloads via the engine and stamps downloadedAt', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    const book = makeBook('h1');
    expect(await runActiveFileBookDownload(envConfig, book)).toBe(true);
    expect(downloadBookFile).toHaveBeenCalledTimes(1);
    expect(book.downloadedAt).toBeTruthy();
  });

  test('returns false and leaves the book unstamped when the remote has no file', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    downloadBookFile.mockResolvedValueOnce(false);
    const book = makeBook('h1');
    expect(await runActiveFileBookDownload(envConfig, book)).toBe(false);
    expect(book.downloadedAt).toBeUndefined();
  });

  test('returns false instead of throwing when the engine fails', async () => {
    setProvider({ webdav: { enabled: true } } as Partial<SystemSettings>);
    downloadBookFile.mockRejectedValueOnce(new Error('server unreachable'));
    expect(await runActiveFileBookDownload(envConfig, makeBook('h1'))).toBe(false);
  });
});
