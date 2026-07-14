import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import { setCachedUserPlan } from '@/services/sync/cloudSyncProvider';
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
  runFileBookDownload,
  runFileBookUpload,
  runFileLibrarySyncPass,
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

const multiProviderSettings = {
  version: 1,
  readestCloud: { enabled: false },
  webdav: {
    enabled: true,
    serverUrl: 'https://dav',
    username: 'u',
    password: 'p',
    rootPath: '/',
    syncBooks: true,
  },
  googleDrive: { enabled: true, syncBooks: true },
} as unknown as SystemSettings;

describe('runFileLibrarySyncPass', () => {
  beforeEach(() => {
    syncLibrary.mockReset().mockResolvedValue({ booksSynced: 1 });
    useSettingsStore.getState().setSettings(multiProviderSettings);
    useLibraryStore.setState({ library: [makeBook('h1')], libraryLoaded: true });
    useFileSyncStore.setState({ byKind: {}, activeKind: null, lastErrorByKind: {} });
    setCachedUserPlan('pro');
  });

  test('runs every enabled backend in a fixed order and sums the result', async () => {
    const result = await runFileLibrarySyncPass(envConfig, translationFn);
    expect(syncLibrary).toHaveBeenCalledTimes(2);
    expect(result?.booksSynced).toBe(2);
  });

  test('holds the mutex for the whole pass', async () => {
    let lockedDuringPass: boolean | null = null;
    syncLibrary.mockImplementation(async () => {
      // A racing auto-sync must be refused while the pass is mid-flight.
      lockedDuringPass = useFileSyncStore.getState().beginSync('s3', 'Syncing…') === false;
      return { booksSynced: 1 };
    });
    await runFileLibrarySyncPass(envConfig, translationFn);
    expect(lockedDuringPass).toBe(true);
    // ...and the lock is free again afterwards.
    expect(useFileSyncStore.getState().activeKind).toBeNull();
  });

  // The check above only observes the lock from inside a backend's own
  // syncLibrary call, which is always mid-acquisition by construction — it
  // cannot see a release-then-reacquire between backends, because releasing
  // and reacquiring back to back has no `await` between them for anything
  // else to run in. Subscribing to the store directly records every
  // transition `set()` produces (beginSync/switchSync/endSync each call it
  // once), so a hand-off that dips through `null` becomes visible even
  // though nothing outside the store could ever race into that instant.
  test('hands the lock directly from one backend to the next, never through a released state', async () => {
    const activeKindHistory: (string | null)[] = [];
    const unsubscribe = useFileSyncStore.subscribe((state) => {
      activeKindHistory.push(state.activeKind);
    });
    await runFileLibrarySyncPass(envConfig, translationFn);
    unsubscribe();
    // The final entry is the pass's own closing endSync; every transition
    // before it must already hold some backend's lock.
    expect(activeKindHistory.slice(0, -1)).not.toContain(null);
  });

  test('a failing backend does not stop the others', async () => {
    syncLibrary
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValueOnce({ booksSynced: 3 });

    const result = await runFileLibrarySyncPass(envConfig, translationFn);

    expect(syncLibrary).toHaveBeenCalledTimes(2);
    expect(result?.booksSynced).toBe(3);
    expect(useFileSyncStore.getState().lastErrorByKind.webdav).toBe('token expired');
    expect(useFileSyncStore.getState().lastErrorByKind.gdrive).toBeNull();
  });

  test('returns null when every backend fails', async () => {
    syncLibrary.mockRejectedValue(new Error('offline'));
    expect(await runFileLibrarySyncPass(envConfig, translationFn)).toBeNull();
    expect(useFileSyncStore.getState().activeKind).toBeNull();
  });

  test('does nothing when no backend is enabled', async () => {
    useSettingsStore.getState().setSettings({ version: 1 } as SystemSettings);
    expect(await runFileLibrarySyncPass(envConfig, translationFn)).toBeNull();
    expect(syncLibrary).not.toHaveBeenCalled();
  });

  test('skips when the library has not loaded (would push an empty index)', async () => {
    useLibraryStore.setState({ libraryLoaded: false });
    expect(await runFileLibrarySyncPass(envConfig, translationFn)).toBeNull();
    expect(syncLibrary).not.toHaveBeenCalled();
  });

  test('skips when another backend holds the library-sync mutex', async () => {
    useFileSyncStore.getState().beginSync('s3', 'busy');
    expect(await runFileLibrarySyncPass(envConfig, translationFn)).toBeNull();
    expect(syncLibrary).not.toHaveBeenCalled();
  });
});

describe('runFileBookUpload', () => {
  beforeEach(() => {
    pushBookFile.mockReset().mockResolvedValue({ uploaded: true });
    pushBookCover.mockReset().mockResolvedValue({ uploaded: true });
    useSettingsStore.getState().setSettings(multiProviderSettings);
    setCachedUserPlan('pro');
  });

  test('pushes the book to every enabled backend', async () => {
    expect(await runFileBookUpload(envConfig, makeBook('h1'))).toBe(true);
    expect(pushBookFile).toHaveBeenCalledTimes(2);
  });

  test('succeeds when at least one backend takes the book', async () => {
    pushBookFile
      .mockRejectedValueOnce(new Error('drive is down'))
      .mockResolvedValueOnce({ uploaded: true });
    expect(await runFileBookUpload(envConfig, makeBook('h1'))).toBe(true);
  });

  test('fails when no backend takes the book', async () => {
    pushBookFile.mockRejectedValue(new Error('offline'));
    expect(await runFileBookUpload(envConfig, makeBook('h1'))).toBe(false);
  });

  test('treats an already-mirrored file as success', async () => {
    pushBookFile
      .mockResolvedValueOnce({ uploaded: false, reason: 'remote-matches' })
      .mockResolvedValueOnce({ uploaded: false, reason: 'no-source' });
    expect(await runFileBookUpload(envConfig, makeBook('h1'))).toBe(true);
  });
});

describe('runFileBookDownload', () => {
  beforeEach(() => {
    downloadBookFile.mockReset();
    useSettingsStore.getState().setSettings(multiProviderSettings);
    setCachedUserPlan('pro');
  });

  test('stops at the first backend that has the file', async () => {
    downloadBookFile.mockResolvedValueOnce(true);
    expect(await runFileBookDownload(envConfig, makeBook('h1'))).toBe(true);
    expect(downloadBookFile).toHaveBeenCalledTimes(1);
  });

  test('falls through to the next backend when the first does not have it', async () => {
    downloadBookFile.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await runFileBookDownload(envConfig, makeBook('h1'))).toBe(true);
    expect(downloadBookFile).toHaveBeenCalledTimes(2);
  });

  test('stamps downloadedAt and coverDownloadedAt on success', async () => {
    downloadBookFile.mockResolvedValueOnce(true);
    const book = makeBook('h1');
    expect(await runFileBookDownload(envConfig, book)).toBe(true);
    expect(book.downloadedAt).toBeTruthy();
    expect(book.coverDownloadedAt).toBeTruthy();
  });
});
