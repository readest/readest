import { describe, expect, it, vi } from 'vitest';
import {
  createFeedBook,
  ensureFeedBookCover,
  feedBookHash,
  generateFeedCoverSvg,
} from '@/services/rss/feedBook';
import { parseFeedBookUrl } from '@/services/rss/feedBookUrl';

describe('generateFeedCoverSvg', () => {
  it('embeds the RSS icon as the center avatar and shows the site name', () => {
    const cover = generateFeedCoverSvg(
      'https://feeds.feedburner.com/ruanyifeng',
      'Ruan YiFeng Blog',
    );
    expect(cover.mime).toBe('image/svg+xml');
    const svg = new TextDecoder().decode(cover.bytes);
    expect(svg).toContain('data:image/svg+xml;base64,'); // icon embedded as avatar image
    expect(svg).toContain('feeds.feedburner.com'); // hostname as siteName
    expect(svg).toContain('Ruan YiFeng Blog'); // title rendered
  });
});

describe('createFeedBook', () => {
  it('creates a virtual feed book carrying feedUrl in metadata', () => {
    const feedUrl = 'https://feeds.feedburner.com/ruanyifeng';
    const book = createFeedBook(feedUrl, { title: 'Blog', items: [] });
    expect(book.hash).toBe(feedBookHash(feedUrl));
    expect(book.title).toBe('Blog');
    expect(parseFeedBookUrl(book.url!)).toEqual({ feedUrl });
    expect(book.metadata?.feedUrl).toBe(feedUrl);
    expect(book.filePath).toBeUndefined();
  });
});

// Issue #5307 — a feed book has no files in cloud storage, so every device that
// receives the subscription writes the cover itself.
describe('ensureFeedBookCover', () => {
  const book = createFeedBook('https://www.saastr.com/feed/', { title: 'SaaStr', items: [] });

  const makeAppService = (coverExists: boolean) => ({
    exists: vi.fn(async () => coverExists),
    createDir: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    generateCoverImageUrl: vi.fn(async () => 'blob:cover'),
  });

  it('reuses the cover already on disk', async () => {
    const appService = makeAppService(true);
    const url = await ensureFeedBookCover(appService, book);
    expect(url).toBe('blob:cover');
    expect(appService.writeFile).not.toHaveBeenCalled();
  });

  it('falls back to no cover url when the cover cannot be written', async () => {
    const appService = makeAppService(false);
    // Worst case is the shelf's title-only fallback cover, never a rejection
    // that would abort the sync pass this runs inside.
    appService.exists.mockRejectedValue(new Error('fs unavailable'));
    await expect(ensureFeedBookCover(appService, book)).resolves.toBeUndefined();
  });
});
