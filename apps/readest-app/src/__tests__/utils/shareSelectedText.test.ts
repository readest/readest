import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const shareTextMock = vi.fn().mockResolvedValue(undefined);
const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareText: (...args: unknown[]) => shareTextMock(...args),
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeClipboardMock(...args),
}));

import { shareSelectedText } from '@/utils/share';

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
    await shareSelectedText('hello', undefined, { isWindowsApp: true, hasWindow: true });
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

  test('swallows navigator.share rejection (user dismissed) without clipboard fallback', async () => {
    const navShare = vi.fn().mockRejectedValue(new Error('AbortError'));
    globalThis.navigator.share = navShare;
    await expect(shareSelectedText('hello', undefined, null)).resolves.toBeUndefined();
    expect(writeClipboardMock).not.toHaveBeenCalled();
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
