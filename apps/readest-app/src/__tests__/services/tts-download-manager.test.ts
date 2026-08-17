import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useTTSDownloadStore } from '@/store/ttsDownloadStore';
import { TTSDownloadManager } from '@/services/tts/ttsDownloadManager';
import type { TTSController } from '@/services/tts/TTSController';
import type { DownloadChapter } from '@/services/tts/downloadChapters';
import type { SectionDownloadProgress } from '@/services/tts/TTSDownloader';

const QUEUE_KEY = 'readest_tts_download_queue';

const chapter = (key: string, startSection: number, endSection: number): DownloadChapter => ({
  key,
  label: `Chapter ${key}`,
  depth: 0,
  startSection,
  endSection,
});

const makeController = () => {
  const packed = new Set<number>();
  const beginDownloadSections = vi.fn().mockResolvedValue(undefined);
  const completeDownloadSections = vi.fn().mockResolvedValue(undefined);
  const cancelDownloadSections = vi.fn().mockResolvedValue(undefined);
  const downloader = {
    download: vi
      .fn()
      .mockImplementation(
        async (sections: number[], onProgress?: (p: SectionDownloadProgress) => void) => {
          for (const section of sections) {
            for (let done = 1; done <= 3; done++) {
              onProgress?.({ sectionIndex: section, total: 3, done, synthesized: done });
            }
            packed.add(section);
          }
          return { completed: [...sections], skipped: [], synthesized: 0 };
        },
      ),
  };
  const controller = {
    getTTSDownloader: () => downloader,
    getSectionCacheStatuses: vi
      .fn()
      .mockImplementation(
        async () =>
          new Map(
            [...packed].map((section) => [
              section,
              { total: 1, recorded: 1, packed: true, pinned: true, active: false },
            ]),
          ),
      ),
    beginDownloadSections,
    completeDownloadSections,
    cancelDownloadSections,
  };
  return {
    downloader,
    controller: controller as unknown as TTSController,
    packed,
    beginDownloadSections,
    completeDownloadSections,
    cancelDownloadSections,
  };
};

