import { getFeed, isOPDSCatalog } from 'foliate-js/opds.js';
import type { OPDSCatalog, OPDSFeed, OPDSPublication, OPDSLink } from '@/types/opds';
import { REL } from '@/types/opds';
import { isWebAppPlatform } from '@/services/environment';
import { fetchWithAuth } from '@/app/opds/utils/opdsReq';
import { resolveURL } from '@/app/opds/utils/opdsUtils';
import { normalizeOPDSCustomHeaders } from '@/app/opds/utils/customHeaders';
import type { OPDSSubscriptionState, PendingItem } from './types';
import { MAX_CRAWL_DEPTH, MAX_PAGES_PER_FEED } from './types';

const MIME_XML = 'application/xml';

/**
 * Find the first acquisition link on a publication.
 */
export function getAcquisitionLink(pub: OPDSPublication): OPDSLink | undefined {
  return pub.links.find((link) => {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    return rels.some((r) => r.startsWith(REL.ACQ));
  });
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
  const nextLink = feed.links.find((link) => {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    return rels.includes('next');
  });
  return nextLink?.href;
}

/**
 * Collect new PendingItems from a feed, skipping entries already in knownIds.
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
  for (const pub of allPubs) {
    const entryId = getEntryId(pub, baseURL);
    if (!entryId) continue;
    if (knownIds.has(entryId)) continue;

    const acqLink = getAcquisitionLink(pub);
    if (!acqLink) continue;

    items.push({
      entryId,
      title: pub.metadata.title,
      acquisitionHref: acqLink.href,
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

  if (text.startsWith('<')) {
    const doc = new DOMParser().parseFromString(text, MIME_XML as DOMParserSupportedType);
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

/**
 * Recursively crawl OPDS feeds to discover new items.
 * Uses visited-URL set for cycle detection and depth limit for safety.
 * Follows rel=next pagination up to MAX_PAGES_PER_FEED.
 */
async function crawlFeed(
  url: string,
  username: string,
  password: string,
  customHeaders: Record<string, string>,
  knownIds: Set<string>,
  depth: number,
  visited: Set<string>,
): Promise<PendingItem[]> {
  if (depth > MAX_CRAWL_DEPTH) return [];
  if (visited.has(url)) return [];
  visited.add(url);

  const result = await fetchFeed(url, username, password, customHeaders);
  if (!result) return [];

  const { feed, baseURL } = result;
  const items: PendingItem[] = [];

  // Collect publications from this feed (+ paginate)
  items.push(...collectNewEntries(feed, knownIds, baseURL));

  let currentFeed = feed;
  let currentBaseURL = baseURL;
  let pageCount = 1;
  while (pageCount < MAX_PAGES_PER_FEED) {
    const nextHref = getNextPageUrl(currentFeed);
    if (!nextHref) break;

    const nextUrl = resolveURL(nextHref, currentBaseURL);
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);

    const nextResult = await fetchFeed(nextUrl, username, password, customHeaders);
    if (!nextResult) break;

    items.push(...collectNewEntries(nextResult.feed, knownIds, nextResult.baseURL));
    currentFeed = nextResult.feed;
    currentBaseURL = nextResult.baseURL;
    pageCount++;
  }

  // Recurse into navigation feeds
  if (feed.navigation?.length) {
    for (const navItem of feed.navigation) {
      if (navItem.href) {
        const childURL = resolveURL(navItem.href, baseURL);
        const childItems = await crawlFeed(
          childURL,
          username,
          password,
          customHeaders,
          knownIds,
          depth + 1,
          visited,
        );
        items.push(...childItems);
      }
    }
  }

  return items;
}

/**
 * Check a catalog's feeds for new items not in the subscription state.
 * Pure discovery — no downloads, no state mutations.
 */
export async function checkFeedForNewItems(
  catalog: OPDSCatalog,
  state: OPDSSubscriptionState,
): Promise<PendingItem[]> {
  const knownIds = new Set(state.knownEntryIds);
  const customHeaders = normalizeOPDSCustomHeaders(catalog.customHeaders);
  const username = catalog.username ?? '';
  const password = catalog.password ?? '';
  const visited = new Set<string>();

  return crawlFeed(catalog.url, username, password, customHeaders, knownIds, 0, visited);
}
