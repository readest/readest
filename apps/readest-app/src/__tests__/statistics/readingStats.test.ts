// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  getDailySeconds,
  getReadingBars,
  getStreaks,
  shiftPeriod,
  toDateKey,
} from '@/services/statistics/readingStats';

const unix = (local: string) => Math.floor(new Date(local).getTime() / 1000);
const daily = (entries: Record<string, number>) => new Map(Object.entries(entries));
const today = new Date('2026-10-21T15:00:00');

describe('StatisticsDb reading queries', () => {
  it('splits events around local midnight into their own days', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    const book = await stats.upsertBook({ bookMd5: 'a', title: 'A', authors: '' });
    const other = await stats.upsertBook({ bookMd5: 'b', title: 'B', authors: '' });
    const event = (page: number, startTime: number, duration: number) => ({
      page,
      startTime,
      duration,
      totalPages: 100,
    });
    await stats.insertPageEvent(book, event(1, unix('2026-10-20T23:50:00'), 120));
    await stats.insertPageEvent(book, event(2, unix('2026-10-21T00:05:00'), 60));
    await stats.insertPageEvent(book, event(2, unix('2026-10-21T00:10:00'), 30));
    await stats.insertPageEvent(other, event(1, unix('2026-10-21T09:00:00'), 300));

    const days = getDailySeconds(await stats.getQuarterHourDurations());
    expect(Object.fromEntries(days)).toEqual({ '2026-10-20': 120, '2026-10-21': 390 });
    expect(await stats.getReadingTotals()).toEqual({ seconds: 510, books: 2, pages: 3 });
  });

  it('returns zero totals for an empty database', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    expect(await stats.getQuarterHourDurations()).toEqual([]);
    expect(await stats.getReadingTotals()).toEqual({ seconds: 0, books: 0, pages: 0 });
  });
});

describe('getStreaks', () => {
  it('counts a streak that ends today', () => {
    const days = daily({ '2026-10-19': 120, '2026-10-20': 120, '2026-10-21': 120 });
    expect(getStreaks(days, today)).toEqual({ current: 3, longest: 3 });
  });

  it('keeps a streak that ended yesterday until today is over', () => {
    const days = daily({ '2026-10-19': 120, '2026-10-20': 120 });
    expect(getStreaks(days, today).current).toBe(2);
  });

  it('breaks the streak after a day without reading', () => {
    expect(getStreaks(daily({ '2026-10-19': 120 }), today).current).toBe(0);
  });

  it('ignores days with under a minute of reading', () => {
    const days = daily({ '2026-10-20': 30, '2026-10-21': 120 });
    expect(getStreaks(days, today)).toEqual({ current: 1, longest: 1 });
  });

  it('finds the longest streak across month ends', () => {
    const days = daily({
      '2026-09-29': 60,
      '2026-09-30': 60,
      '2026-10-01': 60,
      '2026-10-02': 60,
      '2026-10-21': 60,
    });
    expect(getStreaks(days, today)).toEqual({ current: 1, longest: 4 });
  });
});

describe('getReadingBars', () => {
  it('covers the Sunday-first calendar week holding the date', () => {
    // 2026-10-21 is a Wednesday: its week runs Sunday 10-18 to Saturday 10-24.
    const days = daily({
      '2026-10-17': 999,
      '2026-10-18': 30,
      '2026-10-21': 60,
      '2026-10-25': 999,
    });
    const week = getReadingBars(days, 'week', today);
    expect(week.map((b) => toDateKey(b.date))).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ]);
    expect(week.map((b) => b.seconds)).toEqual([30, 0, 0, 60, 0, 0, 0]);
  });

  it('runs a week across a year end', () => {
    // 2027-01-01 is a Friday.
    const week = getReadingBars(new Map(), 'week', new Date('2027-01-01T08:00:00'));
    expect(toDateKey(week[0]!.date)).toBe('2026-12-27');
    expect(toDateKey(week[6]!.date)).toBe('2027-01-02');
  });

  it('covers the calendar month from its first to its last day', () => {
    const days = daily({
      '2026-09-30': 999,
      '2026-10-01': 30,
      '2026-10-31': 60,
      '2026-11-01': 999,
    });
    const month = getReadingBars(days, 'month', today);
    expect(month).toHaveLength(31);
    expect(toDateKey(month[0]!.date)).toBe('2026-10-01');
    expect(toDateKey(month[30]!.date)).toBe('2026-10-31');
    expect(month.reduce((sum, b) => sum + b.seconds, 0)).toBe(90);
    expect(getReadingBars(days, 'month', new Date('2026-02-14T12:00:00'))).toHaveLength(28);
  });

  it('sums the calendar year into January to December bars', () => {
    const days = daily({ '2025-12-31': 999, '2026-01-01': 60, '2026-10-21': 30, '2026-12-31': 30 });
    const year = getReadingBars(days, 'year', today);
    expect(year.map((b) => toDateKey(b.date))).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`),
    );
    expect(year[0]!.seconds).toBe(60);
    expect(year[9]!.seconds).toBe(30);
    expect(year[11]!.seconds).toBe(30);
  });
});

describe('shiftPeriod', () => {
  it('steps to the start of the neighbouring week, month or year', () => {
    expect(toDateKey(shiftPeriod('week', today, -1))).toBe('2026-10-11');
    expect(toDateKey(shiftPeriod('week', new Date('2026-12-30T12:00:00'), 1))).toBe('2027-01-03');
    expect(toDateKey(shiftPeriod('month', new Date('2026-01-31T12:00:00'), -1))).toBe('2025-12-01');
    expect(toDateKey(shiftPeriod('month', new Date('2026-01-31T12:00:00'), 1))).toBe('2026-02-01');
    expect(toDateKey(shiftPeriod('year', today, -1))).toBe('2025-01-01');
  });
});
