import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectsColumnSpread } from '@/utils/config';
import type { ViewSettings } from '@/types/book';

afterEach(() => vi.unstubAllGlobals());

const settings = (extra: Partial<ViewSettings>) =>
  ({
    vertical: false,
    scrolled: false,
    maxInlineSize: 720,
    maxColumnCount: 2,
    ...extra,
  }) as ViewSettings;

describe('expectsColumnSpread (#6307)', () => {
  it('mirrors the paginator: two columns once the page is wider than maxInlineSize', () => {
    vi.stubGlobal('window', { innerWidth: 951, innerHeight: 669 });
    // iPhone Duo inner display, landscape, minus its 84pt strip.
    expect(expectsColumnSpread(settings({}), 867)).toBe(true);
    // Cover display: a single column.
    expect(expectsColumnSpread(settings({}), 382)).toBe(false);
  });

  it('never a spread when capped to one column, scrolled, or vertical', () => {
    vi.stubGlobal('window', { innerWidth: 951, innerHeight: 669 });
    expect(expectsColumnSpread(settings({ maxColumnCount: 1 }), 867)).toBe(false);
    expect(expectsColumnSpread(settings({ scrolled: true }), 867)).toBe(false);
    expect(expectsColumnSpread(settings({ vertical: true }), 867)).toBe(false);
  });
});
