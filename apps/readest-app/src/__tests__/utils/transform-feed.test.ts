import { describe, expect, it } from 'vitest';
import { createFeedBook } from '@/services/rss/feedBook';
import { transformBookToDB, transformBookFromDB } from '@/utils/transform';
import { parseFeedBookUrl } from '@/services/rss/feedBookUrl';

describe('feed book sync round-trip', () => {
  it('rehydrates the feed:// url from metadata even though DBBook drops url', () => {
    const feedUrl = 'https://feeds.feedburner.com/ruanyifeng';
    const book = createFeedBook(feedUrl, { title: 'Blog', items: [] });
    const db = transformBookToDB(book, 'user-1');
    // DBBook carries no url column:
    expect('url' in db).toBe(false);
    const restored = transformBookFromDB(db);
    expect(restored.hash).toBe(book.hash);
    expect(restored.url).toBeTruthy();
    expect(parseFeedBookUrl(restored.url!)).toEqual({ feedUrl });
  });
});
