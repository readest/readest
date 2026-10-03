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
});
