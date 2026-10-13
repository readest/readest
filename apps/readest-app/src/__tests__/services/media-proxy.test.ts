import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OsPlatform } from '@/types/system';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauriAppPlatform: vi.fn(() => false),
  getOSPlatform: vi.fn((): OsPlatform => 'android'),
  servers: [] as Array<{ url: string; deletedAt?: number }>,
  settingsServers: [] as Array<{ url: string; deletedAt?: number }>,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: mocks.isTauriAppPlatform };
});

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: mocks.getOSPlatform };
});

vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: { getState: () => ({ servers: mocks.servers }) },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { absServers: mocks.settingsServers } }) },
}));

import { getMediaProxyBase, proxiedMediaUrl } from '@/services/audiobook/mediaProxy';

describe('getMediaProxyBase (#6216)', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.isTauriAppPlatform.mockReturnValue(true);
    mocks.getOSPlatform.mockReturnValue('android');
    mocks.servers = [];
    mocks.settingsServers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never starts a proxy on the web, where fetch and media share one TLS policy', async () => {
    mocks.isTauriAppPlatform.mockReturnValue(false);
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('never starts a proxy on iOS, whose AVPlayer clocks take the direct URL', async () => {
    mocks.getOSPlatform.mockReturnValue('ios');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('passes the live server origins to Rust on every open, deduped, dropping deleted and malformed', async () => {
    mocks.servers = [
      { url: 'https://abs.example:8443' },
      { url: 'https://abs.example:8443/' }, // same origin, trailing slash
      { url: 'http://192.168.2.3:13378' },
      { url: 'http://old.example', deletedAt: 1 }, // removed server
      { url: 'not a url' }, // malformed
    ];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBe('http://127.0.0.1:41234/s3cret');
    await expect(fresh()).resolves.toBe('http://127.0.0.1:41234/s3cret');
    // Re-invoked each open (a server added mid-session must reach the allowlist).
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_media_proxy_base', {
      origins: ['https://abs.example:8443', 'http://192.168.2.3:13378'],
    });
  });

  // The player route can open before the store is hydrated from settings; the
  // book's server (and its origin) still resolves from settings.absServers, so
  // the allowlist must include it or the proxy refuses the opened track (#6216).
  it('includes servers that live only in persisted settings, deduped with the store', async () => {
    mocks.servers = [{ url: 'https://abs.example:8443' }];
    mocks.settingsServers = [
      { url: 'https://abs.example:8443' }, // same origin as the store entry
      { url: 'http://192.168.2.3:13378' }, // store not yet hydrated with this one
    ];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await fresh();
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_media_proxy_base', {
      origins: ['https://abs.example:8443', 'http://192.168.2.3:13378'],
    });
  });

  it('degrades to direct streaming when the proxy cannot start, and retries on the next open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce(new Error('bind failed'));
    mocks.invoke.mockResolvedValueOnce('http://127.0.0.1:5/s');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    await expect(fresh()).resolves.toBe('http://127.0.0.1:5/s');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('exports the same function the openAudiobook path imports', () => {
    expect(typeof getMediaProxyBase).toBe('function');
  });
});

describe('proxiedMediaUrl', () => {
  it('wraps the upstream URL, token and all, as one encoded query value', () => {
    const upstream = 'https://abs.example/api/items/i1/file/2?token=a+b&c=d';
    expect(proxiedMediaUrl('http://127.0.0.1:41234/s3cret', upstream)).toBe(
      `http://127.0.0.1:41234/s3cret/media?u=${encodeURIComponent(upstream)}`,
    );
  });
});
