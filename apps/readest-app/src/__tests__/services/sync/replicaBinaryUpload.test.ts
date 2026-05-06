import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    isReady: vi.fn(),
    queueReplicaUpload: vi.fn(),
  },
}));

import { transferManager } from '@/services/transferManager';
import { queueDictionaryBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { AppService } from '@/types/system';

const mockIsReady = transferManager.isReady as ReturnType<typeof vi.fn>;
const mockQueueReplicaUpload = transferManager.queueReplicaUpload as ReturnType<typeof vi.fn>;

const makeFakeAppService = (sizes: Record<string, number>) => ({
  openFile: vi.fn(async (path: string) => ({
    size: sizes[path] ?? 0,
    name: path,
  })),
});

const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
  id: 'bundle-id',
  contentId: 'content-hash-abc',
  kind: 'mdict',
  name: 'Webster',
  bundleDir: 'bundle-dir',
  files: { mdx: 'webster.mdx', mdd: ['webster.mdd'] },
  addedAt: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queueDictionaryBinaryUpload', () => {
  test('no-ops when contentId is missing (legacy bundle)', async () => {
    mockIsReady.mockReturnValue(true);
    const fakeAppService = makeFakeAppService({}) as unknown as AppService;
    const result = await queueDictionaryBinaryUpload(
      baseDict({ contentId: undefined }),
      fakeAppService,
    );
    expect(result).toBe(null);
    expect(mockQueueReplicaUpload).not.toHaveBeenCalled();
  });

  test('no-ops when TransferManager is not initialized', async () => {
    mockIsReady.mockReturnValue(false);
    const fakeAppService = makeFakeAppService({}) as unknown as AppService;
    const result = await queueDictionaryBinaryUpload(baseDict(), fakeAppService);
    expect(result).toBe(null);
    expect(mockQueueReplicaUpload).not.toHaveBeenCalled();
  });

  test('queues upload with file sizes resolved via fs', async () => {
    mockIsReady.mockReturnValue(true);
    mockQueueReplicaUpload.mockReturnValue('transfer-id-1');
    const fakeAppService = makeFakeAppService({
      'bundle-dir/webster.mdx': 1_000_000,
      'bundle-dir/webster.mdd': 5_000_000,
    }) as unknown as AppService;

    const result = await queueDictionaryBinaryUpload(baseDict(), fakeAppService);

    expect(result).toBe('transfer-id-1');
    expect(mockQueueReplicaUpload).toHaveBeenCalledOnce();
    const [kind, contentId, displayTitle, files, base, opts] =
      mockQueueReplicaUpload.mock.calls[0]!;
    expect(kind).toBe('dictionary');
    expect(contentId).toBe('content-hash-abc');
    expect(displayTitle).toBe('Webster');
    expect(files).toEqual([
      { logical: 'webster.mdx', lfp: 'bundle-dir/webster.mdx', byteSize: 1_000_000 },
      { logical: 'webster.mdd', lfp: 'bundle-dir/webster.mdd', byteSize: 5_000_000 },
    ]);
    expect(base).toBe('Dictionaries');
    expect(opts).toEqual({ reincarnation: undefined });
  });

  test('passes reincarnation token through to the replica transfer', async () => {
    mockIsReady.mockReturnValue(true);
    mockQueueReplicaUpload.mockReturnValue('transfer-id-1');
    const fakeAppService = makeFakeAppService({
      'bundle-dir/webster.mdx': 1_000_000,
      'bundle-dir/webster.mdd': 5_000_000,
    }) as unknown as AppService;

    await queueDictionaryBinaryUpload(baseDict({ reincarnation: 'epoch-1' }), fakeAppService);

    expect(mockQueueReplicaUpload.mock.calls[0]![5]).toEqual({ reincarnation: 'epoch-1' });
  });

  test('returns null when bundle has no enumerable files', async () => {
    mockIsReady.mockReturnValue(true);
    const fakeAppService = makeFakeAppService({}) as unknown as AppService;
    const result = await queueDictionaryBinaryUpload(
      baseDict({ kind: 'mdict', files: {} }),
      fakeAppService,
    );
    expect(result).toBe(null);
    expect(mockQueueReplicaUpload).not.toHaveBeenCalled();
  });

  test('handles stardict bundle with all four files', async () => {
    mockIsReady.mockReturnValue(true);
    mockQueueReplicaUpload.mockReturnValue('t-2');
    const dict = baseDict({
      kind: 'stardict',
      files: {
        ifo: 'cmu.ifo',
        idx: 'cmu.idx',
        dict: 'cmu.dict.dz',
        syn: 'cmu.syn',
        idxOffsets: 'cmu.idx.offsets',
      },
    });
    const fakeAppService = makeFakeAppService({
      'bundle-dir/cmu.ifo': 100,
      'bundle-dir/cmu.idx': 200,
      'bundle-dir/cmu.dict.dz': 300,
      'bundle-dir/cmu.syn': 400,
    }) as unknown as AppService;

    await queueDictionaryBinaryUpload(dict, fakeAppService);

    const files = mockQueueReplicaUpload.mock.calls[0]![3];
    expect(files.map((f: { logical: string }) => f.logical)).toEqual([
      'cmu.ifo',
      'cmu.idx',
      'cmu.dict.dz',
      'cmu.syn',
    ]);
  });

  test('closes opened files (matches getBookFileSize pattern)', async () => {
    mockIsReady.mockReturnValue(true);
    mockQueueReplicaUpload.mockReturnValue('t-3');
    const close = vi.fn();
    const fakeAppService = {
      openFile: vi.fn(async () => ({ size: 100, close })),
    };
    await queueDictionaryBinaryUpload(baseDict(), fakeAppService as unknown as AppService);
    expect(close).toHaveBeenCalled();
  });
});
