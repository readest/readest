import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SetStateAction } from 'react';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { INDETERMINATE_PROGRESS, type ProgressHandler } from '@/utils/transfer';

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
const runFileBookDownload = vi.hoisted(() =>
  vi.fn(
    async (
      _envConfig: EnvConfigType,
      _book: Book,
      _onProgress?: ProgressHandler,
    ): Promise<boolean> => true,
  ),
);
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

type ProgressState = { [key: string]: number };

const setup = (appService: AppService | null = null) => {
  const updateBook = vi.fn(async (_envConfig: EnvConfigType, _book: Book) => {});
  // Mimic React's functional state updates so tests can assert the actual
  // progress transitions (indeterminate start, percentage updates, cleanup).
  let progressState: ProgressState = {};
  const setBooksTransferProgress = vi.fn((updater: SetStateAction<ProgressState>) => {
    progressState = typeof updater === 'function' ? updater(progressState) : updater;
  });
  const { result } = renderHook(() =>
    useBookTransferActions(envConfig, appService, updateBook, setBooksTransferProgress),
  );
  return { result, updateBook, getProgress: () => progressState };
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
  it('tries file mirrors first because uploadedAt does not identify which provider has the book (#5009)', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];

    const { result } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(queueDownload).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it('falls back to Readest Cloud when no enabled file mirror holds the book', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];
    runFileBookDownload.mockResolvedValueOnce(false);

    const { result } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(queueDownload).toHaveBeenCalledWith(book, 1);
    expect(ok).toBe(true);
  });

  it('falls back to an immediate Readest Cloud download when opening a cloud-shelf book', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];
    runFileBookDownload.mockResolvedValueOnce(false);
    const downloadBook = vi.fn(async () => {});

    const { result, updateBook } = setup({ downloadBook } as unknown as AppService);
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: false });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(downloadBook).toHaveBeenCalledWith(book, false, false, expect.any(Function));
    expect(queueDownload).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledWith(envConfig, book);
    expect(ok).toBe(true);
  });

  it('falls back to a file backend when the book is not in Readest Cloud storage', async () => {
    routing.readestEnabled = true;
    routing.backends = ['webdav'];

    const { result, updateBook } = setup();
    const book = makeBook({ uploadedAt: null });
    const ok = await result.current.handleBookDownload(book, { queued: true });

    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(queueDownload).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledWith(envConfig, book);
    expect(ok).toBe(true);
  });

  it('shows indeterminate progress while a file-backend download runs and clears it on completion', async () => {
    routing.backends = ['gdrive'];
    let release!: (ok: boolean) => void;
    runFileBookDownload.mockImplementationOnce(
      () =>
        new Promise<boolean>((res) => {
          release = res;
        }),
    );

    const { result, getProgress } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const promise = result.current.handleBookDownload(book, { queued: true });

    // The native plugin cannot report a byte total up front, so the entry
    // starts indeterminate until progress events arrive.
    expect(getProgress()).toEqual({ [book.hash]: INDETERMINATE_PROGRESS });

    release(true);
    await promise;
    expect(getProgress()).toEqual({});
  });

  it('reports percentage progress from a direct download and clears it on completion', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      let emit!: ProgressHandler;
      const downloadBook = vi.fn(
        (_book: Book, _redownload: boolean, _reuse: boolean, onProgress?: ProgressHandler) => {
          emit = onProgress!;
          return new Promise<void>((res) => {
            release = res;
          });
        },
      );

      const { result, getProgress } = setup({ downloadBook } as unknown as AppService);
      const book = makeBook({ uploadedAt: 12345 });
      const promise = result.current.handleBookDownload(book, { queued: false });

      // The overlay is primed before the first byte — without this the cover
      // stays blank across the signed-URL round trip, auth and TLS handshake
      // for the queued:false callers (useOpenBook, the details modal's
      // Redownload), which is the "no visual feedback" symptom this exists to
      // remove. The kick takes the throttle's leading edge, so the first real
      // percentage lands on the trailing edge.
      expect(getProgress()).toEqual({ [book.hash]: INDETERMINATE_PROGRESS });

      emit({ progress: 50, total: 100, transferSpeed: 0 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(getProgress()).toEqual({ [book.hash]: 50 });

      release();
      await promise;
      expect(getProgress()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a progress event that arrives after the transfer finished', async () => {
    // Tauri delivers Channel messages over IPC independently of the invoke
    // response, so the downloader's last payload can land after the command
    // resolved. Nothing clears the entry a second time, so a late event that
    // re-armed the throttle would leave the cover stuck behind a stale overlay
    // with its action button gone, permanently.
    vi.useFakeTimers();
    try {
      routing.backends = ['gdrive'];
      let late!: ProgressHandler;
      runFileBookDownload.mockImplementationOnce(async (_env, _book, onProgress) => {
        late = onProgress!;
        return true;
      });

      const { result, getProgress } = setup();
      const book = makeBook({ uploadedAt: 12345 });
      await result.current.handleBookDownload(book, { queued: true });
      expect(getProgress()).toEqual({});

      late({ progress: 90, total: 100, transferSpeed: 0 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(getProgress()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
