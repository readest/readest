import { describe, it, expect, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { pushStats, pullStats } from '@/services/statistics/statsSync';

async function db() {
  const d = await NodeDatabaseService.open(':memory:');
  await migrate(d, getMigrations('statistics'));
  return StatisticsDb.from(d);
}

describe('statsSync', () => {
  it('pushes events at or after the cursor and advances it', async () => {
    const stats = await db();
    const id = await stats.upsertBook({ bookMd5: 'm', title: 'T', authors: 'A' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.insertPageEvent(id, { page: 2, startTime: 200, duration: 6, totalPages: 9 });
    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await pushStats(stats, client as never);
    const sent = client.pushChanges.mock.calls[0]![0];
    expect(sent.statPages.map((p: { start_time: number }) => p.start_time)).toEqual([100, 200]);
    expect(await stats.getCursor('push')).toBe(200);
    await pushStats(stats, client as never);
    expect(client.pushChanges).toHaveBeenCalledTimes(1);
  });

  it('includes same-second events at the push cursor', async () => {
    const stats = await db();
    const id = await stats.upsertBook({ bookMd5: 'm', title: 'T', authors: 'A' });
    await stats.insertPageEvent(id, { page: 1, startTime: 100, duration: 5, totalPages: 9 });
    await stats.setCursor('push', 100);
    await stats.insertPageEvent(id, { page: 2, startTime: 100, duration: 6, totalPages: 9 });

    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await pushStats(stats, client as never);
    expect(
      client.pushChanges.mock.calls[0]![0].statPages.map((p: { page: number }) => p.page),
    ).toEqual([1, 2]);
    await stats.insertPageEvent(id, { page: 3, startTime: 100, duration: 7, totalPages: 9 });
    await pushStats(stats, client as never);
    expect(client.pushChanges).toHaveBeenCalledTimes(2);
    expect(
      client.pushChanges.mock.calls[1]![0].statPages.map((p: { page: number }) => p.page),
    ).toEqual([3]);
  });

  it('does not advance a paged page pull past newer book metadata', async () => {
    const stats = await db();
    const event = (page: number, updatedAtMs: number) => ({
      book_hash: 'm',
      page,
      start_time: page,
      duration: 2,
      total_pages: 9,
      updated_at_ms: updatedAtMs,
    });
    const client = {
      pullChanges: vi
        .fn()
        .mockResolvedValueOnce({
          statBooks: [{ book_hash: 'm', title: 'T', authors: 'A', updated_at_ms: 9000 }],
          statPages: [event(1, 1000)],
        })
        .mockResolvedValueOnce({ statBooks: [], statPages: [event(2, 2000)] })
        .mockResolvedValue({ statBooks: [], statPages: [] }),
    };
    await pullStats(stats, client as never);
    expect(await stats.getCursor('pull')).toBe(2_000_000);
    expect(client.pullChanges).toHaveBeenCalledTimes(3);
  });

  it('advances the pull cursor for books-only responses', async () => {
    const stats = await db();
    const client = {
      pullChanges: vi
        .fn()
        .mockResolvedValueOnce({
          statBooks: [
            {
              book_hash: 'm',
              title: 'T',
              authors: 'A',
              updated_at_ms: 1_750_000_000_000,
            },
          ],
          statPages: [],
        })
        .mockResolvedValue({ statBooks: [], statPages: [] }),
    };
    await pullStats(stats, client as never);
    expect(await stats.getCursor('pull')).toBe(1_750_000_000_000_000);
    expect(client.pullChanges).toHaveBeenCalledTimes(2);
  });

  it('replays a one-millisecond overlap when upgrading a legacy pull cursor', async () => {
    const stats = await db();
    await stats.setCursor('pull', 2_000);
    const client = {
      pullChanges: vi.fn(
        async (
          _sinceMs: number,
          _type: string,
          _book: unknown,
          _meta: unknown,
          _limit: number,
          sinceUs?: number,
        ) => {
          if (sinceUs === 1_999_000) {
            return {
              statBooks: [{ book_hash: 'm', title: 'T', authors: 'A' }],
              statPages: [
                {
                  book_hash: 'm',
                  page: 1,
                  start_time: 1,
                  duration: 2,
                  total_pages: 9,
                  updated_at_ms: 2_000,
                  updated_at_us: 2_000_123,
                },
              ],
            };
          }
          return { statBooks: [], statPages: [] };
        },
      ),
    };
    await pullStats(stats, client as never);
    expect(client.pullChanges.mock.calls[0]![0]).toBe(1_999);
    expect(client.pullChanges.mock.calls[0]![5]).toBe(1_999_000);
    expect(await stats.getCursor('pull-us')).toBe(2_000_123);
  });

  it('applies pulled events and advances the pull cursor', async () => {
    const stats = await db();
    const client = {
      pullChanges: vi.fn().mockResolvedValue({
        statBooks: [{ book_hash: 'm', title: 'T', authors: 'A' }],
        statPages: [
          {
            book_hash: 'm',
            page: 1,
            start_time: 300,
            duration: 7,
            total_pages: 9,
            updated_at_ms: 1_750_000_000_000,
          },
        ],
      }),
    };
    await pullStats(stats, client as never);
    const book = await stats.getBookByMd5('m');
    expect(book!.total_read_time).toBe(7);
    expect(await stats.getCursor('pull')).toBe(1_750_000_000_000_000);
  });

  it('keeps microsecond precision across a page boundary within one millisecond', async () => {
    const stats = await db();
    const event = (page: number, updatedAtUs: number) => ({
      book_hash: 'm',
      page,
      start_time: page,
      duration: 2,
      total_pages: 9,
      updated_at_ms: Math.floor(updatedAtUs / 1000),
      updated_at_us: updatedAtUs,
    });
    const client = {
      pullChanges: vi.fn(
        async (
          _sinceMs: number,
          _type: string,
          _book: unknown,
          _meta: unknown,
          _limit: number,
          sinceUs: number,
        ) => {
          if (sinceUs === 0) return { statBooks: [], statPages: [event(1, 1_000_123)] };
          if (sinceUs === 1_000_123) return { statBooks: [], statPages: [event(2, 1_000_456)] };
          return { statBooks: [], statPages: [] };
        },
      ),
    };
    await pullStats(stats, client as never);
    expect(await stats.getCursor('pull')).toBe(1_000_456);
    expect(client.pullChanges.mock.calls[1]![5]).toBe(1_000_123);
  });

  it('chunks a large push backlog into bounded requests, advancing the cursor per chunk', async () => {
    const stats = await db();
    const id = await stats.upsertBook({ bookMd5: 'm', title: 'T', authors: 'A' });
    // 600 events at distinct start_times — exceeds the 500-event push chunk → 2 requests.
    for (let t = 1; t <= 600; t++) {
      await stats.insertPageEvent(id, { page: t, startTime: t, duration: 1, totalPages: 999 });
    }
    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await pushStats(stats, client as never);
    expect(client.pushChanges).toHaveBeenCalledTimes(2);
    expect(client.pushChanges.mock.calls[0]![0].statPages.length).toBe(500);
    expect(client.pushChanges.mock.calls[1]![0].statPages.length).toBe(100);
    expect(await stats.getCursor('push')).toBe(600);
  });

  it('pages through a multi-page pull, applying every page until exhausted', async () => {
    const stats = await db();
    const ev = (n: number, ms: number) => ({
      book_hash: 'm',
      page: n,
      start_time: n,
      duration: 2,
      total_pages: 9,
      updated_at_ms: ms,
    });
    const client = {
      pullChanges: vi
        .fn()
        .mockResolvedValueOnce({
          statBooks: [{ book_hash: 'm', title: 'T', authors: 'A' }],
          statPages: [ev(1, 1000), ev(2, 1000)],
        })
        .mockResolvedValueOnce({ statBooks: [], statPages: [ev(3, 2000)] })
        .mockResolvedValue({ statBooks: [], statPages: [] }),
    };
    await pullStats(stats, client as never);
    expect(client.pullChanges).toHaveBeenCalledTimes(3);
    const book = await stats.getBookByMd5('m');
    expect(book!.total_read_pages).toBe(3); // pages 1, 2, 3 all applied across pages
    expect(await stats.getCursor('pull')).toBe(2_000_000);
  });
});
