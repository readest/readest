import { describe, expect, it } from 'vitest';
import { buildFeedBookUrl, parseFeedBookUrl, isFeedBookUrl } from '@/services/rss/feedBookUrl';

describe('feedBookUrl', () => {
  it('round-trips a feed URL through the descriptor', () => {
    const url = buildFeedBookUrl('https://feeds.feedburner.com/ruanyifeng');
    expect(url.startsWith('feed://')).toBe(true);
    expect(isFeedBookUrl(url)).toBe(true);
    expect(parseFeedBookUrl(url)).toEqual({ feedUrl: 'https://feeds.feedburner.com/ruanyifeng' });
  });
  it('rejects non-feed urls', () => {
    expect(isFeedBookUrl('pse://x')).toBe(false);
    expect(isFeedBookUrl('https://x/y')).toBe(false);
  });
});
