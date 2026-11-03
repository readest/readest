import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { useTransferStore } from '@/store/transferStore';

const provider = vi.hoisted(() => ({
  rootPath: '/',
  readText: vi.fn(),
  readBinary: vi.fn(),
  writeText: vi.fn(),
  writeBinary: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
  ensureDir: vi.fn(),
  deleteDir: vi.fn(),
  downloadStream: vi.fn(),
  uploadStream: vi.fn(),
}));
vi.mock('@/services/sync/providers/gdrive/buildGoogleDriveProvider', () => ({
  buildGoogleDriveProvider: async () => provider,
}));
import {
  createFileSyncProvider,
  resetFileSyncProviderCache,
} from '@/services/sync/file/providerRegistry';

const rows = () => Object.values(useTransferStore.getState().transfers);
beforeEach(() => {
  resetFileSyncProviderCache();
  useTransferStore.setState({ transfers: {}, activeCount: 0, isQueuePaused: false });
  vi.resetAllMocks();
});

const build = async (): Promise<FileSyncProvider> => (await createFileSyncProvider('gdrive', {}))!;

describe('file-provider transfer log', () => {
  it('logs direct and automatic file uploads and downloads with provider and file name', async () => {
    const sync = await build();
    provider.readBinary.mockResolvedValue(new ArrayBuffer(12));
    await sync.readBinary('/Readest/books/hash/Book.epub');
    await sync.writeText('/Readest/library.json', '[]');
    expect(rows()).toEqual([
      expect.objectContaining({
        kind: 'file',
        provider: 'gdrive',
        bookTitle: 'Book.epub',
        type: 'download',
        status: 'completed',
        transferredBytes: 12,
        totalBytes: 12,
        progress: 100,
      }),
      expect.objectContaining({
        kind: 'file',
        provider: 'gdrive',
        bookTitle: 'library.json',
        type: 'upload',
        status: 'completed',
        transferredBytes: 2,
      }),
    ]);
  });

  it('tracks streaming progress and ignores late native progress events', async () => {
    const sync = await build();
    let emit!: NonNullable<Parameters<NonNullable<FileSyncProvider['downloadStream']>>[2]>;
    let finish!: (ok: boolean) => void;
    provider.downloadStream.mockImplementation((_remote, _local, onProgress) => {
      emit = onProgress;
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    });
    const download = sync.downloadStream!('/Readest/books/hash/Book.epub', '/tmp/book');
    emit({ progress: 5, total: 10, transferSpeed: 2 });
    expect(rows()[0]).toMatchObject({ status: 'in_progress', progress: 50, provider: 'gdrive' });
    finish(true);
    await download;
    emit({ progress: 6, total: 10, transferSpeed: 3 });
    expect(rows()[0]).toMatchObject({ status: 'completed', progress: 100 });
  });

  it('records errors without changing the transport rejection', async () => {
    const sync = await build();
    const error = new Error('Connection failed');
    provider.writeBinary.mockRejectedValue(error);
    await expect(
      sync.writeBinary('/Readest/books/hash/Book.epub', new ArrayBuffer(2)),
    ).rejects.toBe(error);
    expect(rows()[0]).toMatchObject({
      status: 'failed',
      error: 'Connection failed',
      provider: 'gdrive',
    });
  });

  it('does not report missing optional files or directory probes as downloaded files', async () => {
    const sync = await build();
    provider.readText.mockResolvedValue(null);
    provider.readBinary.mockResolvedValue(null);
    await sync.readText('/Readest/books/hash/config.json');
    await sync.readBinary('/Readest/books/hash/cover.png');
    await sync.head('/Readest/library.json');
    await sync.list('/Readest/books');
    await sync.ensureDir(['/Readest']);
    expect(rows()).toEqual([]);
  });

  it('records stream failures that resolve false', async () => {
    const sync = await build();
    provider.downloadStream.mockResolvedValue(false);
    expect(await sync.downloadStream!('/Readest/books/hash/Book.epub', '/tmp/book')).toBe(false);
    expect(rows()[0]).toMatchObject({ status: 'failed', provider: 'gdrive' });
  });

  it('reuses only a queued primary book row and keeps concurrent direct transfers separate', async () => {
    const store = useTransferStore.getState();
    const id = store.addTransfer('hash', 'Book', 'download');
    store.setTransferStatus(id, 'in_progress');
    const queued = (await createFileSyncProvider('gdrive', {}, id))!;
    const direct = await build();
    provider.readBinary.mockResolvedValue(new ArrayBuffer(4));
    provider.readText.mockResolvedValue('{}');
    await Promise.all([
      queued.readBinary('/Readest/books/hash/Book.epub'),
      direct.readBinary('/Readest/books/other/Other.epub'),
    ]);
    await queued.readText('/Readest/books/hash/config.json');
    expect(rows()).toHaveLength(3);
    expect(useTransferStore.getState().transfers[id]).toMatchObject({
      kind: 'book',
      provider: 'gdrive',
      status: 'in_progress',
    });
    expect(
      rows()
        .filter((row) => row.kind === 'file')
        .map((row) => row.bookTitle)
        .sort(),
    ).toEqual(['Other.epub', 'config.json']);
  });

  it('preserves absent optional streaming methods', async () => {
    const { withTransferLog } = await import('@/services/sync/file/transferLog');
    const logged = withTransferLog(
      { ...provider, downloadStream: undefined, uploadStream: undefined },
      's3',
    );
    expect(logged.downloadStream).toBeUndefined();
    expect(logged.uploadStream).toBeUndefined();
  });

  it('records remote deletions', async () => {
    const sync = await build();
    await sync.deleteDir('/Readest/books/hash');
    expect(rows()[0]).toMatchObject({ type: 'delete', status: 'completed', provider: 'gdrive' });
  });
});
