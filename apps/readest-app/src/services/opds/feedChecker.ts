import { getFeed, isOPDSCatalog } from 'foliate-js/opds.js';
import type {
  OPDSAcquisitionLink,
  OPDSBaseLink,
  OPDSCatalog,
  OPDSFeed,
  OPDSGenericLink,
  OPDSNavigationItem,
  OPDSPublication,
  OPDSStreamLink,
} from '@/types/opds';
import { REL } from '@/types/opds';
import { isWebAppPlatform } from '@/services/environment';
import { fetchWithAuth } from '@/app/opds/utils/opdsReq';
import { resolveURL, looksLikeXMLContent, parseOPDSXML } from '@/app/opds/utils/opdsUtils';
import { normalizeCustomHeaders } from '@/utils/customHeaders';
import { getOPDSCoverHref } from './cover';
import { classifyAcquisitionLink, pickPreferredLink } from './formats';
import { getOPDSBookMetadata } from './metadata';
import type { OPDSSubscriptionState, PendingItem } from './types';
import { MAX_CRAWL_DEPTH, MAX_FEEDS_PER_CRAWL, MAX_PAGES_PER_FEED } from './types';

const SORT_NEW_REL = 'http://opds-spec.org/sort/new';

// Title keywords that strongly indicate a "by newest" / "recently added"
// navigation entry.
const NEWNESS_TITLE_RE =
  /\b(newest|new\s+(?:books|titles|releases?|additions?)|recently\s+added|recent|latest|most\s+recent|by\s+date)\b/i;

