import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { getPublicCoverUrl, isPublicImageUrl } from '@/utils/cover';

// Issue #5424: annotations exported to markdown / pushed to Readwise reference
// the book cover by a publicly fetchable URL. A cover already backed by a
// public URL is reused as-is; otherwise the local cover.png is published to
// media/book_covers/<user-seg>/<coverHash>.png and that URL is cached.

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash,
    coverHash: `md5of${hash}`,
    title: 'T',
    author: 'A',
    ...overrides,
  }) as Book;

const makeAppService = (uploadResult: string | undefined | Error) => {
  const uploadFileToCloud = vi.fn(() =>
    uploadResult instanceof Error ? Promise.reject(uploadResult) : Promise.resolve(uploadResult),
  );
  const exists = vi.fn().mockResolvedValue(true);
  return {
    service: { exists, uploadFileToCloud } as unknown as AppService,
    exists,
    uploadFileToCloud,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isPublicImageUrl', () => {
  it('accepts http(s) URLs and rejects local ones', () => {
    expect(isPublicImageUrl('https://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://localhost:3000/c.png')).toBe(false);
    expect(isPublicImageUrl('http://127.0.0.1/c.png')).toBe(false);
    expect(isPublicImageUrl('https://asset.localhost/c.png')).toBe(false);
    expect(isPublicImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isPublicImageUrl(undefined)).toBe(false);
    expect(isPublicImageUrl(null)).toBe(false);
  });
});

describe('getPublicCoverUrl', () => {
  it('reuses an already-public coverImageUrl without uploading', async () => {
    const { service, uploadFileToCloud } = makeAppService('https://assets.readest.com/x.png');
    const book = makeBook('aaa1', { coverImageUrl: 'https://example.com/cover.jpg' });

    await expect(getPublicCoverUrl(book, service)).resolves.toBe('https://example.com/cover.jpg');
    expect(uploadFileToCloud).not.toHaveBeenCalled();
  });

  it('publishes the local cover named by its content hash', async () => {
    const url = 'https://assets.readest.com/media/book_covers/abcdef12/md5ofbbb2.png';
    const { service, uploadFileToCloud } = makeAppService(url);
    const book = makeBook('bbb2', { coverImageUrl: 'https://asset.localhost/cover.png' });

    await expect(getPublicCoverUrl(book, service)).resolves.toBe(url);
    expect(uploadFileToCloud).toHaveBeenCalledWith(
      'bbb2/cover.png',
      'md5ofbbb2.png',
      'Books',
      expect.any(Function),
      'bbb2',
      false,
      'book_covers',
    );
  });

  it('caches a published URL for the session', async () => {
    const url = 'https://assets.readest.com/media/book_covers/abcdef12/md5ofccc3.png';
    const { service, uploadFileToCloud } = makeAppService(url);
    const book = makeBook('ccc3');

    await getPublicCoverUrl(book, service);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await expect(getPublicCoverUrl(book, service)).resolves.toBe(url);
    expect(uploadFileToCloud).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when there is no local cover file', async () => {
    const { service, exists, uploadFileToCloud } = makeAppService('unused');
    exists.mockResolvedValue(false);

    await expect(getPublicCoverUrl(makeBook('ddd4'), service)).resolves.toBeUndefined();
    expect(uploadFileToCloud).not.toHaveBeenCalled();
  });

  it('backs off after a failed upload, then retries', async () => {
    const { service, uploadFileToCloud } = makeAppService(new Error('offline'));
    const book = makeBook('eee5');

    await expect(getPublicCoverUrl(book, service)).resolves.toBeUndefined();
    await expect(getPublicCoverUrl(book, service)).resolves.toBeUndefined();
    expect(uploadFileToCloud).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61 * 1000);
    await getPublicCoverUrl(book, service);
    expect(uploadFileToCloud).toHaveBeenCalledTimes(2);
  });
});
