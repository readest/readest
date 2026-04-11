import { getFeed, isOPDSCatalog } from 'foliate-js/opds.js';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { OPDSCatalog, OPDSFeed, OPDSPublication, OPDSLink } from '@/types/opds';
import { REL } from '@/types/opds';
import { downloadFile } from '@/libs/storage';
import { getFileExtFromMimeType } from '@/libs/document';
import { isWebAppPlatform } from '@/services/environment';
import {
  fetchWithAuth,
  probeAuth,
  needsProxy,
  getProxiedURL,
  probeFilename,
} from '@/app/opds/utils/opdsReq';
import { resolveURL, parseMediaType, getFileExtFromPath } from '@/app/opds/utils/opdsUtils';
import { normalizeOPDSCustomHeaders } from '@/app/opds/utils/customHeaders';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';

const MAX_CRAWL_DEPTH = 3;

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
 * Collect publications from a feed that haven't been downloaded yet.
 */
export function collectNewEntries(feed: OPDSFeed, downloadedIds: Set<string>): OPDSPublication[] {
  const allPubs: OPDSPublication[] = [
    ...(feed.publications ?? []),
    ...(feed.groups?.flatMap((g) => g.publications ?? []) ?? []),
  ];
  return allPubs.filter((pub) => {
    const entryId = pub.metadata.id;
    if (!entryId) return false;
    if (!getAcquisitionLink(pub)) return false;
    return !downloadedIds.has(entryId);
  });
}

/**
 * Fetch and parse an OPDS feed URL, returning the parsed feed and its base URL.
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
    // HTML auto-discovery: try to find an OPDS link in the head
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
    // OPDS 2.0 JSON
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
 * Recursively crawl navigation feeds to find all acquisition feeds.
 * Returns all publications found across all acquisition feeds.
 */
async function crawlFeed(
  url: string,
  username: string,
  password: string,
  customHeaders: Record<string, string>,
  downloadedIds: Set<string>,
  depth: number,
): Promise<{ publications: OPDSPublication[]; baseURL: string }[]> {
  if (depth > MAX_CRAWL_DEPTH) return [];

  const result = await fetchFeed(url, username, password, customHeaders);
  if (!result) return [];

  const { feed, baseURL } = result;
  const results: { publications: OPDSPublication[]; baseURL: string }[] = [];

  // Collect publications from this feed
  const newPubs = collectNewEntries(feed, downloadedIds);
  if (newPubs.length > 0) {
    results.push({ publications: newPubs, baseURL });
  }

  // If this is a navigation feed, crawl child links
  if (feed.navigation?.length) {
    for (const navItem of feed.navigation) {
      if (navItem.href) {
        const childURL = resolveURL(navItem.href, baseURL);
        const childResults = await crawlFeed(
          childURL,
          username,
          password,
          customHeaders,
          downloadedIds,
          depth + 1,
        );
        results.push(...childResults);
      }
    }
  }

  return results;
}

/**
 * Download a single publication and import it into the library.
 */
