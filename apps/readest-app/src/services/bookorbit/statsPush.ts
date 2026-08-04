import type { PageStatEvent, StatBook } from '@/types/statistics';
import type { PageStatsBookWire } from './types';

/** Books per page-stats request — the server rejects more than 50. */
const MAX_BOOKS_PER_REQUEST = 50;

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
 * 50 distinct books per request. The cursor advances per successful chunk and
 * a chunk never splits a startTime, so an interrupted push resumes without
 * dropping same-second events. Mirrors pushStats in statsSync.ts.
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
    while (end < events.length) {
      const event = events[end]!;
      if (!hashes.has(event.bookMd5) && hashes.size === MAX_BOOKS_PER_REQUEST) {
        // A 51st book only starts a new chunk on a fresh startTime; a
        // same-second event stays with its second so the cursor never
        // splits it.
        if (end > i && events[end - 1]!.startTime === event.startTime) {
          hashes.add(event.bookMd5);
          end++;
          continue;
        }
        break;
      }
      hashes.add(event.bookMd5);
      end++;
    }
    const chunk = events.slice(i, end);
    await client.uploadPageStats(toWireBooks(chunk));
    await stats.setCursor('bookorbit-push', chunk[chunk.length - 1]!.startTime);
    i = end;
  }
};
