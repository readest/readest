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

/** Events per push request — bounds request size for a large offline backlog. */
const PUSH_CHUNK = 500;
/** Page events per pull request — bounds the receiving device's memory. */
const PULL_PAGE = 1000;

/**
 * Push local events newer than the push cursor, in bounded chunks. The cursor
 * advances per successful chunk, so an interrupted push (e.g. a 1000-event
 * backlog over flaky network) resumes from the last chunk rather than restarting.
 */
export async function pushStats(stats: StatisticsDb, client: PushClient): Promise<void> {
  const cursor = await stats.getCursor('push');
  const { events, books } = await stats.getEventsForPush(cursor);
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
    i = end;
  }
}

/**
 * Pull events since the pull cursor in bounded pages, applying each before
 * fetching the next so memory stays flat and a fresh-device backfill is
 * resumable (the cursor persists between pages). The server completes the
 * trailing millisecond of each page, so a strict `> cursor` next pull never
 * skips rows that share an `updated_at`.
 */
export async function pullStats(stats: StatisticsDb, client: PullClient): Promise<void> {
  for (;;) {
    const since = await stats.getCursor('pull');
    const res = await client.pullChanges(since, 'stats', undefined, undefined, PULL_PAGE);
    const wireBooks = (res.statBooks ?? []) as StatBookRecord[];
    const wirePages = (res.statPages ?? []) as StatPageRecord[];
    if (wireBooks.length === 0 && wirePages.length === 0) break;
    const books: StatBook[] = wireBooks.map((b) => ({
      bookMd5: b.book_hash,
      title: b.title,
      authors: b.authors,
      // Events are whole seconds: one that started before the deletion's
      // millisecond started before its next whole second.
      ...(b.deleted_at_ms ? { deletedAt: Math.ceil(b.deleted_at_ms / 1000) } : {}),
    }));
    // Events of a deleted book come flagged (#7494): skip them, but still count
    // them for the cursor below.
    const events: PageStatEvent[] = wirePages
      .filter((p) => !p.deleted_at_ms)
      .map((p) => ({
        bookMd5: p.book_hash,
        page: p.page,
        startTime: p.start_time,
        duration: p.duration,
        totalPages: p.total_pages,
      }));
    await stats.applyRemoteEvents(books, events);
    // Advance the cursor to the newest page-event updated_at_ms. Stop when a
    // page yields no further page-event progress (covers the empty-pages and
    // the all-books-no-pages cases, and guards against a stalled cursor).
    const newest = wirePages.reduce((m, p) => Math.max(m, p.updated_at_ms ?? 0), since);
    if (newest <= since) break;
    await stats.setCursor('pull', newest);
  }
}

/**
 * Delete books' reading statistics (#7494). With a sync client the server
 * records the deletions first, in one request, so every device drops the
 * books' events on its next pull; if that fails, nothing is deleted here either.
 */
export async function deleteBookStats(
  stats: StatisticsDb,
  client: PushClient | null,
  books: StatBook[],
): Promise<void> {
  if (client) await pushDeletions(client, books);
  for (const book of books) await stats.deleteBook(book.bookMd5);
}

const pushDeletions = (client: PushClient, books: StatBook[]) =>
  client.pushChanges({
    statBooks: books.map((b) => ({ ...toWireBook(b), deleted_at: new Date().toISOString() })),
  });

/**
 * Merge entries of the same book (#7494): every event of each source becomes
 * an event of `target`, and the sources are deleted. With a sync client this
 * device first pulls, so it holds every event of the sources, then pushes them
 * under `target` and only then deletes the sources on the server. A failure
 * before that leaves every entry as it was here; retrying is safe, since the
 * server keeps the longer duration of an event it already has.
 */
export async function mergeBookStats(
  stats: StatisticsDb,
  client: (PushClient & PullClient) | null,
  sources: StatBook[],
  target: StatBook,
): Promise<void> {
  if (client) {
    await pullStats(stats, client);
    for (const source of sources) {
      const events = await stats.getBookEvents(source.bookMd5);
      for (let i = 0; i < events.length; i += PUSH_CHUNK) {
        await client.pushChanges({
          statBooks: [toWireBook(target)],
          statPages: events
            .slice(i, i + PUSH_CHUNK)
            .map((e) => toWirePage({ ...e, bookMd5: target.bookMd5 })),
        });
      }
    }
    await pushDeletions(client, sources);
  }
  for (const source of sources) await stats.mergeBook(source.bookMd5, target);
}
