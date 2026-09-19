import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectsColumnSpread, getMaxInlineSize } from '@/utils/config';
import type { ViewSettings } from '@/types/book';

const viewSettings = (vertical: boolean) => ({ vertical, maxInlineSize: 720 }) as ViewSettings;

describe('getMaxInlineSize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the configured inline width for horizontal writing', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 });

    expect(getMaxInlineSize(viewSettings(false))).toBe(720);
  });

  it('does not cap the physical height for vertical writing', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 });

    expect(getMaxInlineSize(viewSettings(true))).toBe(1200);
  });
});

describe('expectsColumnSpread (#6307)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const settings = (extra: Partial<ViewSettings>) =>
    ({
      vertical: false,
      scrolled: false,
      maxInlineSize: 720,
      maxColumnCount: 2,
      ...extra,
    }) as ViewSettings;

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
