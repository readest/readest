import { describe, expect, it, vi } from 'vitest';
import { pushStatsToBookOrbit } from '@/services/bookorbit/statsPush';
import type { PageStatsBookWire } from '@/services/bookorbit/types';
import type { PageStatEvent } from '@/types/statistics';

const makeEvent = (overrides: Partial<PageStatEvent>): PageStatEvent => ({
  bookMd5: 'h1',
  page: 1,
  startTime: 1000,
  duration: 30,
  totalPages: 100,
  ...overrides,
});

const makeStats = (events: PageStatEvent[], cursor = 0) => {
  const cursors: Record<string, number> = { 'bookorbit-push': cursor };
  return {
    cursors,
    getCursor: vi.fn(async (key: string) => cursors[key] ?? 0),
    setCursor: vi.fn(async (key: string, value: number) => {
      cursors[key] = value;
    }),
    getEventsForPush: vi.fn(async (since: number) => ({
      events: events.filter((event) => event.startTime > since),
      books: [],
    })),
  };
};

describe('pushStatsToBookOrbit', () => {
  it('groups events by book hash and advances the cursor on success', async () => {
    const events = [
      makeEvent({ bookMd5: 'aaa', startTime: 1000, page: 1 }),
      makeEvent({ bookMd5: 'bbb', startTime: 1500, page: 5, duration: 45 }),
      makeEvent({ bookMd5: 'aaa', startTime: 2000, page: 2 }),
    ];
    const stats = makeStats(events);
    const uploaded: PageStatsBookWire[][] = [];
    const client = {
      uploadPageStats: vi.fn(async (books: PageStatsBookWire[]) => {
        uploaded.push(books);
      }),
    };

    await pushStatsToBookOrbit(stats, client);

    expect(uploaded).toHaveLength(1);
    const books = uploaded[0]!;
    expect(books.map((b) => b.hash).sort()).toEqual(['aaa', 'bbb']);
    const aaa = books.find((b) => b.hash === 'aaa')!;
    expect(aaa.events).toEqual([
      { page: 1, startTime: 1000, durationSeconds: 30, totalPages: 100 },
      { page: 2, startTime: 2000, durationSeconds: 30, totalPages: 100 },
    ]);
    expect(stats.cursors['bookorbit-push']).toBe(2000);
  });

  it('does nothing when there are no new events', async () => {
    const stats = makeStats([makeEvent({ startTime: 500 })], 1000);
    const client = { uploadPageStats: vi.fn(async () => undefined) };
    await pushStatsToBookOrbit(stats, client);
    expect(client.uploadPageStats).not.toHaveBeenCalled();
    expect(stats.setCursor).not.toHaveBeenCalled();
  });

  it('drops events the server would reject', async () => {
    const events = [
      makeEvent({ startTime: 0 }),
      makeEvent({ startTime: 1200, totalPages: 0 }),
      makeEvent({ startTime: 1300 }),
    ];
    const stats = makeStats(events);
    const uploaded: PageStatsBookWire[][] = [];
    const client = {
      uploadPageStats: vi.fn(async (books: PageStatsBookWire[]) => {
        uploaded.push(books);
      }),
    };

    await pushStatsToBookOrbit(stats, client);
    expect(uploaded[0]![0]!.events).toEqual([
      { page: 1, startTime: 1300, durationSeconds: 30, totalPages: 100 },
    ]);
  });

  it('chunks by 50 distinct books without splitting a startTime and stops on failure', async () => {
    const events = [
      // 50 distinct hashes at t=1000..1049.
      ...Array.from({ length: 50 }, (_, i) =>
        makeEvent({ bookMd5: `book-${i}`, startTime: 1000 + i }),
      ),
      // A same-second pair straddling the boundary book: hash 51 at the same
      // startTime as the last event of the first 50 must stay in chunk one.
      makeEvent({ bookMd5: 'book-49', startTime: 1050 }),
      makeEvent({ bookMd5: 'book-50', startTime: 2000 }),
      makeEvent({ bookMd5: 'book-51', startTime: 2100 }),
    ];
    const stats = makeStats(events);
    const calls: PageStatsBookWire[][] = [];
    const client = {
      uploadPageStats: vi.fn(async (books: PageStatsBookWire[]) => {
        calls.push(books);
        if (calls.length === 2) throw new Error('server down');
      }),
    };

    await expect(pushStatsToBookOrbit(stats, client)).rejects.toThrow('server down');

    expect(calls).toHaveLength(2);
    expect(calls[0]!).toHaveLength(50);
    // Cursor sits at the end of the first successful chunk only.
    expect(stats.cursors['bookorbit-push']).toBe(1050);
  });
});
