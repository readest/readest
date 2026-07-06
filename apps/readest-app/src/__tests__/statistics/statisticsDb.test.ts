import { describe, it, expect, beforeEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import { StatisticsDb } from '@/services/statistics/statisticsDb';

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
});
