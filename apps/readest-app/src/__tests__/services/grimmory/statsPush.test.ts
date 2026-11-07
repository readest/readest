import { describe, expect, test, vi } from 'vitest';
import type { PageStatEvent } from '@/types/statistics';
import { GrimmoryRequestError } from '@/services/grimmory/GrimmoryClient';
import type { GrimmoryBookMatch } from '@/services/grimmory/GrimmorySyncStore';
import {
  groupReadingSessions,
  pushStatsToGrimmory,
  SESSION_GAP_SECONDS,
} from '@/services/grimmory/statsPush';
import type { GrimmoryReadingSession, GrimmorySessionPage } from '@/services/grimmory/types';

const T0 = 1_800_000_000;
const ev = (bookMd5: string, startTime: number, page: number, duration = 60): PageStatEvent =>
  ({ bookMd5, startTime, page, duration, totalPages: 100 }) as PageStatEvent;

const match = (bookId: number): GrimmoryBookMatch => ({
  bookId,
  bookFileId: bookId,
  bookType: 'EPUB',
  isPrimary: true,
  statusPushedAt: 0,
});

describe('groupReadingSessions', () => {
  test('joins page visits of a book until a pause longer than the gap', () => {
    const sessions = groupReadingSessions([
      ev('a', T0, 10),
      ev('a', T0 + 60, 11),
      ev('b', T0 + 90, 1),
      ev('a', T0 + 120, 12),
      ev('a', T0 + 180 + SESSION_GAP_SECONDS + 1, 13),
    ]);
    expect(sessions).toEqual([
      {
        bookMd5: 'a',
        startTime: T0,
        endTime: T0 + 180,
        durationSeconds: 180,
        startProgress: 9,
        endProgress: 12,
      },
      expect.objectContaining({ bookMd5: 'b', startTime: T0 + 90 }),
      expect.objectContaining({ bookMd5: 'a', startTime: T0 + 180 + SESSION_GAP_SECONDS + 1 }),
    ]);
  });
});

describe('pushStatsToGrimmory', () => {
  const setup = (events: PageStatEvent[], serverStarts: string[] = []) => {
    const posted: GrimmoryReadingSession[] = [];
    let cursor = 0;
    const db = {
      getCursor: vi.fn(async () => cursor),
      setCursor: vi.fn(async (_key: string, value: number) => {
        cursor = value;
      }),
      getEventsForPush: vi.fn(async (since: number) => ({
        events: events.filter((e) => e.startTime > since),
      })),
    };
    const client = {
      getReadingSessions: vi.fn(
        async (_bookId: number, _page: number): Promise<GrimmorySessionPage> => ({
          content: serverStarts.map((startTime) => ({ startTime })),
        }),
      ),
      recordReadingSession: vi.fn(async (body: GrimmoryReadingSession) => {
        posted.push(body);
      }),
    };
    const store = { getBooks: vi.fn(async () => new Map([['a', match(2)]])) };
    return { db, client, store, posted, cursor: () => cursor };
  };

  test('sends finished sessions of matched books and moves the cursor past them', async () => {
    const { db, client, store, posted, cursor } = setup([
      ev('a', T0, 10),
      ev('a', T0 + 60, 11),
      ev('unmatched', T0 + 90, 1),
    ]);
    await pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 3600 });

    expect(posted).toEqual([
      {
        bookId: 2,
        bookType: 'EPUB',
        startTime: new Date(T0 * 1000).toISOString(),
        endTime: new Date((T0 + 120) * 1000).toISOString(),
        durationSeconds: 120,
        startProgress: 9,
        endProgress: 11,
        progressDelta: 2,
      },
    ]);
    expect(cursor()).toBe(T0 + 90);
  });

  test('holds the open book’s session until it has ended', async () => {
    const events = [ev('a', T0, 10), ev('a', T0 + 60, 11)];
    const { db, client, store, posted, cursor } = setup(events);

    await pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 130, readingHash: 'a' });
    expect(posted).toEqual([]);
    expect(cursor()).toBe(T0 - 1);

    events.push(ev('a', T0 + 120, 12));
    await pushStatsToGrimmory({
      db,
      client,
      store,
      account: 'x',
      now: T0 + 3600,
      readingHash: 'a',
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ durationSeconds: 180, endProgress: 12 });
  });

  test('does not send a session the server already has', async () => {
    const { db, client, store, posted } = setup(
      [ev('a', T0, 10)],
      [new Date(T0 * 1000).toISOString().replace('.000', '')],
    );
    await pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 3600 });
    expect(posted).toEqual([]);
  });

  test('keeps a cursor per account', async () => {
    const cursors = new Map<string, number>();
    const { client, store, posted } = setup([]);
    const db = {
      getCursor: vi.fn(async (key: string) => cursors.get(key) ?? 0),
      setCursor: vi.fn(async (key: string, value: number) => {
        cursors.set(key, value);
      }),
      getEventsForPush: vi.fn(async (since: number) => ({
        events: [ev('a', T0, 10)].filter((e) => e.startTime > since),
      })),
    };
    await pushStatsToGrimmory({ db, client, store, account: 'one', now: T0 + 3600 });
    await pushStatsToGrimmory({ db, client, store, account: 'two', now: T0 + 3600 });
    expect(posted).toHaveLength(2);
  });

  test('two pushes at once for one account send each session once', async () => {
    const { db, client, store, posted } = setup([ev('a', T0, 10)]);
    const serverStarts: string[] = [];
    client.getReadingSessions.mockImplementation(async () => ({
      content: serverStarts.map((startTime) => ({ startTime })),
    }));
    client.recordReadingSession.mockImplementation(async (body: GrimmoryReadingSession) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      posted.push(body);
      serverStarts.push(body.startTime);
    });
    await Promise.all([
      pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 3600 }),
      pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 3600 }),
    ]);
    expect(posted).toHaveLength(1);
  });

  test('looks past the first page of server sessions before sending', async () => {
    // A failed push already sent the oldest 140 of these 150 sessions.
    const events = Array.from({ length: 150 }, (_, i) => ev('a', T0 + i * 1000, 10));
    const iso = (e: PageStatEvent) => new Date(e.startTime * 1000).toISOString();
    const { db, client, store, posted } = setup(events);
    // Newest first, 100 a page, as Grimmory v3.5.0 pages them.
    const serverStarts = events.slice(0, 140).map(iso).reverse();
    client.getReadingSessions.mockImplementation(async (_bookId: number, page: number) => ({
      content: serverStarts.slice(page * 100, page * 100 + 100).map((startTime) => ({ startTime })),
      page: { number: page, totalPages: Math.ceil(serverStarts.length / 100) },
    }));
    await pushStatsToGrimmory({ db, client, store, account: 'x', now: T0 + 1_000_000 });
    expect(posted.map((s) => s.startTime)).toEqual(events.slice(140).map(iso));
  });

  test('keeps the cursor when a send fails, and skips a book deleted from the server', async () => {
    const failing = setup([ev('a', T0, 10)]);
    failing.client.recordReadingSession.mockRejectedValueOnce(new GrimmoryRequestError(500, 'x'));
    await expect(
      pushStatsToGrimmory({ ...failing, account: 'x', now: T0 + 3600 }),
    ).rejects.toThrow();
    expect(failing.cursor()).toBe(0);

    const gone = setup([ev('a', T0, 10)]);
    gone.client.getReadingSessions.mockRejectedValueOnce(new GrimmoryRequestError(404, 'gone'));
    await pushStatsToGrimmory({ ...gone, account: 'x', now: T0 + 3600 });
    expect(gone.cursor()).toBe(T0);
  });
});
