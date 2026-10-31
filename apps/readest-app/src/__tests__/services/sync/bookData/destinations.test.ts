import { beforeEach, describe, expect, test, vi } from 'vitest';

const listFilesMock = vi.fn();
const downloadFileMock = vi.fn();
const deleteCloudFileMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  listFiles: (...a: unknown[]) => listFilesMock(...a),
  downloadFile: (...a: unknown[]) => downloadFileMock(...a),
  deleteFile: (...a: unknown[]) => deleteCloudFileMock(...a),
}));

import { createFileSyncDestination } from '@/services/sync/bookData/fileSyncDestination';
import { createReadestCloudDestination } from '@/services/sync/bookData/cloudDestination';
import { FileSyncError } from '@/services/sync/file/provider';
import type { AppService } from '@/types/system';
import { FakeFileSyncProvider } from './fakeFileSyncProvider';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('file-sync destination', () => {
  let provider: FakeFileSyncProvider;
  beforeEach(() => {
    provider = new FakeFileSyncProvider();
  });

  test('writes under books/<hash>/<kind>/', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    await dest.write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg');
    expect(provider.files.has('/Readest/books/h/tts/a.mp3')).toBe(true);
    expect(provider.ops[0]).toBe(
      'ensureDir:/Readest,/Readest/books,/Readest/books/h,/Readest/books/h/tts',
    );
    expect(dest.id).toBe('webdav');
  });

  test('prepares the folder once per book and kind', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    await dest.write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg');
    await dest.write('h', 'tts', 'a.json', bytes('{}'), 'application/json');
    expect(provider.ops.filter((op) => op.startsWith('ensureDir'))).toHaveLength(1);
  });

  test('a folder its listing found is not prepared again before writing', async () => {
    provider.files.set('/Readest/books/h/tts/a.mp3', bytes('mp3'));
    const dest = createFileSyncDestination('webdav', provider);
    await dest.list('h', 'tts');
    await dest.write('h', 'tts', 'b.mp3', bytes('mp3'), 'audio/mpeg');
    expect(provider.ops.filter((op) => op.startsWith('ensureDir'))).toEqual([]);
  });

  test('lists and reads that kind', async () => {
    provider.files.set('/Readest/books/h/tts/a.mp3', bytes('mp3'));
    provider.files.set('/Readest/books/h/Title.epub', bytes('epub'));
    const dest = createFileSyncDestination('webdav', provider);
    expect(await dest.list('h', 'tts')).toEqual(new Set(['a.mp3']));
    expect(new TextDecoder().decode((await dest.read('h', 'tts', 'a.mp3'))!)).toBe('mp3');
    expect(await dest.read('h', 'tts', 'b.mp3')).toBeNull();
  });

  test('list is empty for a missing folder', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    expect(await dest.list('h', 'tts')).toEqual(new Set());
  });

  test('a listing error throws instead of reading as an empty folder', async () => {
    // Read as empty, it would make push upload every pack again.
    provider.listError = new FileSyncError('timeout', 'NETWORK');
    const dest = createFileSyncDestination('webdav', provider);
    await expect(dest.list('h', 'tts')).rejects.toThrow('timeout');
  });
});

