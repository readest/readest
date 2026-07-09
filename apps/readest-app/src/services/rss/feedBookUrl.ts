export const FEED_SCHEME = 'feed://';

export const isFeedBookUrl = (url: string): boolean => url.startsWith(FEED_SCHEME);

export const buildFeedBookUrl = (feedUrl: string): string =>
  FEED_SCHEME + encodeURIComponent(JSON.stringify({ feedUrl }));

export const parseFeedBookUrl = (url: string): { feedUrl: string } =>
  JSON.parse(decodeURIComponent(url.replace(FEED_SCHEME, '')));
