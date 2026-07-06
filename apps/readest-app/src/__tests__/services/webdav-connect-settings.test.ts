import { describe, test, expect } from 'vitest';
import { buildWebDAVConnectSettings } from '@/services/sync/providers/webdav/connectSettings';
import type { WebDAVSettings } from '@/types/settings';

describe('buildWebDAVConnectSettings', () => {
  test('applies form fields onto a blank previous state', () => {
    const result = buildWebDAVConnectSettings(undefined, {
      serverUrl: '  https://dav.example.com  ',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });
    // The builder is activation-agnostic: `enabled` (and the activation
    // side effects like the syncBooks auto-flip) belong to
    // withActiveCloudProvider, which the connect flow applies on top.
    expect(result).toEqual({
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });
  });

  test('preserves prior bookkeeping fields across reconnect', () => {
    // Simulates the disconnect → reconnect flow: the user previously
    // synced (deviceId minted, syncBooks toggled on), disabled WebDAV,
    // and is now reconnecting with the same credentials.
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
    };

    const next = buildWebDAVConnectSettings(previous, {
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Readest',
    });

    // Still disabled: the connect flow activates via withActiveCloudProvider
    // so the disabled -> enabled transition (and its syncBooks auto-flip)
    // happens exactly once, in one place.
    expect(next.enabled).toBe(false);
    // Stable per-device id MUST survive — losing it makes the next sync
    // look like a brand-new device and breaks cross-device clobber
    // detection in `RemoteBookConfig.writerDeviceId`.
    expect(next.deviceId).toBe('device-uuid-9f3c');
    expect(next.syncBooks).toBe(true);
    expect(next.strategy).toBe('send');
    expect(next.syncProgress).toBe(true);
    expect(next.syncNotes).toBe(true);
    expect(next.lastSyncedAt).toBe(1_700_000_001_500);
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
