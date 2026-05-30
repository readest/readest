import { describe, test, expect } from 'vitest';
import { buildWebDAVConnectSettings } from '@/services/webdav/webdavConnectSettings';
import type { WebDAVSettings, WebDAVSyncLogEntry } from '@/types/settings';

describe('buildWebDAVConnectSettings', () => {
  test('applies form fields onto a blank previous state', () => {
    const result = buildWebDAVConnectSettings(undefined, {
      serverUrl: '  https://dav.example.com  ',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });
    expect(result).toEqual({
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });
  });

  test('preserves prior bookkeeping fields across reconnect', () => {
    // Simulates the disconnect → reconnect flow: the user previously
    // synced (deviceId minted, syncBooks toggled on, history populated),
    // disabled WebDAV, and is now reconnecting with the same credentials.
    const log: WebDAVSyncLogEntry[] = [
      {
        id: 'log-1',
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_500,
        status: 'success',
        trigger: 'manual',
        totalBooks: 3,
        booksDownloaded: 0,
        filesUploaded: 1,
        filesAlreadyInSync: 2,
        configsUploaded: 3,
        configsDownloaded: 0,
        coversUploaded: 0,
        failures: 0,
        summary: 'Sync complete',
      },
    ];
    const previous: WebDAVSettings = {
      enabled: false,
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
      syncProgress: true,
      syncNotes: true,
      syncBooks: true,
      strategy: 'send',
      deviceId: 'device-uuid-9f3c',
      lastSyncedAt: 1_700_000_001_500,
      syncLog: log,
    };

    const next = buildWebDAVConnectSettings(previous, {
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });

    expect(next.enabled).toBe(true);
    // Stable per-device id MUST survive — losing it makes the next sync
    // look like a brand-new device and breaks cross-device clobber
    // detection in `RemoteBookConfig.writerDeviceId`.
    expect(next.deviceId).toBe('device-uuid-9f3c');
    expect(next.syncBooks).toBe(true);
    expect(next.strategy).toBe('send');
    expect(next.syncProgress).toBe(true);
    expect(next.syncNotes).toBe(true);
    expect(next.lastSyncedAt).toBe(1_700_000_001_500);
    expect(next.syncLog).toEqual(log);
  });

  test('updates the credentials when the user reconnects to a different account', () => {
    const previous: WebDAVSettings = {
      enabled: false,
      serverUrl: 'https://old.example.com',
      username: 'alice',
      password: 'old-pw',
      rootPath: '/Old',
      deviceId: 'device-keep',
      syncBooks: false,
    };
    const next = buildWebDAVConnectSettings(previous, {
      serverUrl: 'https://new.example.com/',
      username: 'bob',
      password: 'new-pw',
      rootPath: '/New',
    });
    expect(next.serverUrl).toBe('https://new.example.com/');
    expect(next.username).toBe('bob');
    expect(next.password).toBe('new-pw');
    expect(next.rootPath).toBe('/New');
    // The deviceId is intentionally NOT rotated even when the user
    // reconnects to a different server/account: it identifies the
    // physical device, not the remote account. A user moving between
    // self-hosted instances still wants their device to be recognised
    // by whichever server it's currently talking to.
    expect(next.deviceId).toBe('device-keep');
    expect(next.syncBooks).toBe(false);
  });
});
