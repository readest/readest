import { describe, expect, test } from 'vitest';
import { needsQueryRangeReads } from '@/utils/ua';

describe('needsQueryRangeReads', () => {
  test('the Chromium-backed platforms read through the rangefile scheme', () => {
    expect(needsQueryRangeReads('android')).toBe(true);
    expect(needsQueryRangeReads('linux')).toBe(true);
  });

  test('the WebView2 and WebKit platforms keep the asset protocol', () => {
    expect(needsQueryRangeReads('windows')).toBe(false);
    expect(needsQueryRangeReads('macos')).toBe(false);
    expect(needsQueryRangeReads('ios')).toBe(false);
  });
});
