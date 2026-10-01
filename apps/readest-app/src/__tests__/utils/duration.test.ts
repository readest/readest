import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationAndPagesLeft, formatDurationLeft } from '@/utils/duration';
import type { TranslationFunc } from '@/hooks/useTranslation';

const _: TranslationFunc = (key, options) =>
  key.replace(/{{(\w+)}}/g, (_match, name) => String(options?.[name] ?? ''));

describe('time left formatting', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [96, '1h 36m'],
    [630, '10h 30m'],
  ])('formats %i minutes as "%s"', (minutes, duration) => {
    expect(formatDurationLeft(minutes, _)).toBe(`${duration} left`);
    expect(formatDurationAndPagesLeft(minutes, 9, _)).toBe(`${duration} and 9 pages left`);
  });
});

describe('formatDuration with a number formatter', () => {
  it('formats the hours and minutes through it', () => {
    const wrap = (n: number) => `<${n}>`;
    expect(formatDuration(96, _, wrap)).toBe('<1>h <36>m');
    expect(formatDuration(45, _, wrap)).toBe('<45>m');
    expect(formatDuration(120, _, wrap)).toBe('<2>h');
  });
});
