// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const fallbackBytes = new ArrayBuffer(8);
  const appService = {
    resolveFilePath: vi.fn(async (path: string, base: string) => `/${base}/${path}`),
    exists: vi.fn(async (_path: string, _base: string) => false),
    copyFile: vi.fn(async (..._args: unknown[]) => {}),
    writeFile: vi.fn(async (..._args: unknown[]) => {}),
  };
  const settings = {
    savedBookCoverForLockScreen: 'default',
    savedBookCoverForLockScreenPath: '',
  };
  const book = {
    hash: 'abc123',
    format: 'TXT',
    title: 'A Book Without Cover',
    author: 'Jane Doe',
  };
  return {
    fallbackBytes,
    appService,
    settings,
    book,
    renderFallbackCover: vi.fn(async (_book: unknown) => fallbackBytes),
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: h.appService }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: h.settings, setSettings: vi.fn(), saveSettings: vi.fn() }),
  },
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: () => ({ book: h.book }) }) },
}));
vi.mock('@/utils/cover', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderFallbackCover: h.renderFallbackCover,
}));

import { useBookCoverAutoSave } from '@/app/reader/hooks/useAutoSaveBookCover';

const runAutoSave = async () => {
  renderHook(() => useBookCoverAutoSave('abc123-key'));
  await vi.advanceTimersByTimeAsync(5000);
};

describe('useBookCoverAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.settings.savedBookCoverForLockScreen = 'default';
    h.settings.savedBookCoverForLockScreenPath = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a book without a cover saves a title and author image', async () => {
    h.appService.exists.mockResolvedValue(false);

    await runAutoSave();

    expect(h.renderFallbackCover).toHaveBeenCalledWith(h.book);
    expect(h.appService.writeFile).toHaveBeenCalledWith(
      'last-book-cover.png',
      'Images',
      h.fallbackBytes,
    );
    expect(h.appService.copyFile).not.toHaveBeenCalled();
    expect(h.settings.savedBookCoverForLockScreen).toBe('abc123');
  });

  test('the fallback image goes to the folder the user picked', async () => {
    h.appService.exists.mockResolvedValue(false);
    h.settings.savedBookCoverForLockScreenPath = '/storage/emulated/0/Screensaver';

    await runAutoSave();

    expect(h.appService.writeFile).toHaveBeenCalledWith(
      '/storage/emulated/0/Screensaver/last-book-cover.png',
      'None',
      h.fallbackBytes,
    );
  });

  test('a book with a cover still copies its cover', async () => {
    h.appService.exists.mockResolvedValue(true);

    await runAutoSave();

    expect(h.renderFallbackCover).not.toHaveBeenCalled();
    expect(h.appService.copyFile).toHaveBeenCalledWith(
      '/Books/abc123/cover.png',
      'None',
      'last-book-cover.png',
      'Images',
    );
  });
});
