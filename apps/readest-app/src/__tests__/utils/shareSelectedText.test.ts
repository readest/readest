import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const shareTextMock = vi.fn().mockResolvedValue(undefined);
const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareText: (...args: unknown[]) => shareTextMock(...args),
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeClipboardMock(...args),
}));

import { canShareText, shareSelectedText } from '@/utils/share';

describe('shareSelectedText', () => {
  beforeEach(() => {
    shareTextMock.mockClear().mockResolvedValue(undefined);
    writeClipboardMock.mockClear().mockResolvedValue(undefined);
    // @ts-expect-error - reset between tests
    delete globalThis.navigator.share;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup
    delete globalThis.navigator.share;
  });

  test('no-op on empty text', async () => {
    await shareSelectedText('', undefined, { isMobileApp: true });
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('uses native shareText on mobile', async () => {
    await shareSelectedText('hello', { x: 1, y: 2 }, { isMobileApp: true });
    expect(shareTextMock).toHaveBeenCalledWith('hello', { position: { x: 1, y: 2 } });
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('uses native shareText on macOS desktop', async () => {
    await shareSelectedText('hello', undefined, { isMacOSApp: true });
    expect(shareTextMock).toHaveBeenCalledTimes(1);
  });

  test('does NOT use native shareText on Windows/Linux; falls to navigator.share', async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator.share = navShare;
    // A desktop platform that is neither mobile nor macOS (e.g. Windows/Linux):
    // native sharekit is skipped (issue #4343) and we fall to the Web Share API.
    await shareSelectedText('hello', undefined, { isMobileApp: false, isMacOSApp: false });
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
  });

  test('falls back to navigator.share when not a native share platform', async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, null);
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('swallows an AbortError (user dismissed) without clipboard fallback', async () => {
    const abortErr = new Error('user dismissed');
    abortErr.name = 'AbortError';
    const navShare = vi.fn().mockRejectedValue(abortErr);
    globalThis.navigator.share = navShare;
    await expect(shareSelectedText('hello', undefined, null)).resolves.toBeUndefined();
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('falls back to clipboard when navigator.share fails for a non-Abort reason', async () => {
    // e.g. NotAllowedError when a quick action fires without a user gesture.
    const notAllowed = new Error('permission denied');
    notAllowed.name = 'NotAllowedError';
    const navShare = vi.fn().mockRejectedValue(notAllowed);
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, null);
    expect(writeClipboardMock).toHaveBeenCalledWith('hello');
  });

  test('falls back to clipboard when no share method exists', async () => {
    await shareSelectedText('hello', undefined, null);
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).toHaveBeenCalledWith('hello');
  });

  test('falls back to navigator.share when native shareText throws', async () => {
    shareTextMock.mockRejectedValueOnce(new Error('plugin unavailable'));
    const navShare = vi.fn().mockResolvedValue(undefined);
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, { isMobileApp: true });
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
  });
});

describe('canShareText', () => {
  beforeEach(() => {
    // @ts-expect-error - reset between tests
    delete globalThis.navigator.share;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup
    delete globalThis.navigator.share;
  });

  test('true on mobile and macOS', () => {
    expect(canShareText({ isMobileApp: true })).toBe(true);
    expect(canShareText({ isMacOSApp: true })).toBe(true);
  });

  test('true when the Web Share API is present', () => {
    globalThis.navigator.share = vi.fn().mockResolvedValue(undefined);
    expect(canShareText({ isMobileApp: false, isMacOSApp: false })).toBe(true);
    expect(canShareText(null)).toBe(true);
  });

  test('false on desktop without the Web Share API', () => {
    expect(canShareText({ isMobileApp: false, isMacOSApp: false })).toBe(false);
    expect(canShareText(null)).toBe(false);
  });
});
