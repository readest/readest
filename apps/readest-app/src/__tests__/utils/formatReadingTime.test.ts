import { describe, it, expect } from 'vitest';
import { formatReadingTime } from '@/utils/formatReadingTime';

describe('formatReadingTime', () => {
  it('returns "0m" for zero seconds', () => {
    expect(formatReadingTime(0)).toBe('0m');
  });

  it('returns "0m" for negative seconds', () => {
    expect(formatReadingTime(-10)).toBe('0m');
  });

  it('returns "< 1m" for sub-minute durations', () => {
    expect(formatReadingTime(1)).toBe('< 1m');
    expect(formatReadingTime(30)).toBe('< 1m');
    expect(formatReadingTime(59)).toBe('< 1m');
  });

  it('returns minutes only for durations under 1 hour', () => {
    expect(formatReadingTime(60)).toBe('1m');
    expect(formatReadingTime(120)).toBe('2m');
    expect(formatReadingTime(300)).toBe('5m');
    expect(formatReadingTime(2700)).toBe('45m');
    expect(formatReadingTime(3540)).toBe('59m');
  });

  it('returns hours and minutes for durations 1 hour+', () => {
    expect(formatReadingTime(3600)).toBe('1h 0m');
    expect(formatReadingTime(3720)).toBe('1h 2m');
    expect(formatReadingTime(7200)).toBe('2h 0m');
    expect(formatReadingTime(9000)).toBe('2h 30m');
  });

  it('handles large durations', () => {
    expect(formatReadingTime(86400)).toBe('24h 0m');
    expect(formatReadingTime(90000)).toBe('25h 0m');
  });

  it('floors partial minutes', () => {
    // 1 minute + 30 seconds = 90 seconds → 1m (floors to 1 minute)
    expect(formatReadingTime(90)).toBe('1m');
    // 1 hour + 1 minute + 45 seconds → 1h 1m
    expect(formatReadingTime(3705)).toBe('1h 1m');
  });
});
