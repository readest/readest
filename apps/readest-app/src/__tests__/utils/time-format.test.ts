import { describe, expect, test } from 'vitest';

import { formatPlaybackTime } from '@/utils/time';

describe('formatPlaybackTime', () => {
  test('formats minutes and seconds by default', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(5)).toBe('0:05');
    expect(formatPlaybackTime(62)).toBe('1:02');
    expect(formatPlaybackTime(600)).toBe('10:00');
  });

  test('formats hours when the value reaches one hour', () => {
    expect(formatPlaybackTime(3600)).toBe('1:00:00');
    expect(formatPlaybackTime(3600 + 61)).toBe('1:01:01');
  });

  test('forceHours pins both labels of a row to the same layout', () => {
    // Both labels use the format chosen by the TOTAL's magnitude so the row
    // never re-layouts when the elapsed time crosses an hour.
    expect(formatPlaybackTime(62, true)).toBe('0:01:02');
  });

  test('clamps negative and non-finite input to zero', () => {
    expect(formatPlaybackTime(-5)).toBe('0:00');
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
    expect(formatPlaybackTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  test('truncates fractional seconds', () => {
    expect(formatPlaybackTime(59.9)).toBe('0:59');
  });
});
