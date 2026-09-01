import type { PageStatEvent, StatBook } from '@/types/statistics';
import type { PageStatsBookWire } from './types';

/** Books per page-stats request — the server rejects more than 50. */
const MAX_BOOKS_PER_REQUEST = 50;
/** Events per page-stats request — the server rejects more than 500 in total. */
const MAX_EVENTS_PER_REQUEST = 500;

export interface StatsPushDb {
  getCursor(key: 'bookorbit-push'): Promise<number>;
  setCursor(key: 'bookorbit-push', value: number): Promise<void>;
  getEventsForPush(sinceStartTime: number): Promise<{ events: PageStatEvent[]; books: StatBook[] }>;
}

export interface StatsPushClient {
  uploadPageStats(books: PageStatsBookWire[]): Promise<void>;
}

const toWireBooks = (events: PageStatEvent[]): PageStatsBookWire[] => {
  const byHash = new Map<string, PageStatsBookWire>();
  for (const event of events) {
    let book = byHash.get(event.bookMd5);
    if (!book) {
      book = { hash: event.bookMd5, events: [] };
      byHash.set(event.bookMd5, book);
    }
    book.events.push({
      page: event.page,
      startTime: event.startTime,
      durationSeconds: event.duration,
      totalPages: event.totalPages,
    });
  }
  return Array.from(byHash.values());
};

/**
 * Pushes page-stat events newer than the bookorbit cursor, chunked to at most
 * 50 distinct books and 500 events per request. The cursor advances after each
 * successful chunk that completes a startTime, so an interrupted push resumes
 * without dropping same-second events. Mirrors pushStats in statsSync.ts.
 */
export const pushStatsToBookOrbit = async (
  stats: StatsPushDb,
  client: StatsPushClient,
): Promise<void> => {
  const cursor = await stats.getCursor('bookorbit-push');
  const { events: rawEvents } = await stats.getEventsForPush(cursor);
  // The server validates startTime >= 1 and totalPages >= 1; dropping the
  // stragglers locally keeps one bad row from failing a whole chunk.
  const events = rawEvents.filter((event) => event.startTime >= 1 && event.totalPages >= 1);
  if (events.length === 0) return;

  let i = 0;
  while (i < events.length) {
    const hashes = new Set<string>();
    let end = i;
    while (end < events.length && end - i < MAX_EVENTS_PER_REQUEST) {
      const event = events[end]!;
      if (!hashes.has(event.bookMd5) && hashes.size === MAX_BOOKS_PER_REQUEST) {
        break;
      }
      hashes.add(event.bookMd5);
      end++;
    }

    // Prefer moving a whole startTime group to the next request. If the group
    // itself exceeds either server limit, make progress with a bounded slice
    // but withhold the cursor until the final slice succeeds. A failed later
    // slice then retries the group instead of silently dropping its tail;
    // BookOrbit deduplicates the already accepted events.
    if (end < events.length && events[end - 1]!.startTime === events[end]!.startTime) {
      const splitStartTime = events[end]!.startTime;
      let groupStart = end - 1;
      while (groupStart > i && events[groupStart - 1]!.startTime === splitStartTime) {
        groupStart--;
      }
      if (groupStart > i) end = groupStart;
    }

    const chunk = events.slice(i, end);
    await client.uploadPageStats(toWireBooks(chunk));
    const lastStartTime = chunk[chunk.length - 1]!.startTime;
    if (end === events.length || events[end]!.startTime !== lastStartTime) {
      await stats.setCursor('bookorbit-push', lastStartTime);
    }
    i = end;
  }
};
