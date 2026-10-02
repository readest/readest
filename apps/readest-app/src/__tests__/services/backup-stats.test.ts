import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import type { AppService } from '@/types/system';

/**
 * #6488: reading statistics live in statistics.db under the Data dir, outside
 * the Books tree the backup walks, so a backup silently dropped every reading
 * session. A backup now carries them and a restore merges them in.
 */

vi.mock('@/utils/zip', async () => {
  const { configure } = await import('@zip.js/zip.js');
  return {
    configureZip: async () => configure({ useWebWorkers: false, useCompressionStream: false }),
  };
});

async function freshStats(): Promise<StatisticsDb> {
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('statistics'));
  return StatisticsDb.from(db);
}

const appService = {
  loadLibraryBooks: async () => [],
  saveLibraryBooks: async () => {},
  loadSettings: async () => ({}),
  saveSettings: async () => {},
  resolveFilePath: async () => '/data/Books',
  readDirectory: async () => [],
} as unknown as AppService;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading statistics in backups (#6488)', () => {
  it('restores the backed-up sessions, merged with the ones already on the device', async () => {
    const source = await freshStats();
    await source.applyRemoteEvents(
      [{ bookMd5: 'book-a', title: 'Book A', authors: 'Author A' }],
      [
        { bookMd5: 'book-a', page: 1, startTime: 1000, duration: 30, totalPages: 100 },
        { bookMd5: 'book-a', page: 2, startTime: 1030, duration: 45, totalPages: 100 },
      ],
    );
    vi.spyOn(StatisticsDb, 'open').mockResolvedValue(source);
    const zip = await createBackupZip(appService);

    const target = await freshStats();
    await target.applyRemoteEvents(
      [{ bookMd5: 'book-a', title: 'Book A', authors: 'Author A' }],
      [
        { bookMd5: 'book-a', page: 1, startTime: 1000, duration: 10, totalPages: 100 },
        { bookMd5: 'book-a', page: 3, startTime: 2000, duration: 20, totalPages: 100 },
      ],
    );
    vi.spyOn(StatisticsDb, 'open').mockResolvedValue(target);
    await restoreFromBackupZip(appService, new Blob([zip]));

    const { events } = await target.getEventsForPush(0);
    expect(events.map(({ page, startTime, duration }) => [page, startTime, duration])).toEqual([
      [1, 1000, 30],
      [2, 1030, 45],
      [3, 2000, 20],
    ]);
    expect(await target.getBookByMd5('book-a')).toMatchObject({
      title: 'Book A',
      total_read_time: 95,
      total_read_pages: 3,
    });
  });

  it('still backs up the library when the statistics database cannot be opened', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no statistics.db'));
    const zip = await createBackupZip(appService);
    expect(zip.byteLength).toBeGreaterThan(0);
  });
});
