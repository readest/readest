import { describe, it, expect } from 'vitest';
import { BookProgress } from '@/types/book';
import { getLocalProgressPreview, getProgressPercentage } from '@/app/reader/hooks/kosyncPreview';

const makeProgress = (overrides: Partial<BookProgress> = {}): BookProgress =>
  ({
    location: '',
    sectionHref: '',
    sectionLabel: '',
    section: { current: 0, total: 0 },
    pageinfo: { current: 0, total: 100 },
    timeinfo: { section: 0, total: 0 },
    index: 0,
    range: {} as Range,
    page: 1,
    ...overrides,
  }) as BookProgress;

// Minimal interpolating stand-in for the i18n `_()` function.
const t = (key: string, opts: Record<string, number | string> = {}) =>
  key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts[name]));

describe('getProgressPercentage', () => {
  it('returns 0 when page info is missing', () => {
    expect(getProgressPercentage(undefined)).toBe(0);
  });

  it('returns 0 when the total is zero', () => {
    expect(getProgressPercentage({ current: 0, total: 0 })).toBe(0);
  });

  it('treats the page index as 1-based', () => {
    expect(getProgressPercentage({ current: 49, total: 100 })).toBe(0.5);
  });
});

describe('getLocalProgressPreview', () => {
  it('uses the section label for reflowable books', () => {
    const progress = makeProgress({
      sectionLabel: 'Chapter 3',
      pageinfo: { current: 49, total: 100 },
    });
    expect(getLocalProgressPreview(progress, false, t)).toBe('Chapter 3 (50%)');
  });

  it('falls back to page info when the section label is undefined', () => {
    const progress = makeProgress({
      sectionLabel: undefined as unknown as string,
      pageinfo: { current: 0, total: 100 },
    });
    const result = getLocalProgressPreview(progress, false, t);
    expect(result).not.toContain('undefined');
    expect(result).toBe('Page 1 of 100 (1%)');
  });

  it('falls back to page info when the section label is blank', () => {
    const progress = makeProgress({
      sectionLabel: '   ',
      pageinfo: { current: 9, total: 50 },
    });
    const result = getLocalProgressPreview(progress, false, t);
    expect(result).not.toContain('undefined');
    expect(result).toBe('Page 10 of 50 (20%)');
  });

  it('uses page info for fixed-layout books regardless of section label', () => {
    const progress = makeProgress({
      sectionLabel: 'ignored',
      section: { current: 4, total: 20 },
    });
    expect(getLocalProgressPreview(progress, true, t)).toBe('Page 5 of 20 (25%)');
  });
});
