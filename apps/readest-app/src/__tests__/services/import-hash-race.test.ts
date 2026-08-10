import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';

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
import { buildBookLookupIndex } from '@/services/bookService';

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

  override osPlatform = 'linux' as BaseAppService['osPlatform'];

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
  title: 'Race Book',
  author: 'Race Author',
  language: 'en',
  identifier: 'race-id-1',
};

/**
 * The folder import pool runs several importBook calls concurrently against
 * one shared `books` array / lookup index. Each call reads `byHash` right
 * after `partialMD5` resolves but only writes the index much later (after
 * createDir / writeFile / cover awaits). Two files with identical bytes in
 * flight together therefore both miss the lookup and both push a row — one
 * source of the duplicate library entries in #5601. importBook must re-check
 * the index synchronously before pushing and adopt the winner's row instead.
 */
describe('importBook concurrent same-hash race', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.openFile.mockImplementation(
      async (path: string) => new File(['same-bytes'], path.split('/').pop()!),
    );
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');

    mockOpen.mockImplementation(async () => ({
      book: {
        metadata: { ...TEST_METADATA },
        getCover: vi.fn().mockResolvedValue(null),
        destroy: vi.fn(),
      },
      format: 'EPUB',
    }));
  });

  const gateBothImportsOnHash = () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    mockPartialMD5.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return 'same-hash-race';
    });
  };

  it('does not push duplicate rows when two identical files import concurrently (books.find arm)', async () => {
    gateBothImportsOnHash();
    const books: Book[] = [];

    const [a, b] = await Promise.all([
      service.importBook('/watched/copy-one.epub', books),
      service.importBook('/watched/copy-two.epub', books),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(books).toHaveLength(1);
    expect(a).toBe(b);
  });

  it('does not push duplicate rows when two identical files import concurrently (lookupIndex arm)', async () => {
    gateBothImportsOnHash();
    const books: Book[] = [];
    const lookupIndex = buildBookLookupIndex(books, 'linux');

    const [a, b] = await Promise.all([
      service.importBook('/watched/copy-one.epub', books, { lookupIndex }),
      service.importBook('/watched/copy-two.epub', books, { lookupIndex }),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(books).toHaveLength(1);
    expect(a).toBe(b);
    expect(lookupIndex.byHash.get('same-hash-race')).toBe(a);
  });
});
