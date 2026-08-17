import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TTSController } from '@/services/tts/TTSController';
import type { SectionCacheStatus } from '@/services/tts/downloadChapters';
import { useTTSDownloadStore } from '@/store/ttsDownloadStore';

const mocks = vi.hoisted(() => ({
  attachController: vi.fn(),
  detachController: vi.fn(),
  queueChapter: vi.fn(),
  queueAll: vi.fn(),
  cancelItem: vi.fn(),
  removeBook: vi.fn(),
  getBookData: vi.fn(),
}));

vi.mock('@/services/tts/ttsDownloadManager', () => ({
  ttsDownloadManager: {
    attachController: mocks.attachController,
    detachController: mocks.detachController,
    queueChapter: mocks.queueChapter,
    queueAll: mocks.queueAll,
    cancelItem: mocks.cancelItem,
    removeBook: mocks.removeBook,
  },
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  getBookHashFromKey: (bookKey: string) => bookKey.split('-')[0]!,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: mocks.getBookData }),
}));

import { useTTSDownloads } from '@/app/reader/hooks/useTTSDownloads';

const makeController = (getStatuses: () => Map<number, SectionCacheStatus>) =>
  ({
    canDownload: () => true,
    view: {
      book: { sections: [{}] },
      resolveNavigation: () => null,
    },
    getSectionCacheStatuses: vi.fn(async () => getStatuses()),
    getCacheBytes: vi.fn(async () => 0),
    clearDownloads: vi.fn().mockResolvedValue(undefined),
  }) as unknown as TTSController;

describe('useTTSDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTTSDownloadStore.setState({ items: {} });
    mocks.getBookData.mockReturnValue({ bookDoc: { toc: [] } });
  });

  afterEach(() => {
    cleanup();
    useTTSDownloadStore.setState({ items: {} });
  });

  test('uses the stable book hash for persisted rows and every manager operation', async () => {
    const controller = makeController(() => new Map());
    const getController = () => controller;
    useTTSDownloadStore.getState().enqueue(
      {
        key: 'section-0',
        label: 'Section 1',
        depth: 0,
        startSection: 0,
        endSection: 1,
      },
      'bookhash',
    );

    const { result, unmount } = renderHook(() =>
      useTTSDownloads('bookhash-reader-session', getController, false),
    );

    await waitFor(() =>
      expect(mocks.attachController).toHaveBeenCalledWith('bookhash', getController),
    );
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.downloadChapter(result.current.chapters[0]!));
    expect(mocks.queueChapter).toHaveBeenCalledWith('bookhash', result.current.chapters[0]);

    act(() => result.current.cancelChapter(result.current.chapters[0]!));
    expect(mocks.cancelItem).toHaveBeenCalledWith('bookhash:section-0');

    act(() => result.current.cancelAll());
    expect(mocks.removeBook).toHaveBeenCalledWith('bookhash');

    unmount();
    expect(mocks.detachController).toHaveBeenCalledWith('bookhash');
  });

  test('refreshes cache status when the final queue row is removed', async () => {
    let statuses = new Map<number, SectionCacheStatus>();
    const controller = makeController(() => statuses);
    const getController = () => controller;
    useTTSDownloadStore.getState().enqueue(
      {
        key: 'section-0',
        label: 'Section 1',
        depth: 0,
        startSection: 0,
        endSection: 1,
      },
      'bookhash',
    );

    const { result } = renderHook(() => useTTSDownloads('bookhash', getController, true));
    await waitFor(() => expect(controller.getSectionCacheStatuses).toHaveBeenCalledTimes(2));
    expect(result.current.statusOf(result.current.chapters[0]!)).toBe('none');

    statuses = new Map([[0, { total: 1, recorded: 1, packed: true, pinned: true, active: false }]]);
    act(() => useTTSDownloadStore.getState().removeItem('bookhash:section-0'));

    await waitFor(() =>
      expect(result.current.statusOf(result.current.chapters[0]!)).toBe('complete'),
    );
  });

  test('ignores an older cache refresh that resolves after a newer one', async () => {
    const controller = makeController(() => new Map());
    let resolveOlder: (statuses: Map<number, SectionCacheStatus>) => void = () => {};
    let resolveNewer: (statuses: Map<number, SectionCacheStatus>) => void = () => {};
    vi.mocked(controller.getSectionCacheStatuses)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewer = resolve;
          }),
      );
    const { result } = renderHook(() => useTTSDownloads('bookhash', () => controller, false));

    let older: Promise<void> = Promise.resolve();
    let newer: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.refresh();
      newer = result.current.refresh();
    });
    resolveNewer(
      new Map([[0, { total: 1, recorded: 1, packed: true, pinned: true, active: false }]]),
    );
    await act(async () => newer);
    expect(result.current.statusOf(result.current.chapters[0]!)).toBe('complete');

    resolveOlder(new Map());
    await act(async () => older);
    expect(result.current.statusOf(result.current.chapters[0]!)).toBe('complete');
  });

  test('clear downloads cancels the queue, clears pinned audio, and refreshes badges', async () => {
    const controller = makeController(() => new Map());
    const getController = () => controller;
    const { result } = renderHook(() =>
      useTTSDownloads('bookhash-reader-session', getController, false),
    );

    let finishCancellation: () => void = () => {};
    mocks.removeBook.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishCancellation = resolve;
      }),
    );

    let clearing: Promise<void> = Promise.resolve();
    act(() => {
      clearing = result.current.clearDownloads();
    });
    expect(result.current.clearing).toBe(true);
    expect(controller.clearDownloads).not.toHaveBeenCalled();
    act(() => result.current.downloadChapter(result.current.chapters[0]!));
    expect(mocks.queueChapter).not.toHaveBeenCalled();

    finishCancellation();
    await act(async () => clearing);

    expect(mocks.removeBook).toHaveBeenCalledWith('bookhash');
    expect(controller.clearDownloads).toHaveBeenCalledTimes(1);
    expect(controller.getSectionCacheStatuses).toHaveBeenCalledTimes(1);
    expect(result.current.clearing).toBe(false);
  });
});