describe('Readest Cloud destination', () => {
  const calls: string[] = [];
  const appService = {
    writeFile: vi.fn(async (path: string, base: string) => {
      calls.push(`writeFile:${base}:${path}`);
    }),
    deleteFile: vi.fn(async (path: string, base: string) => {
      calls.push(`deleteFile:${base}:${path}`);
    }),
    uploadFileToCloud: vi.fn(async (lfp: string, cfp: string) => {
      calls.push(`upload:${lfp}->${cfp}`);
      return undefined;
    }),
    createDir: vi.fn(async () => {}),
    resolveFilePath: vi.fn(async (path: string, base: string) => `/${base}/${path}`),
    readFile: vi.fn(async () => bytes('remote')),
  };
  const cloud = () => createReadestCloudDestination(appService as unknown as AppService);

  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    listFilesMock.mockReset();
    downloadFileMock.mockReset().mockResolvedValue({});
    deleteCloudFileMock.mockReset().mockResolvedValue(undefined);
  });

  test("lists only that kind's files, from one listing of the book", async () => {
    listFilesMock.mockResolvedValue({
      files: [
        { file_key: 'u1/Readest/Books/h/tts/a.mp3' },
        { file_key: 'u1/Readest/Books/h/Title.epub' },
        { file_key: 'u1/Readest/Books/h/cover.png' },
      ],
    });
    expect(await cloud().list('h', 'tts')).toEqual(new Set(['a.mp3']));
    expect(listFilesMock).toHaveBeenCalledWith({ bookHash: 'h', pageSize: 1000 });
  });

  test('declines a book whose file is not in Readest Cloud', async () => {
    // `uploadedAt` is also set when the book's file is on a file-sync backend
    // only (#5084), so the listing decides: no book file, no book data.
    listFilesMock.mockResolvedValue({
      files: [{ file_key: 'u1/Readest/Books/h/tts/a.mp3' }],
    });
    expect(await cloud().list('h', 'tts')).toBeNull();
    listFilesMock.mockResolvedValue({ files: [] });
    expect(await cloud().list('h', 'tts')).toBeNull();
  });

  test('a listing error throws instead of reading as an empty folder', async () => {
    listFilesMock.mockRejectedValue(new Error('List files failed'));
    await expect(cloud().list('h', 'tts')).rejects.toThrow('List files failed');
  });

  test('uploads from a Cache outbox file and removes it', async () => {
    const body = bytes('mp3');
    await cloud().write('h', 'tts', 'a.mp3', body, 'audio/mpeg');
    expect(appService.writeFile).toHaveBeenCalledWith('book-data-outbox/a.mp3', 'Cache', body);
    expect(appService.uploadFileToCloud).toHaveBeenCalledWith(
      'book-data-outbox/a.mp3',
      'Readest/Books/h/tts/a.mp3',
      'Cache',
      expect.any(Function),
      'h',
    );
    expect(calls).toEqual([
      'writeFile:Cache:book-data-outbox/a.mp3',
      'upload:book-data-outbox/a.mp3->Readest/Books/h/tts/a.mp3',
      'deleteFile:Cache:book-data-outbox/a.mp3',
    ]);
  });

  test('a failed upload still removes the outbox file and throws', async () => {
    appService.uploadFileToCloud.mockRejectedValueOnce(new Error('Insufficient storage quota'));
    await expect(cloud().write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg')).rejects.toThrow(
      'Insufficient storage quota',
    );
    expect(calls).toContain('deleteFile:Cache:book-data-outbox/a.mp3');
  });

  test('a failed upload drops the row it reserved, so the file is not listed', async () => {
    // The upload route records the row before the bytes land: left in place,
    // a sidecar would be listed as present with nothing behind it.
    appService.uploadFileToCloud.mockRejectedValueOnce(new Error('Network error'));
    await expect(
      cloud().write('h', 'tts', 'a.json', bytes('{}'), 'application/json'),
    ).rejects.toThrow('Network error');
    expect(deleteCloudFileMock).toHaveBeenCalledWith('Readest/Books/h/tts/a.json');
  });

  test('a successful upload deletes nothing in the cloud', async () => {
    await cloud().write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg');
    expect(deleteCloudFileMock).not.toHaveBeenCalled();
  });

  test('reads through a Cache inbox file', async () => {
    const out = await cloud().read('h', 'tts', 'a.mp3');
    expect(downloadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfp: 'Readest/Books/h/tts/a.mp3',
        dst: '/Cache/book-data-inbox/a.mp3',
      }),
    );
    expect(appService.readFile).toHaveBeenCalledWith('book-data-inbox/a.mp3', 'Cache', 'binary');
    expect(new TextDecoder().decode(out!)).toBe('remote');
    expect(calls).toContain('deleteFile:Cache:book-data-inbox/a.mp3');
  });

  test('read returns null when the download fails', async () => {
    downloadFileMock.mockRejectedValue(new Error('404'));
    expect(await cloud().read('h', 'tts', 'a.mp3')).toBeNull();
  });
});
