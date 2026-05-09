import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { OPDSCatalog } from '@/types/opds';
import { downloadFile } from '@/libs/storage';
import { getFileExtFromMimeType } from '@/libs/document';
import { needsProxy, getProxiedURL, probeAuth, probeFilename } from '@/app/opds/utils/opdsReq';
import { resolveURL, parseMediaType, getFileExtFromPath } from '@/app/opds/utils/opdsUtils';
import { normalizeOPDSCustomHeaders } from '@/app/opds/utils/customHeaders';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { checkFeedForNewItems } from './feedChecker';
import {
  loadSubscriptionState,
  saveSubscriptionState,
  pruneKnownEntryIds,
} from './subscriptionState';
import { isRetryEligible, DOWNLOAD_CONCURRENCY, MAX_RETRY_ATTEMPTS } from './types';
import type { PendingItem, SyncResult, OPDSSubscriptionState, FailedEntry } from './types';

/**
 * Download a single item and import it into the library.
 */
async function downloadAndImport(
  item: PendingItem,
  catalog: OPDSCatalog,
  appService: AppService,
  books: Book[],
): Promise<Book> {
  const url = resolveURL(item.acquisitionHref, item.baseURL);
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

  const parsed = parseMediaType(item.mimeType);
  const rawPathname = new URL(url).pathname;
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    pathname = rawPathname;
  }
  const ext = getFileExtFromMimeType(parsed?.mediaType) || getFileExtFromPath(pathname);
  // Use the last non-empty path segment as the base; falling back to the
  // entry id avoids producing 200+ char filenames from deep URLs and keeps
  // us comfortably under the ~255-byte filesystem limit.
  const lastSegment = pathname.split('/').filter(Boolean).pop() ?? '';
  const sanitized = (lastSegment || item.entryId).replaceAll(/[/\\:*?"<>|]/g, '_').slice(0, 200);
  const basename = sanitized || 'opds-download';
  const filename = ext ? `${basename}.${ext}` : basename;
  let dstFilePath = await appService.resolveFilePath(filename, 'Cache');

  console.log(`[OPDS] downloading "${item.title}" from ${url}`);
  const responseHeaders = await downloadFile({
    appService,
    dst: dstFilePath,
    cfp: '',
    url: downloadUrl,
    headers,
    singleThreaded: true,
  });

  const probedFilename = await probeFilename(responseHeaders);
  if (probedFilename) {
    const newFilePath = await appService.resolveFilePath(probedFilename, 'Cache');
    await appService.copyFile(dstFilePath, 'None', newFilePath, 'None');
    await appService.deleteFile(dstFilePath, 'None');
    dstFilePath = newFilePath;
  }

  const book = await appService.importBook(dstFilePath, books);
  if (!book) throw new Error(`importBook returned null for ${item.title}`);
  console.log(`[OPDS] imported "${item.title}"`);
  return book;
}

/**
 * Run a batch of async tasks with bounded concurrency.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ item: T; result: R } | { item: T; error: unknown }>> {
  const results: Array<{ item: T; result: R } | { item: T; error: unknown }> = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex]!;
      try {
        const result = await fn(item);
        results[currentIndex] = { item, result };
      } catch (error) {
        results[currentIndex] = { item, error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Sync a single catalog: discover new items, retry failed, download, update state.
 */
async function syncCatalog(
  catalog: OPDSCatalog,
  appService: AppService,
  books: Book[],
): Promise<{ newBooks: Book[]; state: OPDSSubscriptionState }> {
  const state = await loadSubscriptionState(appService, catalog.id);

  // Discovery: find new items from feeds
  const pendingItems = await checkFeedForNewItems(catalog, state);

  // Failed entries still in their backoff window must not be re-attempted
  // until they become retry-eligible. They naturally reappear in
  // pendingItems (still in feed, not yet in knownEntryIds), so we have to
  // filter them out here. Without this, every sync would re-download the
  // same in-backoff entry and append a second copy to failedEntries —
  // surfacing as duplicate-key warnings in the failed-downloads dialog.
  const inBackoffIds = new Set(
    state.failedEntries.filter((fe) => !isRetryEligible(fe)).map((fe) => fe.entryId),
  );
  const eligiblePendingItems = pendingItems.filter((p) => !inBackoffIds.has(p.entryId));

  // Collect retry-eligible failed entries as PendingItems
  const retryItems: PendingItem[] = state.failedEntries.filter(isRetryEligible).map((fe) => ({
    entryId: fe.entryId,
    title: fe.title,
    acquisitionHref: fe.href,
    mimeType: 'application/octet-stream',
    baseURL: catalog.url,
  }));

  // Dedupe: a retry-eligible failed entry can also reappear in pendingItems
  // (because the entry isn't in knownEntryIds yet). Prefer the pending copy
  // since it carries the freshly-discovered MIME type from the feed.
  const seenIds = new Set<string>();
  const allItems: PendingItem[] = [];
  for (const item of [...eligiblePendingItems, ...retryItems]) {
    if (seenIds.has(item.entryId)) continue;
    seenIds.add(item.entryId);
    allItems.push(item);
  }
  if (allItems.length === 0) {
    state.lastCheckedAt = Date.now();
    await saveSubscriptionState(appService, state);
    return { newBooks: [], state };
  }

  // Acquisition: download with bounded concurrency
  const downloadResults = await runWithConcurrency(allItems, DOWNLOAD_CONCURRENCY, (item) =>
    downloadAndImport(item, catalog, appService, books),
  );

  // Process results and update state
  const newBooks: Book[] = [];
  const newKnownIds: string[] = [];
  const updatedFailedEntries: FailedEntry[] = [
    // Keep non-retry-eligible failures as-is
    ...state.failedEntries.filter((fe) => !isRetryEligible(fe)),
  ];

  for (const outcome of downloadResults) {
    const item = outcome.item;
    if ('result' in outcome) {
      newBooks.push(outcome.result);
      newKnownIds.push(item.entryId);
    } else {
      const existingFailed = state.failedEntries.find((fe) => fe.entryId === item.entryId);
      const attempts = (existingFailed?.attempts ?? 0) + 1;

      if (attempts >= MAX_RETRY_ATTEMPTS) {
        newKnownIds.push(item.entryId);
        console.error(
          `OPDS sync: permanently skipping "${item.title}" after ${attempts} failed attempts`,
        );
      } else {
        updatedFailedEntries.push({
          entryId: item.entryId,
          href: item.acquisitionHref,
          title: item.title,
          attempts,
          lastAttemptAt: Date.now(),
        });
      }
    }
  }

  state.knownEntryIds = pruneKnownEntryIds([...state.knownEntryIds, ...newKnownIds]);
  state.failedEntries = updatedFailedEntries;
  state.lastCheckedAt = Date.now();
  await saveSubscriptionState(appService, state);

  return { newBooks, state };
}

/**
 * Sync all OPDS catalogs that have autoDownload enabled.
 *
 * Catalogs are processed sequentially: the per-catalog pool already runs
 * DOWNLOAD_CONCURRENCY parallel downloads, and a parallel fan-out across
 * catalogs would multiply that (N × DOWNLOAD_CONCURRENCY) and hammer
 * cellular connections. One failure does not block the others — each
 * catalog's errors are isolated and surfaced in the result.
 */
export async function syncSubscribedCatalogs(
  catalogs: OPDSCatalog[],
  appService: AppService,
  books: Book[],
): Promise<SyncResult> {
  const eligible = catalogs.filter((c) => c.autoDownload && !c.disabled);
  if (eligible.length === 0) {
    return { newBooks: [], totalNewBooks: 0, errors: [] };
  }

  const allNewBooks: Book[] = [];
  const errors: SyncResult['errors'] = [];

  for (const catalog of eligible) {
    try {
      const { newBooks } = await syncCatalog(catalog, appService, books);
      allNewBooks.push(...newBooks);
    } catch (reason) {
      console.error(`OPDS sync: catalog "${catalog.name}" failed:`, reason);
      errors.push({
        catalogId: catalog.id,
        catalogName: catalog.name,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      try {
        const state = await loadSubscriptionState(appService, catalog.id);
        state.lastCheckedAt = Date.now();
        await saveSubscriptionState(appService, state);
      } catch {
        // Best effort
      }
    }
  }

  return {
    newBooks: allNewBooks,
    totalNewBooks: allNewBooks.length,
    errors,
  };
}
