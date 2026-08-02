import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';

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
import { refreshBookMetadata } from '@/services/bookService';

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
  async saveImageToGallery() {
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

const TEST_METADATA = {
  title: 'Test Book',
  author: 'Test Author',
  language: 'en',
  identifier: 'isbn-123',
};

// Importing a PDF opens a full pdf.js document (worker + parsed structures +
// retained range chunks). Dropping the reference does NOT release it — the
// dedicated worker survives GC — so importBook must call destroy() or batch
// imports accumulate ~60 MB per PDF until the WebView renderer OOMs (#5387).
describe('importBook BookDoc lifecycle', () => {
  let service: TestAppService;
  let mockDestroy: ReturnType<typeof vi.fn>;

  const setupMockBookDoc = () => {
    mockDestroy = vi.fn();
    const bookDoc = {
      metadata: TEST_METADATA,
      getCover: vi.fn().mockResolvedValue(null),
      destroy: mockDestroy,
    };
    mockOpen.mockResolvedValue({ book: bookDoc, format: 'PDF' });
    return bookDoc;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue('hash-abc');
  });

  it('destroys the loaded BookDoc after a successful import', async () => {
    setupMockBookDoc();
    const books: Book[] = [];
    const mockFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });

    const result = await service.importBook(mockFile, books);

    expect(result).not.toBeNull();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the loaded BookDoc when the import fails after opening', async () => {
    setupMockBookDoc();
    service.getFs().createDir.mockRejectedValue(new Error('disk full'));
    const mockFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });

    await expect(service.importBook(mockFile, [])).rejects.toThrow();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('imports normally when the BookDoc has no destroy method', async () => {
    mockOpen.mockResolvedValue({
      book: { metadata: TEST_METADATA, getCover: vi.fn().mockResolvedValue(null) },
      format: 'EPUB',
    });
    const books: Book[] = [];
    const mockFile = new File(['epub content'], 'test.epub', { type: 'application/epub+zip' });

    const result = await service.importBook(mockFile, books);

    expect(result).not.toBeNull();
    expect(books.length).toBe(1);
  });

  it('destroys the BookDoc opened by refreshBookMetadata', async () => {
    const bookDoc = setupMockBookDoc();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(new ArrayBuffer(8));
    const book: Book = {
      hash: 'hash-abc',
      format: 'PDF',
      title: 'Test Book',
      sourceTitle: 'Test Book',
      author: 'Test Author',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };

    // loadBookContent goes through appService.loadBookContent → fs.openFile
    fs.openFile.mockResolvedValue(new File(['pdf content'], 'test.pdf'));

    const refreshed = await refreshBookMetadata(service.getFs() as never, book);

    expect(refreshed).toBe(true);
    expect(bookDoc.destroy).toHaveBeenCalledTimes(1);
  });
});
