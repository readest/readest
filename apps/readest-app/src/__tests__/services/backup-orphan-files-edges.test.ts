import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBackupEntriesToZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

/**
 * Edge cases around the live-hash export filter introduced for #5837: the
 * retained zero-byte skip, progress accounting over the filtered list, and a
 * single unreadable file not aborting the rest of a live book's export.
 */

const LIVE_HASH = '1111111111111111111111111111aaaa';
const OTHER_HASH = '4444444444444444444444444444dddd';

function makeBook(overrides: Partial<Book>): Book {
  return {
    hash: LIVE_HASH,
    format: 'EPUB',
    title: 'Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function makeAppService(
  books: Book[],
  files: FileItem[],
  readFile: AppService['readFile'] = async () => new ArrayBuffer(8),
): AppService {
  return {
    loadLibraryBooks: async () => books,
    loadSettings: async () => ({}) as never,
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => files,
    readFile,
  } as unknown as AppService;
}

function makeCapturingWriter() {
  const names: string[] = [];
  const writer = {
    add: async (name: string) => {
      names.push(name);
    },
  } as unknown as ZipWriter<unknown>;
  return { writer, names };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addBackupEntriesToZip - live-hash filter edges (#5837)', () => {
  it('still skips zero-byte files inside a live book dir', async () => {
    const files: FileItem[] = [
      { path: `${LIVE_HASH}/book.epub`, size: 1000 },
      { path: `${LIVE_HASH}/cover.png`, size: 0 },
    ];
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService([makeBook({})], files), {});

    expect(names.filter((n) => n.includes('/'))).toEqual([`${LIVE_HASH}/book.epub`]);
  });

  it('reports progress over the filtered file list using the host path', async () => {
    // Two live files plus an orphan and a zero-byte file: `total` must count
    // only what is exported, while the filename echoes the on-disk path so a
    // Windows user sees the same separators the OS shows them.
    const files: FileItem[] = [
      { path: `${LIVE_HASH}\\book.epub`, size: 1000 },
      { path: `${LIVE_HASH}\\config.json`, size: 50 },
      { path: `${LIVE_HASH}\\empty.bin`, size: 0 },
      { path: `${OTHER_HASH}\\book.epub`, size: 1000 },
    ];
    const { writer } = makeCapturingWriter();
    const progress: Array<[number, number, string]> = [];

    await addBackupEntriesToZip(
      writer,
      makeAppService([makeBook({})], files),
      {},
      (current, total, filename) => progress.push([current, total, filename]),
    );

    expect(progress).toEqual([
      [1, 2, `${LIVE_HASH}\\book.epub`],
      [2, 2, `${LIVE_HASH}\\config.json`],
    ]);
  });

  it('skips a file that cannot be read and keeps exporting the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files: FileItem[] = [
      { path: `${LIVE_HASH}/book.epub`, size: 1000 },
      { path: `${LIVE_HASH}/cover.png`, size: 200 },
      { path: `${LIVE_HASH}/config.json`, size: 50 },
    ];
    const readFile: AppService['readFile'] = async (path) => {
      if (path.endsWith('cover.png')) throw new Error('EACCES');
      return new ArrayBuffer(8);
    };
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService([makeBook({})], files, readFile), {});

    expect(names.filter((n) => n.includes('/'))).toEqual([
      `${LIVE_HASH}/book.epub`,
      `${LIVE_HASH}/config.json`,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${LIVE_HASH}/cover.png`),
      expect.any(Error),
    );
  });
});
