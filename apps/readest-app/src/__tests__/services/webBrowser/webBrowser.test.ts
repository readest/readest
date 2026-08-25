import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
const pluginListeners: Array<{ event: string; handler: (payload: unknown) => void }> = [];
const unregisterMock = vi.fn();
const windowListeners: Array<{ event: string; handler: (e: { payload: unknown }) => void }> = [];
const unlistenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
  addPluginListener: (_plugin: string, event: string, handler: (payload: unknown) => void) => {
    pluginListeners.push({ event, handler });
    return Promise.resolve({ unregister: unregisterMock });
  },
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: (event: string, handler: (e: { payload: unknown }) => void) => {
      windowListeners.push({ event, handler });
      return Promise.resolve(unlistenMock);
    },
  }),
}));
vi.mock('@/utils/style', () => ({ getThemeCode: () => ({ bg: '#111111', fg: '#eeeeee' }) }));

import {
  openWebBrowser,
  setWebBrowserStatus,
  subscribeWebBrowserDownloads,
  isSupportedBookDownload,
  WEB_BROWSER_DOWNLOAD_EVENT,
} from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';

const _ = (k: string) => `t:${k}`;

beforeEach(() => {
  invokeMock.mockReset();
  pluginListeners.length = 0;
  windowListeners.length = 0;
  unregisterMock.mockReset();
  unlistenMock.mockReset();
});

describe('getWebBrowserOptions', () => {
  it('carries theme colours, eink flag and every translated label', () => {
    const options = getWebBrowserOptions(_, true);
    expect(options.background).toBe('#111111');
    expect(options.foreground).toBe('#eeeeee');
    expect(options.isEink).toBe(true);
    expect(options.labels.back).toBe('t:Back');
    expect(options.labels.added).toBe('t:Added to library');
    expect(Object.keys(options.labels).sort()).toEqual(
      [
        'added',
        'back',
        'close',
        'copyLink',
        'downloading',
        'failed',
        'forward',
        'importing',
        'menu',
        'notSecure',
        'open',
        'openInBrowser',
        'reload',
        'signOut',
        'stop',
        'unsupported',
      ].sort(),
    );
  });
});

describe('openWebBrowser', () => {
  it('invokes open_web_browser and returns the result', async () => {
    invokeMock.mockResolvedValue({ openBookHash: 'h1' });
    const options = getWebBrowserOptions(_, false);
    const result = await openWebBrowser('https://calibre.example.com', options);
    expect(invokeMock).toHaveBeenCalledWith('open_web_browser', {
      url: 'https://calibre.example.com',
      options,
    });
    expect(result).toEqual({ openBookHash: 'h1' });
  });

  it('normalises a null result to an empty object', async () => {
    invokeMock.mockResolvedValue(null);
    await expect(openWebBrowser('https://x', getWebBrowserOptions(_, false))).resolves.toEqual({});
  });
});

describe('setWebBrowserStatus', () => {
  it('invokes set_web_browser_status and swallows failures', async () => {
    invokeMock.mockRejectedValue(new Error('no browser'));
    await expect(
      setWebBrowserStatus({ state: 'importing', filename: 'dune.epub' }),
    ).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith('set_web_browser_status', {
      status: { state: 'importing', filename: 'dune.epub' },
    });
  });
});

describe('subscribeWebBrowserDownloads', () => {
  const download = { url: 'u', path: '/p/dune.epub', filename: 'dune.epub', success: true };

  it('uses the native-bridge plugin listener on mobile', async () => {
    const onDownload = vi.fn();
    const dispose = await subscribeWebBrowserDownloads(true, onDownload);
    expect(pluginListeners).toEqual([
      expect.objectContaining({ event: WEB_BROWSER_DOWNLOAD_EVENT }),
    ]);
    pluginListeners[0]!.handler(download);
    expect(onDownload).toHaveBeenCalledWith(download);
    dispose();
    expect(unregisterMock).toHaveBeenCalled();
  });

  it('uses the window event listener on desktop', async () => {
    const onDownload = vi.fn();
    const dispose = await subscribeWebBrowserDownloads(false, onDownload);
    expect(windowListeners).toEqual([
      expect.objectContaining({ event: WEB_BROWSER_DOWNLOAD_EVENT }),
    ]);
    windowListeners[0]!.handler({ payload: download });
    expect(onDownload).toHaveBeenCalledWith(download);
    dispose();
    expect(unlistenMock).toHaveBeenCalled();
  });
});

describe('isSupportedBookDownload', () => {
  it('accepts book extensions case-insensitively and rejects others', () => {
    expect(isSupportedBookDownload('Dune.EPUB')).toBe(true);
    expect(isSupportedBookDownload('comic.cbz')).toBe(true);
    expect(isSupportedBookDownload('cover.jpg')).toBe(false);
    expect(isSupportedBookDownload('noext')).toBe(false);
  });
});
