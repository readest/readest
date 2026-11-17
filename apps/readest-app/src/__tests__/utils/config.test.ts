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

  // iPadOS reports a desktop ("Macintosh") user agent. Split View on an iPad
  // is one of the near-square layouts the factor is for.
  it('still trims in iPad Split View', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('window', { innerWidth: 981, innerHeight: 1024 });

    expect(getMaxInlineSize(viewSettings(false))).toBe(576);
  });

  it('keeps the configured width in a near-square Mac window', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 0,
    });
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 900 });

    expect(getMaxInlineSize(viewSettings(false))).toBe(720);
  });
});
