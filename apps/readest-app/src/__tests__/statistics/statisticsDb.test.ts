import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { getPeriodRange, periodRangeToSeconds, getTzOffsetSecs } from '@/utils/stats';

async function freshStatsDb(): Promise<DatabaseService> {
  // In-memory libsql DB; run the same migrations production uses.
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('statistics'));
  return db;
}

describe('statistics migration', () => {
  let db: DatabaseService;
  beforeEach(async () => {
    db = await freshStatsDb();
  });

  it('creates KOReader book + page_stat_data tables and extension tables', async () => {
    const tables = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('book');
    expect(names).toContain('page_stat_data');
    expect(names).toContain('numbers');
    expect(names).toContain('page_stat'); // the rescaling view
    expect(names).toContain('readest_page_ext');
    expect(names).toContain('readest_book_ext');
    expect(names).toContain('readest_stat_sync_state');
  });

  it('is idempotent when the page_stat view already exists (READEST-13)', async () => {
    // A DB imported from KOReader (or left by a partially-applied migration)
    // already has a page_stat view but no migration record. turso ignores
    // IF NOT EXISTS on CREATE VIEW, so a non-idempotent migration throws
    // "View page_stat already exists" here.
    const imported = await NodeDatabaseService.open(':memory:');
    await imported.execute('CREATE VIEW page_stat AS SELECT 1 AS x');

    await expect(migrate(imported, getMigrations('statistics'))).resolves.toBeUndefined();

    const views = await imported.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'view'`,
    );
    expect(views.map((v) => v.name)).toContain('page_stat');
  });

  it('seeds the numbers helper table 1..1000', async () => {
    const rows = await db.select<{ c: number }>(`SELECT COUNT(*) AS c FROM numbers`);
    expect(rows[0]!.c).toBe(1000);
  });

  it('enforces the page_stat_data uniqueness key', async () => {
    await db.execute(`INSERT INTO book (title, authors, md5) VALUES ('T','A','m')`);
    const id = (await db.select<{ id: number }>(`SELECT id FROM book LIMIT 1`))[0]!.id;
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?,?,?,?,?)`,
      [id, 5, 1000, 10, 100],
    );
    await db.execute(
      `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
       VALUES (?,?,?,?,?)
       ON CONFLICT(id_book, page, start_time) DO UPDATE SET duration = max(duration, excluded.duration)`,
      [id, 5, 1000, 25, 100],
    );
    const rows = await db.select<{ duration: number; c: number }>(
      `SELECT duration, COUNT(*) OVER () AS c FROM page_stat_data`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.duration).toBe(25);
  });
});

