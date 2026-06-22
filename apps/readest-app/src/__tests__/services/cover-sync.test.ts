import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Book, BookFormat } from '@/types/book';
import { FileSystem } from '@/types/system';

// uploadBookCover uses the storage layer; mock it so we can assert the cloud
// path it uploads to without touching the network. computeCoverHash uses the
// REAL @/utils/book + @/utils/md5 (content hashing must be exercised for real).
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  uploadReplicaFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn().mockReturnValue(vi.fn()),
  batchGetDownloadUrls: vi.fn().mockResolvedValue([]),
}));

import { uploadBookCover } from '@/services/cloudService';
import { computeCoverHash } from '@/services/bookService';
import { uploadFile } from '@/libs/storage';

function createMockBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abc123',
    format: 'EPUB' as BookFormat,
    title: 'Test Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    deletedAt: null,
    uploadedAt: 1000,
    downloadedAt: 1000,
    coverDownloadedAt: 1000,
    ...overrides,
  };
}

function createMockFs(overrides: Partial<FileSystem> = {}): FileSystem {
  return {
    resolvePath: vi
      .fn()
      .mockReturnValue({ baseDir: 0, basePrefix: async () => '', fp: 't', base: 'Books' }),
    getURL: vi.fn().mockReturnValue('url'),
    getBlobURL: vi.fn().mockResolvedValue('blob:url'),
    getImageURL: vi.fn().mockResolvedValue('image:url'),
    openFile: vi.fn().mockResolvedValue(new File(['cover-bytes'], 'cover.png')),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue([]),
    createDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stats: vi.fn().mockResolvedValue({
      isFile: true,
      isDirectory: false,
      size: 100,
      mtime: null,
      atime: null,
      birthtime: null,
    }),
    getPrefix: vi.fn().mockResolvedValue('Readest/Books'),
    ...overrides,
  } as FileSystem;
}

describe('computeCoverHash (issue #4544)', () => {
  test('returns null when the cover does not exist', async () => {
    const fs = createMockFs({ exists: vi.fn().mockResolvedValue(false) });
    const hash = await computeCoverHash(fs, createMockBook());
    expect(hash).toBeNull();
    expect(fs.openFile).not.toHaveBeenCalled();
  });

  test('is stable for identical cover bytes and differs for different bytes', async () => {
    const fsA = createMockFs({
      openFile: vi.fn().mockResolvedValue(new File(['cover-A'], 'cover.png')),
    });
    const fsA2 = createMockFs({
      openFile: vi.fn().mockResolvedValue(new File(['cover-A'], 'cover.png')),
    });
    const fsB = createMockFs({
      openFile: vi.fn().mockResolvedValue(new File(['cover-B-different'], 'cover.png')),
    });

    const hashA = await computeCoverHash(fsA, createMockBook());
    const hashA2 = await computeCoverHash(fsA2, createMockBook());
    const hashB = await computeCoverHash(fsB, createMockBook());

    expect(hashA).toBeTruthy();
    expect(hashA).toBe(hashA2); // idempotent: identical content ⇒ identical hash
    expect(hashA).not.toBe(hashB); // changed content ⇒ changed hash
  });

  test('reads cover.png under the book hash dir', async () => {
    const fs = createMockFs();
    await computeCoverHash(fs, createMockBook({ hash: 'deadbeef' }));
    expect(fs.openFile).toHaveBeenCalledWith('deadbeef/cover.png', 'Books');
  });
});

describe('uploadBookCover (issue #4544)', () => {
  const resolveFilePath = vi.fn().mockResolvedValue('/abs/abc123/cover.png');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uploads only the cover to books/<hash>/cover.png and does not touch uploadedAt', async () => {
    const fs = createMockFs();
    const book = createMockBook({ uploadedAt: 1000 });
    await uploadBookCover(fs, resolveFilePath, book);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    // The cloud key is built inside uploadFileToCloud via
    // fs.openFile(lfp, base, cfp). Assert the cover key was passed through.
    expect(fs.openFile).toHaveBeenCalledWith(
      'abc123/cover.png',
      'Books',
      'Readest/Books/abc123/cover.png',
    );
    expect(book.uploadedAt).toBe(1000); // unchanged
  });

  test('no-ops when the cover is absent', async () => {
    const fs = createMockFs({ exists: vi.fn().mockResolvedValue(false) });
    await uploadBookCover(fs, resolveFilePath, createMockBook());
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
