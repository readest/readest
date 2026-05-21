import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteBook } from '@/services/cloudService';
import { Book, BookFormat } from '@/types/book';
import { FileSystem } from '@/types/system';

// Mock external dependencies
vi.mock('@/utils/book', () => ({
  getDir: vi.fn((book: Book) => book.hash),
  getLocalBookFilename: vi.fn((book: Book) => `${book.hash}/${book.title}.epub`),
  getRemoteBookFilename: vi.fn((book: Book) => `${book.hash}/${book.hash}.epub`),
  getCoverFilename: vi.fn((book: Book) => `${book.hash}/cover.png`),
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  uploadFile: vi.fn().mockResolvedValue('https://example.com/file'),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn().mockReturnValue(vi.fn()),
  batchGetDownloadUrls: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/utils/file', () => ({
  ClosableFile: class {},
  RemoteFile: class {
    async open() {
      return new File(['content'], 'test.epub');
    }
  },
}));

function createMockBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abc123',
    format: 'EPUB' as BookFormat,
    title: 'Test Book',
    author: 'Author',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    uploadedAt: null,
    downloadedAt: Date.now(),
    coverDownloadedAt: Date.now(),
    ...overrides,
  };
}

function createMockFs(): FileSystem {
  return {
    resolvePath: vi
      .fn()
      .mockReturnValue({ baseDir: 0, basePrefix: async () => '', fp: 'test', base: 'Books' }),
    getURL: vi.fn().mockReturnValue('url'),
    getBlobURL: vi.fn().mockResolvedValue('blob:url'),
    getImageURL: vi.fn().mockResolvedValue('image:url'),
    openFile: vi.fn().mockResolvedValue(new File(['content'], 'test.epub')),
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
  };
}

describe('cloudService', () => {
  let mockFs: FileSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs = createMockFs();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deleteBook', () => {
    describe('local delete action', () => {
      test('removes the local book file', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.exists).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
      });

      test('sets downloadedAt to null', async () => {
        const book = createMockBook({ downloadedAt: 12345 });
        await deleteBook(mockFs, book, 'local');

        expect(book.downloadedAt).toBeNull();
      });

      test('does not set deletedAt for local-only delete', async () => {
        const book = createMockBook({ deletedAt: null });
        await deleteBook(mockFs, book, 'local');

        // local action does not modify deletedAt
        expect(book.deletedAt).toBeNull();
      });

      test('skips removal when file does not exist', async () => {
        vi.mocked(mockFs.exists).mockResolvedValue(false);
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
      });

      test('only deletes book file, not cover (local action)', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'local');

        // local action only deletes the book file
        expect(mockFs.removeFile).toHaveBeenCalledTimes(1);
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
      });
    });

    describe('both delete action', () => {
      test('removes book file and cover', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'both');

        // 'both' deletes localBookFilename + coverFilename
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/cover.png`, 'Books');
      });

      test('sets deletedAt, clears downloadedAt and coverDownloadedAt', async () => {
        const book = createMockBook({
          uploadedAt: 1000,
          downloadedAt: 2000,
          coverDownloadedAt: 3000,
        });
        await deleteBook(mockFs, book, 'both');

        expect(book.deletedAt).toBeGreaterThan(0);
        expect(book.downloadedAt).toBeNull();
        expect(book.coverDownloadedAt).toBeNull();
      });

      test('clears uploadedAt when uploaded', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'both');

        expect(book.uploadedAt).toBeNull();
      });
    });

    describe('cloud delete action', () => {
      test('does not delete local files', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'cloud');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
      });

      test('clears uploadedAt when previously uploaded', async () => {
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'cloud');

        expect(book.uploadedAt).toBeNull();
      });

      test('skips cloud delete when not uploaded', async () => {
        const { deleteFile: deleteCloudFile } = await import('@/libs/storage');
        const book = createMockBook({ uploadedAt: null });
        await deleteBook(mockFs, book, 'cloud');

        expect(deleteCloudFile).not.toHaveBeenCalled();
      });

      test('calls deleteFile for remote book and cover', async () => {
        const { deleteFile: deleteCloudFile } = await import('@/libs/storage');
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'cloud');

        expect(deleteCloudFile).toHaveBeenCalledTimes(2);
      });

      test('does not throw when cloud delete fails', async () => {
        const { deleteFile: deleteCloudFile } = await import('@/libs/storage');
        vi.mocked(deleteCloudFile).mockImplementation(() => {
          throw new Error('network error');
        });
        const book = createMockBook({ uploadedAt: 1000 });

        // Should not throw
        await deleteBook(mockFs, book, 'cloud');
        expect(book.uploadedAt).toBeNull();
      });
    });

    // In-place imports keep their content at a user-controlled location
    // (book.filePath, base 'None') rather than under Books/<hash>/. For
    // 'local'/'both' deletes that source file IS the local copy and gets
    // removed (symmetric with deleting Books/<hash>/<title>.epub for a
    // normal book). The cloud upload path is shared, so cross-device sync
    // can still pull the book back.
    describe('in-place (book.filePath set)', () => {
      test('local action removes the user-controlled source file', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        await deleteBook(mockFs, book, 'local');

        // The source file is read from base 'None' (absolute path), not Books/.
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
      });

      test('local action does not probe Books/<hash>/<title>.epub', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        await deleteBook(mockFs, book, 'local');

        // The hash-copy path lives only on a normal book; for an in-place book
        // there's nothing there, so we shouldn't even check.
        expect(mockFs.exists).not.toHaveBeenCalledWith(`${book.hash}/${book.title}.epub`, 'Books');
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          `${book.hash}/${book.title}.epub`,
          'Books',
        );
      });

      test('local action still clears downloadedAt', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });
        await deleteBook(mockFs, book, 'local');
        expect(book.downloadedAt).toBeNull();
      });

      test('local action does not throw when the source file is missing', async () => {
        // exists() returns false → no removeFile call, but no error either.
        vi.mocked(mockFs.exists).mockResolvedValue(false);
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });
        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).not.toHaveBeenCalled();
        expect(book.downloadedAt).toBeNull();
      });

      test('local action swallows errors from removeFile (best-effort source delete)', async () => {
        vi.mocked(mockFs.removeFile).mockRejectedValueOnce(new Error('EPERM'));
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 12345,
        });

        // Must not throw, and must still flip the metadata bit so the UI
        // reflects the user's delete intent.
        await deleteBook(mockFs, book, 'local');
        expect(book.downloadedAt).toBeNull();
      });

      test('both action removes both the source file and the cover sidecar', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          uploadedAt: null,
        });
        await deleteBook(mockFs, book, 'both');

        // Source file under user-controlled path:
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
        // Cover sidecar under Books/<hash>/:
        expect(mockFs.removeFile).toHaveBeenCalledWith(`${book.hash}/cover.png`, 'Books');
        // We must never poke at Books/<hash>/<title>.epub for an in-place book.
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          `${book.hash}/${book.title}.epub`,
          'Books',
        );
      });

      test('both action still flips deletedAt/downloadedAt/coverDownloadedAt', async () => {
        const book = createMockBook({
          filePath: '/Users/me/Library/sample.epub',
          downloadedAt: 2000,
          coverDownloadedAt: 3000,
        });
        await deleteBook(mockFs, book, 'both');

        expect(book.deletedAt).toBeGreaterThan(0);
        expect(book.downloadedAt).toBeNull();
        expect(book.coverDownloadedAt).toBeNull();
      });
    });
  });
});
