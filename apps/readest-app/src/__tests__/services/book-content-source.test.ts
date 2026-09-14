import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  exportBook,
  getBookFileSize,
  isBookAvailable,
  loadBookContent,
} from '@/services/bookService';
import { resolveBookContentSource } from '@/services/bookContent';
import { useABSServerStore } from '@/store/absServerStore';
import { getLocalBookFilename } from '@/utils/book';
import type { Book } from '@/types/book';
import type { BaseDir, FileSystem } from '@/types/system';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'bookhash',
    format: 'EPUB',
    title: 'sample',
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    downloadedAt: 1,
    ...overrides,
  };
}

function makeFs(options: {
  existing?: Array<[string, BaseDir]>;
  files?: Record<string, File>;
}): FileSystem {
  const existing = new Set((options.existing ?? []).map(([path, base]) => `${base}:${path}`));
  const files = options.files ?? {};
  return {
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn(),
    getImageURL: vi.fn(),
    openFile: vi.fn(async (path: string, base: BaseDir) => {
      const file = files[`${base}:${path}`];
      if (!file) throw new Error(`missing ${base}:${path}`);
      return file;
    }),
    copyFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn().mockResolvedValue([]),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(async (path: string, base: BaseDir) => existing.has(`${base}:${path}`)),
    stats: vi.fn(),
    getPrefix: vi.fn(),
  };
}

describe('book content source resolution', () => {
  test('getBookFileSize reads external in-place sources when no managed copy exists', async () => {
    const book = makeBook({ filePath: '/Users/me/Library/sample.epub' });
    const fs = makeFs({
      existing: [[book.filePath!, 'None']],
      files: {
        'None:/Users/me/Library/sample.epub': new File(['external content'], 'sample.epub'),
      },
    });

    await expect(getBookFileSize(fs, book)).resolves.toBe('external content'.length);
    expect(fs.openFile).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
  });

  test('exportBook uses the external source path instead of a missing managed path', async () => {
    const book = makeBook({ filePath: '/Users/me/Library/sample.epub' });
    const fs = makeFs({
      existing: [[book.filePath!, 'None']],
      files: {
        'None:/Users/me/Library/sample.epub': new File(['external content'], 'sample.epub', {
          type: 'application/epub+zip',
        }),
      },
    });
    const resolveFilePath = vi.fn(async (path: string, base: BaseDir) => `${base}:${path}`);
    const copyFile = vi.fn();
    const saveFile = vi.fn().mockResolvedValue(true);

    await exportBook(fs, book, resolveFilePath, copyFile, saveFile);

    expect(resolveFilePath).toHaveBeenCalledWith('/Users/me/Library/sample.epub', 'None');
    expect(resolveFilePath).not.toHaveBeenCalledWith(getLocalBookFilename(book), 'Books');
    expect(copyFile).not.toHaveBeenCalled();
    expect(saveFile).toHaveBeenCalledWith('sample.epub', expect.any(ArrayBuffer), {
      filePath: 'None:/Users/me/Library/sample.epub',
      mimeType: 'application/epub+zip',
    });
  });

  test('isBookAvailable treats PSE streams as available content sources', async () => {
    const book = makeBook({ format: 'CBZ', url: 'pse://encoded-stream' });
    const fs = makeFs({});

    await expect(isBookAvailable(fs, book)).resolves.toBe(true);
  });

  test('isBookAvailable treats an ABS book as available without probing the filesystem', async () => {
    const book = makeBook({
      format: 'ABS',
      downloadedAt: undefined,
      filePath: 'abs://server-1/item-abc',
    });
    const fs = makeFs({});

    await expect(isBookAvailable(fs, book)).resolves.toBe(true);
    // ABS books stream from the server; resolving a content source (and thus
    // probing the abs:// filePath) must never happen for them.
    expect(fs.exists).not.toHaveBeenCalled();
  });

  test('getBookFileSize returns null for an ABS book instead of a false-positive size', async () => {
    const book = makeBook({
      format: 'ABS',
      downloadedAt: undefined,
      filePath: 'abs://server-1/item-abc',
    });
    const fs = makeFs({});

    await expect(getBookFileSize(fs, book)).resolves.toBeNull();
  });
});

describe('ABS ebook content source', () => {
  const server = {
    id: 'server-1',
    contentId: 'server-1',
    name: 'Home',
    url: 'http://abs.local',
    accessToken: 'tok-1',
  };
  const path = 'http://abs.local/api/items/item-abc/ebook?token=tok-1';
  const absEbook = () =>
    makeBook({
      format: 'ABS',
      downloadedAt: undefined,
      filePath: 'abs://server-1/item-abc',
      metadata: { title: 'sample', author: 'Author', language: 'en', absMediaType: 'ebook' },
    });

  beforeEach(() => {
    useABSServerStore.setState({ servers: [server] });
  });

  test('resolves to a url source whose fetcher owns the access token', async () => {
    const source = await resolveBookContentSource(makeFs({}), absEbook());

    expect(source).toMatchObject({ kind: 'url', base: 'None', path });
    if (source.kind !== 'url') throw new Error('expected a url source');
    expect(source.fetcher).toBeTypeOf('function');
  });

  test('loadBookContent opens the stream through that fetcher', async () => {
    const fs = makeFs({ files: { [`None:${path}`]: new File([], 'ebook') } });

    await loadBookContent(fs, absEbook());

    expect(fs.openFile).toHaveBeenCalledWith(path, 'None', undefined, expect.any(Function));
  });
});
