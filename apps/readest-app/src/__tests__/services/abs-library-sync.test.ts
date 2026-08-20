import { describe, it, expect } from 'vitest';
import { reconcileAbsBooks } from '@/services/audiobookshelf/librarySync';
import { makeAbsFilePath } from '@/utils/audiobook';
import { md5 } from '@/utils/md5';
import type { ABSLibraryItem, ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';

const server: ABSServer = { id: 'srv1', name: 'Home', url: 'http://abs.local' };

const item = (id: string, title: string, numTracks = 3): ABSLibraryItem => ({
  id,
  mediaType: 'book',
  media: {
    metadata: { title, authorName: 'Author A' },
    duration: 3600,
    numAudioFiles: numTracks,
  },
});

const podcastItem = (id: string, title: string, numEpisodes = 2): ABSLibraryItem => ({
  id,
  mediaType: 'podcast',
  media: {
    metadata: { title, author: 'Podcast Author' },
    numEpisodes,
  },
});

describe('reconcileAbsBooks', () => {
  it('creates Book stubs with deterministic hash, ABS format, and duration', () => {
    const { upserts, tombstoneHashes } = reconcileAbsBooks({
      server,
      items: [item('i1', 'Peter Pan')],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1000,
    });
    expect(tombstoneHashes).toEqual([]);
    expect(upserts).toHaveLength(1);
    const book = upserts[0]!;
    expect(book.format).toBe('ABS');
    expect(book.filePath).toBe(makeAbsFilePath('srv1', 'i1'));
    expect(book.hash).toBe(md5(makeAbsFilePath('srv1', 'i1')));
    expect(book.title).toBe('Peter Pan');
    expect(book.author).toBe('Author A');
    expect(book.duration).toBe(3600);
    expect(book.createdAt).toBe(1000);
  });

  it('skips items without audio tracks (ebook-only)', () => {
    const ebookOnly = item('i2', 'Text Only', 0);
    const { upserts } = reconcileAbsBooks({
      server,
      items: [ebookOnly],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1,
    });
    expect(upserts).toEqual([]);
  });

  describe('podcast shows', () => {
    it('creates a podcast show stub with absMediaType, undefined duration, and author from metadata.author', () => {
      const { upserts } = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News')],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      });
      expect(upserts).toHaveLength(1);
      const book = upserts[0]!;
      expect(book.format).toBe('ABS');
      expect(book.absMediaType).toBe('podcast');
      expect(book.filePath).toBe(makeAbsFilePath('srv1', 'p1'));
      expect(book.hash).toBe(md5(makeAbsFilePath('srv1', 'p1')));
      expect(book.title).toBe('Daily News');
      expect(book.author).toBe('Podcast Author');
      expect(book.duration).toBeUndefined();
      expect(book.episodeCount).toBe(2);
      expect(book.progress).toBeUndefined();
    });

    it('falls back to episodes.length for the episode count when numEpisodes is absent', () => {
      const expanded: ABSLibraryItem = {
        id: 'p2',
        mediaType: 'podcast',
        media: {
          metadata: { title: 'Weekly', author: 'A' },
          episodes: [
            { id: 'e1', title: 'Ep1' },
            { id: 'e2', title: 'Ep2' },
            { id: 'e3', title: 'Ep3' },
          ],
        },
      };
      const { upserts } = reconcileAbsBooks({
        server,
        items: [expanded],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1,
      });
      expect(upserts[0]!.episodeCount).toBe(3);
    });

    it('upserts an existing show when its episode count changes, and never maps show-level progress', () => {
      const first = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 5)],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      }).upserts[0]!;
      expect(first.episodeCount).toBe(5);

      const showProgress = [
        {
          libraryItemId: 'p1',
          currentTime: 100,
          duration: 200,
          isFinished: false,
          lastUpdate: 999999,
        },
      ];

      // Same episode count and server-reported progress: nothing to upsert.
      const unchanged = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 5)],
        progress: showProgress,
        library: [first],
        lastPlayedAtByHash: new Map(),
        now: 2000,
      });
      expect(unchanged.upserts).toEqual([]);

      // A new episode alone triggers an upsert; progress still isn't mapped.
      const { upserts } = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 6)],
        progress: showProgress,
        library: [first],
        lastPlayedAtByHash: new Map(),
        now: 3000,
      });
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.episodeCount).toBe(6);
      expect(upserts[0]!.progress).toBeUndefined();
    });

    it('keeps show-level progress set by playing an episode across an unrelated reconcile', () => {
      const first = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 5)],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      }).upserts[0]!;
      // Simulates AbsProgressSyncer#cacheLocally having written show-level
      // progress after the user played an episode - never something
      // reconcileAbsBooks itself does, since a podcast's itemProgress
      // lookup above is unconditionally undefined.
      const existing: Book = { ...first, progress: [120, 600] };

      const { upserts } = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 6)],
        progress: [
          {
            libraryItemId: 'p1',
            currentTime: 999,
            duration: 999,
            isFinished: false,
            lastUpdate: 999999,
          },
        ],
        library: [existing],
        lastPlayedAtByHash: new Map(),
        now: 3000,
      });

      // A routine resync (here, the episode-count bump) must not clobber
      // the episode-driven progress with the show-level server value.
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.progress).toEqual([120, 600]);
    });
  });

  it('updates changed metadata on existing entries without touching createdAt', () => {
    const first = reconcileAbsBooks({
      server,
      items: [item('i1', 'Old Title')],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1000,
    }).upserts[0]!;
    const { upserts } = reconcileAbsBooks({
      server,
      items: [item('i1', 'New Title')],
      progress: [],
      library: [first],
      lastPlayedAtByHash: new Map(),
      now: 2000,
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.title).toBe('New Title');
    expect(upserts[0]!.createdAt).toBe(1000);
    expect(upserts[0]!.updatedAt).toBe(2000);
  });

  it('returns no upsert when nothing changed', () => {
    const first = reconcileAbsBooks({
      server,
      items: [item('i1', 'Same')],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1000,
    }).upserts[0]!;
    const { upserts } = reconcileAbsBooks({
      server,
      items: [item('i1', 'Same')],
      progress: [],
      library: [first],
      lastPlayedAtByHash: new Map(),
      now: 2000,
    });
    expect(upserts).toEqual([]);
  });

  it('maps server media progress onto Book.progress in seconds', () => {
    const { upserts } = reconcileAbsBooks({
      server,
      items: [item('i1', 'P')],
      progress: [
        {
          libraryItemId: 'i1',
          currentTime: 120.6,
          duration: 3600,
          isFinished: false,
          lastUpdate: 5,
        },
      ],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1,
    });
    expect(upserts[0]!.progress).toEqual([121, 3600]);
  });

  it('rounds a non-integer server duration in Book.progress', () => {
    const { upserts } = reconcileAbsBooks({
      server,
      items: [item('i1', 'P')],
      progress: [
        {
          libraryItemId: 'i1',
          currentTime: 100.2,
          duration: 3599.7,
          isFinished: false,
          lastUpdate: 5,
        },
      ],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1,
    });
    expect(upserts[0]!.progress).toEqual([100, 3600]);
  });

  it('preserves a user-edited title/author over the server copy but still updates progress', () => {
    const first = reconcileAbsBooks({
      server,
      items: [item('i1', 'Server Title')],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1000,
    }).upserts[0]!;
    const edited: Book = {
      ...first,
      title: 'My Title',
      author: 'My Author',
      metadataUpdatedAt: 1500,
    };
    const { upserts } = reconcileAbsBooks({
      server,
      items: [item('i1', 'Server Title')],
      progress: [
        {
          libraryItemId: 'i1',
          currentTime: 200,
          duration: 3600,
          isFinished: false,
          lastUpdate: 10,
        },
      ],
      library: [edited],
      lastPlayedAtByHash: new Map(),
      now: 2000,
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.title).toBe('My Title');
    expect(upserts[0]!.author).toBe('My Author');
    expect(upserts[0]!.progress).toEqual([200, 3600]);
  });

  it('tombstones books whose items vanished from the server, and revives returned ones', () => {
    const gone = reconcileAbsBooks({
      server,
      items: [item('i1', 'A')],
      progress: [],
      library: [],
      lastPlayedAtByHash: new Map(),
      now: 1000,
    }).upserts[0]!;
    const { upserts, tombstoneHashes } = reconcileAbsBooks({
      server,
      items: [],
      progress: [],
      library: [gone],
      lastPlayedAtByHash: new Map(),
      now: 2000,
    });
    expect(upserts).toEqual([]);
    expect(tombstoneHashes).toEqual([gone.hash]);
    // Revive
    const revived = reconcileAbsBooks({
      server,
      items: [item('i1', 'A')],
      progress: [],
      library: [{ ...gone, deletedAt: 2000 }],
      lastPlayedAtByHash: new Map(),
      now: 3000,
    });
    expect(revived.upserts).toHaveLength(1);
    expect(revived.upserts[0]!.deletedAt).toBeNull();
  });

  describe('newest-wins guard on server progress', () => {
    // A paused book whose close-session failed keeps a fresher local position
    // than the server's. Before the guard every 5-minute pass overwrote it —
    // and persisted the overwrite — while `abs-last-played-<hash>` stayed
    // fresh, so resolveResumePosition then trusted the poisoned local cache.
    const played = (progress: [number, number]): Book => ({
      ...reconcileAbsBooks({
        server,
        items: [item('i1', 'P')],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      }).upserts[0]!,
      progress,
    });

    const serverProgress = (currentTime: number, lastUpdate: number) => [
      { libraryItemId: 'i1', currentTime, duration: 3600, isFinished: false, lastUpdate },
    ];

    it('keeps a fresher local position instead of applying the stale server one', () => {
      const local = played([900, 3600]);
      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'P')],
        progress: serverProgress(120, 5000),
        library: [local],
        lastPlayedAtByHash: new Map([[local.hash, 9000]]),
        now: 2000,
      });
      // Nothing else changed either, so the book isn't even re-upserted.
      expect(upserts).toEqual([]);
    });

    it('applies the server position when the server stamp is newer', () => {
      const local = played([900, 3600]);
      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'P')],
        progress: serverProgress(120, 9000),
        library: [local],
        lastPlayedAtByHash: new Map([[local.hash, 5000]]),
        now: 2000,
      });
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.progress).toEqual([120, 3600]);
    });

    it('keeps the local position when the server reports no progress at all', () => {
      const local = played([900, 3600]);
      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'P')],
        progress: [],
        library: [local],
        lastPlayedAtByHash: new Map(),
        now: 2000,
      });
      expect(upserts).toEqual([]);
    });
  });

  it('never touches books from other servers or local books', () => {
    const other: Book = {
      hash: 'x',
      format: 'EPUB',
      title: 'Local',
      author: '',
      createdAt: 1,
      updatedAt: 1,
    };
    const { tombstoneHashes } = reconcileAbsBooks({
      server,
      items: [],
      progress: [],
      library: [other],
      lastPlayedAtByHash: new Map(),
      now: 2,
    });
    expect(tombstoneHashes).toEqual([]);
  });

  describe('cloud sync mirror in metadata', () => {
    // The cloud books row has no column for filePath / duration /
    // absMediaType / episodeCount, and the push strips filePath outright. An
    // ABS stub's identity IS that path, so reconcile mirrors it (and the badge
    // fields) into `metadata`, which does sync.
    it('mirrors the abs:// identity and the badge fields onto a new stub', () => {
      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'Peter Pan')],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      });
      const meta = upserts[0]!.metadata!;
      expect(meta.absSource).toBe(makeAbsFilePath('srv1', 'i1'));
      expect(meta.absDuration).toBe(3600);
      expect(meta.absMediaType).toBeUndefined();
    });

    it('mirrors the episode count on a podcast show stub', () => {
      const { upserts } = reconcileAbsBooks({
        server,
        items: [podcastItem('p1', 'Daily News', 7)],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      });
      const meta = upserts[0]!.metadata!;
      expect(meta.absSource).toBe(makeAbsFilePath('srv1', 'p1'));
      expect(meta.absMediaType).toBe('podcast');
      expect(meta.absEpisodeCount).toBe(7);
    });

    it('backfills the mirror on a legacy row that predates it', () => {
      const legacy = reconcileAbsBooks({
        server,
        items: [item('i1', 'Same')],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      }).upserts[0]!;
      delete legacy.metadata;

      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'Same')],
        progress: [],
        library: [legacy],
        lastPlayedAtByHash: new Map(),
        now: 2000,
      });
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.metadata!.absSource).toBe(makeAbsFilePath('srv1', 'i1'));
    });

    it('keeps a user-edited metadata payload while restoring the mirror', () => {
      const first = reconcileAbsBooks({
        server,
        items: [item('i1', 'Server Title')],
        progress: [],
        library: [],
        lastPlayedAtByHash: new Map(),
        now: 1000,
      }).upserts[0]!;
      // The metadata editor rewrites `metadata` wholesale, so an edit can drop
      // the mirror; the next pass must restore it without losing the edit.
      const edited: Book = {
        ...first,
        title: 'My Title',
        metadataUpdatedAt: 1500,
        metadata: { title: 'My Title', author: 'My Author', language: 'en', publisher: 'Mine' },
      };
      const { upserts } = reconcileAbsBooks({
        server,
        items: [item('i1', 'Server Title')],
        progress: [],
        library: [edited],
        lastPlayedAtByHash: new Map(),
        now: 2000,
      });
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.title).toBe('My Title');
      expect(upserts[0]!.metadata!.publisher).toBe('Mine');
      expect(upserts[0]!.metadata!.absSource).toBe(makeAbsFilePath('srv1', 'i1'));
    });

    it('adopts a row pulled from the cloud instead of duplicating it', () => {
      // What a peer that has the same server configured actually holds after
      // the cloud pull: the same hash (md5 of the abs:// path), filePath and
      // mirrors rebuilt by transformBookFromDB, but no local sync history.
      const pulled: Book = {
        hash: md5(makeAbsFilePath('srv1', 'i1')),
        format: 'ABS',
        filePath: makeAbsFilePath('srv1', 'i1'),
        title: 'Peter Pan',
        author: 'Author A',
        duration: 3600,
        createdAt: 500,
        updatedAt: 500,
        syncedAt: 600,
        metadata: {
          title: 'Peter Pan',
          author: 'Author A',
          language: '',
          absSource: makeAbsFilePath('srv1', 'i1'),
          absDuration: 3600,
        },
      };

      const { upserts, tombstoneHashes } = reconcileAbsBooks({
        server,
        items: [item('i1', 'Peter Pan')],
        progress: [],
        library: [pulled],
        lastPlayedAtByHash: new Map(),
        now: 2000,
      });
      // Identity matched by filePath -> same hash -> nothing to add or remove.
      expect(tombstoneHashes).toEqual([]);
      expect(upserts).toEqual([]);
    });
  });
});
