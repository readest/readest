import dayjs from 'dayjs';
import type { AppService } from '@/types/system';
import type { DatabaseService, DatabaseRow } from '@/types/database';
import type {
  BookReadTime,
  DailyReadTime,
  PageStatEvent,
  StatBook,
  TotalReadStats,
} from '@/types/statistics';

interface BookRow extends DatabaseRow {
  id: number;
  title: string;
  authors: string;
  md5: string;
  total_read_time: number;
  total_read_pages: number;
  last_open: number;
  pages: number;
}

type CursorKey = 'push' | 'pull' | 'pull-us' | 'bookorbit-push' | 'file-push';

/**
 * Per-tab singleton open promise. OPFS permits only ONE access handle per file
 * across the whole origin, so a second `connect()` to statistics.db throws
 * `NoModificationAllowedError`. Every ReadingStatsTracker instance (and split-
 * view books) must therefore share a single connection — we memoise the open
 * and never thrash it.
 */
let sharedDb: Promise<StatisticsDb> | null = null;
let lifecycleBound = false;

function bindLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  // Fold the WAL into the main db when the tab is backgrounded/closed — the
  // most reliable point for best-effort async OPFS work before teardown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sharedDb) {
      void sharedDb.then((s) => s.checkpoint()).catch(() => {});
    }
  });
}

/**
 * Typed wrapper over the KOReader-compatible `statistics.db`. All identity is
 * keyed on `book_hash` (= Book.hash); the local autoincrement `id_book` never
 * leaves this class.
 */
const statsEventKey = (event: PageStatEvent): string =>
  JSON.stringify([event.bookMd5, event.page, event.startTime, event.duration, event.totalPages]);

export class StatisticsDb {
  // Serializes applyRemoteEvents so two concurrent pulls can't nest BEGINs.
  private applyRemoteLock: Promise<void> = Promise.resolve();
  private pushBoundaryTableReady: Promise<void> | null = null;

  private constructor(private readonly db: DatabaseService) {}

  private async ensurePushBoundaryTable(): Promise<void> {
    if (!this.pushBoundaryTableReady) {
      const ready = this.db
        .execute(
          `CREATE TABLE IF NOT EXISTS readest_stat_sync_boundary (
             key TEXT PRIMARY KEY,
             start_time INTEGER NOT NULL,
             event_keys TEXT NOT NULL
           )`,
        )
        .then(() => undefined)
        .catch((error) => {
          if (this.pushBoundaryTableReady === ready) this.pushBoundaryTableReady = null;
          throw error;
        });
      this.pushBoundaryTableReady = ready;
    }
    await this.pushBoundaryTableReady;
  }

  /** Production entry point — opens + migrates statistics.db (per-tab singleton). */
  static async open(appService: AppService): Promise<StatisticsDb> {
    bindLifecycle();
    if (!sharedDb) {
      const opening = (async () => {
        const db = await appService.openDatabase('statistics', 'statistics.db', 'Data');
        return new StatisticsDb(db);
      })();
      sharedDb = opening;
      void opening.catch(() => {
        if (sharedDb === opening) sharedDb = null;
      });
    }
    return sharedDb;
  }

  /** Test/advanced entry point — wrap an already-migrated DatabaseService. */
  static from(db: DatabaseService): StatisticsDb {
    return new StatisticsDb(db);
  }

