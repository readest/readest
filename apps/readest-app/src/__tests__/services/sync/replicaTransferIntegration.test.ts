import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaManifest: vi.fn(),
}));

import { eventDispatcher } from '@/utils/event';
import { publishReplicaManifest } from '@/services/sync/replicaPublish';
import {
  __resetReplicaTransferIntegrationForTests,
  registerReplicaDownloadHandler,
  startReplicaTransferIntegration,
} from '@/services/sync/replicaTransferIntegration';
import { clearReplicaAdapters, registerReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { AppService } from '@/types/system';

const mockPublish = publishReplicaManifest as ReturnType<typeof vi.fn>;
const downloadHandler = vi.fn();

const fakeDictionaryAdapter: ReplicaAdapter<unknown> = {
  kind: 'dictionary',
  schemaVersion: 1,
  pack: () => ({}),
  unpack: () => ({}),
  computeId: async () => '',
  unpackRow: () => ({}),
  binary: {
    localBaseDir: 'Dictionaries',
    enumerateFiles: () => [],
  },
};

const makeFakeAppService = () => {
  const close = vi.fn();
  return {
    openFile: vi.fn(async (path: string) => {
      const content = `content-of-${path}`;
      return new File([content], path, { type: 'application/octet-stream' });
    }),
    _close: close,
  };
};

beforeEach(() => {
  __resetReplicaTransferIntegrationForTests();
  clearReplicaAdapters();
  vi.clearAllMocks();
  registerReplicaAdapter(fakeDictionaryAdapter);
  registerReplicaDownloadHandler('dictionary', downloadHandler);
});

afterEach(() => {
  __resetReplicaTransferIntegrationForTests();
  clearReplicaAdapters();
  vi.restoreAllMocks();
});

describe('replicaTransferIntegration', () => {
  test('upload event triggers publishReplicaManifest', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockResolvedValue(undefined);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [
        { logical: 'webster.mdx', lfp: 'b/webster.mdx', byteSize: 1000 },
        { logical: 'webster.mdd', lfp: 'b/webster.mdd', byteSize: 2000 },
      ],
    });

    expect(mockPublish).toHaveBeenCalledOnce();
    // Args: (kind, contentId, manifestFiles, reincarnation?)
    const [kind, contentId, manifestFiles] = mockPublish.mock.calls[0]!;
    expect(kind).toBe('dictionary');
    expect(contentId).toBe('content-hash-abc');
    expect(manifestFiles).toHaveLength(2);
    expect(manifestFiles[0]!.filename).toBe('webster.mdx');
    expect(manifestFiles[0]!.byteSize).toBe(1000);
    expect(manifestFiles[0]!.partialMd5).toMatch(/^[0-9a-f]{32}$/);
  });

  test('upload openFile uses the adapter binary base dir', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockResolvedValue(undefined);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [{ logical: 'webster.mdx', lfp: 'b/webster.mdx', byteSize: 1 }],
    });

    expect(appService.openFile).toHaveBeenCalledWith('b/webster.mdx', 'Dictionaries');
  });

  test('upload event carries reincarnation token into manifest publish', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockResolvedValue(undefined);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      reincarnation: 'epoch-1',
      type: 'upload',
      files: [{ logical: 'webster.mdx', lfp: 'b/webster.mdx', byteSize: 1000 }],
    });

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]![3]).toBe('epoch-1');
  });

  test('download event does NOT publish a manifest (publish is upload-side only)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'download',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 10 }],
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('download event invokes the per-kind handler with the replicaId', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'download',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 10 }],
    });
    expect(downloadHandler).toHaveBeenCalledOnce();
    expect(downloadHandler).toHaveBeenCalledWith('content-hash-abc');
  });

  test('upload event does NOT invoke the download handler', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockResolvedValue(undefined);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 10 }],
    });
    expect(downloadHandler).not.toHaveBeenCalled();
  });

  test('event for an unknown kind (no registered adapter) is ignored', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'unregistered-kind',
      replicaId: 'x',
      type: 'download',
      files: [{ logical: 'r.ttf', lfp: 'f/r.ttf', byteSize: 1 }],
    });
    expect(downloadHandler).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('event for a kind without a registered download handler is ignored cleanly', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    // Register a SECOND adapter without a download handler.
    registerReplicaAdapter({
      ...fakeDictionaryAdapter,
      kind: 'font',
    });
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'font',
      replicaId: 'font-hash',
      type: 'download',
      files: [{ logical: 'r.ttf', lfp: 'f/r.ttf', byteSize: 1 }],
    });
    expect(downloadHandler).not.toHaveBeenCalled();
  });

  test('delete event is ignored', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'delete',
      filenames: ['x.mdx'],
    });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(downloadHandler).not.toHaveBeenCalled();
  });

  test('upload event with no files is ignored', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [],
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('start is idempotent — second call does not double-register', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 100 }],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  test('registering a download handler twice for the same kind throws', () => {
    expect(() => registerReplicaDownloadHandler('dictionary', vi.fn())).toThrowError(
      /already registered/,
    );
  });

  test('publish error is caught (does not bubble up to event dispatcher)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockRejectedValueOnce(new Error('network outage'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind: 'dictionary',
        replicaId: 'content-hash-abc',
        type: 'upload',
        files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 1 }],
      }),
    ).resolves.toBeUndefined();
  });
});
