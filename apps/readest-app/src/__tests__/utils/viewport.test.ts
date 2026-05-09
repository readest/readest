import { describe, test, expect } from 'vitest';
import { getAndroidPatchedViewportContent } from '@/utils/viewport';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MACOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const BASE_VIEWPORT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

describe('getAndroidPatchedViewportContent', () => {
  test('returns null on macOS Safari', () => {
    expect(getAndroidPatchedViewportContent(MACOS_UA, BASE_VIEWPORT)).toBeNull();
  });

  test('returns null on iOS Safari', () => {
    expect(getAndroidPatchedViewportContent(IOS_UA, BASE_VIEWPORT)).toBeNull();
  });

  test('appends interactive-widget on Android Chrome', () => {
    expect(getAndroidPatchedViewportContent(ANDROID_UA, BASE_VIEWPORT)).toBe(
      `${BASE_VIEWPORT}, interactive-widget=resizes-content`,
    );
  });

  test('returns null when interactive-widget is already present', () => {
    const existing = `${BASE_VIEWPORT}, interactive-widget=resizes-visual`;
    expect(getAndroidPatchedViewportContent(ANDROID_UA, existing)).toBeNull();
  });

  test('handles empty current content without leading comma', () => {
    expect(getAndroidPatchedViewportContent(ANDROID_UA, '')).toBe(
      'interactive-widget=resizes-content',
    );
  });
});
