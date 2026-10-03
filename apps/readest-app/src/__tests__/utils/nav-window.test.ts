import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { AppService } from '@/types/system';

const webviewWindowCtor = vi.fn();
let openWindowLabels: string[] = ['main'];
// `tauri://created` handlers of windows whose creation is still pending.
const createdHandlers: (() => void)[] = [];

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getAllWebviewWindows: async () => openWindowLabels.map((label) => ({ label })),
  WebviewWindow: class {
    constructor(label: string, options: Record<string, unknown>) {
      webviewWindowCtor(label, options);
    }
    once(event: string, handler: () => void) {
      if (event === 'tauri://created') createdHandlers.push(handler);
    }
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

  test('Linux reader window is not transparent', async () => {
    await showReaderWindow(makeAppService('linux'), ['book-1']);
    expect(webviewWindowCtor).toHaveBeenCalledTimes(1);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });

  test('macOS reader window is not transparent (native decorations)', async () => {
    await showReaderWindow(makeAppService('macos'), ['book-1']);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });
});

// Regression (#6363): after closing one of several reader windows, the next
// book opened from the library must not reuse the label of a window that is
// still open, or Tauri refuses to create it and nothing opens.
describe('nav.ts reader window labels', () => {
  beforeEach(() => {
    webviewWindowCtor.mockClear();
    for (const created of createdHandlers.splice(0)) created();
  });

  test('skips labels of reader windows that are still open', async () => {
    openWindowLabels = ['main', 'reader-0', 'reader-1', 'reader-2'];
    await showReaderWindow(makeAppService('linux'), ['book-4']);
    expect(webviewWindowCtor.mock.calls[0]![0]).toBe('reader-3');
  });

  test('reuses the label of a closed reader window', async () => {
    openWindowLabels = ['main', 'reader-1', 'reader-2'];
    await showReaderWindow(makeAppService('linux'), ['book-4']);
    expect(webviewWindowCtor.mock.calls[0]![0]).toBe('reader-0');
  });

  test('overlapping launches do not pick the same label', async () => {
    openWindowLabels = ['main'];
    await Promise.all([
      showReaderWindow(makeAppService('linux'), ['book-1']),
      showReaderWindow(makeAppService('linux'), ['book-2']),
    ]);
    const labels = webviewWindowCtor.mock.calls.map((call) => call[0]);
    expect(labels).toEqual(['reader-0', 'reader-1']);
  });
});
