import { beforeEach, describe, expect, test, vi } from 'vitest';

const listFilesMock = vi.fn();
const purgeFilesMock = vi.fn();
const deleteCloudFileMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  listFiles: (...a: unknown[]) => listFilesMock(...a),
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
    expect(listFilesMock).toHaveBeenCalledWith({ bookHash: 'h', search: '/h/', pageSize: 1000 });
    expect(deleteCloudFileMock).toHaveBeenCalledTimes(2);
    expect(book.uploadedAt).toBeNull();
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
