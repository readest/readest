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
import { MIMETYPES } from '@/libs/document';
import { isWebAppPlatform } from '@/services/environment';
import { fetchWithAuth } from '@/app/opds/utils/opdsReq';
import { resolveURL, parseMediaType } from '@/app/opds/utils/opdsUtils';
import { normalizeOPDSCustomHeaders } from '@/app/opds/utils/customHeaders';
import type { OPDSSubscriptionState, PendingItem } from './types';
import { MAX_PAGES_PER_FEED } from './types';

const SORT_NEW_REL = 'http://opds-spec.org/sort/new';

// Title keywords that strongly indicate a "by newest" / "recently added"
// navigation entry.
const NEWNESS_TITLE_RE =
  /\b(newest|new\s+(?:books|titles|releases?|additions?)|recently\s+added|recent|latest|most\s+recent|by\s+date)\b/i;

// Href hints for catalogs that don't expose rel or human-readable titles.
const NEWNESS_HREF_RE =
  /(?:sort_order=release_date|sort=(?:new|date|added|date_added|recent|release_date|release_date_desc)|\b(?:new[-_]?releases?|newest|recently[-_]?added|by[-_]?date)\b|\/new(?:[/?#]|$))/i;

const MIME_XML = 'application/xml';

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

// Tier 0 (best) → 4 (worst). See getAcquisitionLink for the policy.
type FormatTier = 0 | 1 | 2 | 3 | 4;

// When a feed omits the link `type` (or returns the uninformative
// application/octet-stream), fall back to inferring the format from the
// href extension and the human-readable link title. Order matters here:
// AZW3 must match before AZW, EPUB 3 before plain EPUB.
const INFERENCE_RULES: ReadonlyArray<{ mime: string; href: RegExp; title: RegExp }> = [
  { mime: 'application/epub+zip', href: /\.epub3(?:[?#]|$)/i, title: /\bepub\s*3\b|\bepub3\b/i },
  { mime: 'application/epub+zip', href: /\.epub(?:[?#]|$)/i, title: /\bepub\b/i },
  { mime: 'application/x-mobi8-ebook', href: /\.azw3(?:[?#]|$)/i, title: /\bazw\s*3\b|\bazw3\b/i },
  { mime: 'application/vnd.amazon.ebook', href: /\.azw(?:[?#]|$)/i, title: /\bazw\b/i },
  { mime: 'application/x-mobipocket-ebook', href: /\.mobi(?:[?#]|$)/i, title: /\bmobi\b/i },
  { mime: 'application/pdf', href: /\.pdf(?:[?#]|$)/i, title: /\bpdf\b/i },
  { mime: 'application/vnd.comicbook+zip', href: /\.cbz(?:[?#]|$)/i, title: /\bcbz\b/i },
  { mime: 'application/x-fictionbook+xml', href: /\.fb2(?:[?#]|$)/i, title: /\bfb2\b/i },
];

function inferMediaType(link: ValidAcqLink): string {
  const title = link.title ?? '';
  for (const rule of INFERENCE_RULES) {
    if (rule.href.test(link.href) || rule.title.test(title)) return rule.mime;
  }
  return '';
}

function getEffectiveMediaType(link: ValidAcqLink): string {
  const declared = parseMediaType(link.type)?.mediaType ?? '';
  // Treat octet-stream as "the server didn't actually tell us" — most
  // OPDS feeds emit a real media type for known formats, and falling back
  // to href/title inference recovers from servers that don't.
  if (declared && declared !== 'application/octet-stream') return declared;
  return inferMediaType(link);
}

function isAdvancedEpub(link: ValidAcqLink, mediaType: string): boolean {
  if (mediaType !== 'application/epub+zip') return false;
  const version = parseMediaType(link.type)?.parameters?.['version'];
  if (version && /^3(\.|$)/.test(version)) return true;
  const title = link.title?.toLowerCase() ?? '';
  if (title.includes('advanced')) return true;
  if (title.includes('epub3') || title.includes('epub 3')) return true;
  if (/\.epub3(?:[?#.]|$)/i.test(link.href)) return true;
  return false;
}

function getFormatTier(link: ValidAcqLink): FormatTier {
  const mediaType = getEffectiveMediaType(link);
  if (MIMETYPES.EPUB.includes(mediaType)) {
    return isAdvancedEpub(link, mediaType) ? 0 : 1;
  }
  if (
    MIMETYPES.MOBI.includes(mediaType) ||
    MIMETYPES.AZW.includes(mediaType) ||
    MIMETYPES.AZW3.includes(mediaType)
  ) {
    return 2;
  }
  if (MIMETYPES.PDF.includes(mediaType) || MIMETYPES.CBZ.includes(mediaType)) {
    return 3;
  }
  return 4;
}

/**
 * Pick the best acquisition link on a publication for unattended download.
 *
 * 1. Filter to safe rels (acquisition / acquisition/open-access), drop
 *    indirect links — leaves entries we can fetch directly.
 * 2. Prefer open-access over plain acquisition.
 * 3. Within those, rank by format tier:
 *    Advanced EPUB / EPUB3 > EPUB > MOBI/AZW/AZW3 > PDF/CBZ > other.
 *    Ties resolve by feed order.
 *
 * Returns undefined when no safe link exists — the entry is skipped.
 */
export function getAcquisitionLink(pub: OPDSPublication): ValidAcqLink | undefined {
  const acqLinks = pub.links.filter(isSafeAcquisitionLink);
  if (acqLinks.length === 0) return undefined;

  const openAccess = acqLinks.filter((link) => {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    return rels.includes(`${REL.ACQ}/open-access`);
  });
  const candidates = openAccess.length > 0 ? openAccess : acqLinks;

  let best = candidates[0]!;
  let bestTier = getFormatTier(best);
  for (let i = 1; i < candidates.length && bestTier > 0; i++) {
    const tier = getFormatTier(candidates[i]!);
    if (tier < bestTier) {
      best = candidates[i]!;
      bestTier = tier;
    }
  }
  return best;
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
    items.push({
      entryId,
      title: pub.metadata.title || acqLink.title || 'Untitled',
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

type LinkLike = Pick<OPDSBaseLink, 'href' | 'rel' | 'title'> | OPDSNavigationItem;

function hasRel(item: LinkLike, target: string): boolean {
  const rels = Array.isArray(item.rel) ? item.rel : [item.rel ?? ''];
  return rels.includes(target);
}

/**
 * Find the catalog's "by newest" feed URL — the one that lists publications
 * in reverse-chronological order. Auto-download follows only this feed (plus
 * its rel=next pages); we deliberately don't crawl the rest of the navigation
 * tree because subscribing to a whole catalog is rarely what the user wants.
 *
 * Detection order:
 *  1. Authoritative: any link or navigation entry with
 *     rel="http://opds-spec.org/sort/new" (Calibre / Calibre-Web emit this).
 *  2. Title heuristics: "Newest", "Recently Added", "Latest", "Recent",
 *     "By date", etc. (Standard Ebooks, ManyBooks, custom catalogs.)
 *  3. Href heuristics: ?sort_order=release_date (Project Gutenberg),
 *     /new-releases, /recently-added, ?sort=new, etc.
 *
 * Returns undefined when no candidate matches — the caller should treat the
 * catalog as not auto-download-capable rather than fall back to a deep crawl.
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

/**
 * Resolve a catalog URL down to its acquisition feed:
 * - If the root already contains publications, use it as-is.
 * - Otherwise look for a "by newest" link and follow it.
 *
 * Returns null when no acquisition feed can be found — auto-download will
 * skip the catalog rather than crawl through every navigation branch.
 */
async function resolveAcquisitionFeed(
  url: string,
  username: string,
  password: string,
  customHeaders: Record<string, string>,
  visited: Set<string>,
): Promise<{ feed: OPDSFeed; baseURL: string } | null> {
  visited.add(url);
  const root = await fetchFeed(url, username, password, customHeaders);
  if (!root) return null;

  const newestURL = findNewestFeedURL(root.feed, root.baseURL);
  if (newestURL && !visited.has(newestURL)) {
    visited.add(newestURL);
    const newest = await fetchFeed(newestURL, username, password, customHeaders);
    if (newest && feedHasContent(newest.feed)) return newest;
  }

  if (feedHasContent(root.feed)) return root;
  return null;
}

/**
 * Check a catalog's "by newest" feed for new items.
 *
 * Pure discovery — no downloads, no state mutations. Resolves the catalog
 * URL to its newest-acquisition feed (see resolveAcquisitionFeed) and walks
 * up to MAX_PAGES_PER_FEED of rel=next pagination, collecting entries that
 * aren't already in knownEntryIds.
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

  const acquisition = await resolveAcquisitionFeed(
    catalog.url,
    username,
    password,
    customHeaders,
    visited,
  );
  if (!acquisition) {
    console.warn(
      `OPDS sync: catalog "${catalog.name}" has no recognizable "by newest" feed; skipping`,
    );
    return [];
  }

  const items: PendingItem[] = [];
  let { feed, baseURL } = acquisition;
  items.push(...collectNewEntries(feed, knownIds, baseURL));

  let pageCount = 1;
  while (pageCount < MAX_PAGES_PER_FEED) {
    const nextHref = getNextPageUrl(feed);
    if (!nextHref) break;
    const nextUrl = resolveURL(nextHref, baseURL);
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);

    const next = await fetchFeed(nextUrl, username, password, customHeaders);
    if (!next) break;

    items.push(...collectNewEntries(next.feed, knownIds, next.baseURL));
    feed = next.feed;
    baseURL = next.baseURL;
    pageCount++;
  }

  return items;
}
