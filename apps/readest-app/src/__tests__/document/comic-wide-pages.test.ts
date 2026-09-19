// #6210: a comic's double-page spread is usually stored as one wide image.
// Paired with the next page it shows at half size and shifts every later page
// to the wrong side, so a wide page is laid out as a spread of its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { getImageSize } from '@/utils/image';
import { setCoverSpread } from '@/utils/spread';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: vi.fn(),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn(() => false) }));
vi.mock('@/utils/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/image')>();
  return { ...actual, getImageSize: vi.fn(actual.getImageSize) };
});

const u16be = (n: number) => [n >> 8, n & 0xff];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const png = (width: number, height: number) =>
  new Uint8Array([
    0x89,
    ...ascii('PNG\r\n\x1a\n'),
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
  ]);

// Incompressible filler, so the deflated metadata stays as long as the raw one.
const noise = (length: number) => {
  let x = 1;
  return Array.from({ length }, () => (x = (x * 1103515245 + 12345) >>> 0) >>> 24);
};

// A JPEG whose size marker sits behind `appLength` bytes of metadata.
const jpeg = (width: number, height: number, appLength: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    ...u16be(appLength),
    ...noise(appLength - 2),
    0xff,
    0xc0,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
  ]);

const makeCbz = async (pages: [name: string, data: Uint8Array, level?: number][]) => {
  const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/vnd.comicbook+zip'));
  for (const [name, data, level] of pages) {
    await writer.add(name, new Uint8ArrayReader(data), { level });
  }
  return new File([await writer.close()], 'spreads.cbz', {
    type: 'application/vnd.comicbook+zip',
  });
};

// A comic page's own loader (comic-book.js), which the renderer calls.
const loadPage = (book: BookDoc, index: number) =>
  (book.sections[index] as unknown as { load: () => Promise<string> }).load();

const pageSpreads = (book: BookDoc) =>
  Object.fromEntries(book.sections.map((section) => [section.id, section.pageSpread]));

describe('CBZ double-page spreads (#6210)', () => {
  afterEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    vi.mocked(invoke).mockReset();
  });

  it('lays out each wide page as a spread of its own', async () => {
    const file = await makeCbz([
      ['01.png', png(1200, 1829)],
      // Deflated, with the size marker past the first read step.
      ['02.jpg', jpeg(2200, 1673, 40000)],
      ['03.png', png(1200, 1829)],
      ['04.png', png(2400, 1800), 0],
      ['ComicInfo.xml', new Uint8Array(ascii('<ComicInfo/>'))],
    ]);
    const { book } = await new DocumentLoader(file, { widePages: {} }).open();
    expect(pageSpreads(book)).toEqual({
      '01.png': undefined,
      '02.jpg': 'center',
      '03.png': undefined,
      '04.png': 'center',
    });
  });

  it('stops inflating a page at the header limit', async () => {
    // 8 MB of zeros deflates to a few kilobytes: a small read that expands
    // a thousandfold must not be kept whole.
    const bomb = new Uint8Array(8 * 1024 * 1024);
    bomb.set([0xff, 0xd8]);
    const file = await makeCbz([
      ['01.jpg', bomb],
      ['02.png', png(2400, 1800)],
    ]);
    const { book } = await new DocumentLoader(file, { widePages: {} }).open();
    expect(pageSpreads(book)).toEqual({ '01.jpg': undefined, '02.png': 'center' });
    const longest = Math.max(...vi.mocked(getImageSize).mock.calls.map(([data]) => data.length));
    expect(longest).toBeLessThanOrEqual(64 * 1024);
  });

  it('takes the wide pages an earlier open found instead of measuring again', async () => {
    const file = await makeCbz([
      ['01.png', png(2400, 1800)],
      ['02.png', png(1200, 1829)],
    ]);
    const { book } = await new DocumentLoader(file, {
      widePages: { known: ['02.png'] },
    }).open();
    expect(pageSpreads(book)).toEqual({ '01.png': undefined, '02.png': 'center' });
  });

  it('measures a page as its image loads and reports the wide ones', async () => {
    // A streamed comic can only be measured then; `known: []` skips the
    // measuring up front, as a streamed file does.
    URL.createObjectURL ??= () => 'blob:page';
    const onFound = vi.fn();
    const file = await makeCbz([
      ['01.png', png(1200, 1829)],
      ['02.png', png(2400, 1800)],
    ]);
    const { book } = await new DocumentLoader(file, {
      widePages: { known: [], onFound },
    }).open();
    expect(pageSpreads(book)).toEqual({ '01.png': undefined, '02.png': undefined });
    await loadPage(book, 0);
    await loadPage(book, 1);
    expect(pageSpreads(book)).toEqual({ '01.png': undefined, '02.png': 'center' });
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(['02.png']);
  });

  it('leaves the pages unmeasured unless asked', async () => {
    const file = await makeCbz([['01.png', png(2400, 1800)]]);
    const { book } = await new DocumentLoader(file).open();
    expect(pageSpreads(book)).toEqual({ '01.png': undefined });
  });

  it('measures the pages natively when the app has the file path', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue({ '01.png': [1200, 1829], '02.png': [2200, 1673] });
    const file = await makeCbz([
      ['01.png', png(1, 1)],
      ['02.png', png(1, 1)],
    ]);
    const { book } = await new DocumentLoader(file, {
      nativeFilePath: '/books/spreads.cbz',
      widePages: {},
    }).open();
    expect(invoke).toHaveBeenCalledWith('get_comic_page_sizes', {
      filePath: '/books/spreads.cbz',
    });
    expect(pageSpreads(book)).toEqual({ '01.png': undefined, '02.png': 'center' });
  });
});

describe('setCoverSpread', () => {
  const makeBook = (dir: string, pageSpread?: string) =>
    ({ dir, sections: [{ pageSpread }, {}] }) as unknown as BookDoc;

  it('pairs the cover with the next page unless it is kept apart', () => {
    const book = makeBook('ltr');
    setCoverSpread(book, false);
    expect(book.sections[0]!.pageSpread).toBe('left');
    setCoverSpread(book, true);
    expect(book.sections[0]!.pageSpread).toBe('');

    const rtl = makeBook('rtl');
    setCoverSpread(rtl, false);
    expect(rtl.sections[0]!.pageSpread).toBe('right');
  });

  it('keeps a wide cover on its own', () => {
    const book = makeBook('ltr', 'center');
    setCoverSpread(book, false);
    expect(book.sections[0]!.pageSpread).toBe('center');
    setCoverSpread(book, true);
    expect(book.sections[0]!.pageSpread).toBe('center');
  });
});
