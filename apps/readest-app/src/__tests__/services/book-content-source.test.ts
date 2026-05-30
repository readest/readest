import { describe, expect, test, vi } from 'vitest';
import { exportBook, getBookFileSize, isBookAvailable } from '@/services/bookService';
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
});
