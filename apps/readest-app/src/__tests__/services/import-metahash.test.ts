import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';
import { getMetadataHash } from '@/utils/book';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return { ...actual, partialMD5: mockPartialMD5 };
});

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  class MockDocumentLoader {
    open() {
      return mockOpen();
    }
  }
  return { ...actual, DocumentLoader: MockDocumentLoader };
});

vi.mock('@/utils/txt', () => ({ TxtToEpubConverter: vi.fn() }));
vi.mock('@/utils/svg', () => ({ svg2png: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn(),
  batchGetDownloadUrls: vi.fn(),
}));

import { BaseAppService } from '@/services/appService';

// Concrete test subclass of BaseAppService with mocked fs
class TestAppService extends BaseAppService {
  protected fs = {
    openFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(),
    stats: vi.fn(),
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn().mockResolvedValue(''),
    getImageURL: vi.fn(),
    getPrefix: vi.fn(),
  };

  protected resolvePath() {
    return { baseDir: 0, basePrefix: async () => '', fp: '', base: 'Books' as const };
  }

  async init() {}
  async setCustomRootDir() {}
  async selectDirectory() {
    return '';
  }
  async selectFiles() {
    return [];
  }
  async saveFile() {
    return false;
  }
  async ask() {
    return false;
  }
  async openDatabase() {
    return {} as ReturnType<BaseAppService['openDatabase']>;
  }
  async createWindow() {}
  async getCacheDir() {
    return '';
  }
  async clearWebviewCache() {}
  async showNotification() {}

  getFs() {
    return this.fs;
  }
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'old-hash-123',
    format: 'EPUB' as Book['format'],
    title: 'Test Book',
    sourceTitle: 'Test Book',
    author: 'Test Author',
    createdAt: Date.now() - 10000,
    updatedAt: Date.now() - 10000,
    downloadedAt: Date.now() - 10000,
    deletedAt: null,
    ...overrides,
  };
}

const TEST_METADATA = {
  title: 'Test Book',
  author: 'Test Author',
  language: 'en',
  identifier: 'isbn-123',
};

function setupMockBookDoc(metadata: Record<string, unknown> = TEST_METADATA) {
  const bookDoc = {
    metadata,
    getCover: vi.fn().mockResolvedValue(null),
  };
  mockOpen.mockResolvedValue({ book: bookDoc, format: 'EPUB' });
}

describe('importBook metaHash deduplication', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
  });

  it('should detect metaHash match and override existing book with new hash', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const existingBook = makeBook({ hash: 'old-hash-123', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    // Should return the existing book, not a new one
    expect(result).toBe(existingBook);
    // Library should still have only one book
    expect(books.length).toBe(1);
    // Hash should be updated to new file's content hash
    expect(existingBook.hash).toBe('new-hash-456');
    // Metadata should be overridden
    expect(existingBook.metadata).toEqual(TEST_METADATA);
    // metaHash should be set
    expect(existingBook.metaHash).toBe(metaHash);
  });

  it('should not match metaHash for deleted books', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const deletedBook = makeBook({
      hash: 'old-hash-123',
      metaHash,
      deletedAt: Date.now(),
    });
    const books: Book[] = [deletedBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    // Should create a new book since the existing one is deleted
    expect(result).not.toBe(deletedBook);
    expect(books.length).toBe(2);
  });

  it('should migrate config to new directory with updated bookHash and metaHash', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({ hash: 'old-hash-123', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path === 'old-hash-123/config.json') return true;
      if (path === 'old-hash-123') return true;
      return false;
    });
    fs.readFile.mockResolvedValue('{"readProgress":0.5}');

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    // Should have read config from old directory
    expect(fs.readFile).toHaveBeenCalledWith('old-hash-123/config.json', 'Books', 'text');
    // Should have written config to new directory with updated bookHash and metaHash
    const writeCalls = fs.writeFile.mock.calls;
    const configWrite = writeCalls.find((c: unknown[]) => c[0] === 'new-hash-456/config.json');
    expect(configWrite).toBeDefined();
    const writtenConfig = JSON.parse(configWrite![2] as string);
    expect(writtenConfig.bookHash).toBe('new-hash-456');
    expect(writtenConfig.metaHash).toBe(metaHash);
    expect(writtenConfig.readProgress).toBe(0.5);
    // Should have removed old directory
    expect(fs.removeDir).toHaveBeenCalledWith('old-hash-123', 'Books', true);
  });

  it('should prefer exact file hash match over metaHash match', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const exactMatchBook = makeBook({ hash: 'same-hash', metaHash });
    const metaMatchBook = makeBook({ hash: 'different-hash', metaHash });
    const books: Book[] = [exactMatchBook, metaMatchBook];

    mockPartialMD5.mockResolvedValue('same-hash');
    setupMockBookDoc();

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    // Should return the exact hash match, not the metaHash match
    expect(result).toBe(exactMatchBook);
    expect(books.length).toBe(2);
  });

  it('should not check metaHash for transient imports', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({ hash: 'old-hash', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.openFile.mockResolvedValue(new File(['content'], 'test.epub'));

    // Transient import requires string file path
    const result = await service.importBook('/path/to/test.epub', books, true, true, false, true);

    // Should create a new entry, not override existing
    expect(result).not.toBe(existingBook);
  });
});
