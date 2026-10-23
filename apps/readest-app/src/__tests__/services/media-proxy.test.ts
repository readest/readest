import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: vi.fn(),
  isTauriAppPlatform: vi.fn(() => false),
  isIOSApp: false,
  servers: [] as Array<{ url: string; deletedAt?: number; allowSelfSignedCert?: boolean }>,
  settingsServers: [] as Array<{ url: string; deletedAt?: number; allowSelfSignedCert?: boolean }>,
  bookorbit: undefined as
    | { serverUrl: string; password?: string; allowSelfSignedCert?: boolean }
    | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: mocks.stat }));

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return {
    ...actual,
    isTauriAppPlatform: mocks.isTauriAppPlatform,
    getInitializedAppService: () => ({ isIOSApp: mocks.isIOSApp }),
  };
});

vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: { getState: () => ({ servers: mocks.servers }) },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: { absServers: mocks.settingsServers, bookorbit: mocks.bookorbit },
    }),
  },
}));

import {
  getLocalMediaUrl,
  getMediaProxyBase,
  proxiedMediaUrl,
} from '@/services/audiobook/mediaProxy';

describe('getMediaProxyBase (#6216)', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.isTauriAppPlatform.mockReturnValue(true);
    mocks.isIOSApp = false;
    mocks.servers = [];
    mocks.settingsServers = [];
    mocks.bookorbit = undefined;
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

  // Read from the app service, not the user agent: iPadOS sends a desktop one (#6974).
  it('never starts a proxy in the iOS app, whose AVPlayer clocks take the direct URL', async () => {
    mocks.isIOSApp = true;
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
      // Saved before the option existed, so both keep accepting self-signed certs.
      selfSigned: ['https://abs.example:8443', 'http://192.168.2.3:13378'],
    });
  });

  it("forwards each server's certificate choice, preferring the live store copy", async () => {
    mocks.servers = [
      { url: 'https://verified.example', allowSelfSignedCert: false },
      { url: 'https://home.example', allowSelfSignedCert: true },
    ];
    // A stale persisted copy must not re-enable what the store turned off.
    mocks.settingsServers = [{ url: 'https://verified.example' }];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    // A grant that doesn't say accepts self-signed certificates, like a server.
    await fresh({ origin: 'https://books.example', authorization: 'Bearer t' });
    await fresh({ origin: 'https://lab.example', allowSelfSignedCert: false });
    expect(mocks.invoke.mock.calls[0]![1]).toMatchObject({
      origins: ['https://verified.example', 'https://home.example', 'https://books.example'],
      selfSigned: ['https://home.example', 'https://books.example'],
    });
    expect(mocks.invoke.mock.calls[1]![1]).toMatchObject({
      selfSigned: ['https://home.example'],
    });
  });

  // A certificate belongs to the origin (host:port), so servers sharing one
  // share its policy: if any of them turned the option off, it is verified
  // for all of them, whichever call registers the origin.
  it('verifies an origin when any Audiobookshelf server on it turned the option off', async () => {
    mocks.servers = [
      { url: 'https://home.example/abs-a', allowSelfSignedCert: true },
      { url: 'https://home.example/abs-b', allowSelfSignedCert: false },
    ];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await fresh();
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_media_proxy_base', {
      origins: ['https://home.example'],
      selfSigned: [],
    });
  });

  it('weighs every live store entry, even two spellings of one URL', async () => {
    mocks.servers = [
      { url: 'https://home.example', allowSelfSignedCert: true },
      { url: 'https://home.example/', allowSelfSignedCert: false },
    ];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await fresh();
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_media_proxy_base', {
      origins: ['https://home.example'],
      selfSigned: [],
    });
  });

  it('keeps a BookOrbit origin verified when an Audiobookshelf server shares it', async () => {
    mocks.servers = [{ url: 'https://home.example/abs', allowSelfSignedCert: true }];
    mocks.bookorbit = {
      serverUrl: 'https://home.example',
      password: 'pw',
      allowSelfSignedCert: false,
    };
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    // BookOrbit registering its own grant...
    await fresh({ origin: 'https://home.example', authorization: 'Bearer t' });
    expect(mocks.invoke.mock.calls[0]![1]).toMatchObject({ selfSigned: [] });
    // ...and a later Audiobookshelf-only call must not flip it back.
    await fresh();
    expect(mocks.invoke.mock.calls[1]![1]).toMatchObject({ selfSigned: [] });
  });

  it("lets a server's live store copy turn the option on over a stale persisted copy", async () => {
    mocks.servers = [{ url: 'https://home.example', allowSelfSignedCert: true }];
    mocks.settingsServers = [{ url: 'https://home.example/', allowSelfSignedCert: false }];
    mocks.invoke.mockResolvedValue('http://127.0.0.1:41234/s3cret');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await fresh();
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_media_proxy_base', {
      origins: ['https://home.example'],
      selfSigned: ['https://home.example'],
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
      selfSigned: ['https://abs.example:8443', 'http://192.168.2.3:13378'],
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

describe('getLocalMediaUrl (#6848)', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.stat.mockReset();
    mocks.isTauriAppPlatform.mockReturnValue(true);
    mocks.isIOSApp = false;
  });

  it('registers the whole file as one window, so a long recording streams past 1 MB', async () => {
    mocks.stat.mockResolvedValue({ size: 285_530_804 });
    mocks.invoke.mockResolvedValue('http://127.0.0.1:5/s/file/abc');

    await expect(getLocalMediaUrl('/books/h/audiobook/big.m4a', 'audio/mp4')).resolves.toBe(
      'http://127.0.0.1:5/s/file/abc',
    );
    expect(mocks.stat).toHaveBeenCalledWith('/books/h/audiobook/big.m4a');
    expect(mocks.invoke).toHaveBeenCalledWith('get_media_file_url', {
      path: '/books/h/audiobook/big.m4a',
      start: 0,
      end: 285_530_804,
      contentType: 'audio/mp4',
    });
  });

  it('returns null when the file cannot be read, so the caller keeps its own URL', async () => {
    mocks.stat.mockRejectedValue(new Error('forbidden path'));

    await expect(getLocalMediaUrl('/elsewhere/a.mp3', 'audio/mpeg')).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
