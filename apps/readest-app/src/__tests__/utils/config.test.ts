// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMaxInlineSize } from '@/utils/config';
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

  // The 0.8 factor is for unfolded foldables and split-screen: a near-square
  // desktop window is a window the user sized, not a foldable.
  it('keeps the configured width in a near-square desktop window', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 900 });

    expect(getMaxInlineSize(viewSettings(false))).toBe(720);
  });

  it('still trims in a near-square mobile viewport', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    vi.stubGlobal('window', { innerWidth: 900, innerHeight: 1000 });

    expect(getMaxInlineSize(viewSettings(false))).toBe(576);
  });
});