// Href hints for catalogs that don't expose rel or human-readable titles.
const NEWNESS_HREF_RE =
  /(?:sort_order=release_date|sort=(?:new|date|added|date_added|recent|release_date|release_date_desc)|\b(?:new[-_]?releases?|newest|recently[-_]?added|by[-_]?date)\b|\/new(?:[/?#]|$))/i;

// Acquisition rels safe for unattended download. Excludes buy / borrow /
// subscribe / sample (need user action) and indirect (link points to a
// landing document, not the file).
const SAFE_ACQ_RELS = [REL.ACQ, `${REL.ACQ}/open-access`];

type AnyAcqLink = OPDSAcquisitionLink | OPDSStreamLink | OPDSGenericLink;
type ValidAcqLink = OPDSAcquisitionLink & { href: string };

function isSafeAcquisitionLink(link: AnyAcqLink): link is ValidAcqLink {
  if (!link.href) return false;
  if (link.properties?.indirectAcquisition?.length) return false;
  const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
  return rels.some((r) => SAFE_ACQ_RELS.includes(r));
}

/**
 * Pick the best acquisition link on a publication for unattended download.
 *
 * 1. Filter to safe rels (acquisition / acquisition/open-access), drop
 *    indirect links — leaves entries we can fetch directly.
 * 2. Drop formats Readest cannot import — downloading them only to fail at
 *    import wastes the transfer and leaves a failed entry behind (#5583).
 * 3. Prefer open-access over plain acquisition.
 * 4. Within those, rank by format tier:
 *    Advanced EPUB / EPUB3 > EPUB > MOBI/AZW/AZW3 > PDF/CBZ > other.
 *    Ties resolve by feed order.
 *
 * Returns undefined when no usable link exists — the entry is skipped.
 */
export function getAcquisitionLink(pub: OPDSPublication): ValidAcqLink | undefined {
  const acqLinks = pub.links
    .filter(isSafeAcquisitionLink)
    .filter((link) => classifyAcquisitionLink(link) !== 'unsupported');
  if (acqLinks.length === 0) return undefined;

  const openAccess = acqLinks.filter((link) => {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    return rels.includes(`${REL.ACQ}/open-access`);
  });
  const candidates = openAccess.length > 0 ? openAccess : acqLinks;

  return pickPreferredLink(candidates);
}

/**
 * Derive a stable entry ID from a publication.
 * Primary: Atom <id>. Fallback: resolved acquisition URL.
 */
export function getEntryId(pub: OPDSPublication, baseURL: string): string | undefined {
  if (pub.metadata.id) return pub.metadata.id;
  const acqLink = getAcquisitionLink(pub);
  if (acqLink) return resolveURL(acqLink.href, baseURL);
  return undefined;
}

/**
 * Extract the rel=next pagination URL from a feed.
 */
export function getNextPageUrl(feed: OPDSFeed): string | undefined {
  const nextLink = feed.links?.find((link) => {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    return rels.includes('next');
  });
  return nextLink?.href;
}

/**
 * Collect new PendingItems from a feed, skipping entries already in knownIds
 * and de-duplicating entries that appear multiple times within the same feed
 * (e.g. listed under both feed.publications and a group).
 */
export function collectNewEntries(
  feed: OPDSFeed,
  knownIds: Set<string>,
  baseURL: string,
): PendingItem[] {
  const allPubs: OPDSPublication[] = [
    ...(feed.publications ?? []),
    ...(feed.groups?.flatMap((g) => g.publications ?? []) ?? []),
  ];

  const items: PendingItem[] = [];
  const seenInBatch = new Set<string>();
  for (const pub of allPubs) {
    const entryId = getEntryId(pub, baseURL);
    if (!entryId) continue;
    if (knownIds.has(entryId)) continue;
    if (seenInBatch.has(entryId)) continue;

    const acqLink = getAcquisitionLink(pub);
    if (!acqLink) continue;

    seenInBatch.add(entryId);
    const metadata = getOPDSBookMetadata(pub);
    items.push({
      entryId,
      title: pub.metadata.title || acqLink.title || 'Untitled',
      acquisitionHref: acqLink.href,
      coverHref: getOPDSCoverHref(pub),
      metadata: Object.keys(metadata).length ? metadata : undefined,
      mimeType: acqLink.type ?? 'application/octet-stream',
      updated: pub.metadata.updated,
      baseURL,
    });
  }
  return items;
}

/**
 * Fetch and parse an OPDS feed URL.
 */
async function fetchFeed(
  url: string,
  username: string,
  password: string,
  customHeaders: Record<string, string>,
): Promise<{ feed: OPDSFeed; baseURL: string } | null> {
  const useProxy = isWebAppPlatform();
  const res = await fetchWithAuth(url, username, password, useProxy, {}, customHeaders);
  if (!res.ok) {
    console.error(`OPDS sync: failed to fetch ${url}: ${res.status} ${res.statusText}`);
    return null;
  }

  const responseURL = res.url;
  const text = await res.text();

  if (looksLikeXMLContent(text)) {
    const doc = parseOPDSXML(text);
    const { localName } = doc.documentElement;

    if (localName === 'feed') {
      return { feed: getFeed(doc) as OPDSFeed, baseURL: responseURL };
    }

    // HTML auto-discovery
    const htmlDoc = new DOMParser().parseFromString(text, 'text/html' as DOMParserSupportedType);
    const link = htmlDoc.head
      ? Array.from(htmlDoc.head.querySelectorAll('link')).find((el) =>
          isOPDSCatalog(el.getAttribute('type') ?? ''),
        )
      : null;
    if (link?.getAttribute('href')) {
      const resolvedURL = resolveURL(link.getAttribute('href')!, responseURL);
      return fetchFeed(resolvedURL, username, password, customHeaders);
    }
  } else {
    try {
      const feed = JSON.parse(text) as OPDSFeed;
      return { feed, baseURL: responseURL };
    } catch {
      // not valid JSON
    }
  }

  console.error(`OPDS sync: could not parse feed at ${url}`);
  return null;
}

type LinkLike = Pick<OPDSBaseLink, 'href' | 'rel' | 'title'> | OPDSNavigationItem;

function hasRel(item: LinkLike, target: string): boolean {
  const rels = Array.isArray(item.rel) ? item.rel : [item.rel ?? ''];
  return rels.includes(target);
}

/**
 * Find the catalog's "by newest" feed URL — the one that lists publications
 * in reverse-chronological order. For library catalogs auto-download follows
 * only this feed (plus its rel=next pages); we deliberately don't crawl the
 * rest of the navigation tree because subscribing to a whole library catalog
 * is rarely what the user wants.
 *
 * Detection order:
 *  1. Authoritative: any link or navigation entry with
 *     rel="http://opds-spec.org/sort/new" (Calibre / Calibre-Web emit this).
 *  2. Title heuristics: "Newest", "Recently Added", "Latest", "Recent",
 *     "By date", etc. (Standard Ebooks, ManyBooks, custom catalogs.)
 *  3. Href heuristics: ?sort_order=release_date (Project Gutenberg),
 *     /new-releases, /recently-added, ?sort=new, etc.
 *
 * Returns undefined when no candidate matches — the caller then treats the
 * catalog as a directory-style feed and crawls its subsections instead.
 */
export function findNewestFeedURL(feed: OPDSFeed, baseURL: string): string | undefined {
  const candidates: LinkLike[] = [...(feed.links ?? []), ...(feed.navigation ?? [])];

  // 1. Strong match by rel.
  for (const c of candidates) {
    if (c.href && hasRel(c, SORT_NEW_REL)) return resolveURL(c.href, baseURL);
  }

  // 2. Title keyword.
  for (const c of candidates) {
    if (c.href && c.title && NEWNESS_TITLE_RE.test(c.title)) {
      return resolveURL(c.href, baseURL);
    }
  }

  // 3. Href shape — last resort for catalogs that don't label their links.
  for (const c of candidates) {
    if (c.href && NEWNESS_HREF_RE.test(c.href)) return resolveURL(c.href, baseURL);
  }

  return undefined;
}

function feedHasContent(feed: OPDSFeed): boolean {
  if ((feed.publications?.length ?? 0) > 0) return true;
  if (feed.groups?.some((g) => (g.publications?.length ?? 0) > 0)) return true;
  return false;
}

// Rels that must not be treated as subdirectories when crawling a
// directory-style catalog: facets and structural links (self/up/start/…)
// would re-list the same feed under another sort order or escape the
// subscribed folder into its parent.
const CRAWL_SKIP_RELS = [REL.FACET, 'self', 'start', 'up', 'top', 'search'];

/**
 * Collect sub-catalog URLs from a feed's navigation entries — the
 * subdirectories of a directory-style catalog (copyparty and other file
 * servers expose folders as rel="subsection" entries). Entries with a
 * non-catalog media type or a facet/structural rel are skipped; a missing
 * type is accepted since many servers omit it on navigation entries.
 */
export function getSubsectionURLs(feed: OPDSFeed, baseURL: string): string[] {
  const urls: string[] = [];
  for (const item of feed.navigation ?? []) {
    if (!item.href) continue;
    const rels = Array.isArray(item.rel) ? item.rel : [item.rel ?? ''];
    if (rels.some((rel) => CRAWL_SKIP_RELS.includes(rel))) continue;
    if (item.type && !isOPDSCatalog(item.type)) continue;
    urls.push(resolveURL(item.href, baseURL));
  }
  return urls;
}

interface CrawlContext {
  catalog: OPDSCatalog;
  knownIds: Set<string>;
  username: string;
  password: string;
  customHeaders: Record<string, string>;
  visited: Set<string>;
  /** Follow subsection navigation entries (directory-style catalogs). */
  crawlNav: boolean;
}

/**
 * Walk feeds breadth-first from an already-fetched start feed, collecting
 * new PendingItems. Every feed's rel=next chain is followed up to
 * MAX_PAGES_PER_FEED pages. When ctx.crawlNav is set, subsection navigation
 * entries are followed too, at most MAX_CRAWL_DEPTH levels below the start
 * feed and MAX_FEEDS_PER_CRAWL fetches in total.
 */
async function crawlFeeds(
  start: { feed: OPDSFeed; baseURL: string },
  ctx: CrawlContext,
): Promise<PendingItem[]> {
  const items: PendingItem[] = [];
  const queue: Array<{ url: string; depth: number; page: number }> = [];

  const processFeed = (feed: OPDSFeed, baseURL: string, depth: number, page: number) => {
    const newItems = collectNewEntries(feed, ctx.knownIds, baseURL);
    // Mark as known so a book listed by several crawled feeds is only
    // collected once.
    for (const item of newItems) ctx.knownIds.add(item.entryId);
    items.push(...newItems);

    const nextHref = getNextPageUrl(feed);
    if (nextHref && page < MAX_PAGES_PER_FEED) {
      const nextURL = resolveURL(nextHref, baseURL);
      if (!ctx.visited.has(nextURL)) {
        ctx.visited.add(nextURL);
        queue.push({ url: nextURL, depth, page: page + 1 });
      }
    }

    if (ctx.crawlNav && depth < MAX_CRAWL_DEPTH) {
      for (const subURL of getSubsectionURLs(feed, baseURL)) {
        if (ctx.visited.has(subURL)) continue;
        ctx.visited.add(subURL);
        queue.push({ url: subURL, depth: depth + 1, page: 1 });
      }
    }
  };

  processFeed(start.feed, start.baseURL, 0, 1);

  let fetches = 1; // the start feed was already fetched by the caller
  while (queue.length > 0 && fetches < MAX_FEEDS_PER_CRAWL) {
    const node = queue.shift()!;
    const next = await fetchFeed(node.url, ctx.username, ctx.password, ctx.customHeaders);
    fetches++;
    if (!next) continue;
    processFeed(next.feed, next.baseURL, node.depth, node.page);
  }
  if (queue.length > 0) {
    console.warn(
      `OPDS sync: catalog "${ctx.catalog.name}" crawl budget exhausted; ${queue.length} sub-feed(s) skipped`,
    );
  }

  return items;
}

/**
 * Check a catalog for new items. Pure discovery — no downloads, no state
 * mutations.
 *
 * Library catalogs (those exposing a "by newest" feed, see
 * findNewestFeedURL) are checked through that feed and its rel=next pages
 * only. Catalogs without one are directory-style listings (e.g. copyparty):
 * the subscribed URL itself is the acquisition feed and its subsection
 * navigation entries are subdirectories, which are crawled breadth-first so
 * books in subfolders are downloaded too (#4272).
 */
export async function checkFeedForNewItems(
  catalog: OPDSCatalog,
  state: OPDSSubscriptionState,
): Promise<PendingItem[]> {
  const knownIds = new Set(state.knownEntryIds);
  const customHeaders = normalizeCustomHeaders(catalog.customHeaders);
  const username = catalog.username ?? '';
  const password = catalog.password ?? '';
  const visited = new Set<string>([catalog.url]);

  const root = await fetchFeed(catalog.url, username, password, customHeaders);
  if (!root) return [];

  const ctx: CrawlContext = {
    catalog,
    knownIds,
    username,
    password,
    customHeaders,
    visited,
    crawlNav: false,
  };

  const newestURL = findNewestFeedURL(root.feed, root.baseURL);
  if (newestURL) {
    if (!visited.has(newestURL)) {
      visited.add(newestURL);
      const newest = await fetchFeed(newestURL, username, password, customHeaders);
      if (newest && feedHasContent(newest.feed)) return crawlFeeds(newest, ctx);
    }
    // Broken or empty "by newest" feed: fall back to the root feed's own
    // publications, still without crawling navigation.
    return crawlFeeds(root, ctx);
  }

  if (!feedHasContent(root.feed) && getSubsectionURLs(root.feed, root.baseURL).length === 0) {
    console.warn(
      `OPDS sync: catalog "${catalog.name}" has no publications or subdirectories; skipping`,
    );
    return [];
  }
  return crawlFeeds(root, { ...ctx, crawlNav: true });
}
