import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  getAPIBaseUrl: () => 'https://api.test',
  isWebAppPlatform: () => false,
}));
vi.mock('@/utils/access', () => ({ getUserID: vi.fn(async () => 'u1') }));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@/utils/transfer', () => ({
  tauriUpload: vi.fn(),
  tauriDownload: vi.fn(),
  webUpload: vi.fn(),
  webDownload: vi.fn(),
}));

import { fetchWithAuth } from '@/utils/fetch';
import { createReadestCloudDestination } from '@/services/sync/bookData/cloudDestination';
import { deleteBook } from '@/services/cloudService';
import type { Book } from '@/types/book';
import type { AppService, FileSystem } from '@/types/system';

// A book with more files in Readest Cloud than one listing page holds: the
// book file and 1,000 packs of one kind, then two packs past the first page.
const PAGE = 1000;
const bigBook = [
  'u1/Readest/Books/h/Title.epub',
  ...Array.from({ length: PAGE + 1 }, (_, i) => `u1/Readest/Books/h/tts/${i}-a.mp3`),
];
let keys = bigBook;
const listedUrls: string[] = [];

// Serves the list route as it pages: rows sorted by file key, `pageSize` at a time.
const serveList = async (url: string) => {
  listedUrls.push(url);
  const query = new URL(url).searchParams;
  const page = Number(query.get('page') ?? 1);
  const pageSize = Math.min(Number(query.get('pageSize') ?? 50), PAGE);
  const sorted = [...keys].sort();
  const files = sorted
    .slice((page - 1) * pageSize, page * pageSize)
    .map((file_key) => ({ file_key, book_hash: 'h' }));
  const body = {
    files,
    total: sorted.length,
    page,
    pageSize,
    totalPages: Math.ceil(sorted.length / pageSize),
  };
  return new Response(JSON.stringify(body), { status: 200 });
};

beforeEach(() => {
  keys = bigBook;
  listedUrls.length = 0;
  vi.mocked(fetchWithAuth).mockReset();
});

describe('a book with more than one page of cloud files', () => {
  test('the Readest Cloud destination lists packs past the first page', async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => serveList(url));
    const names = await createReadestCloudDestination({} as AppService).list('h', 'tts');
    expect(names?.size).toBe(PAGE + 1);
    expect(names?.has(`${PAGE}-a.mp3`)).toBe(true);
  });

  test('deleting the book from Readest Cloud purges packs past the first page', async () => {
    const purged: string[] = [];
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      if (url.includes('/storage/list')) return serveList(url);
      if (url.includes('/storage/purge')) {
        const { fileKeys } = JSON.parse(String(init.body)) as { fileKeys: string[] };
        purged.push(...fileKeys);
        return new Response(JSON.stringify({ failedCount: 0 }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const book = { hash: 'h', title: 'Title', format: 'EPUB', uploadedAt: 1 } as unknown as Book;
    await deleteBook({} as FileSystem, book, 'cloud');
    await vi.waitFor(() => expect(purged).toHaveLength(PAGE + 1));
    expect(purged).toContain(`u1/Readest/Books/h/tts/${PAGE}-a.mp3`);
  });

  test('a book within one page takes one listing request', async () => {
    keys = bigBook.slice(0, 3);
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => serveList(url));
    await createReadestCloudDestination({} as AppService).list('h', 'tts');
    expect(listedUrls).toHaveLength(1);
  });
});