  /**
   * Fold the WAL into the main db file and truncate it. The Turso engine does
   * NOT implement `PRAGMA wal_autocheckpoint` (so there's no auto threshold to
   * rely on), but `wal_checkpoint(TRUNCATE)` works — verified folding a 688 KB
   * WAL back to 0 B. We call this when the tab is hidden so the WAL stays bounded.
   */
  async checkpoint(): Promise<void> {
    await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** Checkpoint, close the underlying connection, and reset the singleton. */
  async close(): Promise<void> {
    try {
      await this.checkpoint();
    } catch {
      // best-effort — a checkpoint failure must not block close
    }
    await this.db.close();
    sharedDb = null;
  }

  async upsertBook(book: StatBook): Promise<number> {
    const existing = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      book.bookMd5,
    ]);
    if (existing[0]) {
      // md5 is the identity; keep the latest title/authors (LWW, matches server stat_books).
      await this.db.execute(`UPDATE book SET title = ?, authors = ? WHERE id = ?`, [
        book.title,
        book.authors,
        existing[0].id,
      ]);
      return existing[0].id;
    }
    await this.db.execute(
      `INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
       ON CONFLICT(title, authors, md5) DO NOTHING`,
      [book.title, book.authors, book.bookMd5],
    );
    const rows = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      book.bookMd5,
    ]);
    return rows[0]!.id;
  }

  async insertPageEvent(
    idBook: number,
    e: { page: number; startTime: number; duration: number; totalPages: number },
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id_book, page, start_time)
       DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages`,
      [idBook, e.page, e.startTime, e.duration, e.totalPages],
    );
  }

  async recomputeBookTotals(idBook: number): Promise<void> {
    await this.db.execute(
      `UPDATE book SET
         total_read_time  = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = ?), 0),
         total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = ?), 0),
         last_open        = COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = ?), last_open),
         pages            = COALESCE((SELECT total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time DESC LIMIT 1), pages)
       WHERE id = ?`,
      [idBook, idBook, idBook, idBook, idBook],
    );
  }

  /**
   * Returns the median duration of time spent on each page in seconds. Returns
   * `null` if sufficient data is not available.
   *
   * Use the median since reading times are skewed; thus the median must be
   * used to get the middle value.
   */
  async getMedianPageDurationSecs(idBook: number): Promise<number | null> {
    const PAGE_THRESHOLD = 5;
    const rows = await this.db.select<{ duration: number }>(
      `SELECT duration
         FROM page_stat_data
         WHERE id_book = ?
         ORDER BY start_time DESC
         LIMIT 50`,
      [idBook],
    );
    if (rows.length < PAGE_THRESHOLD) return null;
    // The query orders by recency; sort by value so the middle is the true median.
    const pageDurations = rows.map((d) => d['duration']).sort((a, b) => a - b);
    const mid = Math.floor(pageDurations.length / 2);
    return pageDurations.length % 2 !== 0
      ? (pageDurations[mid] ?? 0)
      : ((pageDurations[mid - 1] ?? 0) + (pageDurations[mid] ?? 0)) / 2;
  }

  async getBookByMd5(md5: string): Promise<BookRow | null> {
    const rows = await this.db.select<BookRow>(`SELECT * FROM book WHERE md5 = ? LIMIT 1`, [md5]);
    return rows[0] ?? null;
  }

  // ---- Derived aggregates for the stats UI (never stored; see types/statistics.ts).
  // Callers may pass a fixed offset for deterministic/imported data. The UI omits
  // it and buckets through dayjs so historical daylight-saving transitions use
  // each event's actual local calendar day.

  /** All-time totals: total seconds, distinct local days read, first event time. */
  async getTotalReadStats(tzOffsetSecs?: number): Promise<TotalReadStats> {
    const rows = await this.db.select<{ total: number; first: number | null }>(
      `SELECT COALESCE(SUM(duration), 0) AS total,
              MIN(start_time) AS first
       FROM page_stat_data`,
    );
    const row = rows[0];
    let readDays = 0;
    if (tzOffsetSecs !== undefined) {
      const dayRows = await this.db.select<{ days: number }>(
        `SELECT COUNT(DISTINCT (start_time + ?) / 86400) AS days
         FROM page_stat_data`,
        [tzOffsetSecs],
      );
      readDays = Number(dayRows[0]?.days ?? 0);
    } else {
      const startRows = await this.db.select<{ startTime: number }>(
        `SELECT start_time AS startTime FROM page_stat_data`,
      );
      readDays = new Set(
        startRows.map((event) => dayjs(Number(event.startTime) * 1000).format('YYYY-MM-DD')),
      ).size;
    }
    return {
      totalSeconds: Number(row?.total ?? 0),
      readDays,
      firstStartTime: row?.first != null ? Number(row.first) : null,
    };
  }

  /** Sum of reading seconds whose events START within [fromTs, toTs). */
  async getReadTimeBetween(fromTs: number, toTs: number): Promise<number> {
    const rows = await this.db.select<{ total: number }>(
      `SELECT COALESCE(SUM(duration), 0) AS total
       FROM page_stat_data
       WHERE start_time >= ? AND start_time < ?`,
      [fromTs, toTs],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Reading seconds per LOCAL day for events starting within [fromTs, toTs). */
  async getDailyReadTimeBetween(
    fromTs: number,
    toTs: number,
    tzOffsetSecs?: number,
  ): Promise<DailyReadTime[]> {
    if (tzOffsetSecs !== undefined) {
      const rows = await this.db.select<{ dayIdx: number; seconds: number }>(
        `SELECT (start_time + ?) / 86400 AS dayIdx, SUM(duration) AS seconds
         FROM page_stat_data
         WHERE start_time >= ? AND start_time < ?
         GROUP BY dayIdx
         ORDER BY dayIdx ASC`,
        [tzOffsetSecs, fromTs, toTs],
      );
      return rows.map((r) => ({
        dayStartTs: Number(r.dayIdx) * 86400 - tzOffsetSecs,
        seconds: Number(r.seconds),
      }));
    }

    const rows = await this.db.select<{ startTime: number; duration: number }>(
      `SELECT start_time AS startTime, duration
       FROM page_stat_data
       WHERE start_time >= ? AND start_time < ?
       ORDER BY start_time ASC`,
      [fromTs, toTs],
    );
    const daily = new Map<number, number>();
    for (const row of rows) {
      const dayStartTs = dayjs(Number(row.startTime) * 1000)
        .startOf('day')
        .unix();
      daily.set(dayStartTs, (daily.get(dayStartTs) ?? 0) + Number(row.duration));
    }
    return [...daily.entries()]
      .sort(([a], [b]) => a - b)
      .map(([dayStartTs, seconds]) => ({ dayStartTs, seconds }));
  }

  /** Per-book reading seconds for events starting within [fromTs, toTs), longest first. */
  async getBookReadTimesBetween(
    fromTs: number,
    toTs: number,
    limit = 100,
  ): Promise<BookReadTime[]> {
    const rows = await this.db.select<{
      bookMd5: string;
      title: string;
      authors: string;
      seconds: number;
      pages: number;
    }>(
      `SELECT b.md5 AS bookMd5, b.title AS title, b.authors AS authors,
              SUM(p.duration) AS seconds, COUNT(DISTINCT p.page) AS pages
       FROM page_stat_data p JOIN book b ON b.id = p.id_book
       WHERE p.start_time >= ? AND p.start_time < ?
       GROUP BY p.id_book
       ORDER BY seconds DESC
       LIMIT ?`,
      [fromTs, toTs, limit],
    );
    return rows.map((r) => ({
      bookMd5: String(r.bookMd5),
      title: String(r.title),
      authors: String(r.authors),
      seconds: Number(r.seconds),
      pages: Number(r.pages),
    }));
  }

  /**
   * Ensure a book row exists for an event whose metadata record isn't in the
   * current batch (paged pull can deliver an event before its `stat_books`
   * record). Unlike `upsertBook`, this NEVER overwrites an existing real title
   * with the hash placeholder — the real record, arriving in any page, wins.
   */
  private async ensureBookId(bookMd5: string): Promise<number> {
    const existing = await this.db.select<BookRow>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [
      bookMd5,
    ]);
    if (existing[0]) return existing[0].id;
    return this.upsertBook({ bookMd5, title: bookMd5, authors: '' });
  }

  /** Events with start_time >= cursor, joined to their md5, for pushing.
   * The inclusive boundary prevents same-second events from being skipped. A
   * durable boundary memo filters events already acknowledged at that
   * timestamp, so a successful push does not replay forever. */
  async getEventsForPush(
    sinceStartTime: number,
    cursorKey: CursorKey = 'push',
  ): Promise<{ events: PageStatEvent[]; books: StatBook[] }> {
    await this.ensurePushBoundaryTable();
    const rows = await this.db.select<DatabaseRow>(
      `SELECT b.md5 AS bookMd5, b.title AS title, b.authors AS authors,
              p.page AS page, p.start_time AS startTime, p.duration AS duration, p.total_pages AS totalPages
       FROM page_stat_data p JOIN book b ON b.id = p.id_book
       WHERE p.start_time >= ?
       ORDER BY p.start_time ASC, b.md5 ASC, p.page ASC`,
      [sinceStartTime],
    );
    const boundaryRows = await this.db.select<{ startTime: number; eventKeys: string }>(
      `SELECT start_time AS startTime, event_keys AS eventKeys
       FROM readest_stat_sync_boundary WHERE key = ?`,
      [cursorKey],
    );
    let acknowledged = new Set<string>();
    const boundary = boundaryRows[0];
    if (boundary && Number(boundary.startTime) === sinceStartTime) {
      try {
        const keys: unknown = JSON.parse(boundary.eventKeys);
        if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) {
          acknowledged = new Set(keys);
        }
      } catch {
        // A malformed optimization memo must never hide local events.
      }
    }

    const events: PageStatEvent[] = [];
    const pendingRows = rows.filter((r) => {
      const event = {
        bookMd5: String(r['bookMd5']),
        page: Number(r['page']),
        startTime: Number(r['startTime']),
        duration: Number(r['duration']),
        totalPages: Number(r['totalPages']),
      };
      if (event.startTime === sinceStartTime && acknowledged.has(statsEventKey(event))) {
        return false;
      }
      events.push(event);
      return true;
    });
    const bookMap = new Map<string, StatBook>();
    for (const r of pendingRows) {
      const md5 = String(r['bookMd5']);
      if (!bookMap.has(md5)) {
        bookMap.set(md5, {
          bookMd5: md5,
          title: String(r['title']),
          authors: String(r['authors']),
        });
      }
    }
    return { events, books: [...bookMap.values()] };
  }

  /** Remember the exact boundary events acknowledged by a successful push. */
  async markEventsPushed(cursorKey: CursorKey, events: PageStatEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.ensurePushBoundaryTable();
    const startTime = events.reduce(
      (max, event) => Math.max(max, event.startTime),
      events[0]!.startTime,
    );
    const eventKeys = new Set<string>();
    const existing = await this.db.select<{ startTime: number; eventKeys: string }>(
      `SELECT start_time AS startTime, event_keys AS eventKeys
       FROM readest_stat_sync_boundary WHERE key = ?`,
      [cursorKey],
    );
    if (existing[0] && Number(existing[0].startTime) === startTime) {
      try {
        const keys: unknown = JSON.parse(existing[0].eventKeys);
        if (Array.isArray(keys)) {
          for (const key of keys) if (typeof key === 'string') eventKeys.add(key);
        }
      } catch {
        // A malformed optimization memo must never hide local events.
      }
    }
    for (const event of events) {
      if (event.startTime === startTime) eventKeys.add(statsEventKey(event));
    }
    await this.db.execute(
      `INSERT INTO readest_stat_sync_boundary (key, start_time, event_keys)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         start_time = excluded.start_time,
         event_keys = excluded.event_keys`,
      [cursorKey, startTime, JSON.stringify([...eventKeys])],
    );
  }

  async applyRemoteEvents(books: StatBook[], events: PageStatEvent[]): Promise<void> {
    if (books.length === 0 && events.length === 0) return;
    // Serialize against other pulls: the statistics connection is shared across
    // ReadingStatsTracker instances (split view), and a second concurrent pull
    // would open a BEGIN inside this one's still-open BEGIN ("cannot start a
    // transaction within a transaction", Sentry READEST-N). The per-op native
    // lock can't make this multi-statement transaction atomic on its own.
    const prev = this.applyRemoteLock;
    let release!: () => void;
    this.applyRemoteLock = new Promise<void>((resolve) => (release = resolve));
    await prev;
    try {
      // One transaction for the whole pulled batch: a single commit instead of
      // O(rows) fsyncs, and the apply is atomic (a failed pull leaves no partial
      // state). Critical when a fresh device backfills tens of thousands of rows.
      await this.db.execute('BEGIN');
      try {
        const idByMd5 = new Map<string, number>();
        for (const b of books) idByMd5.set(b.bookMd5, await this.upsertBook(b));
        // Books referenced only by events (no metadata record) get a placeholder row.
        const touched = new Set<number>();
        for (const e of events) {
          let id = idByMd5.get(e.bookMd5);
          if (id === undefined) {
            id = await this.ensureBookId(e.bookMd5);
            idByMd5.set(e.bookMd5, id);
          }
          await this.insertPageEvent(id, e);
          touched.add(id);
        }
        for (const id of touched) await this.recomputeBookTotals(id);
        await this.db.execute('COMMIT');
      } catch (err) {
        await this.db.execute('ROLLBACK');
        throw err;
      }
    } finally {
      release();
    }
  }

  async getCursor(key: CursorKey): Promise<number> {
    const rows = await this.db.select<{ value: number }>(
      `SELECT value FROM readest_stat_sync_state WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? 0;
  }

  async setCursor(key: CursorKey, value: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO readest_stat_sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}