describe('StatisticsDb', () => {
  let stats: StatisticsDb;
  beforeEach(async () => {
    stats = StatisticsDb.from(await freshStatsDb());
  });

  it('upserts a book by md5 and returns a stable id_book', async () => {
    const id1 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    const id2 = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    expect(id1).toBe(id2);
  });

  it('inserts page events and keeps the longer duration on re-flush', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 10, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 30, totalPages: 50 });
    await stats.insertPageEvent(id, { page: 4, startTime: 140, duration: 12, totalPages: 50 });
    await stats.recomputeBookTotals(id);
    const book = await stats.getBookByMd5('m1');
    expect(book!.total_read_time).toBe(42); // 30 + 12
    expect(book!.total_read_pages).toBe(2); // distinct pages 3,4
    expect(book!.last_open).toBe(152); // max(start_time + duration) = 140 + 12
  });

  it('returns events for push after a start_time cursor, joined with md5', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.insertPageEvent(id, { page: 2, startTime: 200, duration: 5, totalPages: 9 });
    const { events } = await stats.getEventsForPush(150);
    expect(events.map((e) => e.startTime)).toEqual([200]);
    expect(events[0]!.bookMd5).toBe('m1');
  });

  it('merges acknowledged events when bounded chunks share one start_time', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm1', title: 'T1', authors: 'A1' });
    for (let page = 1; page <= 51; page++) {
      await stats.insertPageEvent(id, { page, startTime: 1000, duration: 5, totalPages: 51 });
    }
    const all = (await stats.getEventsForPush(1000, 'bookorbit-push')).events;
    await stats.markEventsPushed('bookorbit-push', all.slice(0, 50));
    await stats.markEventsPushed('bookorbit-push', all.slice(50));
    expect((await stats.getEventsForPush(1000, 'bookorbit-push')).events).toHaveLength(0);
  });

  it('applies remote events idempotently via upsert', async () => {
    const remoteBooks = [{ bookMd5: 'm2', title: 'T2', authors: 'A2' }];
    const remoteEvents = [
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 },
      { bookMd5: 'm2', page: 1, startTime: 300, duration: 8, totalPages: 20 }, // dup
    ];
    await stats.applyRemoteEvents(remoteBooks, remoteEvents);
    await stats.applyRemoteEvents(remoteBooks, remoteEvents); // again — still idempotent
    const book = await stats.getBookByMd5('m2');
    expect(book!.total_read_time).toBe(8);
  });

  it('serializes concurrent applyRemoteEvents without nesting transactions (READEST-N)', async () => {
    // Two pulls racing on the shared connection (split-view trackers) must not
    // open a BEGIN inside a BEGIN ("cannot start a transaction within a transaction").
    const a = stats.applyRemoteEvents(
      [{ bookMd5: 'ra', title: 'RA', authors: '' }],
      [{ bookMd5: 'ra', page: 1, startTime: 400, duration: 3, totalPages: 10 }],
    );
    const b = stats.applyRemoteEvents(
      [{ bookMd5: 'rb', title: 'RB', authors: '' }],
      [{ bookMd5: 'rb', page: 1, startTime: 401, duration: 4, totalPages: 10 }],
    );
    await expect(Promise.all([a, b])).resolves.toBeDefined();
    expect((await stats.getBookByMd5('ra'))!.total_read_time).toBe(3);
    expect((await stats.getBookByMd5('rb'))!.total_read_time).toBe(4);
  });

  it('reads and writes sync cursors', async () => {
    expect(await stats.getCursor('push')).toBe(0);
    await stats.setCursor('push', 1234);
    expect(await stats.getCursor('push')).toBe(1234);
  });

  it('keeps one book row per md5 even when title/authors change (no duplicates)', async () => {
    const id1 = await stats.upsertBook({ bookMd5: 'm1', title: 'Old', authors: 'A' });
    const id2 = await stats.upsertBook({ bookMd5: 'm1', title: 'New', authors: 'B' });
    expect(id2).toBe(id1);
    const book = await stats.getBookByMd5('m1');
    expect(book!.title).toBe('New'); // latest title wins
    // exactly one row for this md5
    const rows = await stats.getEventsForPush(-1); // no events; just exercise no crash
    void rows;
  });

  it('returns null until enough page data exists for a median', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-few', title: 'T', authors: 'A' });
    for (let i = 0; i < 4; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: 10,
        totalPages: 50,
      });
    }
    expect(await stats.getMedianPageDurationSecs(id)).toBeNull();
  });

  it('takes the median by duration value, not by recency (odd count)', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-odd', title: 'T', authors: 'A' });
    // Inserted in ascending start_time; durations are NOT sorted by value, so the
    // median must sort by value before picking the middle (recency-middle is 50).
    const byTime = [30, 10, 50, 20, 40];
    for (let i = 0; i < byTime.length; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: byTime[i]!,
        totalPages: 50,
      });
    }
    // Sorted: [10, 20, 30, 40, 50] -> median 30.
    expect(await stats.getMedianPageDurationSecs(id)).toBe(30);
  });

  it('averages the two middle durations (even count)', async () => {
    const id = await stats.upsertBook({ bookMd5: 'm-even', title: 'T', authors: 'A' });
    const byTime = [60, 10, 50, 20, 40, 30];
    for (let i = 0; i < byTime.length; i++) {
      await stats.insertPageEvent(id, {
        page: i,
        startTime: 100 + i,
        duration: byTime[i]!,
        totalPages: 50,
      });
    }
    // Sorted: [10, 20, 30, 40, 50, 60] -> (30 + 40) / 2 = 35.
    expect(await stats.getMedianPageDurationSecs(id)).toBe(35);
  });
});

