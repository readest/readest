import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/sync/providers/gdrive/buildGoogleDriveProvider', () => ({
  buildGoogleDriveProvider: vi.fn(),
}));

import { buildGoogleDriveProvider } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import {
  createFileSyncProvider,
  getEnabledFileSyncBackends,
} from '@/services/sync/file/providerRegistry';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { WebDAVSettings } from '@/types/settings';

const webdav: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'u',
  password: 'p',
  rootPath: '/',
};

afterEach(() => vi.clearAllMocks());

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
});

describe('createFileSyncProvider', () => {
  test('builds a WebDAV provider from its settings', async () => {
    const provider = await createFileSyncProvider('webdav', { webdav });
    expect(provider?.rootPath).toBe('/');
  });

  test('returns null for webdav without settings', async () => {
    expect(await createFileSyncProvider('webdav', {})).toBeNull();
  });

  test('delegates gdrive to buildGoogleDriveProvider', async () => {
    const fake = { rootPath: '/' } as unknown as FileSyncProvider;
    vi.mocked(buildGoogleDriveProvider).mockResolvedValueOnce(fake);
    expect(await createFileSyncProvider('gdrive', {})).toBe(fake);
    expect(buildGoogleDriveProvider).toHaveBeenCalledTimes(1);
  });
});
