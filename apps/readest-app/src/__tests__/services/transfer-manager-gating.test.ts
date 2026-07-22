import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTransferStore, TransferItem } from '@/store/transferStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    dispatchSync: vi.fn(),
  },
}));

import { transferManager } from '@/services/transferManager';
import { eventDispatcher } from '@/utils/event';
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

function makeTransferItem(overrides: Partial<TransferItem> = {}): TransferItem {
  return {
    id: 't1',
    kind: 'book',
    bookHash: 'hash1',
    bookTitle: 'Test Book',
    type: 'upload',
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    transferredBytes: 0,
    transferSpeed: 0,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    priority: 10,
    isBackground: false,
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

const settingsNotLoaded = (): void => {
  useSettingsStore.setState({ settings: {} as SystemSettings });
};

const webdavSelected = (): void =>
  settingsLoaded({ webdav: { enabled: true } } as Partial<SystemSettings>);

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

describe('provider gating of book uploads', () => {
  test('queueUpload returns null and queues nothing when a third-party provider is selected', async () => {
    webdavSelected();
    await initManager();

    const id = transferManager.queueUpload(makeBook());
    expect(id).toBeNull();
    expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
  });

  test('queueUpload works when Readest Cloud is the provider', async () => {
    await initManager();

    const id = transferManager.queueUpload(makeBook());
    expect(id).toBeTruthy();
  });

  test('queueBatchUploads returns empty when gated', async () => {
    webdavSelected();
    await initManager();

    const ids = transferManager.queueBatchUploads([makeBook(), makeBook({ hash: 'hash2' })]);
    expect(ids).toEqual([]);
  });

  test('downloads and replica transfers are never gated', async () => {
    webdavSelected();
    await initManager();

    const downloadId = transferManager.queueDownload(makeBook());
    expect(downloadId).toBeTruthy();

    const replicaId = transferManager.queueReplicaUpload(
      'font',
      'font-1',
      'A Font',
      [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
      'Data' as never,
    );
    expect(replicaId).toBeTruthy();
  });
});

describe('settings-loaded barrier', () => {
  test('a pending book upload does not execute before settings hydration', async () => {
    settingsNotLoaded();
    const persisted = {
      transfers: { t1: makeTransferItem() },
      isQueuePaused: false,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    const appService = makeAppService();
    await initManager(appService, [makeBook()]);
    await flushAsync();

    expect(appService['uploadBook']).not.toHaveBeenCalled();
    expect(useTransferStore.getState().transfers['t1']?.status).toBe('pending');
  });

  test('the deferred upload executes once settings hydrate with readest selected', async () => {
    settingsNotLoaded();
    localStorage.setItem(
      'readest_transfer_queue',
      JSON.stringify({ transfers: { t1: makeTransferItem() }, isQueuePaused: false }),
    );

    const appService = makeAppService();
    await initManager(appService, [makeBook()]);
    await flushAsync();
    expect(appService['uploadBook']).not.toHaveBeenCalled();

    settingsLoaded();
    await flushAsync();

    expect(appService['uploadBook']).toHaveBeenCalledTimes(1);
  });

  test('replica transfers are not stalled by the barrier', async () => {
    settingsNotLoaded();
    const appService = makeAppService();
    await initManager(appService);

    transferManager.queueReplicaDownload(
      'font',
      'font-1',
      'A Font',
      [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
      'Data' as never,
    );
    await flushAsync();

    expect(appService['downloadReplicaFile']).toHaveBeenCalled();
  });
});

describe('policy cancellation on restore/reconcile', () => {
  test('pre-switch pending book uploads are policy-cancelled on restore; downloads and replicas survive', async () => {
    webdavSelected();
    const persisted = {
      transfers: {
        up1: makeTransferItem({ id: 'up1' }),
        down1: makeTransferItem({ id: 'down1', type: 'download', bookHash: 'hash2' }),
        rep1: makeTransferItem({
          id: 'rep1',
          kind: 'replica',
          type: 'upload',
          bookHash: '',
          replicaKind: 'font',
          replicaId: 'font-1',
          replicaFiles: [{ logical: 'font.ttf', lfp: '/tmp/font.ttf', byteSize: 10 }],
          replicaBase: 'Data' as never,
        }),
      },
      isQueuePaused: true,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    await initManager();
    await flushAsync();

    const transfers = useTransferStore.getState().transfers;
    expect(transfers['up1']?.status).toBe('cancelled');
    expect(transfers['up1']?.cancelReason).toBe('policy');
    expect(transfers['down1']?.status).toBe('pending');
    expect(transfers['rep1']?.status).toBe('pending');
  });

  test('switching providers after init policy-cancels pending book uploads', async () => {
    await initManager();
    useTransferStore.getState().pauseQueue();
    const id = transferManager.queueUpload(makeBook())!;

    webdavSelected();
    await flushAsync();

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer?.status).toBe('cancelled');
    expect(transfer?.cancelReason).toBe('policy');
  });

  test('policy-cancelled rows from a previous session are pruned on restore', async () => {
    const persisted = {
      transfers: {
        old1: makeTransferItem({ id: 'old1', status: 'cancelled', cancelReason: 'policy' }),
        user1: makeTransferItem({ id: 'user1', status: 'cancelled' }),
      },
      isQueuePaused: false,
    };
    localStorage.setItem('readest_transfer_queue', JSON.stringify(persisted));

    await initManager();

    const transfers = useTransferStore.getState().transfers;
    expect(transfers['old1']).toBeUndefined();
    expect(transfers['user1']).toBeDefined();
  });

  test('legacy persisted entries without kind or cancelReason restore cleanly', async () => {
    const legacy = makeTransferItem({ id: 'l1', status: 'completed' }) as Partial<TransferItem>;
    delete legacy.kind;
    localStorage.setItem(
      'readest_transfer_queue',
      JSON.stringify({ transfers: { l1: legacy }, isQueuePaused: false }),
    );

    await initManager();

    const restored = useTransferStore.getState().transfers['l1'];
    expect(restored?.kind).toBe('book');
    expect(restored?.status).toBe('completed');
  });
});

describe('cancelled bucket accounting', () => {
  test('policy-cancelled rows are excluded from failed stats and getFailedTransfers; user-cancelled stay', () => {
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
        u1: makeTransferItem({ id: 'u1', status: 'cancelled', cancelReason: 'user' }),
        f1: makeTransferItem({ id: 'f1', status: 'failed' }),
      },
    });

    const store = useTransferStore.getState();
    const failedIds = store.getFailedTransfers().map((t) => t.id);
    expect(failedIds).toContain('u1');
    expect(failedIds).toContain('f1');
    expect(failedIds).not.toContain('p1');
    expect(store.getQueueStats().failed).toBe(2);
  });

  test('retryAllFailed does not resurrect policy-cancelled rows', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
      },
    });

    transferManager.retryAllFailed();
    await flushAsync();

    expect(useTransferStore.getState().transfers['p1']?.status).toBe('cancelled');
  });

  test('retryTransfer no-ops on a policy-cancelled row', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'cancelled', cancelReason: 'policy' }),
      },
    });

    transferManager.retryTransfer('p1');
    await flushAsync();

    expect(useTransferStore.getState().transfers['p1']?.status).toBe('cancelled');
  });

  test('user cancelTransfer records cancelReason user', async () => {
    await initManager();
    useTransferStore.getState().pauseQueue();
    const id = transferManager.queueUpload(makeBook())!;

    transferManager.cancelTransfer(id);

    const transfer = useTransferStore.getState().transfers[id];
    expect(transfer?.status).toBe('cancelled');
    expect(transfer?.cancelReason).toBe('user');
  });

  test('gate-off reconcile settles: a force-pended policy row is re-cancelled without looping', async () => {
    webdavSelected();
    await initManager();
    useTransferStore.setState({
      transfers: {
        p1: makeTransferItem({ id: 'p1', status: 'pending', cancelReason: 'policy' }),
      },
    });

    await (transferManager as unknown as { processQueue: () => Promise<void> }).processQueue();
    await flushAsync();

    const transfer = useTransferStore.getState().transfers['p1'];
    expect(transfer?.status).toBe('cancelled');
    expect(useTransferStore.getState().getPendingTransfers()).toHaveLength(0);
  });
});