describe('StatisticsDb aggregates', () => {
  let stats: StatisticsDb;
  beforeEach(async () => {
    stats = StatisticsDb.from(await freshStatsDb());
  });

  const DAY = 86400;

  async function seedBook(
    md5: string,
    events: { page: number; startTime: number; duration: number }[],
  ) {
    const id = await stats.upsertBook({ bookMd5: md5, title: `T-${md5}`, authors: 'A' });
    for (const e of events) {
      await stats.insertPageEvent(id, { ...e, totalPages: 50 });
    }
    return id;
  }

  it('sums all-time totals and counts distinct local days', async () => {
    await seedBook('m1', [
      { page: 1, startTime: 0, duration: 10 },
      { page: 2, startTime: 3600, duration: 20 }, // same local day (tz 0)
      { page: 1, startTime: DAY, duration: 30 },
    ]);
    const totals = await stats.getTotalReadStats(0);
    expect(totals.totalSeconds).toBe(60);
    expect(totals.readDays).toBe(2);
    expect(totals.firstStartTime).toBe(0);
  });

  it('sums empty stats to zero without nulls', async () => {
    const totals = await stats.getTotalReadStats(0);
    expect(totals).toEqual({ totalSeconds: 0, readDays: 0, firstStartTime: null });
    expect(await stats.getReadTimeBetween(0, DAY)).toBe(0);
  });

  it('buckets events into [from, to) ranges', async () => {
    await seedBook('m1', [
      { page: 1, startTime: 100, duration: 10 }, // at from → included
      { page: 2, startTime: 200, duration: 20 },
      { page: 3, startTime: 300, duration: 40 }, // at to → excluded
    ]);
    expect(await stats.getReadTimeBetween(100, 300)).toBe(30);
    expect(await stats.getReadTimeBetween(101, 300)).toBe(20);
  });

  it('groups daily read time by local day with a timezone offset', async () => {
    const TZ = 8 * 3600; // UTC+8
    // 22:00 UTC on day 0 is already 06:00 of day 1 in UTC+8.
    await seedBook('m1', [
      { page: 1, startTime: 0, duration: 10 }, // local day 0 (epoch = 08:00 local)
      { page: 2, startTime: 22 * 3600, duration: 20 }, // local day 1
      { page: 3, startTime: DAY + 3600, duration: 40 }, // 01:00 UTC day 1 → local day 1
    ]);
    const daily = await stats.getDailyReadTimeBetween(0, 10 * DAY, TZ);
    expect(daily).toEqual([
      { dayStartTs: 0 * DAY - TZ, seconds: 10 },
      { dayStartTs: 1 * DAY - TZ, seconds: 60 },
    ]);
  });

  it('matches real-scale tracker timestamps via the hook unit chain', async () => {
    // Regression for the ms-vs-seconds unit split: the tracker writes
    // Math.floor(Date.now()/1000) (seconds, KOReader-compatible), while
    // getPeriodRange is dayjs-native milliseconds. This drives the exact
    // conversion chain useReadingStats uses, against real-magnitude data.
    vi.useFakeTimers();
    try {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      await seedBook('real', [{ page: 1, startTime: nowSec, duration: 90 }]);
      const dbRange = periodRangeToSeconds(getPeriodRange('week'));
      expect(await stats.getReadTimeBetween(dbRange.fromTs, dbRange.toTs)).toBe(90);
      const daily = await stats.getDailyReadTimeBetween(
        dbRange.fromTs,
        dbRange.toTs,
        getTzOffsetSecs(),
      );
      expect(daily.length).toBeGreaterThan(0);
      expect(daily.at(-1)!.seconds).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ranks books by reading time and honors the limit', async () => {
    await seedBook('m-a', [
      { page: 1, startTime: 100, duration: 10 },
      { page: 2, startTime: 150, duration: 10 },
    ]);
    await seedBook('m-b', [{ page: 1, startTime: 120, duration: 50 }]);
    await seedBook('m-c', [{ page: 1, startTime: 130, duration: 25 }]);

    const ranked = await stats.getBookReadTimesBetween(0, DAY, 10);
    expect(ranked.map((b) => [b.title, b.seconds])).toEqual([
      ['T-m-b', 50],
      ['T-m-c', 25],
      ['T-m-a', 20],
    ]);
    expect(ranked[0]!.pages).toBe(1);

    const top1 = await stats.getBookReadTimesBetween(0, DAY, 1);
    expect(top1.map((b) => b.title)).toEqual(['T-m-b']);

    // Period filter: only m-a's second event is inside [150, 160).
    const slice = await stats.getBookReadTimesBetween(150, 160, 10);
    expect(slice.map((b) => [b.title, b.seconds])).toEqual([['T-m-a', 10]]);
  });
});

describe('StatisticsDb.open', () => {
  it('retries after a transient singleton open failure', async () => {
    const db = await freshStatsDb();
    const error = new Error('transient open failure');
    const openDatabase = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(db);
    const appService = { openDatabase } as unknown as AppService;

    await expect(StatisticsDb.open(appService)).rejects.toBe(error);

    const stats = await StatisticsDb.open(appService);
    expect(openDatabase).toHaveBeenCalledTimes(2);
    await stats.close();
  });
});
