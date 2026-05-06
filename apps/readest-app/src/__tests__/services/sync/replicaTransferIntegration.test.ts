import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/sync/replicaPublish', () => ({
  publishDictionaryManifest: vi.fn(),
}));

const markAvailableByContentId = vi.fn();
vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: {
    getState: () => ({ markAvailableByContentId }),
  },
}));

import { eventDispatcher } from '@/utils/event';
import { publishDictionaryManifest } from '@/services/sync/replicaPublish';
import {
  __resetReplicaTransferIntegrationForTests,
  startReplicaTransferIntegration,
} from '@/services/sync/replicaTransferIntegration';
import type { AppService } from '@/types/system';

const mockPublish = publishDictionaryManifest as ReturnType<typeof vi.fn>;

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
  vi.clearAllMocks();
});

afterEach(() => {
  __resetReplicaTransferIntegrationForTests();
  vi.restoreAllMocks();
});

describe('replicaTransferIntegration', () => {
  test('upload event triggers publishDictionaryManifest', async () => {
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
    const [contentId, manifestFiles] = mockPublish.mock.calls[0]!;
    expect(contentId).toBe('content-hash-abc');
    expect(manifestFiles).toHaveLength(2);
    expect(manifestFiles[0]!.filename).toBe('webster.mdx');
    expect(manifestFiles[0]!.byteSize).toBe(1000);
    expect(manifestFiles[0]!.partialMd5).toMatch(/^[0-9a-f]{32}$/);
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
    expect(mockPublish.mock.calls[0]![2]).toBe('epoch-1');
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

  test('download event marks the local dict available (clears unavailable flag)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'download',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 10 }],
    });
    expect(markAvailableByContentId).toHaveBeenCalledOnce();
    expect(markAvailableByContentId).toHaveBeenCalledWith('content-hash-abc');
  });

  test('upload event does NOT mark available (only download finishes the placeholder lifecycle)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);
    mockPublish.mockResolvedValue(undefined);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'dictionary',
      replicaId: 'content-hash-abc',
      type: 'upload',
      files: [{ logical: 'x.mdx', lfp: 'b/x.mdx', byteSize: 10 }],
    });
    expect(markAvailableByContentId).not.toHaveBeenCalled();
  });

  test('non-dictionary download event is ignored (no markAvailable)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'font',
      replicaId: 'font-hash',
      type: 'download',
      files: [{ logical: 'r.ttf', lfp: 'f/r.ttf', byteSize: 1 }],
    });
    expect(markAvailableByContentId).not.toHaveBeenCalled();
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
  });

  test('non-dictionary kind is ignored (this slice ships dictionary only)', async () => {
    const appService = makeFakeAppService() as unknown as AppService;
    startReplicaTransferIntegration(appService);

    await eventDispatcher.dispatch('replica-transfer-complete', {
      kind: 'font',
      replicaId: 'font-hash',
      type: 'upload',
      files: [{ logical: 'r.ttf', lfp: 'f/r.ttf', byteSize: 1 }],
    });
    expect(mockPublish).not.toHaveBeenCalled();
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
