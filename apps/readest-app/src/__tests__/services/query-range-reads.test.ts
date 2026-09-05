import { describe, expect, test } from 'vitest';
import { needsQueryRangeReads } from '@/utils/ua';

const WEBKITGTK_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CEF_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const WEBVIEW2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

describe('needsQueryRangeReads', () => {
  test('Android always reads through the rangefile scheme', () => {
    expect(
      needsQueryRangeReads('android', 'Mozilla/5.0 (Linux; Android 14) Chrome/151.0.0.0'),
    ).toBe(true);
  });

  test('Linux on the CEF (Chromium) runtime reads through the rangefile scheme', () => {
    expect(needsQueryRangeReads('linux', CEF_UA)).toBe(true);
  });

  test('Linux on WebKitGTK keeps the asset protocol', () => {
    expect(needsQueryRangeReads('linux', WEBKITGTK_UA)).toBe(false);
  });

  test('other desktop platforms are unaffected even with a Chrome token', () => {
    expect(needsQueryRangeReads('windows', WEBVIEW2_UA)).toBe(false);
    expect(needsQueryRangeReads('macos', WEBKITGTK_UA)).toBe(false);
    expect(needsQueryRangeReads('ios', WEBKITGTK_UA)).toBe(false);
  });
});
