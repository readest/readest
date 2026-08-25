import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book, BookConfig } from '@/types/book';

// Reproduction for issue #5859: the OPDS auto-download re-import path.
// `syncCatalog` -> `downloadAndImport` -> `appService.importBook(path, books)`.
// The question: when auto-download fetches a book that is already in the
// library, can the re-import leave the book at INIT_BOOK_CONFIG (page one)
// and strand the reading progress? This drives the REAL bookService.importBook
// through the four shapes a re-download can take and observes the config each
// one writes.

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

// Models a tiny in-memory Books/ tree: config.json files keyed by their path.
// fs.exists / fs.readFile / fs.writeFile all go through it so state carries
// across the two imports the way a real re-download would see it.
let disk: Map<string, string>;

class TestAppService extends BaseAppService {
  protected fs = {
    openFile: vi.fn(),
    readFile: vi.fn(async (path: string) => disk.get(path) ?? '{}'),
    writeFile: vi.fn(async (path: string, _base: unknown, content: string) => {
      if (typeof content === 'string') disk.set(path, content);
    }),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(async (dir: string) => {
      // Directory retirement: drop that hash dir's config from the tree.
      for (const key of [...disk.keys()]) if (key.startsWith(`${dir}/`)) disk.delete(key);
    }),
    exists: vi.fn(async (path: string) => {
      if (path.endsWith('/config.json')) return disk.has(path);
      return false;
    }),
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

const META = { title: 'The Trap', author: 'Dorothy M. Richardson', language: 'en' };

const setMeta = (metadata: Record<string, unknown>) => {
  mockOpen.mockResolvedValue({
    book: { metadata, getCover: vi.fn().mockResolvedValue(null) },
    format: 'EPUB',
  });
};

const importOnce = async (
  service: TestAppService,
  books: Book[],
  hash: string,
  metadata: Record<string, unknown>,
) => {
  mockPartialMD5.mockResolvedValue(hash);
  setMeta(metadata);
  return service.importBook(
    new File(['bytes'], 'the-trap.epub', { type: 'application/epub+zip' }),
    books,
  );
};

// The reader wrote real progress into this hash's config after the first import.
const writeProgress = (hash: string) => {
  disk.set(
    `${hash}/config.json`,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: 2_000_000,
      location: 'epubcfi(/6/16!/4,/920,/936/1:819)',
      progress: [201, 240],
    } satisfies Partial<BookConfig>),
  );
};

const configOf = (hash: string): Partial<BookConfig> | null => {
  const raw = disk.get(`${hash}/config.json`);
  return raw ? (JSON.parse(raw) as Partial<BookConfig>) : null;
};

const isInitConfig = (hash: string) => {
  const c = configOf(hash);
  return !!c && !c.location && c.progress == null && (c.updatedAt ?? 0) === 0;
};

describe('OPDS auto-download re-import — can it reset a read book to INIT_BOOK_CONFIG? (#5859)', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    disk = new Map();
    service = new TestAppService();
    const fs = service.getFs();
    fs.createDir.mockResolvedValue(undefined);
  });

  it('CONTROL: identical re-download (same bytes) keeps the reading progress', async () => {
    const books: Book[] = [];
    await importOnce(service, books, 'H1', META); // first download
    writeProgress('H1'); // user reads

    await importOnce(service, books, 'H1', META); // auto-download fetches the same file

    expect(configOf('H1')?.location).toBeTruthy();
    expect(isInitConfig('H1')).toBe(false);
  });

  it('same metaHash, different bytes, old config present: progress migrates (no reset)', async () => {
    const books: Book[] = [];
    await importOnce(service, books, 'H1', META);
    writeProgress('H1');

    // calibre re-compresses -> different file hash, identical metadata.
    await importOnce(service, books, 'H2', META);

    // Progress should have moved to the new hash, not been reset.
    expect(configOf('H2')?.location).toBeTruthy();
    expect(isInitConfig('H2')).toBe(false);
  });

  it('RESET: re-download with changed metadata (new metaHash) lands a fresh INIT copy', async () => {
    const books: Book[] = [];
    await importOnce(service, books, 'H1', META);
    writeProgress('H1');

    // The feed serves an edition whose metadata differs (Standard Ebooks bump,
    // an added subtitle/identifier, a calibre metadata edit) -> new metaHash.
    await importOnce(service, books, 'H2', { ...META, title: 'The Trap (Revised)' });

    // A brand-new book at page one, while the read copy is stranded.
    expect(isInitConfig('H2')).toBe(true);
    const live = books.filter((b) => !b.deletedAt);
    expect(live.length).toBe(2); // duplicate created
  });

  it('RESET: same metaHash, different bytes, but the old config is gone -> INIT', async () => {
    const books: Book[] = [];
    await importOnce(service, books, 'H1', META);
    writeProgress('H1');
    // Old config vanished (a prior migration retired the dir, a lost write, etc.)
    disk.delete('H1/config.json');

    await importOnce(service, books, 'H2', META);

    expect(isInitConfig('H2')).toBe(true);
  });
});
