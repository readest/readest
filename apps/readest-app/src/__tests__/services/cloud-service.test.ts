import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteBook, uploadBook } from '@/services/cloudService';
import { Book, BookFormat } from '@/types/book';
import { BaseDir, FileSystem } from '@/types/system';

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

      test('removes the managed copy when filePath is stale', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/missing.epub' });
        const managedPath = `${book.hash}/${book.title}.epub`;
        vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
          return base === 'Books' && path === managedPath;
        });

        await deleteBook(mockFs, book, 'local');

        expect(mockFs.removeFile).toHaveBeenCalledWith(managedPath, 'Books');
        expect(mockFs.removeFile).not.toHaveBeenCalledWith(
          '/Users/me/Library/missing.epub',
          'None',
        );
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

    // Purge is the "Cloud & Device" delete PLUS a full wipe of the
    // app-generated Books/<hash>/ directory (config.json reading progress/notes,
    // nav.json, cover.png) that the other deletes leave behind (issue #4615).
    // The local-file side lives here; the tombstone + queued cloud deletion are
    // owned by the page's handleBookDelete, exactly like the 'both'/'local'
    // split, so this branch must NOT touch deletedAt or the cloud.
    describe('purge delete action', () => {
      test('removes the entire Books/<hash>/ directory', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'purge');

        expect(mockFs.removeDir).toHaveBeenCalledWith(book.hash, 'Books', true);
      });

      test('does not remove the managed book file individually (the dir wipe covers it)', async () => {
        const book = createMockBook();
        await deleteBook(mockFs, book, 'purge');

        // The whole directory is removed in one shot; no per-file removeFile.
        expect(mockFs.removeFile).not.toHaveBeenCalled();
      });

      test('clears downloadedAt but leaves deletedAt for the caller (mirrors local)', async () => {
        const book = createMockBook({ downloadedAt: 12345, deletedAt: null });
        await deleteBook(mockFs, book, 'purge');

        expect(book.downloadedAt).toBeNull();
        expect(book.deletedAt).toBeNull();
      });

      test('does not delete cloud files (the page queues the cloud deletion)', async () => {
        const { deleteFile: deleteCloudFile } = await import('@/libs/storage');
        const book = createMockBook({ uploadedAt: 1000 });
        await deleteBook(mockFs, book, 'purge');

        expect(deleteCloudFile).not.toHaveBeenCalled();
        // uploadedAt is left intact for the queued cloud-delete transfer to clear.
        expect(book.uploadedAt).toBe(1000);
      });

      test('removes the in-place source file and the sidecar dir for in-place books', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
          if (base === 'None' && path === book.filePath) return true;
          if (base === 'Books' && path === book.hash) return true;
          return false;
        });

        await deleteBook(mockFs, book, 'purge');

        // External source file (outside Books/<hash>/) is removed...
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
        // ...and the metadata sidecar directory is wiped too.
        expect(mockFs.removeDir).toHaveBeenCalledWith(book.hash, 'Books', true);
      });

      test('does not throw when the directory does not exist', async () => {
        vi.mocked(mockFs.exists).mockResolvedValue(false);
        const book = createMockBook({ downloadedAt: 12345 });

        await deleteBook(mockFs, book, 'purge');

        expect(mockFs.removeDir).not.toHaveBeenCalled();
        expect(book.downloadedAt).toBeNull();
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
      const mockInPlaceExists = (book: Book, coverExists = true) => {
        vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
          if (base === 'None' && path === book.filePath) return true;
          if (base === 'Books' && path === `${book.hash}/cover.png`) return coverExists;
          return false;
        });
      };

      test('local action removes the user-controlled source file', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'local');

        // The source file is read from base 'None' (absolute path), not Books/.
        expect(mockFs.removeFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
      });

      test('local action does not remove Books/<hash>/<title>.epub', async () => {
        const book = createMockBook({ filePath: '/Users/me/Library/sample.epub' });
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'local');

        // The hash-copy path lives only on a normal book; for an in-place book,
        // the resolver can probe it, but deletion must target the external source.
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
        mockInPlaceExists(book);
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
        mockInPlaceExists(book);

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
        mockInPlaceExists(book);
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
        mockInPlaceExists(book);
        await deleteBook(mockFs, book, 'both');

        expect(book.deletedAt).toBeGreaterThan(0);
        expect(book.downloadedAt).toBeNull();
        expect(book.coverDownloadedAt).toBeNull();
      });
    });
  });

  describe('uploadBook', () => {
    test('uses an existing managed copy before a stale filePath', async () => {
      const book = createMockBook({ filePath: '/Users/me/Library/missing.epub' });
      const managedPath = `${book.hash}/${book.title}.epub`;
      const coverPath = `${book.hash}/cover.png`;
      vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
        return base === 'Books' && path === managedPath;
      });
      const resolveFilePath = vi.fn(async (path: string, base: BaseDir) => `${base}:${path}`);

      await uploadBook(mockFs, resolveFilePath, book);

      expect(mockFs.exists).toHaveBeenCalledWith(managedPath, 'Books');
      expect(mockFs.exists).not.toHaveBeenCalledWith('/Users/me/Library/missing.epub', 'None');
      expect(mockFs.openFile).toHaveBeenCalledWith(
        managedPath,
        'Books',
        expect.stringContaining(`${book.hash}/${book.hash}.epub`),
      );
      expect(mockFs.openFile).not.toHaveBeenCalledWith(
        '/Users/me/Library/missing.epub',
        'None',
        expect.any(String),
      );
      expect(mockFs.exists).toHaveBeenCalledWith(coverPath, 'Books');
    });

    test('does not mark a book uploaded when only the cover exists', async () => {
      const book = createMockBook({ uploadedAt: null, downloadedAt: null });
      const managedPath = `${book.hash}/${book.title}.epub`;
      const coverPath = `${book.hash}/cover.png`;
      vi.mocked(mockFs.exists).mockImplementation(async (path, base) => {
        return base === 'Books' && path === coverPath;
      });
      const resolveFilePath = vi.fn(async (path: string, base: BaseDir) => `${base}:${path}`);

      await expect(uploadBook(mockFs, resolveFilePath, book)).rejects.toThrow(
        'Book file not uploaded',
      );

      const { uploadFile } = await import('@/libs/storage');
      expect(uploadFile).not.toHaveBeenCalled();
      expect(book.uploadedAt).toBeNull();
      expect(mockFs.exists).toHaveBeenCalledWith(managedPath, 'Books');
    });
  });
});
