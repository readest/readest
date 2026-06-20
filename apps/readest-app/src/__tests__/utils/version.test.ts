import { describe, test, expect } from 'vitest';
import { parseUpdateVersion, isUpdateNewer } from '@/utils/version';

describe('parseUpdateVersion', () => {
  test('parses a stable version', () => {
    expect(parseUpdateVersion('0.11.4')).toEqual({ base: '0.11.4', stamp: null, isNightly: false });
  });
  test('parses a nightly stamp', () => {
    expect(parseUpdateVersion('0.11.4-2026061406')).toEqual({
      base: '0.11.4',
      stamp: 2026061406,
      isNightly: true,
    });
  });
  test('non-10-digit prerelease is not a nightly stamp', () => {
    expect(parseUpdateVersion('0.11.4-rc.1')).toEqual({
      base: '0.11.4',
      stamp: null,
      isNightly: false,
    });
    expect(parseUpdateVersion('0.11.4-2026')).toEqual({
      base: '0.11.4',
      stamp: null,
      isNightly: false,
    });
  });
  test('returns null for malformed input', () => {
    expect(parseUpdateVersion('')).toBeNull();
    expect(parseUpdateVersion('not-a-version')).toBeNull();
  });
});

describe('isUpdateNewer', () => {
  const cases: Array<[string, string, boolean]> = [
    ['0.11.5', '0.11.4-2026061406', true],
    ['0.11.4-2026061506', '0.11.4-2026061406', true],
    ['0.11.4-2026061406', '0.11.4-2026061506', false],
    ['0.11.4', '0.11.4-2026061406', false],
    ['0.11.4-2026061406', '0.11.4', true],
    ['0.11.5-2026070106', '0.11.4', true],
    ['0.11.4', '0.11.4', false],
    ['0.11.4-2026061406', '0.11.4-2026061406', false],
    ['0.11.4-rc.1', '0.11.4', false],
    ['', '0.11.4', false],
    ['0.11.4', '', false],
  ];
  test.each(cases)('isUpdateNewer(%s, %s) === %s', (candidate, current, expected) => {
    expect(isUpdateNewer(candidate, current)).toBe(expected);
  });
});
