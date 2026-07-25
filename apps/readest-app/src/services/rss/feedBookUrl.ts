export const FEED_SCHEME = 'feed://';

export const isFeedBookUrl = (url: string): boolean => url.startsWith(FEED_SCHEME);

export const buildFeedBookUrl = (feedUrl: string): string =>
  FEED_SCHEME + encodeURIComponent(JSON.stringify({ feedUrl }));

export const parseFeedBookUrl = (url: string): { feedUrl: string } =>
  JSON.parse(decodeURIComponent(url.replace(FEED_SCHEME, '')));

/**
 * A feed subscription is a fileless book: there is no blob on disk or in cloud
 * storage, only a `feed://` descriptor whose content every device rebuilds from
 * `metadata.feedUrl`. Everything that reasons about a book's FILE — upload,
 * download, share, and the peer-side "is this row fetchable?" sync guard — has
 * to special-case it, or it offers transfers that can only fail and drops the
 * subscription on every device but the one that added it (issue #5307).
 */
export const isFeedBook = (book: { url?: string }): boolean =>
  !!book.url && isFeedBookUrl(book.url);