describe('quota failure handling', () => {
  test('quota 403 fails immediately with zero retries', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('Insufficient storage quota')),
    });
    const book = makeBook();
    await initManager(appService, [book]);

    transferManager.queueUpload(book);
    await flushAsync();

    const transfers = Object.values(useTransferStore.getState().transfers);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.status).toBe('failed');
    expect(transfers[0]?.retryCount).toBe(0);
    expect(appService['uploadBook']).toHaveBeenCalledTimes(1);
  });

  test('a batch of quota failures produces one summary toast, not one per book', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('Insufficient storage quota')),
    });
    const books = [makeBook(), makeBook({ hash: 'hash2' }), makeBook({ hash: 'hash3' })];
    await initManager(appService, books);

    transferManager.queueBatchUploads(books);
    await flushAsync(10000);

    const dispatched = vi.mocked(eventDispatcher.dispatch).mock.calls.filter(
      ([event, payload]) =>
        event === 'toast' &&
        String((payload as { message?: string })?.message ?? '')
          .toLowerCase()
          .includes('quota'),
    );
    expect(dispatched).toHaveLength(1);
    expect(String((dispatched[0]![1] as { message: string }).message)).toContain('3');
  });

  test('non-quota errors keep the existing retry behavior', async () => {
    const appService = makeAppService({
      uploadBook: vi.fn().mockRejectedValue(new Error('network boom')),
    });
    const book = makeBook();
    await initManager(appService, [book]);

    transferManager.queueUpload(book);
    await flushAsync(60000);

    const transfer = Object.values(useTransferStore.getState().transfers)[0];
    expect(transfer?.status).toBe('failed');
    expect(transfer?.retryCount).toBe(3);
  });
});
