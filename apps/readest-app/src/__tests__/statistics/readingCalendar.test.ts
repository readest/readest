import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  getCalendarDays,
  getDailyBookReadings,
  toDateKey,
} from '@/services/statistics/readingStats';

afterEach(() => vi.unstubAllEnvs());

describe('reading calendar data', () => {
  it.each([
    'Asia/Kathmandu',
    'America/Los_Angeles',
  ])('keeps local month boundaries and book identity in %s', async (timezone) => {
    vi.stubEnv('TZ', timezone);
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    try {
      const a = await stats.upsertBook({ bookMd5: 'a', title: 'Same title', authors: 'A' });
      const b = await stats.upsertBook({ bookMd5: 'b', title: 'Same title', authors: 'B' });
      const insert = (id: number, date: string, duration: number) =>
        stats.insertPageEvent(id, {
          page: 1,
          totalPages: 10,
          startTime: new Date(date).getTime() / 1000,
          duration,
        });
      await insert(a, '2026-10-31T23:59:00', 10);
      await insert(a, '2026-11-01T00:00:00', 60);
      await insert(a, '2026-11-01T00:05:00', 120);
      await insert(b, '2026-11-01T23:59:00', 300);
      await insert(a, '2026-11-02T00:00:00', 20);
      await insert(b, '2026-11-03T12:00:00', 0);
      await insert(a, '2026-12-01T00:00:00', 30);
      const quarters = await stats.getBookQuarterHourDurations(
        new Date('2026-11-01T00:00:00').getTime() / 1000,
        new Date('2026-12-01T00:00:00').getTime() / 1000,
      );
      const days = getDailyBookReadings(quarters);
      expect([...days.keys()]).toEqual(['2026-11-01', '2026-11-02']);
      expect(days.get('2026-11-01')).toEqual([
        { bookMd5: 'b', title: 'Same title', authors: 'B', seconds: 300 },
        { bookMd5: 'a', title: 'Same title', authors: 'A', seconds: 180 },
      ]);
      expect(days.get('2026-11-02')?.[0]?.seconds).toBe(20);
    } finally {
      await stats.close();
    }
  });

  it('returns no books for an empty month', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    try {
      expect(await stats.getBookQuarterHourDurations(0, 100)).toEqual([]);
      expect(getDailyBookReadings([]).size).toBe(0);
    } finally {
      await stats.close();
    }
  });
});

describe('calendar month layout', () => {
  it('includes leap day and complete Monday-first weeks', () => {
    const days = getCalendarDays(new Date(2024, 1, 1));
    expect(days.slice(0, 3)).toEqual([null, null, null]);
    expect(days.filter(Boolean)).toHaveLength(29);
    expect(days.filter(Boolean).map((day) => toDateKey(day!))).toContain('2024-02-29');
    expect(days).toHaveLength(35);
  });

  it('fits six-week months without leaking adjacent-month dates', () => {
    const days = getCalendarDays(new Date(2026, 10, 1));
    expect(days).toHaveLength(42);
    expect(days.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(days.filter(Boolean).map((day) => toDateKey(day!))).toHaveLength(30);
    expect(days[6] && toDateKey(days[6])).toBe('2026-11-01');
  });

  it('keeps every local day through daylight-saving changes', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const keys = getCalendarDays(new Date(2026, 2, 1))
      .filter((day) => day !== null)
      .map(toDateKey);
    expect(new Set(keys).size).toBe(31);
    expect(keys.at(-1)).toBe('2026-03-31');
  });
});
