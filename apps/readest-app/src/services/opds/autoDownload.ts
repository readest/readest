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
  });

  const probedFilename = await probeFilename(responseHeaders);
  if (probedFilename) {
    const newFilePath = await appService.resolveFilePath(probedFilename, 'Cache');
    await appService.copyFile(dstFilePath, newFilePath, 'None');
    await appService.deleteFile(dstFilePath, 'None');
    dstFilePath = newFilePath;
  }

  const book = await appService.importBook(dstFilePath, books);
  if (!book) throw new Error(`importBook returned null for ${item.title}`);
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

  // Collect retry-eligible failed entries as PendingItems
  const retryItems: PendingItem[] = state.failedEntries.filter(isRetryEligible).map((fe) => ({
    entryId: fe.entryId,
    title: fe.title,
    acquisitionHref: fe.href,
    mimeType: 'application/octet-stream',
    baseURL: catalog.url,
  }));

  const allItems = [...pendingItems, ...retryItems];
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
 * Catalogs are processed with Promise.allSettled — one failure doesn't block others.
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

  const results = await Promise.allSettled(
    eligible.map((catalog) => syncCatalog(catalog, appService, books)),
  );

  const allNewBooks: Book[] = [];
  const errors: SyncResult['errors'] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const catalog = eligible[i]!;

    if (result.status === 'fulfilled') {
      allNewBooks.push(...result.value.newBooks);
    } else {
      console.error(`OPDS sync: catalog "${catalog.name}" failed:`, result.reason);
      errors.push({
        catalogId: catalog.id,
        catalogName: catalog.name,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      // Save state with updated lastCheckedAt even on failure
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
