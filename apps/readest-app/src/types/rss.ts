// src/types/rss.ts
export interface RssFeedItem {
  /** Stable id: the item guid/id, else the article link URL. */
  id: string;
  title: string;
  /** Canonical article URL. */
  link: string;
  author?: string;
  /** ISO-8601 publish date, if the feed provided one. */
  publishedAt?: string;
  /** Short plain-text/HTML summary for the list row. */
  summary?: string;
  /** Full HTML body when the feed ships it (RSS content:encoded / Atom
   *  content / JSON Feed content_html). Undefined for summary-only feeds. */
  contentHtml?: string;
  /** Hero image URL if present (enclosure / media:content / og image). */
  imageUrl?: string;
  read: boolean;
}

export interface RssFeed {
  /** Stable id: the subscribed feed URL. */
  id: string;
  /** The feed document URL (what we re-fetch on refresh). */
  url: string;
  title: string;
  siteUrl?: string;
  description?: string;
  iconUrl?: string;
  addedAt: number;
  lastFetchedAt?: number;
  errorMessage?: string;
  items: RssFeedItem[];
}

/** Result of parsing a raw feed document (metadata + items), before it is
 *  merged into an existing subscription's item list. */
export interface ParsedFeed {
  title: string;
  siteUrl?: string;
  description?: string;
  iconUrl?: string;
  items: RssFeedItem[];
}
