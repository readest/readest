import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveResumePosition, AbsProgressSyncer } from '@/services/audiobookshelf/progressSync';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';

describe('resolveResumePosition', () => {
  it('uses the server position when the server is newer', () => {
    expect(
      resolveResumePosition({
        serverCurrentTime: 500,
        serverLastUpdate: 2000,
        localCurrentTime: 100,
        localLastPlayedAt: 1000,
      }),
    ).toBe(500);
  });

  it('uses the local position when local is strictly newer', () => {
    expect(
      resolveResumePosition({
        serverCurrentTime: 500,
        serverLastUpdate: 1000,
        localCurrentTime: 700,
        localLastPlayedAt: 2000,
      }),
    ).toBe(700);
  });

  it('server wins ties and absent local state', () => {
    expect(
      resolveResumePosition({
        serverCurrentTime: 500,
        serverLastUpdate: 1000,
        localCurrentTime: 700,
        localLastPlayedAt: 1000,
      }),
    ).toBe(500);
    expect(
      resolveResumePosition({
        serverCurrentTime: 500,
        serverLastUpdate: 0,
        localCurrentTime: 0,
        localLastPlayedAt: 0,
      }),
    ).toBe(500);
  });
});

describe('AbsProgressSyncer', () => {
  const client = {
    openPlaybackSession: vi
      .fn()
      .mockResolvedValue({ id: 'sess1', currentTime: 500, audioTracks: [] }),
    getMe: vi.fn().mockResolvedValue({
      mediaProgress: [
        {
          libraryItemId: 'i1',
          currentTime: 500,
          duration: 3600,
          isFinished: false,
          lastUpdate: 2000,
        },
      ],
    }),
    syncSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
  };
  let syncer: AbsProgressSyncer;

  beforeEach(() => {
    vi.clearAllMocks();
    syncer = new AbsProgressSyncer({
      client: client as never,
      itemId: 'i1',
      bookHash: 'h1',
      duration: 3600,
      appService: { saveLibraryBooks: vi.fn() } as never,
    });
  });

  it('begin opens a session and resolves the resume position', async () => {
    const resume = await syncer.begin(100, 1000);
    expect(client.openPlaybackSession).toHaveBeenCalledWith('i1');
    expect(resume).toBe(500);
  });

  it('onTick syncs the session with listened time deltas', async () => {
    await syncer.begin(0, 0);
    const hooks = syncer.hooks();
    hooks.onTick!(515);
    await vi.waitFor(() =>
      expect(client.syncSession).toHaveBeenCalledWith('sess1', {
        currentTime: 515,
        timeListened: 15,
        duration: 3600,
      }),
    );
    hooks.onTick!(530);
    await vi.waitFor(() =>
      expect(client.syncSession).toHaveBeenLastCalledWith('sess1', {
        currentTime: 530,
        timeListened: 15,
        duration: 3600,
      }),
    );
  });

  it('seeks do not count as listened time', async () => {
    await syncer.begin(0, 0);
    const hooks = syncer.hooks();
    hooks.onSeek!(1000);
    hooks.onTick!(1015);
    await vi.waitFor(() =>
      expect(client.syncSession).toHaveBeenLastCalledWith('sess1', {
        currentTime: 1015,
        timeListened: 15,
        duration: 3600,
      }),
    );
  });

  it('onEnd closes the session once', async () => {
    await syncer.begin(0, 0);
    const hooks = syncer.hooks();
    hooks.onEnd!(600);
    hooks.onEnd!(600);
    await vi.waitFor(() => expect(client.closeSession).toHaveBeenCalledTimes(1));
  });

  it('sync failures are swallowed and do not break playback', async () => {
    client.syncSession.mockRejectedValueOnce(new Error('offline'));
    await syncer.begin(0, 0);
    expect(() => syncer.hooks().onTick!(15)).not.toThrow();
  });

  describe('local cache', () => {
    const seedBook = (): Book => {
      const book: Book = {
        hash: 'h1',
        format: 'ABS',
        title: 'Local Cache Book',
        author: 'Author A',
        createdAt: 0,
        updatedAt: 0,
      };
      useLibraryStore.getState().setLibrary([book]);
      return book;
    };

    const makeSyncer = () => {
      const appService = { saveLibraryBooks: vi.fn().mockResolvedValue(undefined) };
      const localSyncer = new AbsProgressSyncer({
        client: client as never,
        itemId: 'i1',
        bookHash: 'h1',
        duration: 3600,
        appService: appService as never,
      });
      return { localSyncer, appService };
    };

    afterEach(() => {
      useLibraryStore.getState().setLibrary([]);
    });

    it('onTick writes a new book object into the library store without mutating the original', async () => {
      const originalBook = seedBook();
      const { localSyncer } = makeSyncer();
      await localSyncer.begin(0, 0);
      localSyncer.hooks().onTick!(515);

      const updatedBook = useLibraryStore.getState().library.find((b) => b.hash === 'h1');
      expect(updatedBook).toBeDefined();
      expect(updatedBook).not.toBe(originalBook);
      expect(updatedBook!.progress).toEqual([515, 3600]);
      expect(originalBook.progress).toBeUndefined();
    });

    it('throttles the disk write across two rapid ticks', async () => {
      seedBook();
      const { localSyncer, appService } = makeSyncer();
      await localSyncer.begin(0, 0);
      const hooks = localSyncer.hooks();

      // The very first cache write always persists (nothing to throttle
      // against yet).
      hooks.onTick!(515);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(1);

      // Milliseconds later, well inside the 10s throttle window.
      hooks.onTick!(520);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(1);
    });

    it('onEnd forces the disk write even inside the throttle window', async () => {
      seedBook();
      const { localSyncer, appService } = makeSyncer();
      await localSyncer.begin(0, 0);
      const hooks = localSyncer.hooks();

      hooks.onTick!(515);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(1);

      // Still inside the 10s throttle window from the tick above: a naive
      // throttled write would be dropped here, silently regressing the
      // resume position if the app is killed right after.
      hooks.onEnd!(520);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(2);
    });

    it('onPause forces the disk write even inside the throttle window', async () => {
      seedBook();
      const { localSyncer, appService } = makeSyncer();
      await localSyncer.begin(0, 0);
      const hooks = localSyncer.hooks();

      hooks.onTick!(515);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(1);

      hooks.onPause!(520);
      expect(appService.saveLibraryBooks).toHaveBeenCalledTimes(2);
    });
  });
});
