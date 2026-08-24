import { describe, it, expect } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBackupEntriesToZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

/**
 * Regression test for issue #5837: the backup zip exported every file under
 * the Books/ tree, so hash directories no live library row references — a
 * soft-deleted book whose file lingered, or an import killed before the
 * library was saved — were silently exported even though they never appear
 * in the library UI. Only a live (non-deleted) book's own `<hash>/` dir
 * belongs in the backup.
 */

const LIVE_HASH = '1111111111111111111111111111aaaa';
const DELETED_HASH = '2222222222222222222222222222bbbb';
const ORPHAN_HASH = '3333333333333333333333333333cccc';

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

function makeAppService(books: Book[], files: FileItem[]): AppService {
  return {
    loadLibraryBooks: async () => books,
    loadSettings: async () => ({}) as never,
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => files,
    readFile: async () => new ArrayBuffer(8),
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

describe('addBackupEntriesToZip - only live library books are exported (#5837)', () => {
  const files: FileItem[] = [
    { path: 'library.json', size: 10 },
    { path: 'library.json.bak', size: 10 },
    { path: `${LIVE_HASH}/book.epub`, size: 1000 },
    { path: `${LIVE_HASH}/cover.png`, size: 200 },
    { path: `${LIVE_HASH}/config.json`, size: 50 },
    { path: `${DELETED_HASH}/book.epub`, size: 1000 },
    { path: `${DELETED_HASH}/config.json`, size: 50 },
    { path: `${ORPHAN_HASH}/book.pdf`, size: 1000 },
    { path: `${ORPHAN_HASH}/cover.png`, size: 200 },
  ];

  it('skips hash dirs with no library row and dirs of soft-deleted books', async () => {
    const books = [
      makeBook({ hash: LIVE_HASH }),
      makeBook({ hash: DELETED_HASH, deletedAt: 5000 }),
    ];
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService(books, files), {});

    const bookEntries = names.filter((n) => n.includes('/'));
    expect(bookEntries).toEqual([
      `${LIVE_HASH}/book.epub`,
      `${LIVE_HASH}/cover.png`,
      `${LIVE_HASH}/config.json`,
    ]);
    // library.json in the zip is the generated snapshot, never the on-disk
    // metadata files picked up from the directory walk.
    expect(names.filter((n) => n === 'library.json')).toHaveLength(1);
    expect(names).not.toContain('library.json.bak');
  });

  it('falls back to exporting every dir when the library has no rows at all', async () => {
    // A library.json that failed to load hands back [] (safeLoadJSON); the
    // Books tree is then the only copy, and restore's orphan import is how a
    // broken library gets rebuilt. Root-level metadata still stays out.
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService([], files), {});

    expect(names.filter((n) => n.includes('/'))).toEqual(
      files.map((f) => f.path).filter((p) => p.includes('/')),
    );
    expect(names).not.toContain('library.json.bak');
  });

  it('exports nothing from the Books tree when every row is soft-deleted', async () => {
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(
      writer,
      makeAppService([makeBook({ hash: DELETED_HASH, deletedAt: 5000 })], files),
      {},
    );

    expect(names.filter((n) => n.includes('/'))).toEqual([]);
  });

  it('matches a live book dir on Windows backslash paths', async () => {
    const windowsFiles: FileItem[] = [
      { path: `${LIVE_HASH}\\book.epub`, size: 1000 },
      { path: `${ORPHAN_HASH}\\book.epub`, size: 1000 },
    ];
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(
      writer,
      makeAppService([makeBook({ hash: LIVE_HASH })], windowsFiles),
      {},
    );

    expect(names.filter((n) => n.includes('/'))).toEqual([`${LIVE_HASH}/book.epub`]);
  });
});
