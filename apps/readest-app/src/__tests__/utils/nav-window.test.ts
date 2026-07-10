import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { AppService } from '@/types/system';

const webviewWindowCtor = vi.fn();

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor(label: string, options: Record<string, unknown>) {
      webviewWindowCtor(label, options);
    }
    once() {}
    show() {}
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
  ScrollBarStyle: {},
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
  isPWA: () => false,
}));

import { showReaderWindow } from '@/utils/nav';

const makeAppService = (os: 'macos' | 'windows' | 'linux'): AppService =>
  ({
    isMacOSApp: os === 'macos',
    isWindowsApp: os === 'windows',
    isLinuxApp: os === 'linux',
    osPlatform: os,
  }) as unknown as AppService;

// Regression (#3682): reader/extra windows opened via nav.ts must also be
// opaque on Linux — a transparent WebKitGTK window goes invisible when the web
// process is busy. Only macOS (native decorations) stays non-transparent by
// design; Windows keeps its existing behavior.
describe('nav.ts window transparency', () => {
  beforeEach(() => {
    webviewWindowCtor.mockClear();
  });

  test('Linux reader window is not transparent', () => {
    showReaderWindow(makeAppService('linux'), ['book-1']);
    expect(webviewWindowCtor).toHaveBeenCalledTimes(1);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });

  test('macOS reader window is not transparent (native decorations)', () => {
    showReaderWindow(makeAppService('macos'), ['book-1']);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });
});
