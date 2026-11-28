import { describe, expect, it } from 'vitest';
import {
  getDailySpeeds,
  getMonthlySpeeds,
  getSpeedChange,
  getSpeedLanguages,
  getSpeedPoints,
  sumSpeeds,
  toPace,
  type ReadingSpeedQuarter,
} from '@/services/statistics/readingSpeedStats';
import type { ReadingSpeedUnit } from '@/types/statistics';

const quarter = (
  date: Date,
  lang: string,
  unit: ReadingSpeedUnit,
  count: number,
  minutes: number,
): ReadingSpeedQuarter => ({
  quarter: date.getTime() / 900_000,
  lang,
  unit,
  count,
  durationMs: minutes * 60_000,
});

// Local times. 2026-11-01 is a Sunday, so the week of 11-04 starts on it.
const quarters = [
  quarter(new Date(2026, 9, 20, 21), 'en', 'words', 2000, 10),
  quarter(new Date(2026, 10, 2, 8), 'en', 'words', 1000, 5),
  quarter(new Date(2026, 10, 2, 23, 45), 'en', 'words', 1500, 5),
  quarter(new Date(2026, 10, 4, 9), 'en', 'words', 3000, 10),
  quarter(new Date(2026, 10, 3, 9), 'zh', 'characters', 16_000, 40),
  quarter(new Date(2026, 10, 3, 10), '', 'words', 200, 1),
];

describe('reading speed by language', () => {
  it('lists each language read, most measured reading first', () => {
    expect(getSpeedLanguages(quarters)).toEqual([
      {
        key: 'zh:characters',
        lang: 'zh',
        unit: 'characters',
        total: { unit: 'characters', count: 16_000, durationMs: 2_400_000 },
      },
      {
        key: 'en:words',
        lang: 'en',
        unit: 'words',
        total: { unit: 'words', count: 7500, durationMs: 1_800_000 },
      },
      {
        key: ':words',
        lang: '',
        unit: 'words',
        total: { unit: 'words', count: 200, durationMs: 60_000 },
      },
    ]);
  });

  it('folds one language’s quarter hours into local days', () => {
    const daily = getDailySpeeds(quarters, 'en:words');
    expect([...daily.keys()]).toEqual(['2026-10-20', '2026-11-02', '2026-11-04']);
    expect(daily.get('2026-11-02')).toEqual({ unit: 'words', count: 2500, durationMs: 600_000 });
  });

  it('averages a week by day and a year by month, weighted by measured time', () => {
    const daily = getDailySpeeds(quarters, 'en:words');
    const week = getSpeedPoints(daily, 'week', new Date(2026, 10, 4));
    expect(week.map(({ date }) => date.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(week.map(({ speed }) => toPace(speed))).toEqual([
      null,
      250,
      null,
      300,
      null,
      null,
      null,
    ]);
    const year = getSpeedPoints(daily, 'year', new Date(2026, 10, 4));
    expect(year).toHaveLength(12);
    expect(toPace(year[9]!.speed)).toBe(200);
    // 5,500 words over 20 minutes.
    expect(toPace(year[10]!.speed)).toBe(275);
    expect(year[11]!.speed).toBeNull();
  });

  it('sums a period, compares it with the one before, and finds the best month', () => {
    const daily = getDailySpeeds(quarters, 'en:words');
    const november = sumSpeeds(daily, new Date(2026, 10, 1), new Date(2026, 11, 1));
    const october = sumSpeeds(daily, new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(toPace(november)).toBe(275);
    expect(getSpeedChange(november, october)).toBeCloseTo(0.375);
    expect(getSpeedChange(november, null)).toBeNull();
    expect(sumSpeeds(daily, new Date(2026, 11, 1), new Date(2027, 0, 1))).toBeNull();
    expect([...getMonthlySpeeds(daily)].map(([month, speed]) => [month, toPace(speed)])).toEqual([
      ['2026-10', 200],
      ['2026-11', 275],
    ]);
  });
});
