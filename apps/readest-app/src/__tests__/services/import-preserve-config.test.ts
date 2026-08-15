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

const BOOK_HASH = 'hash-abc';
const CONFIG_PATH = `${BOOK_HASH}/config.json`;

const setupMockBookDoc = () => {
  mockOpen.mockResolvedValue({
    book: {
      metadata: { title: 'Test Book', author: 'Test Author', language: 'en' },
      getCover: vi.fn().mockResolvedValue(null),
    },
    format: 'EPUB',
  });
};

const configWrites = (fs: ReturnType<TestAppService['getFs']>) =>
  fs.writeFile.mock.calls.filter((call) => call[0] === CONFIG_PATH);

/**
 * Issue #5716, second fault. `importBook` decided whether to stamp a fresh
 * INIT_BOOK_CONFIG by looking at the LIBRARY record, not at the config file —
 * so any book whose `Books/<hash>/` dir already held a config.json but whose
 * library.json row was missing had its reading position, bookmarks and
 * annotations overwritten with an empty config.
 *
 * `restoreBackup` walks straight into this: for a hash dir the archive's
 * library.json does not list, it extracts the dir (config.json included) and
 * then imports the book file, which had no library row yet.
 */
describe('importBook config preservation (issue #5716)', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue(BOOK_HASH);
    setupMockBookDoc();
  });

  it('keeps a config.json that is already on disk for an unlisted book', async () => {
    const fs = service.getFs();
    // The restored dir already holds the user's config; the library does not
    // know about the book yet.
    fs.exists.mockImplementation(async (path: string) => path === CONFIG_PATH);

    const books: Book[] = [];
    const imported = await service.importBook(
      new File(['content'], 'test.epub', { type: 'application/epub+zip' }),
      books,
    );

    expect(imported).not.toBeNull();
    expect(books).toHaveLength(1);
    expect(configWrites(fs)).toHaveLength(0);
  });

  it('still writes an initial config when the book dir has none', async () => {
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);

    const books: Book[] = [];
    await service.importBook(
      new File(['content'], 'test.epub', { type: 'application/epub+zip' }),
      books,
    );

    expect(configWrites(fs)).toHaveLength(1);
  });
});