describe('TTSDownloadManager', () => {
  beforeEach(() => {
    useTTSDownloadStore.setState({ items: {} });
    localStorage.clear();
  });

  afterEach(() => {
    useTTSDownloadStore.setState({ items: {} });
    localStorage.clear();
  });

  test('processes queued chapters in order, one at a time', async () => {
    const { downloader, controller, beginDownloadSections, completeDownloadSections } =
      makeController();
    const manager = new TTSDownloadManager();
    manager.queueChapter('book', chapter('a', 0, 2));
    manager.queueChapter('book', chapter('b', 2, 3));
    // Nothing runs until the book's controller attaches (e.g. reader opens).
    expect(downloader.download).not.toHaveBeenCalled();
    manager.attachController('book', () => controller);

    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(2));
    expect(downloader.download.mock.calls[0]![0]).toEqual([0, 1]);
    expect(downloader.download.mock.calls[1]![0]).toEqual([2]);
    // Completed chapters leave the queue.
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemsForBook('book')).toHaveLength(0),
    );
    expect(beginDownloadSections.mock.calls).toEqual([[[0, 1]], [[2]]]);
    expect(completeDownloadSections.mock.calls).toEqual([[[0, 1]], [[2]]]);
  });

  test('a chapter already pending or active is not queued twice', async () => {
    const { downloader, controller } = makeController();
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(1));
  });

  test('a Download all batch jumps ahead of individually tapped chapters', async () => {
    const { downloader, controller } = makeController();
    const manager = new TTSDownloadManager();
    // Both queued before the session attaches: priority (1) beats priority (10).
    manager.queueChapter('book', chapter('a', 0, 1));
    manager.queueAll('book', [chapter('b', 1, 2)]);
    manager.attachController('book', () => controller);

    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(2));
    expect(downloader.download.mock.calls[0]![0]).toEqual([1]);
    expect(downloader.download.mock.calls[1]![0]).toEqual([0]);
  });

  test('a failed chapter can be retried by queueing it again', async () => {
    const { downloader, controller, packed } = makeController();
    let calls = 0;
    downloader.download.mockImplementation(async (sections: number[]) => {
      calls++;
      if (calls === 1) throw new Error('offline');
      for (const section of sections) packed.add(section);
      return { completed: [...sections], skipped: [], synthesized: 0 };
    });
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe('failed'),
    );
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
  });

  test('cancelling an active chapter aborts it and drops the row', async () => {
    const { downloader, controller, cancelDownloadSections } = makeController();
    let resolveDownload: () => void = () => {};
    downloader.download.mockImplementation(
      (
        _sections: number[],
        _onProgress?: (p: SectionDownloadProgress) => void,
        signal?: AbortSignal,
      ) =>
        new Promise((resolve) => {
          resolveDownload = () => resolve({ completed: [], skipped: [], synthesized: 0 });
          signal?.addEventListener('abort', resolveDownload);
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe(
        'in_progress',
      ),
    );
    manager.cancelItem('book:a');
    expect(downloader.download.mock.calls[0]![2]!.aborted).toBe(true);
    resolveDownload();
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
    await vi.waitFor(() => expect(cancelDownloadSections).toHaveBeenCalledWith([0]));
  });

  test('cancelling while cache status loads never starts the stale item', async () => {
    const { downloader, controller, beginDownloadSections } = makeController();
    let resolveStatuses: (value: Map<number, never>) => void = () => {};
    vi.mocked(controller.getSectionCacheStatuses).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatuses = resolve;
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() => expect(controller.getSectionCacheStatuses).toHaveBeenCalledTimes(1));

    manager.cancelItem('book:a');
    resolveStatuses(new Map<number, never>());
    await Promise.resolve();
    await Promise.resolve();

    expect(beginDownloadSections).not.toHaveBeenCalled();
    expect(downloader.download).not.toHaveBeenCalled();
    expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined();
  });

  test('a cancelled attempt cannot update or remove an immediate retry of the same chapter', async () => {
    const { downloader, controller } = makeController();
    const packed = new Set<number>();
    vi.mocked(controller.getSectionCacheStatuses).mockImplementation(
      async () =>
        new Map(
          [...packed].map((section) => [
            section,
            { total: 1, recorded: 1, packed: true, pinned: true, active: false },
          ]),
        ),
    );

    let resolveOldAttempt: () => void = () => {};
    let reportOldProgress: ((progress: SectionDownloadProgress) => void) | undefined;
    downloader.download
      .mockImplementationOnce(
        (_sections: number[], onProgress?: (progress: SectionDownloadProgress) => void) =>
          new Promise((resolve) => {
            reportOldProgress = onProgress;
            resolveOldAttempt = () => resolve({ completed: [], skipped: [], synthesized: 0 });
          }),
      )
      .mockImplementationOnce(async (sections: number[]) => {
        for (const section of sections) packed.add(section);
        return { completed: [...sections], skipped: [], synthesized: 0 };
      });

    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe(
        'in_progress',
      ),
    );

    manager.cancelItem('book:a');
    manager.queueChapter('book', chapter('a', 0, 1));
    expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toMatchObject({
      status: 'pending',
      done: 0,
    });

    reportOldProgress?.({ sectionIndex: 0, total: 3, done: 1, synthesized: 1 });
    expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toMatchObject({
      status: 'pending',
      done: 0,
    });

    resolveOldAttempt();
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
  });

  test('cancelling during successful finalization does not release the attempt twice', async () => {
    const { controller, completeDownloadSections, cancelDownloadSections } = makeController();
    let finishFinalization: () => void = () => {};
    completeDownloadSections.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFinalization = resolve;
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() => expect(completeDownloadSections).toHaveBeenCalledWith([0]));

    manager.cancelItem('book:a');
    finishFinalization();
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
    await Promise.resolve();

    expect(cancelDownloadSections).not.toHaveBeenCalled();
  });

  test('a failed pin acquisition does not release another attempt ownership', async () => {
    const { controller, beginDownloadSections, cancelDownloadSections } = makeController();
    beginDownloadSections.mockRejectedValueOnce(new Error('pin failed'));
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe('failed'),
    );
    expect(cancelDownloadSections).not.toHaveBeenCalled();
  });

  test('removeBook aborts and drops only the targeted book queue', async () => {
    const { downloader, controller } = makeController();
    let resolveDownload: () => void = () => {};
    downloader.download.mockImplementation(
      (
        _sections: number[],
        _onProgress?: (p: SectionDownloadProgress) => void,
        signal?: AbortSignal,
      ) =>
        new Promise((resolve) => {
          resolveDownload = () => resolve({ completed: [], skipped: [], synthesized: 0 });
          signal?.addEventListener('abort', resolveDownload);
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book1', () => controller);
    manager.queueChapter('book1', chapter('a', 0, 1));
    manager.queueChapter('book2', chapter('x', 0, 1));

    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book1', 'a')?.status).toBe(
        'in_progress',
      ),
    );
    manager.removeBook('book1');
    expect(downloader.download.mock.calls[0]![2]!.aborted).toBe(true);
    resolveDownload();
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemsForBook('book1')).toHaveLength(0),
    );
    expect(useTTSDownloadStore.getState().itemForChapter('book2', 'x')).toBeDefined();
  });

  test('removeBook waits for a previously cancelled synthesis attempt to unwind', async () => {
    const { downloader, controller, cancelDownloadSections } = makeController();
    let releaseDownload: () => void = () => {};
    downloader.download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDownload = () => resolve({ completed: [], skipped: [], synthesized: 0 });
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe(
        'in_progress',
      ),
    );

    manager.cancelItem('book:a');
    let removalFinished = false;
    const removal = Promise.resolve(manager.removeBook('book')).then(() => {
      removalFinished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(removalFinished).toBe(false);

    releaseDownload();
    await removal;
    expect(cancelDownloadSections).toHaveBeenCalledWith([0]);
  });

  test('removeBook hydrates before deleting so a cold manager preserves other books', () => {
    const seeder = new TTSDownloadManager();
    seeder.queueChapter('book1', chapter('a', 0, 1));
    seeder.queueChapter('book2', chapter('b', 1, 2));
    useTTSDownloadStore.setState({ items: {} });

    const manager = new TTSDownloadManager();
    manager.removeBook('book1');

    expect(useTTSDownloadStore.getState().itemForChapter('book1', 'a')).toBeUndefined();
    expect(useTTSDownloadStore.getState().itemForChapter('book2', 'b')).toBeDefined();
    const persisted = JSON.parse(localStorage.getItem(QUEUE_KEY)!);
    expect(Object.keys(persisted.items)).toEqual(['book2:b']);
  });

  test('parks a pending item when its attached controller is unavailable', async () => {
    const { downloader, controller } = makeController();
    const manager = new TTSDownloadManager();
    manager.queueChapter('book', chapter('a', 0, 1));
    const getController = vi.fn().mockReturnValueOnce(null).mockReturnValue(controller);

    manager.attachController('book', getController);
    await Promise.resolve();
    await Promise.resolve();

    expect(getController).toHaveBeenCalledTimes(1);
    expect(downloader.download).not.toHaveBeenCalled();
    expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe('pending');

    manager.attachController('book', getController);
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
  });

  test('keeps an incomplete resolved download as failed so it can be retried', async () => {
    const { downloader, controller, cancelDownloadSections } = makeController();
    downloader.download.mockResolvedValue({ completed: [], skipped: [0], synthesized: 0 });
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe('failed'),
    );
    expect(cancelDownloadSections).toHaveBeenCalledWith([0]);
  });

  test('repairs a pinned section whose durable pack is missing', async () => {
    const { downloader, controller, packed } = makeController();
    vi.mocked(controller.getSectionCacheStatuses).mockImplementation(async () => {
      if (packed.has(0)) {
        return new Map([[0, { total: 1, recorded: 1, packed: true, pinned: true, active: false }]]);
      }
      return new Map([[0, { total: 1, recorded: 1, packed: false, pinned: true, active: false }]]);
    });
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));

    await vi.waitFor(() =>
      expect(downloader.download).toHaveBeenCalledWith([0], expect.anything(), expect.anything()),
    );
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
  });

  test('aggregates sentence progress across a chapter sections', async () => {
    const { downloader, controller, packed } = makeController();
    const observed: Array<[number, number]> = [];
    const unsub = useTTSDownloadStore.subscribe((state) => {
      const item = state.itemForChapter('book', 'a');
      if (item) observed.push([item.done, item.total]);
    });
    downloader.download.mockImplementation(
      async (sections: number[], onProgress?: (p: SectionDownloadProgress) => void) => {
        const totals: Record<number, number> = { 0: 3, 1: 4 };
        for (const section of sections) {
          const total = totals[section]!;
          for (let done = 1; done <= total; done++) {
            onProgress?.({ sectionIndex: section, total, done, synthesized: done });
            await Promise.resolve();
          }
          packed.add(section);
        }
        return { completed: [...sections], skipped: [], synthesized: 0 };
      },
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 2));

    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemsForBook('book')).toHaveLength(0),
    );
    unsub();
    // Section 0 saturates at 3/3; section 1 continues from 3 and ends 7/7.
    expect(observed.some(([done, total]) => done === 3 && total === 3)).toBe(true);
    expect(observed.some(([done, total]) => done === 7 && total === 7)).toBe(true);
  });

  test('regression: a chapter completing never touches a queued successor', async () => {
    const { downloader, controller, packed } = makeController();
    const resolvers: Array<() => void> = [];
    downloader.download.mockImplementation(
      (
        sections: number[],
        _onProgress?: (p: SectionDownloadProgress) => void,
        signal?: AbortSignal,
      ) =>
        new Promise((resolve) => {
          const resolver = () => {
            for (const section of sections) packed.add(section);
            resolve({ completed: [...sections], skipped: [], synthesized: 0 });
          };
          resolvers.push(resolver);
          signal?.addEventListener('abort', resolver);
        }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    manager.queueChapter('book', chapter('a', 0, 1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')?.status).toBe(
        'in_progress',
      ),
    );

    // User taps chapter B while A is mid-flight (the old bug: A's teardown
    // reset the shared state and B never visibly ran).
    manager.queueChapter('book', chapter('b', 1, 2));
    expect(useTTSDownloadStore.getState().itemForChapter('book', 'b')?.status).toBe('pending');

    resolvers[0]!();
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'a')).toBeUndefined(),
    );
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(2));
    expect(downloader.download.mock.calls[1]![0]).toEqual([1]);
    resolvers[1]!();
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemForChapter('book', 'b')).toBeUndefined(),
    );
  });

  test('persists the queue and a fresh manager restores and resumes it', async () => {
    const { downloader, controller } = makeController();
    const manager = new TTSDownloadManager();
    manager.queueChapter('book', chapter('a', 0, 1));
    const persisted = JSON.parse(localStorage.getItem(QUEUE_KEY)!);
    expect(persisted).toMatchObject({ schemaVersion: 1 });
    expect(Object.values(persisted.items)).toHaveLength(1);

    // A fresh manager — as after an app restart — restores the row and runs
    // it once the book's session is live again.
    const restarted = new TTSDownloadManager();
    restarted.attachController('book', () => controller);
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(useTTSDownloadStore.getState().itemsForBook('book')).toHaveLength(0),
    );
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!).items).toEqual({});
  });

  test('interrupted runs restore as pending and re-download', async () => {
    const { downloader, controller } = makeController();
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        items: {
          'book:a': {
            id: 'book:a',
            bookHash: 'book',
            chapterKey: 'a',
            label: 'A',
            startSection: 0,
            endSection: 2,
            status: 'in_progress',
            done: 2,
            total: 3,
            createdAt: 1,
            priority: 10,
          },
        },
      }),
    );
    const manager = new TTSDownloadManager();
    manager.attachController('book', () => controller);
    await vi.waitFor(() => expect(downloader.download).toHaveBeenCalledTimes(1));
    // The demoted row downloads its full section range again.
    expect(downloader.download.mock.calls[0]![0]).toEqual([0, 1]);
  });
});
