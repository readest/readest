import { describe, expect, it, vi, beforeEach } from 'vitest';

// #6224: replaying an OPDS audiobook must work more than once. The session
// manager hands back the last session for a book hash without checking whether
// its controller has already terminated, so reusing it blindly gave the player
// a dead controller and the route bounced straight back out.
const h = vi.hoisted(() => ({
  session: null as { bookKey: string; controller: { kind: string; terminated: boolean } } | null,
  claimed: [] as string[],
  startAt: -1,
  durations: null as number[] | null,
  library: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getSessionByHash: () => h.session,
    claim: (bookKey: string) => h.claimed.push(bookKey),
  },
}));

vi.mock('@/services/opds/audioStream', () => ({
  resolveOpdsAudioAuth: async () => ({
    authHeader: null,
    customHeaders: {},
    hasCredentials: false,
  }),
  canStreamOpdsAudio: () => true,
  buildOpdsAudioUrl: (href: string) => href,
  fetchOpdsAudioBlob: async () => new Blob(),
  opdsAudioBlocker: () => null,
  needsAudioAuth: () => false,
  probeAudioDurations: async (urls: string[]) => urls.map((_, i) => h.durations?.[i] ?? 20),
}));

vi.mock('@/services/audiobook/AudiobookClock', () => ({ HtmlAudioClock: class {} }));
vi.mock('@/services/audiobook/AudiobookController', () => ({
  AudiobookController: class {
    kind = 'audiobook';
    terminated = false;
    constructor(source: { startAt: number }) {
      h.startAt = source.startAt;
    }
    getCurrentChapter() {
      return null;
    }
  },
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: h.library,
      setLibrary: (next: unknown[]) => {
        h.library = next as typeof h.library;
      },
    }),
  },
}));

const { openOpdsAudiobookSession } = await import('@/services/opds/openOpdsAudiobook');
const { makeOpdsAudioFilePath } = await import('@/services/opds/audiobook');

const makeBook = (progress?: [number, number]) => ({
  ...(book as unknown as Record<string, unknown>),
  ...(progress ? { progress } : {}),
});

const book = {
  hash: 'h1',
  format: 'OPDSAUDIO' as const,
  title: 'T',
  author: 'A',
  filePath: makeOpdsAudioFilePath({
    catalogId: 'c',
    title: 'T',
    author: 'A',
    tracks: [{ href: 'http://x/1.mp3', mimeType: 'audio/mpeg' }],
  }),
} as never;

const appService = { saveLibraryBooks: vi.fn() } as never;

beforeEach(() => {
  h.session = null;
  h.claimed = [];
  h.durations = null;
});

describe('openOpdsAudiobookSession session reuse', () => {
  it('reuses a live session for the same book', async () => {
    const live = { kind: 'audiobook', terminated: false };
    h.session = { bookKey: 'existing-key', controller: live };

    const res = await openOpdsAudiobookSession({ appService, book });

    expect(res?.bookKey).toBe('existing-key');
    expect(h.claimed).toHaveLength(0);
  });

  it('opens a fresh session when the previous one has terminated', async () => {
    const dead = { kind: 'audiobook', terminated: true };
    h.session = { bookKey: 'dead-key', controller: dead };

    const res = await openOpdsAudiobookSession({ appService, book });

    expect(res).not.toBeNull();
    expect(res?.bookKey).not.toBe('dead-key');
    expect(h.claimed).toHaveLength(1);
  });
});

// A book saved at its end is finished. Resuming there starts the clock past the
// last track, the session ends instantly, and PlayerView#onGoBack bounces the
// route straight back out -- so a finished OPDS audiobook could never be
// replayed (#6224).
describe('resume position', () => {
  it('resumes mid-book from the saved position', async () => {
    await openOpdsAudiobookSession({ appService, book: makeBook([13, 60]) as never });
    expect(h.startAt).toBe(13);
  });

  it('replays from the start when the book was finished', async () => {
    await openOpdsAudiobookSession({ appService, book: makeBook([60, 60]) as never });
    expect(h.startAt).toBe(0);
  });

  it('starts at zero when there is no saved progress', async () => {
    await openOpdsAudiobookSession({ appService, book: makeBook() as never });
    expect(h.startAt).toBe(0);
  });
});

// The shelf renders an audiobook's length from `book.duration` (BookItem), not
// from progress[1]. A stub created before the tracks were known has none, so
// once playback wrote a position the row read "-0:00" while the player showed
// the real remaining time.
describe('library duration', () => {
  it('records the book length on the library row when the session opens', async () => {
    h.library = [{ hash: 'h1', title: 'T' }];

    await openOpdsAudiobookSession({ appService, book });

    expect(h.library[0]!['duration']).toBe(20);
  });
});

// Dropping an unprobeable track closes the gap and shifts every later track
// earlier, so the book would play a chapter short with every seek and saved
// position landing in the wrong place. Refuse rather than do that quietly.
describe('incomplete timeline', () => {
  const twoTrackBook = {
    ...(book as unknown as Record<string, unknown>),
    filePath: makeOpdsAudioFilePath({
      catalogId: 'c',
      title: 'T',
      author: 'A',
      tracks: [
        { href: 'http://x/1.mp3', mimeType: 'audio/mpeg' },
        { href: 'http://x/2.mp3', mimeType: 'audio/mpeg' },
      ],
    }),
  } as never;

  it('refuses to open when a track duration could not be read', async () => {
    // The first track probes, the second does not: exactly the case that used
    // to produce a silently shortened book.
    h.durations = [20, NaN];

    await expect(openOpdsAudiobookSession({ appService, book: twoTrackBook })).rejects.toThrow(
      /incomplete/,
    );
  });
});
