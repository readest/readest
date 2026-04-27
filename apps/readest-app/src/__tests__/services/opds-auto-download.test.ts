import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OPDSCatalog } from '@/types/opds';
import type { AppService } from '@/types/system';
import type { OPDSSubscriptionState, PendingItem } from '@/services/opds/types';

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue({ 'content-disposition': '' }),
}));

vi.mock('@/app/opds/utils/opdsReq', () => ({
  fetchWithAuth: vi.fn(),
  probeAuth: vi.fn().mockResolvedValue(null),
  needsProxy: vi.fn(() => false),
  getProxiedURL: vi.fn((url: string) => url),
  probeFilename: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/services/opds/feedChecker', () => ({
  checkFeedForNewItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/opds/subscriptionState', () => ({
  loadSubscriptionState: vi.fn().mockResolvedValue({
    catalogId: 'cat-1',
    lastCheckedAt: 0,
    knownEntryIds: [],
    failedEntries: [],
  }),
  saveSubscriptionState: vi.fn().mockResolvedValue(undefined),
  pruneKnownEntryIds: vi.fn((ids: string[]) => ids),
  emptyState: vi.fn((id: string) => ({
    catalogId: id,
    lastCheckedAt: 0,
    knownEntryIds: [],
    failedEntries: [],
  })),
}));

import { syncSubscribedCatalogs } from '@/services/opds/autoDownload';
import { checkFeedForNewItems } from '@/services/opds/feedChecker';
import { saveSubscriptionState, loadSubscriptionState } from '@/services/opds/subscriptionState';
import { downloadFile } from '@/libs/storage';

