import { describe, expect, test, vi } from 'vitest';
import type { PageStatEvent } from '@/types/statistics';
import { GrimmoryRequestError } from '@/services/grimmory/GrimmoryClient';
import type { GrimmoryBookMatch } from '@/services/grimmory/GrimmorySyncStore';
import {
  groupReadingSessions,
  pushStatsToGrimmory,
  SESSION_GAP_SECONDS,
} from '@/services/grimmory/statsPush';
import type { GrimmoryReadingSession } from '@/services/grimmory/types';

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
      getReadingSessions: vi.fn(async () => ({
        content: serverStarts.map((startTime) => ({ startTime })),
      })),
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
