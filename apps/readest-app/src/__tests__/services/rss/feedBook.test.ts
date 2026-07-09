import { describe, expect, it } from 'vitest';
import { createFeedBook, feedBookHash, generateFeedCoverSvg } from '@/services/rss/feedBook';
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
