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
import {
  buildBookLookupIndex,
  collectKnownSourcePaths,
  selectNewImportableFiles,
} from '@/services/bookService';

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
  title: 'Duplicated Book',
  author: 'Author',
  language: 'en',
  identifier: 'isbn-dup',
};

/** One watched folder holding the same book under two different filenames. */
const ORIGINAL_PATH = '/lib/watched/book.epub';
const DUPLICATE_PATH = '/lib/watched/book-copy.epub';
const SCANNED = [
  { fullPath: ORIGINAL_PATH, size: 1024 },
  { fullPath: DUPLICATE_PATH, size: 1024 },
];

describe('auto-import: watched folder with duplicated files', () => {
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
    fs.openFile.mockImplementation(async (path: string) => new File(['content'], path));
    // Same bytes under both names -> identical partial md5.
    mockPartialMD5.mockResolvedValue('dup-hash');
    mockOpen.mockResolvedValue({
      book: { metadata: TEST_METADATA, getCover: vi.fn().mockResolvedValue(null) },
      format: 'EPUB',
    });
  });

  /** One auto-import pass: pick the files that look new, then ingest them. */
  const runScan = async (library: Book[]) => {
    const existingPaths = collectKnownSourcePaths(library, 'linux');
    const fresh = selectNewImportableFiles(SCANNED, {
      extensions: ['epub'],
      minSizeBytes: 0,
      existingPaths,
      osPlatform: 'linux',
    });
    const lookupIndex = buildBookLookupIndex(library, 'linux');
    for (const entry of fresh) {
      await service.importBook(entry.fullPath, library, { lookupIndex, inPlace: true });
    }
    return fresh.map((f) => f.fullPath);
  };

  it('does not re-import the duplicate on every later scan', async () => {
    const library: Book[] = [];

    const first = await runScan(library);
    expect(first).toEqual([ORIGINAL_PATH, DUPLICATE_PATH]);
    // Both files are the same book, so the library holds a single entry.
    expect(library.filter((b) => !b.deletedAt)).toHaveLength(1);

    // Second scan (app returns to the foreground): nothing on disk changed, so
    // nothing should be imported again.
    const second = await runScan(library);
    expect(second).toEqual([]);

    // And it must stay quiet on every later scan, not ping-pong between the
    // two paths.
    const third = await runScan(library);
    expect(third).toEqual([]);
  });

  it('keeps both names on the single deduped entry', async () => {
    const library: Book[] = [];
    await runScan(library);

    const book = library.find((b) => !b.deletedAt)!;
    // The most recently ingested file owns `filePath` (that is what makes a
    // rename recoverable); the other name is remembered alongside it.
    expect(book.filePath).toBe(DUPLICATE_PATH);
    expect(book.altFilePaths).toEqual([ORIGINAL_PATH]);
  });

  it('does not accumulate duplicate entries across repeated imports', async () => {
    const library: Book[] = [];
    await runScan(library);

    const book = library.find((b) => !b.deletedAt)!;
    const lookupIndex = buildBookLookupIndex(library, 'linux');
    // Re-importing the same two files (manual folder import, which ignores the
    // known-path filter) must not grow the list without bound.
    await service.importBook(ORIGINAL_PATH, library, { lookupIndex, inPlace: true });
    await service.importBook(DUPLICATE_PATH, library, { lookupIndex, inPlace: true });

    expect(book.filePath).toBe(DUPLICATE_PATH);
    expect(book.altFilePaths).toEqual([ORIGINAL_PATH]);
  });

  it('follows a rename and remembers the vacated path', async () => {
    const library: Book[] = [];
    const lookupIndex = buildBookLookupIndex(library, 'linux');
    await service.importBook(ORIGINAL_PATH, library, { lookupIndex, inPlace: true });

    const book = library[0]!;
    expect(book.filePath).toBe(ORIGINAL_PATH);

    const renamed = '/lib/watched/renamed.epub';
    await service.importBook(renamed, library, {
      lookupIndex: buildBookLookupIndex(library, 'linux'),
      inPlace: true,
    });

    // Content is read from `filePath`, so it must point at the name that
    // actually exists on disk now.
    expect(book.filePath).toBe(renamed);
    expect(book.altFilePaths).toEqual([ORIGINAL_PATH]);
  });

  // The other dedup arm: two different files (different bytes, so different
  // hashes) that describe the same book and collapse on `metaHash`.
  it('remembers both paths when two different files share a metaHash', async () => {
    mockPartialMD5.mockImplementation(async (file: File) =>
      file.name === ORIGINAL_PATH ? 'hash-a' : 'hash-b',
    );

    const library: Book[] = [];
    const first = await runScan(library);
    expect(first).toEqual([ORIGINAL_PATH, DUPLICATE_PATH]);
    expect(library.filter((b) => !b.deletedAt)).toHaveLength(1);

    const book = library.find((b) => !b.deletedAt)!;
    // The metaHash arm re-keys the survivor to the newest file's hash.
    expect(book.hash).toBe('hash-b');
    expect(book.altFilePaths).toEqual([ORIGINAL_PATH]);
    expect(await runScan(library)).toEqual([]);
  });

  it('leaves alternative paths unset for a copy-mode import', async () => {
    const library: Book[] = [];
    const lookupIndex = buildBookLookupIndex(library, 'linux');
    await service.importBook(ORIGINAL_PATH, library, { lookupIndex });
    await service.importBook(DUPLICATE_PATH, library, { lookupIndex });

    const book = library.find((b) => !b.deletedAt)!;
    // Copy-mode books live under Books/<hash>/ and carry no source path at all.
    expect(book.filePath).toBeUndefined();
    expect(book.altFilePaths).toBeUndefined();
  });
});
