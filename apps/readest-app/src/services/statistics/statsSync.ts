import type { StatisticsDb } from './statisticsDb';
import type { SyncClient, StatPageRecord, StatBookRecord } from '@/libs/sync';
import type { PageStatEvent, StatBook } from '@/types/statistics';

type PushClient = Pick<SyncClient, 'pushChanges'>;
type PullClient = Pick<SyncClient, 'pullChanges'>;

const toWirePage = (e: PageStatEvent): StatPageRecord => ({
  book_hash: e.bookMd5,
  page: e.page,
  start_time: e.startTime,
  duration: e.duration,
  total_pages: e.totalPages,
});

const toWireBook = (b: StatBook): StatBookRecord => ({
  book_hash: b.bookMd5,
  title: b.title,
  authors: b.authors,
});

const updatedAtUs = (record: {
  updated_at_us?: number;
  updated_at_ms?: number;
  updated_at?: string;
}): number => {
  if (typeof record.updated_at_us === 'number' && Number.isSafeInteger(record.updated_at_us)) {
    return record.updated_at_us;
  }
  if (record.updated_at) {
    const parsedMs = Date.parse(record.updated_at);
    if (Number.isFinite(parsedMs)) {
      const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/.exec(record.updated_at)?.[1] ?? '';
      return Math.floor(parsedMs / 1000) * 1_000_000 + Number(fraction.padEnd(6, '0').slice(0, 6));
    }
  }
  if (typeof record.updated_at_ms === 'number' && Number.isFinite(record.updated_at_ms)) {
    return Math.trunc(record.updated_at_ms) * 1000;
  }
  return 0;
};

/** Events per push request — bounds request size for a large offline backlog. */
const PUSH_CHUNK = 500;
/** Page events per pull request — bounds the receiving device's memory. */
const PULL_PAGE = 1000;

/**
 * Push local events at or newer than the push cursor, in bounded chunks. The
 * cursor advances per successful chunk, so an interrupted push (e.g. a
 * 1000-event backlog over flaky network) resumes from the last chunk rather
 * than restarting; replaying the boundary second is idempotent.
 */
export async function pushStats(stats: StatisticsDb, client: PushClient): Promise<void> {
  const cursor = await stats.getCursor('push');
  const { events, books } = await stats.getEventsForPush(cursor, 'push');
  if (events.length === 0) return;
  const bookByHash = new Map(books.map((b) => [b.bookMd5, b]));
  let i = 0;
  while (i < events.length) {
    let end = Math.min(i + PUSH_CHUNK, events.length);
    // Never split a start_time across chunks — advancing the push cursor past it
    // would drop the remaining same-second events (e.g. split-view) on resume.
    const lastStart = events[end - 1]!.startTime;
    while (end < events.length && events[end]!.startTime === lastStart) end++;
    const chunk = events.slice(i, end);
    const seen = new Set<string>();
    const chunkBooks: StatBookRecord[] = [];
    for (const e of chunk) {
      if (seen.has(e.bookMd5)) continue;
      seen.add(e.bookMd5);
      const b = bookByHash.get(e.bookMd5);
      if (b) chunkBooks.push(toWireBook(b));
    }
    await client.pushChanges({ statBooks: chunkBooks, statPages: chunk.map(toWirePage) });
    await stats.setCursor('push', chunk[chunk.length - 1]!.startTime);
    await stats.markEventsPushed('push', chunk);
    i = end;
  }
}

/**
 * Pull events since the pull cursor in bounded pages, applying each before
 * fetching the next so memory stays flat and a fresh-device backfill is
 * resumable (the cursor persists between pages). The durable cursor is epoch
 * microseconds; old millisecond cursors are upgraded on first use so rows that
 * share one millisecond cannot be skipped.
 */
export async function pullStats(stats: StatisticsDb, client: PullClient): Promise<void> {
  for (;;) {
    const preciseCursor = await stats.getCursor('pull-us');
    const legacyCursor = preciseCursor > 0 ? 0 : await stats.getCursor('pull');
    const migratingLegacyCursor = preciseCursor === 0 && legacyCursor > 0;
    // Replay one millisecond on the first precise pull. A legacy millisecond
    // cursor may have stopped after a page boundary inside that millisecond.
    const sinceUs =
      preciseCursor > 0
        ? preciseCursor
        : Math.max(0, legacyCursor * 1000 - (migratingLegacyCursor ? 1000 : 0));
    const res = await client.pullChanges(
      sinceUs / 1000,
      'stats',
      undefined,
      undefined,
      PULL_PAGE,
      sinceUs,
    );
    const wireBooks = (res.statBooks ?? []) as StatBookRecord[];
    const wirePages = (res.statPages ?? []) as StatPageRecord[];
    if (wireBooks.length === 0 && wirePages.length === 0) break;
    const books: StatBook[] = wireBooks.map((b) => ({
      bookMd5: b.book_hash,
      title: b.title,
      authors: b.authors,
    }));
    const events: PageStatEvent[] = wirePages.map((p) => ({
      bookMd5: p.book_hash,
      page: p.page,
      startTime: p.start_time,
      duration: p.duration,
      totalPages: p.total_pages,
    }));
    await stats.applyRemoteEvents(books, events);
    // When page rows are present, advance only from those rows. The API returns
    // all books but pages are paged, so a newer book timestamp must not skip
    // page rows that are still waiting in a later page. A books-only response
    // can advance from metadata because the next request confirms exhaustion.
    const recordsForCursor = wirePages.length > 0 ? wirePages : wireBooks;
    const newestUs = recordsForCursor.reduce(
      (m, record) => Math.max(m, updatedAtUs(record)),
      sinceUs,
    );
    if (newestUs <= sinceUs) break;
    await stats.setCursor('pull-us', newestUs);
    await stats.setCursor('pull', newestUs);
  }
}
