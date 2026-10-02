import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppService } from '@/types/system';
import type { BookDoc } from '@/libs/document';

const makeAppService = (files: Record<string, ArrayBuffer> = {}) =>
  ({
    readFile: vi.fn(async (path: string) => {
      if (!files[path]) throw new Error('not found');
      return files[path];
    }),
    writeFile: vi.fn(async (path: string, _base: string, content: ArrayBuffer) => {
      files[path] = content;
    }),
  }) as unknown as AppService & {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };

const makeBookDoc = () =>
  ({
    getPageThumbnail: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
  }) as unknown as BookDoc & { getPageThumbnail: ReturnType<typeof vi.fn> };

let loadPageThumbnail: typeof import('@/app/reader/utils/pageThumbnails').loadPageThumbnail;
let getCachedPageThumbnail: typeof import('@/app/reader/utils/pageThumbnails').getCachedPageThumbnail;

beforeEach(async () => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${n++}`);
  URL.revokeObjectURL = vi.fn();
  vi.resetModules();
  ({ loadPageThumbnail, getCachedPageThumbnail } = await import(
    '@/app/reader/utils/pageThumbnails'
  ));
});

describe('page thumbnail cache', () => {
  it('renders a missing thumbnail once and stores it on disk', async () => {
    const appService = makeAppService();
    const bookDoc = makeBookDoc();
    const url = await loadPageThumbnail(appService, 'hash', bookDoc, 4);
    expect(url).toMatch(/^blob:/);
    expect(bookDoc.getPageThumbnail).toHaveBeenCalledWith(4, expect.any(Number));
    expect(appService.writeFile).toHaveBeenCalledWith(
      'page-thumbnails/hash/4.jpg',
      'Cache',
      expect.any(ArrayBuffer),
    );
  });

  it('serves repeat requests from memory without rendering again', async () => {
    const appService = makeAppService();
    const bookDoc = makeBookDoc();
    const [a, b] = await Promise.all([
      loadPageThumbnail(appService, 'hash', bookDoc, 1),
      loadPageThumbnail(appService, 'hash', bookDoc, 1),
    ]);
    const c = await loadPageThumbnail(appService, 'hash', bookDoc, 1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(getCachedPageThumbnail('hash', 1)).toBe(a);
    expect(bookDoc.getPageThumbnail).toHaveBeenCalledTimes(1);
  });

  it('reads a thumbnail cached on disk by an earlier session instead of rendering', async () => {
    const appService = makeAppService({ 'page-thumbnails/hash/2.jpg': new ArrayBuffer(3) });
    const bookDoc = makeBookDoc();
    expect(await loadPageThumbnail(appService, 'hash', bookDoc, 2)).toMatch(/^blob:/);
    expect(bookDoc.getPageThumbnail).not.toHaveBeenCalled();
  });

  it('resolves null when the page cannot be rendered', async () => {
    const bookDoc = makeBookDoc();
    bookDoc.getPageThumbnail.mockRejectedValueOnce(new Error('destroyed'));
    expect(await loadPageThumbnail(makeAppService(), 'hash', bookDoc, 3)).toBeNull();
  });
});
