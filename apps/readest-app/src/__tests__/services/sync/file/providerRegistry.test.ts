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
  resetFileSyncProviderCache,
} from '@/services/sync/file/providerRegistry';
import type { FileSyncBackendsSettings } from '@/services/sync/file/providerRegistry';
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

describe('per-backend provider cache', () => {
  test('alternating backends do not evict each other', async () => {
    resetFileSyncProviderCache();
    const settings = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav',
        username: 'u',
        password: 'p',
        rootPath: '/',
      },
      s3: {
        enabled: true,
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'b',
        accessKeyId: 'k',
        secretAccessKey: 's',
      },
    } as unknown as FileSyncBackendsSettings;

    const webdav1 = await createFileSyncProvider('webdav', settings);
    const s3First = await createFileSyncProvider('s3', settings);
    const webdav2 = await createFileSyncProvider('webdav', settings);

    expect(webdav1).toBeTruthy();
    expect(s3First).toBeTruthy();
    // The WebDAV provider survived the S3 build: same instance, cache intact.
    expect(webdav2).toBe(webdav1);
  });

  test('editing one backend config rebuilds only that backend', async () => {
    resetFileSyncProviderCache();
    const base = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav',
        username: 'u',
        password: 'p',
        rootPath: '/',
      },
      s3: {
        enabled: true,
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'b',
        accessKeyId: 'k',
        secretAccessKey: 's',
      },
    } as unknown as FileSyncBackendsSettings;

    const s3First = await createFileSyncProvider('s3', base);
    const webdavFirst = await createFileSyncProvider('webdav', base);

    const edited = {
      ...base,
      webdav: { ...base.webdav, serverUrl: 'https://other' },
    } as unknown as FileSyncBackendsSettings;

    expect(await createFileSyncProvider('webdav', edited)).not.toBe(webdavFirst);
    expect(await createFileSyncProvider('s3', edited)).toBe(s3First);
  });

  test('reset clears every backend', async () => {
    resetFileSyncProviderCache();
    const settings = {
      webdav: {
        enabled: true,
        serverUrl: 'https://dav',
        username: 'u',
        password: 'p',
        rootPath: '/',
      },
    } as unknown as FileSyncBackendsSettings;
    const first = await createFileSyncProvider('webdav', settings);
    resetFileSyncProviderCache();
    expect(await createFileSyncProvider('webdav', settings)).not.toBe(first);
  });
});
