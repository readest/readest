import { describe, expect, it, vi } from 'vitest';
import { formatKoDatetime } from '@/services/bookorbit/noteMapping';
import { runBookOrbitNotesPass, type NotesPassDeps } from '@/services/bookorbit/notesPass';
import type { BookmarkExchangeResponse, ExchangeResponse } from '@/services/bookorbit/types';
import type { BookNote } from '@/types/book';

const HASH = 'd'.repeat(32);
const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

const makeNote = (overrides: Partial<BookNote>): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/8!/4/2/1:0)',
  xpointer0: '/body/DocFragment[4]/body/p[1]/text().0',
  text: 'quote',
  style: 'highlight',
  note: '',
  createdAt: Date.UTC(2026, 7, 1),
  updatedAt: Date.UTC(2026, 7, 1),
  ...overrides,
});

const emptyExchangeResponse = (): ExchangeResponse => ({
  results: [
    {
      hash: HASH,
      bookId: 1,
      toApply: { add: [], edit: [], delete: [] },
      more: false,
      skippedNoPosition: 0,
    },
  ],
  unmatched: [],
});

const emptyBookmarkResponse = (): BookmarkExchangeResponse => ({
  results: [{ hash: HASH, bookId: 1, toApply: { add: [], delete: [] }, more: false }],
  unmatched: [],
});

type FakeStore = NotesPassDeps['store'];

const makeStore = (): FakeStore & {
  identities: Map<string, { datetime: string; serverId: number | null }>;
  watermarks: Record<string, number>;
  flushed: number;
} => {
  const identities = new Map<string, { datetime: string; serverId: number | null }>();
  const watermarks: Record<string, number> = { annotations: 0, bookmarks: 0 };
  const store = {
    identities,
    watermarks,
    flushed: 0,
    getIdentities: vi.fn(async () => new Map(identities)),
    setIdentity: vi.fn(
      async (_hash: string, noteId: string, id: { datetime: string; serverId: number | null }) => {
        identities.set(noteId, id);
      },
    ),
    getWatermark: vi.fn(async (_hash: string, kind: 'annotations' | 'bookmarks') => {
      return watermarks[kind]!;
    }),
    setWatermark: vi.fn(async (_hash: string, kind: 'annotations' | 'bookmarks', value: number) => {
      watermarks[kind] = value;
    }),
    flush: vi.fn(async () => {
      store.flushed += 1;
    }),
  };
  return store;
};

const makeDeps = (overrides: Partial<NotesPassDeps> = {}): NotesPassDeps => ({
  client: {
    getVersion: vi.fn(async () => ({
      pluginVersion: '1',
      serverVersion: '1',
      capabilities: [] as string[],
    })),
    matchCheck: vi.fn(async () => ({
      matches: [{ hash: HASH, bookId: 1, bookFileId: 1 }],
      libraryVersion: 'v1',
    })),
    exchangeAnnotations: vi.fn(async () => emptyExchangeResponse()),
    ackAnnotations: vi.fn(async () => undefined),
    exchangeBookmarks: vi.fn(async () => emptyBookmarkResponse()),
    ackBookmarks: vi.fn(async () => undefined),
    uploadBookStates: vi.fn(async () => undefined),
  },
  store: makeStore(),
  book: { hash: HASH, title: 'A Book', author: 'An Author' },
  getNotes: () => [makeNote({})],
  mergeNotes: vi.fn(),
  resolvePosition: async () => ({ cfi: 'epubcfi(/6/10!/4/2/1:0)', verified: true }),
  populateXPointers: vi.fn(async (notes: BookNote[]) => notes),
  syncBookStates: false,
  now: () => NOW,
  onUnmatched: vi.fn(),
  ...overrides,
});

