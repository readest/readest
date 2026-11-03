import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOK_LAYOUT } from '@/services/constants';
import { getDefaultViewSettings } from '@/services/settingsService';
import { loadBookConfig } from '@/services/bookService';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

describe('view settings defaults', () => {
  it.each([
    { platform: 'desktop app', isDesktopApp: true, isMobile: false, spread: 'auto' },
    { platform: 'mobile app', isDesktopApp: false, isMobile: true, spread: 'none' },
    { platform: 'desktop browser', isDesktopApp: false, isMobile: false, spread: 'none' },
    { platform: 'mobile browser', isDesktopApp: false, isMobile: true, spread: 'none' },
  ])('defaults to $spread spread on $platform (#7283)', ({ isDesktopApp, isMobile, spread }) => {
    const settings = getDefaultViewSettings({
      fs: {} as FileSystem,
      isDesktopApp,
      isMobile,
      isEink: false,
      isAppDataSandbox: false,
    });
    expect(settings.spreadMode).toBe(spread);
  });

  it.each([
    'PDF',
    'CBZ',
  ] as const)('inherits the chosen spread for a new %s and keeps book overrides', async (format) => {
    const fs = {
      exists: async () => true,
      readFile: async () => JSON.stringify({ viewSettings: { spreadMode: 'none' } }),
    } as unknown as FileSystem;
    const book = { hash: 'test', format } as Book;
    const globalViewSettings = getDefaultViewSettings({
      fs,
      isMobile: false,
      isDesktopApp: true,
      isEink: false,
      isAppDataSandbox: false,
    });
    const settings = { globalViewSettings } as SystemSettings;
    expect((await loadBookConfig(fs, book, settings)).viewSettings?.spreadMode).toBe('none');
    fs.exists = async () => false;
    expect((await loadBookConfig(fs, book, settings)).viewSettings?.spreadMode).toBe('auto');
    settings.globalViewSettings.spreadMode = 'none';
    expect((await loadBookConfig(fs, book, settings)).viewSettings?.spreadMode).toBe('none');
  });

  it('defaults scrolledDirection to vertical (readest#4995)', () => {
    expect(DEFAULT_BOOK_LAYOUT.scrolledDirection).toBe('vertical');
  });
});