const createMockAppService = () =>
  ({
    resolveFilePath: vi.fn(async (path: string) => `/cache/${path}`),
    importBook: vi.fn(async () => ({
      hash: 'abc123',
      format: 'EPUB',
      title: 'Test Book',
      author: 'Author',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    copyFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    readFile: vi.fn(async () => '{}'),
    writeFile: vi.fn(async () => {}),
    createDir: vi.fn(async () => {}),
  }) as unknown as AppService;

describe('OPDS auto-download orchestrator', () => {
  let appService: AppService;

  beforeEach(() => {
    vi.clearAllMocks();
    appService = createMockAppService();
  });

  it('skips catalogs without autoDownload enabled', async () => {
    const catalogs: OPDSCatalog[] = [
      { id: 'cat-1', name: 'Test', url: 'https://example.com/opds' },
    ];
    const result = await syncSubscribedCatalogs(catalogs, appService, []);
    expect(result.totalNewBooks).toBe(0);
    expect(checkFeedForNewItems).not.toHaveBeenCalled();
  });

  it('skips disabled catalogs even with autoDownload', async () => {
    const catalogs: OPDSCatalog[] = [
      {
        id: 'cat-1',
        name: 'Test',
        url: 'https://example.com/opds',
        autoDownload: true,
        disabled: true,
      },
    ];
    const result = await syncSubscribedCatalogs(catalogs, appService, []);
    expect(result.totalNewBooks).toBe(0);
  });

  it('downloads new items and returns them', async () => {
    const catalogs: OPDSCatalog[] = [
      { id: 'cat-1', name: 'Shelf', url: 'https://shelf.example.com/opds', autoDownload: true },
    ];

    const pendingItems: PendingItem[] = [
      {
        entryId: 'urn:shelf:1',
        title: 'Issue 1',
        acquisitionHref: '/dl/1.epub',
        mimeType: 'application/epub+zip',
        baseURL: 'https://shelf.example.com/opds',
      },
    ];
    vi.mocked(checkFeedForNewItems).mockResolvedValue(pendingItems);

    const result = await syncSubscribedCatalogs(catalogs, appService, []);
    expect(result.totalNewBooks).toBe(1);
    expect(result.newBooks).toHaveLength(1);
    expect(saveSubscriptionState).toHaveBeenCalled();

    const savedState = vi.mocked(saveSubscriptionState).mock.calls[0]![1] as OPDSSubscriptionState;
    expect(savedState.knownEntryIds).toContain('urn:shelf:1');
    expect(savedState.lastCheckedAt).toBeGreaterThan(0);
  });

  it('handles import failure by adding to failedEntries', async () => {
    const catalogs: OPDSCatalog[] = [
      { id: 'cat-1', name: 'Test', url: 'https://example.com/opds', autoDownload: true },
    ];

    vi.mocked(checkFeedForNewItems).mockResolvedValue([
      {
        entryId: 'urn:fail:1',
        title: 'Bad Book',
        acquisitionHref: '/dl/bad.epub',
        mimeType: 'application/epub+zip',
        baseURL: 'https://example.com',
      },
    ]);
    (appService.importBook as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('corrupt file'),
    );

    const result = await syncSubscribedCatalogs(catalogs, appService, []);
    expect(result.totalNewBooks).toBe(0);

    const savedState = vi.mocked(saveSubscriptionState).mock.calls[0]![1] as OPDSSubscriptionState;
    expect(savedState.failedEntries).toHaveLength(1);
    expect(savedState.failedEntries[0]!.entryId).toBe('urn:fail:1');
    expect(savedState.failedEntries[0]!.attempts).toBe(1);
    expect(savedState.knownEntryIds).not.toContain('urn:fail:1');
  });

  it('returns empty result when no catalogs have autoDownload', async () => {
    const result = await syncSubscribedCatalogs([], appService, []);
    expect(result).toEqual({ newBooks: [], totalNewBooks: 0, errors: [] });
  });

  it('does not re-attempt or duplicate an in-backoff failed entry that reappears in the feed', async () => {
    const catalogs: OPDSCatalog[] = [
      { id: 'cat-1', name: 'Test', url: 'https://example.com/opds', autoDownload: true },
    ];

    // Entry X failed once, very recently — well within the backoff window,
    // so isRetryEligible() returns false.
    vi.mocked(loadSubscriptionState).mockResolvedValueOnce({
      catalogId: 'cat-1',
      lastCheckedAt: 0,
      knownEntryIds: [],
      failedEntries: [
        {
          entryId: 'urn:backoff:1',
          href: '/dl/x.epub',
          title: 'Backed-off Book',
          attempts: 1,
          lastAttemptAt: Date.now(), // freshly attempted, still in backoff
        },
      ],
    });

    // The entry is still in the feed (not in knownEntryIds), so discovery
    // returns it again.
    vi.mocked(checkFeedForNewItems).mockResolvedValue([
      {
        entryId: 'urn:backoff:1',
        title: 'Backed-off Book',
        acquisitionHref: '/dl/x.epub',
        mimeType: 'application/epub+zip',
        baseURL: 'https://example.com/opds',
      },
    ]);

    await syncSubscribedCatalogs(catalogs, appService, []);

    // No download should have been attempted while in backoff.
    expect(downloadFile).not.toHaveBeenCalled();

    // And the saved state must not contain duplicate failedEntries for the
    // same entryId.
    const savedState = vi
      .mocked(saveSubscriptionState)
      .mock.calls.at(-1)![1] as OPDSSubscriptionState;
    const ids = savedState.failedEntries.map((fe) => fe.entryId);
    expect(ids).toEqual(Array.from(new Set(ids)));
    expect(savedState.failedEntries.filter((fe) => fe.entryId === 'urn:backoff:1')).toHaveLength(1);
  });

  it('does not download the same entry twice when it is both pending and a retry-eligible failure', async () => {
    const catalogs: OPDSCatalog[] = [
      { id: 'cat-1', name: 'Test', url: 'https://example.com/opds', autoDownload: true },
    ];

    vi.mocked(loadSubscriptionState).mockResolvedValueOnce({
      catalogId: 'cat-1',
      lastCheckedAt: 0,
      knownEntryIds: [],
      failedEntries: [
        {
          entryId: 'urn:dup:1',
          href: '/dl/dup.epub',
          title: 'Dup Book',
          attempts: 1,
          lastAttemptAt: 0, // far in the past, retry eligible
        },
      ],
    });

    vi.mocked(checkFeedForNewItems).mockResolvedValue([
      {
        entryId: 'urn:dup:1',
        title: 'Dup Book',
        acquisitionHref: '/dl/dup.epub',
        mimeType: 'application/epub+zip',
        baseURL: 'https://example.com/opds',
      },
    ]);

    await syncSubscribedCatalogs(catalogs, appService, []);

    expect(downloadFile).toHaveBeenCalledTimes(1);
  });
});
