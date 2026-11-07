import { beforeEach, describe, expect, test, vi } from 'vitest';

const listFilesMock = vi.fn();
const purgeFilesMock = vi.fn();
const deleteCloudFileMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  listAllFiles: async (...a: unknown[]) => (await listFilesMock(...a)).files,
  purgeFiles: (...a: unknown[]) => purgeFilesMock(...a),
  deleteFile: (...a: unknown[]) => deleteCloudFileMock(...a),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  uploadReplicaFile: vi.fn(),
  createProgressHandler: vi.fn(),
  batchGetDownloadUrls: vi.fn(),
}));

import { deleteBook } from '@/services/cloudService';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';

const fs = {} as FileSystem;
const makeBook = (): Book =>
  ({ hash: 'h', title: 'Title', format: 'EPUB', uploadedAt: 1 }) as unknown as Book;

beforeEach(() => {
  listFilesMock.mockReset();
  purgeFilesMock.mockReset().mockResolvedValue({});
  deleteCloudFileMock.mockReset();
});

describe('deleteBook from Readest Cloud', () => {
  test("purges the book's synced data files", async () => {
    listFilesMock.mockResolvedValue({
      files: [
        { file_key: 'u1/Readest/Books/h/tts/a.mp3' },
        { file_key: 'u1/Readest/Books/h/tts/a.json' },
        { file_key: 'u1/Readest/Books/h/Title.epub' },
        { file_key: 'u1/Readest/Books/h/cover.png' },
      ],
    });
    const book = makeBook();
    await deleteBook(fs, book, 'cloud');
    await vi.waitFor(() =>
      expect(purgeFilesMock).toHaveBeenCalledWith(
        ['u1/Readest/Books/h/tts/a.mp3', 'u1/Readest/Books/h/tts/a.json'],
        true,
      ),
    );
    expect(listFilesMock).toHaveBeenCalledWith({ bookHash: 'h', search: '/h/' });
    expect(deleteCloudFileMock).toHaveBeenCalledTimes(2);
    expect(book.uploadedAt).toBeNull();
  });

  test('purges at most 100 files per request, as the purge route allows', async () => {
    // Over 100 keys, the route answers 400 and deletes nothing.
    const keys = Array.from({ length: 150 }, (_, i) => `u1/Readest/Books/h/tts/${i}-a.mp3`);
    listFilesMock.mockResolvedValue({ files: keys.map((file_key) => ({ file_key })) });
    await deleteBook(fs, makeBook(), 'cloud');
    await vi.waitFor(() => expect(purgeFilesMock).toHaveBeenCalledTimes(2));
    expect(purgeFilesMock.mock.calls.map(([batch]) => (batch as string[]).length)).toEqual([
      100, 50,
    ]);
    expect(purgeFilesMock.mock.calls.flatMap(([batch]) => batch as string[])).toEqual(keys);
  });

  test('warns when some files could not be purged', async () => {
    listFilesMock.mockResolvedValue({ files: [{ file_key: 'u1/Readest/Books/h/tts/a.mp3' }] });
    purgeFilesMock.mockResolvedValue({ failedCount: 1, failed: [{ fileKey: 'k', error: 'x' }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await deleteBook(fs, makeBook(), 'cloud');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('1')));
    warn.mockRestore();
  });

  test('a book with no synced data purges nothing', async () => {
    listFilesMock.mockResolvedValue({ files: [{ file_key: 'u1/Readest/Books/h/Title.epub' }] });
    await deleteBook(fs, makeBook(), 'cloud');
    await vi.waitFor(() => expect(listFilesMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(purgeFilesMock).not.toHaveBeenCalled();
  });

  test('a failed listing still clears uploadedAt', async () => {
    listFilesMock.mockRejectedValue(new Error('List files failed'));
    const book = makeBook();
    await expect(deleteBook(fs, book, 'cloud')).resolves.toBeUndefined();
    expect(book.uploadedAt).toBeNull();
  });
});
