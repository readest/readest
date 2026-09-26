// An OPDS-PSE comic streams one page per request, so its pages can't be
// measured up front: each is measured as its image arrives, and a wide one
// (a double-page spread) is laid out on its own.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openPseStreamBook } from '@/services/opds/pseStream';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/services/constants', () => ({ READEST_OPDS_USER_AGENT: 'Readest' }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { opdsCatalogs: [] } }) },
}));
vi.mock('@/app/opds/utils/opdsReq', () => ({
  needsProxy: () => false,
  getProxiedURL: (url: string) => url,
  probeAuth: async () => null,
  withOriginSuppressed: (headers: Record<string, string>) => headers,
}));

const u32be = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const png = (width: number, height: number) =>
  new Blob([
    new Uint8Array([
      0x89,
      ...[...'PNG\r\n\x1a\n'].map((c) => c.charCodeAt(0)),
      ...u32be(13),
      ...[...'IHDR'].map((c) => c.charCodeAt(0)),
      ...u32be(width),
      ...u32be(height),
      8,
      6,
      0,
      0,
      0,
    ]),
  ]);

// Page 1 of the stream is a spread.
const pages = [png(1200, 1829), png(2400, 1800), png(1200, 1829)];

const data = {
  url: 'https://library.example.com/opds/book/7/page/{pageNumber}',
  catalogId: 'catalog-1',
  count: pages.length,
  title: 'Streamed',
  author: 'Author',
};

const loadPage = (book: { sections: unknown[] }, index: number) =>
  (book.sections[index] as { load: () => Promise<string> }).load();
const pageSpreads = (book: { sections: { id: string; pageSpread?: string }[] }) =>
  book.sections.map((section) => section.pageSpread);

describe('openPseStreamBook wide pages (#6210)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lays out a page on its own once its image arrives wide', async () => {
    URL.createObjectURL ??= () => 'blob:page';
    // A Response would hand back Node's Blob, not the page's own.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        blob: async () => pages[Number(url.split('/').pop())],
      })),
    );
    const onFound = vi.fn();
    const { book } = await openPseStreamBook(data, { known: [], onFound });
    expect(pageSpreads(book)).toEqual([undefined, undefined, undefined]);
    for (const i of [0, 1, 2]) await loadPage(book, i);
    expect(pageSpreads(book)).toEqual([undefined, 'center', undefined]);
    expect(onFound).toHaveBeenCalledOnce();
    expect(onFound).toHaveBeenCalledWith(['0001.jpg']);
  });

  it('lays out the pages an earlier read found wide before any loads', async () => {
    const { book } = await openPseStreamBook(data, { known: ['0002.jpg'] });
    expect(pageSpreads(book)).toEqual([undefined, undefined, 'center']);
  });
});
