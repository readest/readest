import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveResumePosition,
  AbsProgressSyncer,
  readLocalLastPlayedAt,
} from '@/services/audiobookshelf/progressSync';
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
    // A book syncer has no episodeId; it forwards `undefined`, which
    // ABSClient#openPlaybackSession treats the same as omitting the
    // argument (see the "book session URL unchanged" client test).
    expect(client.openPlaybackSession).toHaveBeenCalledWith('i1', undefined);
    expect(resume).toBe(500);
  });

  it("begin's book matching ignores mediaProgress entries with a truthy episodeId", async () => {
    // A book syncer (no episodeId) must not match an entry that carries a
    // truthy episodeId, even when libraryItemId matches. If it wrongly
    // matched, serverLastUpdate would be 9000 (newer than localLastPlayedAt
    // 100) and resume would fall back to the session's currentTime (500)
    // instead of the local position.
    client.getMe.mockResolvedValueOnce({
      mediaProgress: [
        {
          libraryItemId: 'i1',
          episodeId: 'ep9',
          currentTime: 999,
          duration: 3600,
          isFinished: false,
          lastUpdate: 9000,
        },
      ],
    });
    const resume = await syncer.begin(50, 100);
    expect(resume).toBe(50);
  });

  it("begin's book matching matches a mediaProgress entry with an explicit null episodeId", async () => {
    // /api/me sends `episodeId: null` (not just an absent field) for a
    // book's own mediaProgress entry. A book syncer must still match it.
    client.getMe.mockResolvedValueOnce({
      mediaProgress: [
        {
          libraryItemId: 'i1',
          episodeId: null,
          currentTime: 42,
          duration: 3600,
          isFinished: false,
          lastUpdate: 9000,
        },
      ],
    });
    // localLastPlayedAt (100) is older than the matched entry's lastUpdate
    // (9000), so the server should win, proving the entry was matched: if
    // unmatched, serverLastUpdate falls back to 0 and local (100 > 0) would
    // win instead, resolving to localCurrentTime (700) rather than the
    // session's currentTime (500, from the shared client mock).
    const resume = await syncer.begin(700, 100);
    expect(resume).toBe(500);
  });

  it('begin passes the episodeId to openPlaybackSession for an episode', async () => {
    const episodeSyncer = new AbsProgressSyncer({
      client: client as never,
      itemId: 'show1',
      episodeId: 'ep1',
      bookHash: 'h-ep1',
      duration: 1800,
      appService: { saveLibraryBooks: vi.fn() } as never,
    });
    await episodeSyncer.begin(0, 0);
    expect(client.openPlaybackSession).toHaveBeenCalledWith('show1', 'ep1');
  });

  it("begin's episode matching ignores show-level and other-episode entries", async () => {
    client.openPlaybackSession.mockResolvedValueOnce({
      id: 'sess-ep1',
      currentTime: 999,
      audioTracks: [],
    });
    client.getMe.mockResolvedValueOnce({
      mediaProgress: [
        // Show-level entry: same libraryItemId, no episodeId. Must be ignored.
        {
          libraryItemId: 'show1',
          currentTime: 10,
          duration: 1800,
          isFinished: false,
          lastUpdate: 5000,
        },
        // Other-episode entry: same libraryItemId, different episodeId. Must be ignored.
        {
          libraryItemId: 'show1',
          episodeId: 'ep2',
          currentTime: 20,
          duration: 1800,
          isFinished: false,
          lastUpdate: 6000,
        },
        // Target entry for (show1, ep1).
        {
          libraryItemId: 'show1',
          episodeId: 'ep1',
          currentTime: 30,
          duration: 1800,
          isFinished: false,
          lastUpdate: 1000,
        },
      ],
    });
    const episodeSyncer = new AbsProgressSyncer({
      client: client as never,
      itemId: 'show1',
      episodeId: 'ep1',
      bookHash: 'h-ep1',
      duration: 1800,
      appService: { saveLibraryBooks: vi.fn() } as never,
    });
    // localLastPlayedAt (2000) is newer than the matched (show1, ep1) entry's
    // lastUpdate (1000), so local should win. If matching had instead picked
    // the show-level (5000) or other-episode (6000) entry, local would not
    // be considered fresher and resume would fall back to the session's
    // currentTime (999) instead.
    const resume = await episodeSyncer.begin(700, 2000);
    expect(resume).toBe(700);
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

    it('bumps updatedAt on playback so Date Read sorting reflects listening', async () => {
      const originalBook = seedBook();
      const before = originalBook.updatedAt;
      const { localSyncer } = makeSyncer();
      await localSyncer.begin(0, 0);
      localSyncer.hooks().onTick!(515);

      const updatedBook = useLibraryStore.getState().library.find((b) => b.hash === 'h1');
      expect(updatedBook!.updatedAt).toBeGreaterThan(before);
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

  describe('per-episode localStorage key isolation', () => {
    afterEach(() => {
      localStorage.clear();
    });

    it('writes distinct keys for two episodes sharing a bookHash, and leaves the book-level key untouched', async () => {
      const nowSpy = vi.spyOn(Date, 'now');
      const makeEpisodeSyncer = (episodeId: string) =>
        new AbsProgressSyncer({
          client: client as never,
          itemId: 'show1',
          episodeId,
          bookHash: 'hShow',
          duration: 1800,
          appService: { saveLibraryBooks: vi.fn() } as never,
        });
      const bookSyncer = new AbsProgressSyncer({
        client: client as never,
        itemId: 'i1',
        bookHash: 'hShow',
        duration: 3600,
        appService: { saveLibraryBooks: vi.fn() } as never,
      });

      try {
        const ep1Syncer = makeEpisodeSyncer('ep1');
        nowSpy.mockReturnValue(1111);
        await ep1Syncer.begin(0, 0);
        ep1Syncer.hooks().onTick!(10);

        const ep2Syncer = makeEpisodeSyncer('ep2');
        nowSpy.mockReturnValue(2222);
        await ep2Syncer.begin(0, 0);
        ep2Syncer.hooks().onTick!(20);

        nowSpy.mockReturnValue(3333);
        await bookSyncer.begin(0, 0);
        bookSyncer.hooks().onTick!(30);

        expect(localStorage.getItem('abs-last-played-hShow:ep1')).toBe('1111');
        expect(localStorage.getItem('abs-last-played-hShow:ep2')).toBe('2222');
        expect(localStorage.getItem('abs-last-played-hShow')).toBe('3333');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('treats an empty-string episodeId as no episode: same session call, cache key, and mediaProgress match as a book', async () => {
      client.getMe.mockResolvedValueOnce({
        mediaProgress: [
          // Book-level entry (no episodeId), the same shape /api/me sends
          // for a show that isn't episode-scoped.
          {
            libraryItemId: 'show2',
            currentTime: 77,
            duration: 1800,
            isFinished: false,
            lastUpdate: 4000,
          },
        ],
      });
      const emptyEpisodeSyncer = new AbsProgressSyncer({
        client: client as never,
        itemId: 'show2',
        episodeId: '',
        bookHash: 'hEmpty',
        duration: 1800,
        appService: { saveLibraryBooks: vi.fn() } as never,
      });

      // localLastPlayedAt (0) is older than the book-level entry's
      // lastUpdate (4000), so the server should win (session currentTime,
      // 500 from the shared default mock) only if '' matched the
      // book-level entry the same way `undefined` would.
      const resume = await emptyEpisodeSyncer.begin(999, 0);
      expect(client.openPlaybackSession).toHaveBeenCalledWith('show2', undefined);
      expect(resume).toBe(500);

      emptyEpisodeSyncer.hooks().onTick!(10);
      expect(localStorage.getItem('abs-last-played-hEmpty')).not.toBeNull();
      expect(localStorage.getItem('abs-last-played-hEmpty:')).toBeNull();
    });
  });

  describe('readLocalLastPlayedAt with an episodeId', () => {
    afterEach(() => {
      localStorage.clear();
    });

    it('reads the per-episode key, distinct from the book-level key and other episodes', () => {
      localStorage.setItem('abs-last-played-hShow', '111');
      localStorage.setItem('abs-last-played-hShow:ep1', '222');
      localStorage.setItem('abs-last-played-hShow:ep2', '333');

      expect(readLocalLastPlayedAt('hShow')).toBe(111);
      expect(readLocalLastPlayedAt('hShow', 'ep1')).toBe(222);
      expect(readLocalLastPlayedAt('hShow', 'ep2')).toBe(333);
    });
  });
});
