import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import dayjs from 'dayjs';
import { mergeEditions, MIN_RANKING_SECONDS } from '@/hooks/useReadingStats';
import { getPeriodRange, periodRangeToSeconds, getTzOffsetSecs } from '@/utils/stats';

// Fixed clock: 2026-08-30 12:34:56 local (a Sunday).
const NOW = dayjs('2026-08-30T12:34:56').valueOf();

describe('getPeriodRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns millisecond magnitudes (dayjs-native), not seconds', () => {
    for (const period of ['week', 'month', 'year', 'total'] as const) {
      const { fromTs, toTs } = getPeriodRange(period);
      expect(toTs).toBeGreaterThan(1e12);
      expect(fromTs).toBeGreaterThanOrEqual(0);
    }
  });

  it('toTs is local midnight of tomorrow (exclusive end)', () => {
    const { toTs } = getPeriodRange('week');
    expect(toTs).toBe(dayjs().add(1, 'day').startOf('day').valueOf());
  });

  it('week starts on Monday', () => {
    const { fromTs } = getPeriodRange('week');
    expect(dayjs(fromTs).format('YYYY-MM-DD')).toBe('2026-08-24');
    expect(dayjs(fromTs).day()).toBe(1);
  });

  it('month / year align to local boundaries', () => {
    expect(dayjs(getPeriodRange('month').fromTs).format('YYYY-MM-DD')).toBe('2026-08-01');
    expect(dayjs(getPeriodRange('year').fromTs).format('YYYY-MM-DD')).toBe('2026-01-01');
  });

  it('total spans from epoch', () => {
    expect(getPeriodRange('total')).toEqual({
      fromTs: 0,
      toTs: dayjs().add(1, 'day').startOf('day').valueOf(),
    });
  });
});

describe('periodRangeToSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts the window to Unix seconds matching the db unit', () => {
    const range = getPeriodRange('year');
    const secs = periodRangeToSeconds(range);
    expect(secs.fromTs).toBe(Math.floor(range.fromTs / 1000));
    expect(secs.toTs).toBe(Math.ceil(range.toTs / 1000));
    expect(secs.toTs).toBeLessThan(4e9);
    expect(secs.fromTs * 1000).toBeLessThan(range.fromTs + 1000);
    expect(secs.toTs * 1000).toBeGreaterThanOrEqual(range.toTs - 999);
  });

  it('total keeps fromTs at 0', () => {
    expect(periodRangeToSeconds(getPeriodRange('total')).fromTs).toBe(0);
  });

  it('toTs rounds up so the exclusive bound stays exclusive', () => {
    const secs = periodRangeToSeconds({ fromTs: 1000, toTs: 1500 });
    expect(secs).toEqual({ fromTs: 1, toTs: 2 });
  });

  it('is consistent with the tracker clock (nowSec) and the tz helper', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const secs = periodRangeToSeconds(getPeriodRange('total'));
    expect(nowSec).toBeGreaterThan(secs.fromTs);
    expect(nowSec).toBeLessThan(secs.toTs);
    expect(getTzOffsetSecs() % 60).toBe(0);
  });
});

describe('reading ranking', () => {
  it('merges editions before applying the five-minute threshold', () => {
    const rows = [
      { bookMd5: 'a', title: 'Same Book', authors: 'Author', seconds: 160, pages: 2 },
      { bookMd5: 'b', title: 'Same Book', authors: 'Author', seconds: 140, pages: 2 },
      { bookMd5: 'c', title: 'Too Short', authors: 'Author', seconds: 299, pages: 3 },
      { bookMd5: 'd', title: 'Longer', authors: 'Author', seconds: 600, pages: 4 },
    ];
    const ranking = mergeEditions(rows, new Map());
    expect(MIN_RANKING_SECONDS).toBe(300);
    expect(ranking.map((row) => [row.title, row.seconds, row.versions])).toEqual([
      ['Longer', 600, 1],
      ['Same Book', 300, 2],
    ]);
  });
});
