import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/sync/providers/gdrive/buildGoogleDriveProvider', () => ({
  buildGoogleDriveProvider: vi.fn(),
}));

vi.mock('@/services/sync/providers/onedrive/buildOneDriveProvider', () => ({
  buildOneDriveProvider: vi.fn(),
}));

import { buildGoogleDriveProvider } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import { buildOneDriveProvider } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
import {
  createFileSyncProvider,
  getEnabledFileSyncBackends,
  resetFileSyncProviderCache,
} from '@/services/sync/file/providerRegistry';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { S3Settings, WebDAVSettings } from '@/types/settings';

const webdav: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'u',
  password: 'p',
  rootPath: '/',
};

const s3: S3Settings = {
  enabled: true,
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'readest',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
};

afterEach(() => {
  vi.clearAllMocks();
  resetFileSyncProviderCache();
});

describe('getEnabledFileSyncBackends', () => {
  test('lists only switched-on backends in a stable order', () => {
    expect(getEnabledFileSyncBackends({})).toEqual([]);
    expect(getEnabledFileSyncBackends({ webdav })).toEqual(['webdav']);
    expect(getEnabledFileSyncBackends({ webdav, googleDrive: { enabled: true } })).toEqual([
      'webdav',
      'gdrive',
    ]);
    expect(
      getEnabledFileSyncBackends({
        webdav: { ...webdav, enabled: false },
        googleDrive: { enabled: true },
      }),
    ).toEqual(['gdrive']);
  });

  test("getEnabledFileSyncBackends includes 'onedrive' when enabled", () => {
    expect(getEnabledFileSyncBackends({ onedrive: { enabled: true } })).toContain('onedrive');
  });
});

describe('createFileSyncProvider', () => {
  test('builds a WebDAV provider from its settings', async () => {
    const provider = await createFileSyncProvider('webdav', { webdav });
    expect(provider?.rootPath).toBe('/');
  });

  test('returns null for webdav without settings', async () => {
    expect(await createFileSyncProvider('webdav', {})).toBeNull();
  });

  test('builds an S3 provider from its settings and memoises it', async () => {
    const first = await createFileSyncProvider('s3', { s3 });
    expect(first?.rootPath).toBe('/');
    const second = await createFileSyncProvider('s3', { s3 });
    expect(second).toBe(first);
    // A credential change rebuilds.
    const third = await createFileSyncProvider('s3', { s3: { ...s3, secretAccessKey: 'X' } });
    expect(third).not.toBe(first);
  });

  test('returns null for s3 without settings', async () => {
    expect(await createFileSyncProvider('s3', {})).toBeNull();
  });

  test('delegates gdrive to buildGoogleDriveProvider', async () => {
    const fake = { rootPath: '/' } as unknown as FileSyncProvider;
    vi.mocked(buildGoogleDriveProvider).mockResolvedValueOnce(fake);
    expect(await createFileSyncProvider('gdrive', {})).toBe(fake);
    expect(buildGoogleDriveProvider).toHaveBeenCalledTimes(1);
  });

  // The provider is memoised per connection key so its path->id cache stays
  // warm across surfaces (reader hook, library auto-sync, Sync now): a cold
  // provider re-resolves /Readest, books/ and library.json by name query on
  // every engine build, turning each book open/close/sync into a burst of
  // redundant remote requests.
  test('returns the same instance for an unchanged connection', async () => {
    const first = await createFileSyncProvider('webdav', { webdav });
    const second = await createFileSyncProvider('webdav', { webdav });
    expect(second).toBe(first);
  });

  test('memoises the gdrive build (keychain probed once)', async () => {
    const fake = { rootPath: '/' } as unknown as FileSyncProvider;
    vi.mocked(buildGoogleDriveProvider).mockResolvedValue(fake);
    await createFileSyncProvider('gdrive', {});
    await createFileSyncProvider('gdrive', {});
    expect(buildGoogleDriveProvider).toHaveBeenCalledTimes(1);
  });

  test('delegates onedrive to buildOneDriveProvider and does not throw', async () => {
    vi.mocked(buildOneDriveProvider).mockResolvedValueOnce(null);
    const result = await createFileSyncProvider('onedrive', { onedrive: { enabled: true } });
    expect(result).toBeNull();
    expect(buildOneDriveProvider).toHaveBeenCalledTimes(1);
  });

  test('rebuilds when the connection settings change', async () => {
    const first = await createFileSyncProvider('webdav', { webdav });
    const second = await createFileSyncProvider('webdav', {
      webdav: { ...webdav, password: 'changed' },
    });
    expect(second).not.toBe(first);
  });

  test('resetFileSyncProviderCache forces a rebuild', async () => {
    const first = await createFileSyncProvider('webdav', { webdav });
    resetFileSyncProviderCache();
    const second = await createFileSyncProvider('webdav', { webdav });
    expect(second).not.toBe(first);
  });
});
