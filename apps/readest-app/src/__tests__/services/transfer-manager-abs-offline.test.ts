import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTransferStore } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const { downloadAbsForOfflineMock } = vi.hoisted(() => ({ downloadAbsForOfflineMock: vi.fn() }));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    dispatchSync: vi.fn(),
  },
}));
vi.mock('@/services/audiobookshelf/offline', () => ({
  downloadAbsForOffline: downloadAbsForOfflineMock,
}));

import { transferManager } from '@/services/transferManager';
import type { Book } from '@/types/book';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'hash1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

const resetTransferManager = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only introspection
  const mgr = transferManager as unknown as Record<string, unknown>;
  mgr['isInitialized'] = false;
  mgr['isProcessing'] = false;
  mgr['appService'] = null;
  mgr['getLibrary'] = null;
  mgr['updateBook'] = null;
  mgr['_'] = null;
  (mgr['abortControllers'] as Map<string, AbortController>).clear();
  let resolveReady: () => void = () => {};
  mgr['readyPromise'] = new Promise<void>((res) => {
    resolveReady = res;
  });
  mgr['readyResolve'] = resolveReady;
};

const resetTransferStore = () => {
  useTransferStore.setState({
    transfers: {},
    isQueuePaused: false,
    isTransferQueueOpen: false,
    maxConcurrent: 2,
    activeCount: 0,
  });
};

const settingsLoaded = (overrides: Partial<SystemSettings> = {}): void => {
  useSettingsStore.setState({
    settings: {
      version: 1,
      webdav: { enabled: false },
      googleDrive: { enabled: false },
      ...overrides,
    } as SystemSettings,
  });
};

function makeAppService(overrides: Record<string, unknown> = {}) {
  return {
    uploadBook: vi.fn().mockResolvedValue(undefined),
    downloadBook: vi.fn().mockResolvedValue(undefined),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    uploadReplicaFile: vi.fn().mockResolvedValue(undefined),
    downloadReplicaFile: vi.fn().mockResolvedValue(undefined),
    deleteReplicaBundle: vi.fn().mockResolvedValue(undefined),
    isMacOSApp: false,
    ...overrides,
  } as Record<string, unknown>;
}

const translationFn = (key: string, params?: Record<string, string | number>) => {
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
  }
  return key;
};

const initManager = async (appService = makeAppService(), library: Book[] = []) => {
  await transferManager.initialize(appService as never, () => library, vi.fn(), translationFn);
  return appService;
};

const flushAsync = async (ms = 5000) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetTransferStore();
  resetTransferManager();
  vi.clearAllMocks();
  localStorage.clear();
  settingsLoaded();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const absBook = (overrides: Partial<Book> = {}): Book =>
  makeBook({ format: 'ABS', filePath: 'abs://srv1/item1', ...overrides });

describe('offline Audiobookshelf downloads (#6256)', () => {
  test('queue an ABS book and run the offline downloader, not the cloud one', async () => {
    const book = absBook();
    const updateBook = vi.fn().mockResolvedValue(undefined);
    const appService = makeAppService();
    await transferManager.initialize(appService as never, () => [book], updateBook, translationFn);

    const id = transferManager.queueAbsOfflineDownload(book);
    expect(id).toBeTruthy();
    expect(useTransferStore.getState().transfers[id!]).toMatchObject({
      kind: 'book',
      type: 'download',
      bookHash: 'hash1',
    });
    await flushAsync();

    expect(downloadAbsForOfflineMock).toHaveBeenCalledWith(
      appService,
      book,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(appService['downloadBook']).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'hash1', absDownloadedAt: expect.any(Number) }),
    );
    // `downloadedAt` drives cloud upload/share affordances; an ABS copy is not that.
    expect(book.downloadedAt).toBeUndefined();
    expect(useTransferStore.getState().transfers[id!]!.status).toBe('completed');
  });

  test('podcast shows and regular books are not offline-downloadable', async () => {
    await initManager();

    expect(
      transferManager.queueAbsOfflineDownload(
        absBook({ absMediaType: 'podcast', metadata: { absMediaType: 'podcast' } as never }),
      ),
    ).toBeNull();
    expect(transferManager.queueAbsOfflineDownload(makeBook())).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('a cancel during the download is not reported as completed', async () => {
    const book = absBook();
    const updateBook = vi.fn().mockResolvedValue(undefined);
    let finish: () => void = () => {};
    downloadAbsForOfflineMock.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    await transferManager.initialize(
      makeAppService() as never,
      () => [book],
      updateBook,
      translationFn,
    );

    const id = transferManager.queueAbsOfflineDownload(book)!;
    await flushAsync(100);
    transferManager.cancelTransfer(id);
    finish();
    await flushAsync();

    expect(useTransferStore.getState().transfers[id]!.status).toBe('cancelled');
    expect(updateBook).not.toHaveBeenCalled();
  });
});
