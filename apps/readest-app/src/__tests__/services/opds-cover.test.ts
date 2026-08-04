import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { OPDSGenericLink } from '@/types/opds';

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/app/opds/utils/opdsReq', () => ({
  probeAuth: vi.fn().mockResolvedValue(null),
  needsProxy: vi.fn(() => false),
  getProxiedURL: vi.fn((url: string) => url),
}));

import { md5 } from 'js-md5';
import { applyOPDSCover, getOPDSCoverHref, getOPDSImageCacheFilename } from '@/services/opds/cover';
import { downloadFile } from '@/libs/storage';
import { probeAuth, getProxiedURL, needsProxy } from '@/app/opds/utils/opdsReq';

const createMockAppService = (coverBytes = new Uint8Array([1, 2, 3]).buffer) =>
  ({
    resolveFilePath: vi.fn(async (path: string) => `/cache/${path}`),
    readFile: vi.fn(async () => coverBytes),
    writeFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    computeCoverHash: vi.fn(async () => 'opds-cover-hash'),
    generateCoverImageUrl: vi.fn(async () => 'asset://books/h1/cover.png'),
  }) as unknown as AppService;

const createBook = (): Book =>
  ({
    hash: 'h1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    coverHash: 'embedded-cover-hash',
    coverImageUrl: 'asset://books/h1/cover.png?stale',
    createdAt: 0,
    updatedAt: 0,
  }) as Book;

const publicationWith = (images: OPDSGenericLink[] | undefined) => ({ images });

describe('getOPDSCoverHref', () => {
  it('prefers the full cover link over the thumbnail', () => {
    const pub = publicationWith([
      { rel: 'http://opds-spec.org/image/thumbnail', href: '/cwa/opds/cover/572/thumb' },
      { rel: 'http://opds-spec.org/image', href: '/cwa/opds/cover/572' },
    ]);
    expect(getOPDSCoverHref(pub)).toBe('/cwa/opds/cover/572');
  });

  it('accepts a cover rel given as an array', () => {
    const pub = publicationWith([
      { rel: ['alternate', 'x-stanza-cover-image'], href: '/cover.jpg' },
    ]);
    expect(getOPDSCoverHref(pub)).toBe('/cover.jpg');
  });

  it('falls back to the thumbnail when no full cover is advertised', () => {
    const pub = publicationWith([
      { rel: 'http://opds-spec.org/image/thumbnail', href: '/cwa/opds/cover/572/thumb' },
    ]);
    expect(getOPDSCoverHref(pub)).toBe('/cwa/opds/cover/572/thumb');
  });

  it('falls back to the first image when no cover rel matches', () => {
    const pub = publicationWith([{ rel: 'alternate', href: '/some-image.png' }]);
    expect(getOPDSCoverHref(pub)).toBe('/some-image.png');
  });

  it('returns undefined when the publication advertises no image', () => {
    expect(getOPDSCoverHref(publicationWith([]))).toBeUndefined();
    expect(getOPDSCoverHref(publicationWith(undefined))).toBeUndefined();
    expect(
      getOPDSCoverHref(publicationWith([{ rel: 'http://opds-spec.org/image' }])),
    ).toBeUndefined();
  });
});

describe('applyOPDSCover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadFile).mockResolvedValue({});
    vi.mocked(needsProxy).mockReturnValue(false);
    vi.mocked(getProxiedURL).mockImplementation((url: string) => url);
    vi.mocked(probeAuth).mockResolvedValue(null);
  });

  it('overwrites the extracted cover with the one from the OPDS feed', async () => {
    const appService = createMockAppService();
    const book = createBook();

    const applied = await applyOPDSCover({
      appService,
      book,
      coverUrl: 'https://cwa.example.com/cwa/opds/cover/572',
    });

    expect(applied).toBe(true);
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://cwa.example.com/cwa/opds/cover/572' }),
    );
    expect(appService.writeFile).toHaveBeenCalledWith('h1/cover.png', 'Books', expect.anything());
    // Keeps the coverHash === partialMD5(cover.png) invariant (issue #4544).
    expect(book.coverHash).toBe('opds-cover-hash');
    expect(book.coverImageUrl).toBe('asset://books/h1/cover.png');
  });

  it('removes the temporary download once the cover is stored', async () => {
    const appService = createMockAppService();
    await applyOPDSCover({
      appService,
      book: createBook(),
      coverUrl: 'https://cwa.example.com/cover/1',
    });
    expect(appService.deleteFile).toHaveBeenCalled();
  });

  it('sends basic auth and custom headers through the same probe as the book download', async () => {
    vi.mocked(probeAuth).mockResolvedValue('Basic dXNlcjpwYXNz');
    const appService = createMockAppService();

    await applyOPDSCover({
      appService,
      book: createBook(),
      coverUrl: 'https://cwa.example.com/cover/1',
      username: 'user',
      password: 'pass',
      customHeaders: { 'X-Token': 'secret' },
    });

    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Basic dXNlcjpwYXNz',
          'X-Token': 'secret',
        }),
      }),
    );
  });

  it('keeps the extracted cover when the OPDS cover fails to download', async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error('404 Not Found'));
    const appService = createMockAppService();
    const book = createBook();

    const applied = await applyOPDSCover({
      appService,
      book,
      coverUrl: 'https://cwa.example.com/cover/1',
    });

    expect(applied).toBe(false);
    expect(appService.writeFile).not.toHaveBeenCalled();
    expect(book.coverHash).toBe('embedded-cover-hash');
  });

  it('keeps the extracted cover when the server returns an empty body', async () => {
    const appService = createMockAppService(new ArrayBuffer(0));
    const book = createBook();

    const applied = await applyOPDSCover({
      appService,
      book,
      coverUrl: 'https://cwa.example.com/cover/1',
    });

    expect(applied).toBe(false);
    expect(appService.writeFile).not.toHaveBeenCalled();
    expect(book.coverHash).toBe('embedded-cover-hash');
  });
});

describe('getOPDSImageCacheFilename', () => {
  const url = 'https://catalog.example.com/covers/1.jpg';

  it('keeps the historical URL-only key when the entry has no updated value', () => {
    // Existing caches for catalogs without <updated> must stay valid.
    expect(getOPDSImageCacheFilename(url)).toBe(`img_${md5(url)}.png`);
  });

  it('changes the key when the updated value changes (issue #5492)', () => {
    const before = getOPDSImageCacheFilename(url, '2024-01-01T00:00:00Z');
    const after = getOPDSImageCacheFilename(url, '2025-06-01T00:00:00Z');
    expect(before).not.toBe(after);
    expect(before).not.toBe(getOPDSImageCacheFilename(url));
  });

  it('is stable for the same URL and updated value', () => {
    expect(getOPDSImageCacheFilename(url, '2025-06-01T00:00:00Z')).toBe(
      getOPDSImageCacheFilename(url, '2025-06-01T00:00:00Z'),
    );
  });
});
