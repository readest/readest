import { describe, expect, it } from 'vitest';
import { createFeedBook, feedBookHash } from '@/services/rss/feedBook';
import { parseFeedBookUrl } from '@/services/rss/feedBookUrl';

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
