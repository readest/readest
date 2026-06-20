import { describe, expect, it } from 'vitest';

import { formatSeries } from '@/utils/book';

describe('formatSeries', () => {
  it('returns an empty string when there is no series name', () => {
    expect(formatSeries(undefined)).toBe('');
    expect(formatSeries('')).toBe('');
    expect(formatSeries('   ')).toBe('');
  });

  it('returns an empty string when only an index is present', () => {
    expect(formatSeries(undefined, 3)).toBe('');
  });

  it('returns the trimmed series name when no index is present', () => {
    expect(formatSeries('Harry Potter')).toBe('Harry Potter');
    expect(formatSeries('  The Expanse  ')).toBe('The Expanse');
  });

  it('appends the series number when a positive index is present', () => {
    expect(formatSeries('Harry Potter', 3)).toBe('Harry Potter #3');
    expect(formatSeries('  The Expanse  ', 2)).toBe('The Expanse #2');
  });

  it('supports fractional series indices', () => {
    expect(formatSeries('The Expanse', 1.5)).toBe('The Expanse #1.5');
  });

  it('omits the number when the index is zero or not a finite number', () => {
    expect(formatSeries('Harry Potter', 0)).toBe('Harry Potter');
    expect(formatSeries('Harry Potter', Number.NaN)).toBe('Harry Potter');
  });
});
