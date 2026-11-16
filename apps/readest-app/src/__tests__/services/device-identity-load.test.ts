// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
  isSyncKeychainAvailable: vi.fn(),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isTauriAppPlatform: vi.fn(() => true),
}));

import { getSecureItem, setSecureItem } from '@/utils/bridge';
import { isTauriAppPlatform } from '@/services/environment';
import { SETTINGS_FILENAME } from '@/services/constants';
import { loadSettings, type Context } from '@/services/settingsService';
import type { FileSystem } from '@/types/system';

const storedSettings = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    kosync: { deviceId: 'stored-kosync-id', deviceName: 'Old iPhone' },
    bookorbit: { deviceId: 'stored-bookorbit-id', deviceName: 'Old iPhone' },
    replicaDeviceId: 'stored-replica-id',
    ...overrides,
  });

const makeFs = (stored?: string) => {
  const files = new Map<string, string>();
  if (stored !== undefined) files.set(SETTINGS_FILENAME, stored);
  const writes: string[] = [];
  const fs = {
    readFile: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    writeFile: async (path: string, _base: unknown, content: string) => {
      writes.push(content);
      files.set(path, content);
    },
    getPrefix: async () => 'Books',
  } as unknown as FileSystem;
  return { fs, files, writes };
};

const ctx = (fs: FileSystem): Context => ({
  fs,
  isMobile: true,
  isDesktopApp: false,
  isEink: false,
  isAppDataSandbox: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  localStorage.clear();
});

describe('loadSettings device migration (#7558)', () => {
  it('regenerates the sync IDs when stored IDs exist but the device anchor is missing', async () => {
    vi.mocked(getSecureItem).mockResolvedValue({});
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });
    const { fs, files, writes } = makeFs(storedSettings());

    const settings = await loadSettings(ctx(fs));

    expect(settings.kosync.deviceId).not.toBe('stored-kosync-id');
    expect(settings.bookorbit.deviceId).not.toBe('stored-bookorbit-id');
    expect(settings.replicaDeviceId).not.toBe('stored-replica-id');
    expect(settings.kosync.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    // Everything else is preserved: the migration keeps books, account
    // settings and the device name, only the identity changes.
    expect(settings.kosync.deviceName).toBe('Old iPhone');
    expect(setSecureItem).toHaveBeenCalledWith(expect.objectContaining({ deviceBound: true }));
    expect(writes.length).toBeGreaterThan(0);
    const persisted = JSON.parse(files.get(SETTINGS_FILENAME)!);
    expect(persisted.kosync.deviceId).toBe(settings.kosync.deviceId);
    expect(persisted.bookorbit.deviceId).toBe(settings.bookorbit.deviceId);
    expect(persisted.replicaDeviceId).toBe(settings.replicaDeviceId);
  });

  it('keeps the stored IDs when the device anchor is present (same device)', async () => {
    vi.mocked(getSecureItem).mockResolvedValue({ value: 'anchor-from-this-device' });
    const { fs } = makeFs(storedSettings());

    const settings = await loadSettings(ctx(fs));

    expect(settings.kosync.deviceId).toBe('stored-kosync-id');
    expect(settings.bookorbit.deviceId).toBe('stored-bookorbit-id');
    expect(settings.replicaDeviceId).toBe('stored-replica-id');
    expect(setSecureItem).not.toHaveBeenCalled();
  });

  it('does not touch the secure store on web (no device anchor exists there)', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const { fs } = makeFs(storedSettings());

    const settings = await loadSettings(ctx(fs));

    expect(settings.kosync.deviceId).toBe('stored-kosync-id');
    expect(getSecureItem).not.toHaveBeenCalled();
    expect(setSecureItem).not.toHaveBeenCalled();
  });

  it('anchors a fresh install without changing the just-minted IDs', async () => {
    vi.mocked(getSecureItem).mockResolvedValue({});
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });
    const { fs } = makeFs();

    const settings = await loadSettings(ctx(fs));

    expect(settings.kosync.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(settings.bookorbit.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(settings.replicaDeviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(setSecureItem).toHaveBeenCalledWith(expect.objectContaining({ deviceBound: true }));
  });
});
