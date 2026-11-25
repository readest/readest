// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { mergeBookStats } from '@/services/statistics/statsSync';

// Merging two entries of the same book (#7494): the source's events become the
// target's, locally and on the sync server, and the source is deleted.

async function db() {
  const d = await NodeDatabaseService.open(':memory:');
  await migrate(d, getMigrations('statistics'));
  return StatisticsDb.from(d);
}

async function seed(
  stats: StatisticsDb,
  md5: string,
  events: { page: number; startTime: number; duration: number }[],
) {
  const id = await stats.upsertBook({ bookMd5: md5, title: md5.toUpperCase(), authors: 'A' });
  for (const e of events) await stats.insertPageEvent(id, { ...e, totalPages: 50 });
  await stats.recomputeBookTotals(id);
}

const OLD = { bookMd5: 'old', title: 'OLD', authors: 'A' };
const NEW = { bookMd5: 'new', title: 'NEW', authors: 'A' };

describe('mergeBook', () => {
  it('moves the source’s events onto the target and deletes the source', async () => {
    const stats = await db();
    await seed(stats, 'old', [
      { page: 1, startTime: 100, duration: 30 },
      { page: 2, startTime: 200, duration: 40 },
    ]);
    // the same event recorded on both: the longer duration wins
    await seed(stats, 'new', [
      { page: 2, startTime: 200, duration: 60 },
      { page: 3, startTime: 300, duration: 10 },
    ]);
    await seed(stats, 'other', [{ page: 1, startTime: 50, duration: 5 }]);

    await stats.mergeBook('old', NEW);

    expect(await stats.getBookByMd5('old')).toBeNull();
    const [merged] = await stats.getBookStats('new');
    expect(merged).toMatchObject({ seconds: 100, pages: 3, lastRead: 310 });
    expect((await stats.getBookByMd5('new'))!.total_read_time).toBe(100);
    expect((await stats.getBookStats()).map((b) => b.md5).sort()).toEqual(['new', 'other']);
  });

  it('moves the source’s reading speed samples onto the target', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    await seed(stats, 'new', [{ page: 1, startTime: 300, duration: 30 }]);
    // split view can start both books' samples on the same millisecond
    const sample = { unit: 'words' as const, count: 30, startTimeMs: 100_000, durationMs: 10_000 };
    await stats.insertReadingSpeed('old', sample);
    await stats.insertReadingSpeed('new', sample);
    await stats.insertReadingSpeed('old', { ...sample, startTimeMs: 200_000, count: 20 });

    await stats.mergeBook('old', NEW);
    expect(await stats.getReadingSpeedTotals()).toEqual([
      { unit: 'words', count: 50, durationMs: 20_000 },
    ]);
    // deleting the merged book now removes every sample it took over
    await stats.deleteBook('new');
    expect(await stats.getReadingSpeedTotals()).toEqual([]);
  });

  it('creates the target when it has no statistics yet', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    await stats.mergeBook('old', NEW);
    expect(await stats.getBookStats()).toEqual([
      { md5: 'new', title: 'NEW', authors: 'A', seconds: 30, pages: 1, lastRead: 130 },
    ]);
  });
});

describe('recording while a merge runs', () => {
  it('keeps an event recorded for the source while it is merged', async () => {
    // Read Aloud or the reader can record the source book (Read Aloud keeps
    // playing after its book closes) while the merge runs from the library
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    await Promise.all([
      stats.mergeBook('old', NEW),
      stats.recordEvents(OLD, [{ page: 3, startTime: 300, duration: 20, totalPages: 50 }]),
    ]);
    const seconds = Object.fromEntries((await stats.getBookStats()).map((b) => [b.md5, b.seconds]));
    expect(seconds).toEqual({ new: 30, old: 20 });
  });
});

describe('mergeBookStats', () => {
  const client = () => ({
    pullChanges: vi.fn().mockResolvedValue({ statBooks: [], statPages: [] }),
    pushChanges: vi.fn().mockResolvedValue({}),
  });

  it('pulls, pushes the events under the target in chunks, then deletes the source', async () => {
    const stats = await db();
    await seed(
      stats,
      'old',
      Array.from({ length: 600 }, (_, i) => ({ page: i + 1, startTime: i + 1, duration: 5 })),
    );
    const c = client();
    await mergeBookStats(stats, c, [OLD], NEW);

    expect(c.pullChanges).toHaveBeenCalled();
    const pushes = c.pushChanges.mock.calls.map((call) => call[0]);
    expect(pushes.map((p) => p.statPages?.length ?? 0)).toEqual([500, 100, 0]);
    expect(pushes[0].statBooks).toEqual([{ book_hash: 'new', title: 'NEW', authors: 'A' }]);
    expect(pushes[0].statPages[0]).toEqual({
      book_hash: 'new',
      page: 1,
      start_time: 1,
      duration: 5,
      total_pages: 50,
    });
    // the source is deleted only after every event reached the target
    expect(pushes[2].statBooks).toEqual([
      { book_hash: 'old', title: 'OLD', authors: 'A', deleted_at: expect.any(String) },
    ]);
    expect(await stats.getBookByMd5('old')).toBeNull();
    expect((await stats.getBookStats('new'))[0]!.seconds).toBe(3000);
  });

  it('merges several entries with one pull and one deletion (#7812)', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    await seed(stats, 'older', [{ page: 2, startTime: 50, duration: 20 }]);
    await seed(stats, 'new', [{ page: 3, startTime: 200, duration: 10 }]);
    const c = client();
    await mergeBookStats(stats, c, [OLD, { bookMd5: 'older', title: 'OLDER', authors: 'A' }], NEW);

    expect(c.pullChanges).toHaveBeenCalledTimes(1);
    const pushes = c.pushChanges.mock.calls.map((call) => call[0]);
    expect(
      pushes.map((p) =>
        (p.statPages ?? []).map(
          (e: { book_hash: string; start_time: number }) => `${e.book_hash}@${e.start_time}`,
        ),
      ),
    ).toEqual([['new@100'], ['new@50'], []]);
    expect(pushes[2].statBooks).toEqual([
      { book_hash: 'old', title: 'OLD', authors: 'A', deleted_at: expect.any(String) },
      { book_hash: 'older', title: 'OLDER', authors: 'A', deleted_at: expect.any(String) },
    ]);
    expect((await stats.getBookStats()).map((b) => [b.md5, b.seconds])).toEqual([['new', 60]]);
  });

  it('merges nothing when the pull fails, so no event is left behind', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    const c = client();
    c.pullChanges.mockRejectedValue(new Error('offline'));
    await expect(mergeBookStats(stats, c, [OLD], NEW)).rejects.toThrow('offline');
    expect(c.pushChanges).not.toHaveBeenCalled();
    expect(await stats.getBookByMd5('old')).not.toBeNull();
  });

  it('keeps the source on the server and here when pushing its events fails', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    const c = client();
    c.pushChanges.mockRejectedValue(new Error('offline'));
    await expect(mergeBookStats(stats, c, [OLD], NEW)).rejects.toThrow('offline');
    expect(c.pushChanges).toHaveBeenCalledTimes(1); // no deletion was sent
    expect(await stats.getBookByMd5('old')).not.toBeNull();
    expect(await stats.getBookByMd5('new')).toBeNull();
  });

  it('merges locally only when stats aren’t synced', async () => {
    const stats = await db();
    await seed(stats, 'old', [{ page: 1, startTime: 100, duration: 30 }]);
    await mergeBookStats(stats, null, [OLD], NEW);
    expect((await stats.getBookStats()).map((b) => b.md5)).toEqual(['new']);
  });
});
