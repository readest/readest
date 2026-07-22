import { describe, it, expect } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBackupEntriesToZip } from '@/services/backupService';
import type { AppService, FileItem } from '@/types/system';

/**
 * Regression test for issue #4703: a backup zip exported on Windows failed to
 * restore on every platform. `readDirectory` returns paths using the host
 * separator, so on Windows `file.path` is `hash\cover.png` (backslash). When
 * that backslash leaked into the zip entry name, restore's
 * `filename.startsWith(`${hash}/`)` filter (forward slash) never matched and
 * every book file was silently skipped. Entry names must always use `/`.
 */

const BOOK_HASH = '6afdd0136531fbe028e0503a14ba234c';

/** Build a stub AppService whose `readDirectory` returns the given file list. */
function makeAppService(files: FileItem[]): AppService {
  return {
    loadLibraryBooks: async () => [],
    loadSettings: async () => ({}) as never,
    resolveFilePath: async () => 'C:/Users/me/AppData/Books',
    readDirectory: async () => files,
    readFile: async () => new ArrayBuffer(8),
  } as unknown as AppService;
}

/** A ZipWriter stub that records the entry name passed to each `add` call. */
function makeCapturingWriter() {
  const names: string[] = [];
  const writer = {
    add: async (name: string) => {
      names.push(name);
    },
  } as unknown as ZipWriter<unknown>;
  return { writer, names };
}

describe('addBackupEntriesToZip - cross-platform entry names (#4703)', () => {
  it('normalizes Windows backslash paths to forward slashes', async () => {
    const windowsFiles: FileItem[] = [
      { path: `${BOOK_HASH}\\book.epub`, size: 1000 },
      { path: `${BOOK_HASH}\\cover.png`, size: 200 },
      { path: `${BOOK_HASH}\\config.json`, size: 50 },
    ];
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService(windowsFiles), {});

    // No entry name may contain a backslash.
    expect(names.some((n) => n.includes('\\'))).toBe(false);

    // Restore filters book files by `${hash}/`; the Windows export must match.
    const bookEntries = names.filter((n) => n.startsWith(`${BOOK_HASH}/`));
    expect(bookEntries).toEqual([
      `${BOOK_HASH}/book.epub`,
      `${BOOK_HASH}/cover.png`,
      `${BOOK_HASH}/config.json`,
    ]);
  });

  it('leaves POSIX forward-slash paths unchanged', async () => {
    const posixFiles: FileItem[] = [
      { path: `${BOOK_HASH}/book.epub`, size: 1000 },
      { path: `${BOOK_HASH}/cover.png`, size: 200 },
    ];
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, makeAppService(posixFiles), {});

    const bookEntries = names.filter((n) => n.startsWith(`${BOOK_HASH}/`));
    expect(bookEntries).toEqual([`${BOOK_HASH}/book.epub`, `${BOOK_HASH}/cover.png`]);
  });
});