async function downloadAndImport(
  pub: OPDSPublication,
  baseURL: string,
  catalog: OPDSCatalog,
  appService: AppService,
  books: Book[],
): Promise<Book | null> {
  const acqLink = getAcquisitionLink(pub);
  if (!acqLink) return null;

  const url = resolveURL(acqLink.href, baseURL);
  const username = catalog.username ?? '';
  const password = catalog.password ?? '';
  const customHeaders = normalizeOPDSCustomHeaders(catalog.customHeaders);
  const useProxy = needsProxy(url);

  let downloadUrl = useProxy ? getProxiedURL(url, '', true, customHeaders) : url;
  const headers: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: '*/*',
    ...(!useProxy ? customHeaders : {}),
  };

  if (username || password) {
    const authHeader = await probeAuth(url, username, password, useProxy, customHeaders);
    if (authHeader) {
      if (!useProxy) {
        headers['Authorization'] = authHeader;
      }
      downloadUrl = useProxy ? getProxiedURL(url, authHeader, true, customHeaders) : url;
    }
  }

  const parsed = parseMediaType(acqLink.type);
  const pathname = decodeURIComponent(new URL(url).pathname);
  const ext = getFileExtFromMimeType(parsed?.mediaType) || getFileExtFromPath(pathname);
  const basename = pathname.replaceAll('/', '_');
  const filename = ext ? `${basename}.${ext}` : basename;
  let dstFilePath = await appService.resolveFilePath(filename, 'Cache');

  const responseHeaders = await downloadFile({
    appService,
    dst: dstFilePath,
    cfp: '',
    url: downloadUrl,
    headers,
    singleThreaded: true,
    skipSslVerification: true,
  });

  const probedFilename = await probeFilename(responseHeaders);
  if (probedFilename) {
    const newFilePath = await appService.resolveFilePath(probedFilename, 'Cache');
    await appService.copyFile(dstFilePath, newFilePath, 'None');
    await appService.deleteFile(dstFilePath, 'None');
    dstFilePath = newFilePath;
  }

  try {
    const book = await appService.importBook(dstFilePath, books);
    return book;
  } catch (importError) {
    console.error(`OPDS sync: failed to import ${pub.metadata.title}:`, importError);
    return null;
  }
}

/**
 * Sync a single OPDS catalog: crawl its feeds, find new entries, download and import them.
 * Returns the list of newly imported books and the updated catalog with new downloadedEntryIds.
 */
export async function syncOPDSCatalog(
  catalog: OPDSCatalog,
  appService: AppService,
  books: Book[],
): Promise<{ newBooks: Book[]; updatedCatalog: OPDSCatalog }> {
  const downloadedIds = new Set(catalog.downloadedEntryIds ?? []);
  const customHeaders = normalizeOPDSCustomHeaders(catalog.customHeaders);
  const username = catalog.username ?? '';
  const password = catalog.password ?? '';

  const feedResults = await crawlFeed(
    catalog.url,
    username,
    password,
    customHeaders,
    downloadedIds,
    0,
  );

  const newBooks: Book[] = [];
  const newIds: string[] = [];

  for (const { publications, baseURL } of feedResults) {
    for (const pub of publications) {
      const book = await downloadAndImport(pub, baseURL, catalog, appService, books);
      if (book) {
        newBooks.push(book);
      }
      // Mark as downloaded even if import failed, to avoid retrying bad entries
      if (pub.metadata.id) {
        newIds.push(pub.metadata.id);
      }
    }
  }

  const updatedCatalog: OPDSCatalog = {
    ...catalog,
    lastCheckedAt: Date.now(),
    downloadedEntryIds: [...(catalog.downloadedEntryIds ?? []), ...newIds],
  };

  return { newBooks, updatedCatalog };
}

/**
 * Sync all OPDS catalogs that have autoDownload enabled.
 * Returns the total number of new books imported.
 */
export async function syncAllOPDSCatalogs(
  catalogs: OPDSCatalog[],
  appService: AppService,
  books: Book[],
): Promise<{ newBooks: Book[]; totalNewBooks: number; updatedCatalogs: OPDSCatalog[] }> {
  const updatedCatalogs = [...catalogs];
  let totalNewBooks = 0;
  const allNewBooks: Book[] = [];

  for (let i = 0; i < updatedCatalogs.length; i++) {
    const catalog = updatedCatalogs[i]!;
    if (!catalog.autoDownload || catalog.disabled) continue;

    try {
      const { newBooks, updatedCatalog } = await syncOPDSCatalog(catalog, appService, books);
      updatedCatalogs[i] = updatedCatalog;
      totalNewBooks += newBooks.length;
      allNewBooks.push(...newBooks);
    } catch (error) {
      console.error(`OPDS sync: error syncing catalog "${catalog.name}":`, error);
      // Update lastCheckedAt even on failure so we don't hammer a broken feed
      updatedCatalogs[i] = { ...catalog, lastCheckedAt: Date.now() };
    }
  }

  return { newBooks: allNewBooks, totalNewBooks, updatedCatalogs };
}
