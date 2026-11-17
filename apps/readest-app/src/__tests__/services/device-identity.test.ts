// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
}));
vi.mock('@/utils/bridge', () => bridge);
// Every case runs inside the native app; only iOS has a device-bound keychain.
vi.mock('@/services/environment', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isTauriAppPlatform: () => true,
}));

import { SETTINGS_FILENAME } from '@/services/constants';
import type { Context } from '@/services/settingsService';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

const STORED_IDS = {
  kosync: { deviceId: 'stored-kosync-id', deviceName: 'Old iPhone' },
  bookorbit: { deviceId: 'stored-bookorbit-id', deviceName: 'Old iPhone' },
  replicaDeviceId: 'stored-replica-id',
};

const makeFs = (stored?: Record<string, unknown>) => {
  const files = new Map<string, string>();
  if (stored) files.set(SETTINGS_FILENAME, JSON.stringify({ version: 1, ...stored }));
  const fs = {
    readFile: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    writeFile: async (path: string, _base: unknown, content: string) => {
      files.set(path, content);
    },
    getPrefix: async () => 'Books',
  } as unknown as FileSystem;
  const persisted = () => JSON.parse(files.get(SETTINGS_FILENAME)!) as SystemSettings;
  return { fs, persisted };
};

const ctx = (fs: FileSystem, isIOSApp = true): Context => ({
  fs,
  isMobile: true,
  isDesktopApp: false,
  isEink: false,
  isAppDataSandbox: false,
  isIOSApp,
});

const keychain = (value?: string) => bridge.getSecureItem.mockResolvedValue(value ? { value } : {});

// The keychain check runs once per app session, so each case loads a fresh
// settings module.
const loadSettings = async (context: Context) => {
  const settingsService = await import('@/services/settingsService');
  return settingsService.loadSettings(context);
};

const expectStoredIds = (settings: SystemSettings) => {
  expect(settings.kosync.deviceId).toBe('stored-kosync-id');
  expect(settings.bookorbit.deviceId).toBe('stored-bookorbit-id');
  expect(settings.replicaDeviceId).toBe('stored-replica-id');
};

const expectFreshIds = (settings: SystemSettings) => {
  expect(settings.kosync.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(settings.bookorbit.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(settings.replicaDeviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(settings.kosync.deviceId).not.toBe('stored-kosync-id');
  expect(settings.bookorbit.deviceId).not.toBe('stored-bookorbit-id');
  expect(settings.replicaDeviceId).not.toBe('stored-replica-id');
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  bridge.setSecureItem.mockResolvedValue({ success: true });
  localStorage.clear();
});

describe('loadSettings device identity on iOS (#7558)', () => {
  it('keeps the stored IDs on the first launch after an update, and anchors the device', async () => {
    keychain();
    const { fs, persisted } = makeFs(STORED_IDS);

    const settings = await loadSettings(ctx(fs));

    expectStoredIds(settings);
    expect(bridge.setSecureItem).toHaveBeenCalledWith(
      expect.objectContaining({ deviceBound: true, value: settings.deviceAnchor }),
    );
    expect(persisted().deviceAnchor).toBe(settings.deviceAnchor);
  });

  it('adopts the anchor a previous install left in the keychain', async () => {
    keychain('anchor-from-earlier-install');
    const { fs } = makeFs();

    const settings = await loadSettings(ctx(fs));

    expect(settings.deviceAnchor).toBe('anchor-from-earlier-install');
    expect(bridge.setSecureItem).not.toHaveBeenCalled();
  });

  it('keeps the stored IDs when the keychain holds the same anchor (same device)', async () => {
    keychain('this-device');
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'this-device' });

    const settings = await loadSettings(ctx(fs));

    expectStoredIds(settings);
    expect(bridge.setSecureItem).not.toHaveBeenCalled();
  });

  it('mints fresh IDs when settings.json came from another device', async () => {
    keychain();
    const { fs, persisted } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });

    const settings = await loadSettings(ctx(fs));

    expectFreshIds(settings);
    // Only the identity changes; the rest of the settings move with the user.
    expect(settings.kosync.deviceName).toBe('Old iPhone');
    expect(settings.deviceAnchor).not.toBe('old-iphone');
    expect(bridge.setSecureItem).toHaveBeenCalledWith(
      expect.objectContaining({ deviceBound: true, value: settings.deviceAnchor }),
    );
    const saved = persisted();
    expect(saved.deviceAnchor).toBe(settings.deviceAnchor);
    expect(saved.kosync.deviceId).toBe(settings.kosync.deviceId);
    expect(saved.bookorbit.deviceId).toBe(settings.bookorbit.deviceId);
    expect(saved.replicaDeviceId).toBe(settings.replicaDeviceId);
  });

  it('mints fresh IDs and adopts the anchor of a device that had Readest before', async () => {
    keychain('new-iphone');
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });

    const settings = await loadSettings(ctx(fs));

    expectFreshIds(settings);
    expect(settings.deviceAnchor).toBe('new-iphone');
    expect(bridge.setSecureItem).not.toHaveBeenCalled();
  });

  it('keeps the stored IDs when the anchor write fails, so they are not replaced every launch', async () => {
    keychain();
    bridge.setSecureItem.mockResolvedValue({ success: false, error: 'OSStatus -34018' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });

    const settings = await loadSettings(ctx(fs));

    expectStoredIds(settings);
    expect(settings.deviceAnchor).toBe('old-iphone');
    warn.mockRestore();
  });

  it('keeps the stored IDs when the keychain cannot be read', async () => {
    bridge.getSecureItem.mockResolvedValue({ error: 'OSStatus -25308' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });

    const settings = await loadSettings(ctx(fs));

    expectStoredIds(settings);
    expect(bridge.setSecureItem).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gives overlapping loads one identity and reads the keychain once', async () => {
    keychain();
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });
    const settingsService = await import('@/services/settingsService');

    const [a, b] = await Promise.all([
      settingsService.loadSettings(ctx(fs)),
      settingsService.loadSettings(ctx(fs)),
    ]);
    const c = await settingsService.loadSettings(ctx(fs));

    expectFreshIds(a);
    for (const other of [b, c]) {
      expect(other.deviceAnchor).toBe(a.deviceAnchor);
      expect(other.kosync.deviceId).toBe(a.kosync.deviceId);
      expect(other.bookorbit.deviceId).toBe(a.bookorbit.deviceId);
      expect(other.replicaDeviceId).toBe(a.replicaDeviceId);
    }
    expect(bridge.getSecureItem).toHaveBeenCalledTimes(1);
  });

  it('does not touch the keychain outside iOS', async () => {
    const { fs } = makeFs({ ...STORED_IDS, deviceAnchor: 'old-iphone' });

    const settings = await loadSettings(ctx(fs, false));

    expectStoredIds(settings);
    expect(bridge.getSecureItem).not.toHaveBeenCalled();
    expect(bridge.setSecureItem).not.toHaveBeenCalled();
  });
});
