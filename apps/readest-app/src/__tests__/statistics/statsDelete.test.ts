// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { deleteBookStats, pullStats } from '@/services/statistics/statsSync';

// Deleting a book's reading statistics (#7494): locally, on the sync server,
// and on every other device once it pulls the deletion.

async function db() {
  const d = await NodeDatabaseService.open(':memory:');
  await migrate(d, getMigrations('statistics'));
  return StatisticsDb.from(d);
}

async function seed(stats: StatisticsDb, md5: string, startTimes: number[]) {
  const id = await stats.upsertBook({ bookMd5: md5, title: md5.toUpperCase(), authors: 'A' });
  for (const [i, startTime] of startTimes.entries()) {
    await stats.insertPageEvent(id, { page: i + 1, startTime, duration: 10, totalPages: 50 });
  }
  await stats.recomputeBookTotals(id);
}

const wirePage = (book_hash: string, start_time: number, extra: object = {}) => ({
  book_hash,
  page: 1,
  start_time,
  duration: 10,
  total_pages: 50,
  updated_at_ms: 5_000_000,
  ...extra,
});

describe('getBookStats', () => {
  it('lists each book’s reading time, pages and last read, most recent first', async () => {
    const stats = await db();
    await seed(stats, 'a', [100, 200]);
    await seed(stats, 'b', [300]);
    expect(await stats.getBookStats()).toEqual([
      { md5: 'b', title: 'B', authors: 'A', seconds: 10, pages: 1, lastRead: 310 },
      { md5: 'a', title: 'A', authors: 'A', seconds: 20, pages: 2, lastRead: 210 },
    ]);
    expect((await stats.getBookStats('a')).map((b) => b.md5)).toEqual(['a']);
  });
});

describe('deleteBook', () => {
  it('removes the book’s events and row, and leaves other books alone', async () => {
    const stats = await db();
    await seed(stats, 'a', [100, 200]);
    await seed(stats, 'b', [300]);
    await stats.deleteBook('a');
    expect(await stats.getBookByMd5('a')).toBeNull();
    expect((await stats.getBookStats()).map((b) => b.md5)).toEqual(['b']);
    expect(await stats.getReadingTotals()).toEqual({ seconds: 10, books: 1, pages: 1 });
  });
});

describe('pullStats with a deleted book', () => {
  it('deletes the events read before the deletion and keeps later ones', async () => {
    const stats = await db();
    // a local event at 2000 s, inside the deletion's fractional second
    await seed(stats, 'a', [100, 2000, 2500]);
    const client = {
      pullChanges: vi
        .fn()
        .mockResolvedValueOnce({
          // deleted at 2000.5 s: start_time 2000 is before it
          statBooks: [{ book_hash: 'a', title: 'A', authors: 'A', deleted_at_ms: 2_000_500 }],
          statPages: [wirePage('a', 2000, { deleted_at_ms: 2_000_500 })],
        })
        .mockResolvedValue({ statBooks: [], statPages: [] }),
    };
    await pullStats(stats, client as never);
    const [a] = await stats.getBookStats('a');
    expect(a).toMatchObject({ seconds: 10, lastRead: 2510 });
    expect((await stats.getBookByMd5('a'))!.total_read_time).toBe(10);
    // the cursor still advances past the flagged row
    expect(await stats.getCursor('pull')).toBe(5_000_000);
  });

  it('never stores a flagged event, and drops a book left with no events', async () => {
    const stats = await db();
    await seed(stats, 'a', [100]);
    const client = {
      pullChanges: vi
        .fn()
        .mockResolvedValueOnce({
          statBooks: [
            { book_hash: 'a', title: 'A', authors: 'A', deleted_at_ms: 3_000_000 },
            { book_hash: 'b', title: 'B', authors: 'A', deleted_at_ms: 3_000_000 },
          ],
          statPages: [wirePage('b', 1000, { deleted_at_ms: 3_000_000 }), wirePage('c', 1000)],
        })
        .mockResolvedValue({ statBooks: [], statPages: [] }),
    };
    await pullStats(stats, client as never);
    expect(await stats.getBookByMd5('a')).toBeNull();
    expect(await stats.getBookByMd5('b')).toBeNull();
    expect((await stats.getBookStats()).map((b) => b.md5)).toEqual(['c']);
  });
});

describe('deleteBookStats', () => {
  it('sends the deletion to the server, then deletes locally', async () => {
    const stats = await db();
    await seed(stats, 'a', [100]);
    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await deleteBookStats(stats, client, [{ bookMd5: 'a', title: 'A', authors: 'A' }]);
    const sent = client.pushChanges.mock.calls[0]![0];
    expect(sent.statBooks).toEqual([
      { book_hash: 'a', title: 'A', authors: 'A', deleted_at: expect.any(String) },
    ]);
    expect(await stats.getBookByMd5('a')).toBeNull();
  });

  it('deletes several books with one request (#7812)', async () => {
    const stats = await db();
    await seed(stats, 'a', [100]);
    await seed(stats, 'b', [200]);
    await seed(stats, 'c', [300]);
    const client = { pushChanges: vi.fn().mockResolvedValue({}) };
    await deleteBookStats(stats, client, [
      { bookMd5: 'a', title: 'A', authors: 'A' },
      { bookMd5: 'b', title: 'B', authors: 'A' },
    ]);
    expect(client.pushChanges).toHaveBeenCalledTimes(1);
    expect(client.pushChanges.mock.calls[0]![0].statBooks).toEqual([
      { book_hash: 'a', title: 'A', authors: 'A', deleted_at: expect.any(String) },
      { book_hash: 'b', title: 'B', authors: 'A', deleted_at: expect.any(String) },
    ]);
    expect((await stats.getBookStats()).map((b) => b.md5)).toEqual(['c']);
  });

  it('keeps the local statistics when the server rejects the deletion', async () => {
    const stats = await db();
    await seed(stats, 'a', [100]);
    const client = { pushChanges: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(
      deleteBookStats(stats, client, [{ bookMd5: 'a', title: 'A', authors: 'A' }]),
    ).rejects.toThrow('offline');
    expect(await stats.getBookByMd5('a')).not.toBeNull();
  });

  it('deletes locally only when stats aren’t synced', async () => {
    const stats = await db();
    await seed(stats, 'a', [100]);
    await deleteBookStats(stats, null, [{ bookMd5: 'a', title: 'A', authors: 'A' }]);
    expect(await stats.getBookByMd5('a')).toBeNull();
  });
});
