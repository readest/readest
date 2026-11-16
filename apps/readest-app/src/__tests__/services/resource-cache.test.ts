// What an open of a book keeps for its next open (the parsed EPUB, its prepared sections and
// stylesheets) is used only by the same version of the app, and a prepared resource only while
// everything its transforms read is unchanged.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/version', () => ({ getAppVersion: vi.fn(() => '1.0.0') }));

import { getAppVersion } from '@/utils/version';
import { loadBookCache, saveBookCache } from '@/services/bookService';
import { createResourceCache } from '@/services/resourceCache';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';

const book = { hash: 'h1', format: 'EPUB', title: 'T' } as Book;

// A file takes 1 KB on disk per character, so a short string stands for a large file.
const memoryFs = () => {
  const files = new Map<string, string>();
  const read = async (path: string, base: string) => {
    const data = files.get(`${base}:${path}`);
    if (data === undefined) throw new Error('not found');
    return data;
  };
  const fs = {
    readFile: read,
    writeFile: async (path: string, base: string, data: string) =>
      void files.set(`${base}:${path}`, data),
    stats: async (path: string, base: string) => ({ size: (await read(path, base)).length * KB }),
    removeDir: async (path: string, base: string) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${base}:${path}/`)) files.delete(key);
      }
    },
  } as unknown as FileSystem;
  return { files, fs };
};
const KB = 1024;

describe('the book cache folder', () => {
  test('keeps a copy in the app cache, not with the book', async () => {
    const { files, fs } = memoryFs();
    await saveBookCache(fs, book, 'epub.json', '{"a":1}');
    expect([...files.keys()].sort()).toEqual([
      'Cache:book-cache/h1/epub.json',
      'Cache:book-cache/index.json',
    ]);
    expect(await loadBookCache(fs, book, 'epub.json')).toBe('{"a":1}');
  });

  test('has nothing for a name never kept', async () => {
    expect(await loadBookCache(memoryFs().fs, book, 'epub.json')).toBeNull();
  });

  test('ignores what another version of the app kept', async () => {
    const { fs } = memoryFs();
    await saveBookCache(fs, book, 'epub.json', '{"a":1}');
    vi.mocked(getAppVersion).mockReturnValueOnce('1.0.1');
    expect(await loadBookCache(fs, book, 'epub.json')).toBeNull();
  });
});

describe('the book cache size', () => {
  const books = Object.fromEntries(
    ['h1', 'h2', 'h3'].map((hash) => [hash, { hash, format: 'EPUB' } as Book]),
  );
  // ~45 MB on disk in memoryFs
  const section = 'x'.repeat(45 * KB);
  const kept = async (fs: FileSystem, hash: string, name = 'res-1.json') =>
    (await loadBookCache(fs, books[hash]!, name)) !== null;

  beforeEach(() => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
  });
  afterEach(() => vi.restoreAllMocks());

  test('stays under 128 MB: the books cached longest ago go first', async () => {
    const { fs } = memoryFs();
    await saveBookCache(fs, books['h1']!, 'res-1.json', section);
    await saveBookCache(fs, books['h1']!, 'epub.json', '{}');
    await saveBookCache(fs, books['h2']!, 'res-1.json', section);
    await saveBookCache(fs, books['h3']!, 'res-1.json', section);
    expect(await kept(fs, 'h1')).toBe(false);
    expect(await kept(fs, 'h1', 'epub.json')).toBe(false);
    expect(await kept(fs, 'h2')).toBe(true);
    expect(await kept(fs, 'h3')).toBe(true);
  });

  test('counts a book as recent when it keeps something new', async () => {
    const { fs } = memoryFs();
    await saveBookCache(fs, books['h1']!, 'res-1.json', section);
    await saveBookCache(fs, books['h2']!, 'res-1.json', section);
    await saveBookCache(fs, books['h1']!, 'res-2.json', 'x');
    await saveBookCache(fs, books['h3']!, 'res-1.json', section);
    expect(await kept(fs, 'h1')).toBe(true);
    expect(await kept(fs, 'h2')).toBe(false);
  });

  test('counts a file kept again once', async () => {
    const { fs } = memoryFs();
    await saveBookCache(fs, books['h1']!, 'res-1.json', section);
    await saveBookCache(fs, books['h1']!, 'res-1.json', section);
    await saveBookCache(fs, books['h2']!, 'res-1.json', section);
    expect(await kept(fs, 'h1')).toBe(true);
  });
});

describe('createResourceCache', () => {
  const entry = {
    type: 'text/html',
    mediaType: 'text/html',
    data: '<p>\0' + '0\0</p>',
    children: ['a.png'],
  };
  const setup = () => {
    const { files, fs } = memoryFs();
    const appService = {
      loadBookCache: (b: Book, name: string) => loadBookCache(fs, b, name),
      saveBookCache: (b: Book, name: string, data: string) => saveBookCache(fs, b, name, data),
    };
    let inputs: unknown = [{ fontSize: 16 }, 600, 800];
    const cache = createResourceCache(appService, book, () => inputs);
    return { files, cache, setInputs: (next: unknown) => (inputs = next) };
  };

  test('restores what it kept while the inputs are unchanged', async () => {
    const { cache } = setup();
    expect(await cache.get('OEBPS/c1.xhtml')).toBeNull();
    await cache.put('OEBPS/c1.xhtml', entry);
    expect(await cache.get('OEBPS/c1.xhtml')).toEqual(entry);
    expect(await cache.get('OEBPS/c2.xhtml')).toBeNull();
  });

  test('prepares a resource again once an input changes', async () => {
    const { cache, setInputs } = setup();
    await cache.put('OEBPS/c1.xhtml', entry);
    setInputs([{ fontSize: 18 }, 600, 800]);
    expect(await cache.get('OEBPS/c1.xhtml')).toBeNull();
  });

  test('treats an unreadable entry as none', async () => {
    const { files, cache } = setup();
    await cache.put('OEBPS/c1.xhtml', entry);
    const [path] = [...files.keys()];
    files.set(path!, '1.0.0\n{"truncated');
    expect(await cache.get('OEBPS/c1.xhtml')).toBeNull();
  });
});