describe('runBookOrbitNotesPass', () => {
  it('skips the exchange and hints when the book is unmatched', async () => {
    const deps = makeDeps();
    (deps.client.matchCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [],
      libraryVersion: 'v1',
    });
    await runBookOrbitNotesPass(deps);
    expect(deps.onUnmatched).toHaveBeenCalledTimes(1);
    expect(deps.client.exchangeAnnotations).not.toHaveBeenCalled();
  });

  it('populates missing xpointers before exchanging and advances the watermark', async () => {
    const withPointer = makeNote({ id: 'ok' });
    const withoutPointer = makeNote({ id: 'needs', xpointer0: undefined });
    const enriched = { ...withoutPointer, xpointer0: '/body/DocFragment[4]/body/p[9]/text().0' };
    const deps = makeDeps({
      getNotes: () => [withPointer, withoutPointer],
      populateXPointers: vi.fn(async () => [enriched]),
    });

    await runBookOrbitNotesPass(deps);

    expect(deps.populateXPointers).toHaveBeenCalledWith([withoutPointer]);
    expect(deps.mergeNotes).toHaveBeenCalledWith([enriched], []);
    const exchangeMock = deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>;
    expect(exchangeMock).toHaveBeenCalledTimes(1);
    const books = exchangeMock.mock.calls[0]![0];
    expect(books[0].keys).toHaveLength(2);
    expect(books[0].keysComplete).toBe(true);
    expect(deps.store.setWatermark).toHaveBeenCalledWith(HASH, 'annotations', NOW);
    expect(deps.store.flush).toHaveBeenCalled();
    // Nothing pushed down and nothing applied — no ack round needed.
    expect(deps.client.ackAnnotations).not.toHaveBeenCalled();
  });

  it('chunks more than 50 changes and drops keys from follow-up requests', async () => {
    const notes = Array.from({ length: 51 }, (_, i) =>
      makeNote({
        id: `n${i}`,
        xpointer0: `/body/DocFragment[4]/body/p[${i + 1}]/text().0`,
        createdAt: Date.UTC(2026, 7, 3),
        updatedAt: Date.UTC(2026, 7, 3),
      }),
    );
    const deps = makeDeps({ getNotes: () => notes });
    await runBookOrbitNotesPass(deps);

    const exchangeMock = deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>;
    expect(exchangeMock).toHaveBeenCalledTimes(2);
    const first = exchangeMock.mock.calls[0]![0][0];
    const second = exchangeMock.mock.calls[1]![0][0];
    expect(first.changes).toHaveLength(50);
    expect(first.keysComplete).toBe(true);
    expect(second.changes).toHaveLength(1);
    expect(second.keys).toHaveLength(0);
    expect(second.keysComplete).toBe(false);
  });

  it('keeps exchanging while the server reports more push-down pages', async () => {
    const deps = makeDeps();
    const exchangeMock = deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>;
    const moreResponse = emptyExchangeResponse();
    moreResponse.results[0]!.more = true;
    exchangeMock.mockResolvedValueOnce(moreResponse);
    exchangeMock.mockResolvedValueOnce(emptyExchangeResponse());

    await runBookOrbitNotesPass(deps);
    expect(exchangeMock).toHaveBeenCalledTimes(2);
    const followUp = exchangeMock.mock.calls[1]![0][0];
    expect(followUp.changes).toHaveLength(0);
    expect(followUp.keysComplete).toBe(false);
  });

  it('applies pushed-down adds, acks them, and persists identities', async () => {
    const deps = makeDeps();
    const response = emptyExchangeResponse();
    response.results[0]!.toApply.add = [
      {
        serverId: 12,
        version: 1,
        datetime: '2026-08-02 09:00:00',
        datetimeUpdated: null,
        drawer: 'lighten',
        color: 'yellow',
        text: 'from server',
        note: null,
        chapter: null,
        posFormat: 'xpointer',
        pos0: '/body/DocFragment[7]/body/p[1]/text().0',
        pos1: null,
        pageno: null,
      },
    ];
    (deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue(response);

    await runBookOrbitNotesPass(deps);

    const merged = (deps.mergeNotes as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as BookNote[]).length > 0,
    );
    expect(merged?.[0][0]).toMatchObject({ text: 'from server', type: 'annotation' });
    const ackMock = deps.client.ackAnnotations as ReturnType<typeof vi.fn>;
    expect(ackMock).toHaveBeenCalledTimes(1);
    expect(ackMock.mock.calls[0]![0][0].applied[0]).toMatchObject({
      serverId: 12,
      status: 'applied',
    });
    expect(deps.store.setIdentity).toHaveBeenCalledWith(HASH, expect.any(String), {
      datetime: '2026-08-02 09:00:00',
      serverId: 12,
    });
  });

  it('does not advance the watermark when the exchange fails', async () => {
    const deps = makeDeps();
    (deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    );
    await expect(runBookOrbitNotesPass(deps)).rejects.toThrow('network down');
    expect(deps.store.setWatermark).not.toHaveBeenCalled();
  });

  it('exchanges bookmarks only when the server advertises bookmarkSync', async () => {
    const withoutCap = makeDeps({
      getNotes: () => [makeNote({ id: 'bm', type: 'bookmark' })],
    });
    await runBookOrbitNotesPass(withoutCap);
    expect(withoutCap.client.exchangeBookmarks).not.toHaveBeenCalled();

    const withCap = makeDeps({
      getNotes: () => [makeNote({ id: 'bm', type: 'bookmark' })],
    });
    (withCap.client.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      pluginVersion: '1',
      serverVersion: '1',
      capabilities: ['bookmarkSync'],
    });
    await runBookOrbitNotesPass(withCap);
    expect(withCap.client.exchangeBookmarks).toHaveBeenCalledTimes(1);
    expect(withCap.store.setWatermark).toHaveBeenCalledWith(HASH, 'bookmarks', NOW);
  });

  it('pushes the mapped reading status when enabled', async () => {
    const deps = makeDeps({
      syncBookStates: true,
      book: {
        hash: HASH,
        title: 'A Book',
        readingStatus: 'finished',
        readingStatusUpdatedAt: Date.UTC(2026, 7, 4, 6, 0, 0),
      },
    });
    await runBookOrbitNotesPass(deps);
    expect(deps.client.uploadBookStates).toHaveBeenCalledWith([
      { hash: HASH, status: 'complete', statusModified: '2026-08-04' },
    ]);

    const unread = makeDeps({
      syncBookStates: true,
      book: { hash: HASH, title: 'A Book', readingStatus: 'unread' },
    });
    await runBookOrbitNotesPass(unread);
    expect(unread.client.uploadBookStates).not.toHaveBeenCalled();
  });

  it('uses stored identities for remote-born notes when building keys', async () => {
    const remoteBorn = makeNote({ id: 'remote', createdAt: Date.UTC(2026, 7, 1, 5, 0, 0) });
    const deps = makeDeps({ getNotes: () => [remoteBorn] });
    const stored = { datetime: '2026-07-30 01:02:03', serverId: 44 };
    (deps.store.getIdentities as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([['remote', stored]]),
    );

    await runBookOrbitNotesPass(deps);
    const exchangeMock = deps.client.exchangeAnnotations as ReturnType<typeof vi.fn>;
    const request = exchangeMock.mock.calls[0]![0][0];
    expect(request.keys[0].dt).toBe('2026-07-30 01:02:03');
    expect(request.keys[0].dt).not.toBe(formatKoDatetime(remoteBorn.createdAt));
  });
});
