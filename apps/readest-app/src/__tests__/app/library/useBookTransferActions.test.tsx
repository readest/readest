import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { ProgressPayload } from '@/utils/transfer';

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a
 * per-book Upload/Download must route to whichever of {Readest Cloud, a file
 * backend} the user has switched on, instead of assuming exactly one.
 *
 * `isReadestCloudEnabled` and `getActiveFileSyncBackends` are settable per
 * test (same pattern as useBooksSync-routing.test.tsx) so every routing
 * branch can be exercised directly, without rendering the whole library page.
 */

const routing = vi.hoisted(() => ({
  readestEnabled: true,
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileBookUpload = vi.hoisted(() => vi.fn(async () => true));
const runFileBookDownload = vi.hoisted(() => vi.fn(async () => true));
const queueUpload = vi.hoisted(() => vi.fn(() => 'transfer-1'));
const queueDownload = vi.hoisted(() => vi.fn(() => 'transfer-1'));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (text: string, params?: Record<string, string | number>): string => {
      if (!params) return text;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text,
      );
    },
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isReadestCloudEnabled: () => routing.readestEnabled,
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileBookUpload,
  runFileBookDownload,
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    queueUpload,
    queueDownload,
  },
}));

const { useBookTransferActions } = await import('@/app/library/hooks/useBookTransferActions');
const { eventDispatcher } = await import('@/utils/event');

const envConfig: EnvConfigType = { getAppService: async () => ({}) as AppService };

const makeBook = (over: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const setup = () => {
  const updateBook = vi.fn(async (_envConfig: EnvConfigType, _book: Book) => {});
  const updateBookTransferProgress = vi.fn((_bookHash: string, _progress: ProgressPayload) => {});
  const { result } = renderHook(() =>
    useBookTransferActions(envConfig, null, updateBook, updateBookTransferProgress),
  );
  return { result, updateBook };
};

beforeEach(() => {
  vi.clearAllMocks();
  routing.readestEnabled = true;
  routing.backends = [];
});

describe('useBookTransferActions upload routing (issue #5062)', () => {
  it('reaches every enabled destination when Readest Cloud and a file backend are both on', async () => {
    routing.readestEnabled = true;
    routing.backends = ['gdrive'];

    const { result } = setup();
    const book = makeBook();
    const ok = await result.current.handleBookUpload(book);

    expect(runFileBookUpload).toHaveBeenCalledWith(envConfig, book);
    expect(queueUpload).toHaveBeenCalledWith(book, 1);
    expect(ok).toBe(true);
  });

  it('toasts "turn on a provider" and returns false when nothing is enabled', async () => {
    routing.readestEnabled = false;
    routing.backends = [];
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = setup();
    const book = makeBook();
    const ok = await result.current.handleBookUpload(book);

    expect(runFileBookUpload).not.toHaveBeenCalled();
    expect(queueUpload).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({
      type: 'info',
      message: 'Turn on a provider in Cloud Sync settings to upload this book',
    });
  });
});

describe('useBookTransferActions download routing (issue #5062)', () => {
  it('uses the native (queue-backed) path when the book is already in Readest Cloud storage', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];

    const { result } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).not.toHaveBeenCalled();
    expect(queueDownload).toHaveBeenCalledWith(book, 1);
    expect(ok).toBe(true);
  });

  it('falls back to a file backend when the book is not in Readest Cloud storage', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];

    const { result, updateBook } = setup();
    const book = makeBook({ uploadedAt: null });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book);
    expect(queueDownload).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledWith(envConfig, book);
    expect(ok).toBe(true);
  });
});
