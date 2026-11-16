// How far each section of an EPUB runs along its pages, as foliate's paginator measured it, is kept
// for the book's next open: measuring a section takes the boxes of all its text.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/version', () => ({ getAppVersion: vi.fn(() => '1.0.0') }));

import { loadBookCache, saveBookCache } from '@/services/bookService';
import { createPageCache } from '@/services/pageCache';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';

const book = { hash: 'h1', format: 'EPUB', title: 'T' } as Book;
const PAGES = 'Cache:book-cache/h1/pages.json';

const setup = () => {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const read = async (path: string, base: string) => {
    const data = files.get(`${base}:${path}`);
    if (data === undefined) throw new Error('not found');
    return data;
  };
  const fs = {
    readFile: read,
    writeFile: async (path: string, base: string, data: string) => {
      writes.push(`${base}:${path}`);
      files.set(`${base}:${path}`, data);
    },
    stats: async (path: string, base: string) => ({ size: (await read(path, base)).length }),
    removeDir: async () => {},
  } as unknown as FileSystem;
  const appService = {
    loadBookCache: (b: Book, name: string) => loadBookCache(fs, b, name),
    saveBookCache: (b: Book, name: string, data: string) => saveBookCache(fs, b, name, data),
  };
  return { files, writes, open: () => createPageCache(appService, book) };
};

const measured = [{ key: '[800,600]', start: 0, size: 2400 }];

describe('createPageCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("gives the book's next open what its sections measured", async () => {
    const { open } = setup();
    const first = open();
    expect(await first.get(3)).toBeNull();
    first.put(3, measured);
    await vi.runAllTimersAsync();
    const next = open();
    expect(await next.get(3)).toEqual(measured);
    expect(await next.get(4)).toBeNull();
  });

  test('writes the measures that come together once', async () => {
    const { writes, open } = setup();
    const cache = open();
    cache.put(3, measured);
    cache.put(4, measured);
    cache.put(3, [...measured, ...measured]);
    await vi.runAllTimersAsync();
    expect(writes.filter((w) => w === PAGES)).toHaveLength(1);
    expect(await open().get(3)).toHaveLength(2);
  });

  test('treats an unreadable file as nothing kept', async () => {
    const { files, open } = setup();
    files.set(PAGES, '1.0.0\n{"3": [');
    expect(await open().get(3)).toBeNull();
    files.set(PAGES, '1.0.0\nnull');
    expect(await open().get(3)).toBeNull();
  });
});
