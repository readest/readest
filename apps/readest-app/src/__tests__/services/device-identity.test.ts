// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
  isSyncKeychainAvailable: vi.fn(),
}));

import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import {
  DEVICE_ANCHOR_KEY,
  createDeviceAnchorStore,
  ensureDeviceIdentity,
  regenerateSyncDeviceIds,
  type DeviceAnchorStore,
} from '@/services/deviceIdentity';
import type { SystemSettings } from '@/types/settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const settingsWithIds = (
  kosync = 'old-kosync-id',
  bookorbit = 'old-bookorbit-id',
  replica = 'old-replica-id',
) =>
  ({
    kosync: {
      deviceId: kosync,
      deviceName: 'My iPhone',
      serverUrl: 'https://sync.example.com',
      username: 'user',
    },
    bookorbit: {
      deviceId: bookorbit,
      deviceName: 'My iPhone',
      serverUrl: 'https://books.example.com',
      username: 'user',
    },
    replicaDeviceId: replica,
    koreaderSyncDeviceId: 'untouched-koreader-id',
  }) as unknown as SystemSettings;

const fakeStore = (anchor: { value?: string; error?: string } | Error = {}) => {
  const saves: string[] = [];
  let saveShouldThrow = false;
  const store: DeviceAnchorStore = {
    loadAnchor: async () => {
      if (anchor instanceof Error) throw anchor;
      return anchor;
    },
    saveAnchor: async (value: string) => {
      if (saveShouldThrow) throw new Error('keychain locked');
      saves.push(value);
      return { success: true };
    },
    clearAnchor: async () => {},
  };
  return {
    store,
    saves,
    failNextSave: () => {
      saveShouldThrow = true;
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regenerateSyncDeviceIds', () => {
  it('mints fresh UUIDs for the sync identities and leaves everything else alone', () => {
    const settings = settingsWithIds();

    regenerateSyncDeviceIds(settings);

    expect(settings.kosync.deviceId).toMatch(UUID_RE);
    expect(settings.bookorbit.deviceId).toMatch(UUID_RE);
    expect(settings.replicaDeviceId).toMatch(UUID_RE);
    expect(settings.kosync.deviceId).not.toBe('old-kosync-id');
    expect(settings.bookorbit.deviceId).not.toBe('old-bookorbit-id');
    expect(settings.replicaDeviceId).not.toBe('old-replica-id');
    expect(
      new Set([settings.kosync.deviceId, settings.bookorbit.deviceId, settings.replicaDeviceId])
        .size,
    ).toBe(3);
    expect(settings.kosync.deviceName).toBe('My iPhone');
    expect(settings.kosync.serverUrl).toBe('https://sync.example.com');
    expect(settings.kosync.username).toBe('user');
    expect((settings as unknown as { koreaderSyncDeviceId: string }).koreaderSyncDeviceId).toBe(
      'untouched-koreader-id',
    );
  });
});

describe('ensureDeviceIdentity', () => {
  it('leaves the IDs alone when the device anchor is present (same device)', async () => {
    const settings = settingsWithIds();
    const { store, saves } = fakeStore({ value: 'anchor-from-this-device' });
    const saveSettings = vi.fn();

    expect(await ensureDeviceIdentity(settings, true, store, saveSettings)).toBe(false);

    expect(settings.kosync.deviceId).toBe('old-kosync-id');
    expect(settings.bookorbit.deviceId).toBe('old-bookorbit-id');
    expect(settings.replicaDeviceId).toBe('old-replica-id');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(saves).toHaveLength(0);
  });

  it('anchors a fresh install without regenerating the just-minted IDs', async () => {
    const settings = settingsWithIds('', '', '');
    const { store, saves } = fakeStore({});
    const saveSettings = vi.fn();

    expect(await ensureDeviceIdentity(settings, false, store, saveSettings)).toBe(false);

    expect(settings.kosync.deviceId).toBe('');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatch(UUID_RE);
  });

  it('regenerates the IDs when stored IDs exist but the device anchor is missing (migration)', async () => {
    const settings = settingsWithIds();
    const { store, saves } = fakeStore({});
    const saveSettings = vi.fn();

    expect(await ensureDeviceIdentity(settings, true, store, saveSettings)).toBe(true);

    expect(settings.kosync.deviceId).toMatch(UUID_RE);
    expect(settings.bookorbit.deviceId).toMatch(UUID_RE);
    expect(settings.replicaDeviceId).toMatch(UUID_RE);
    expect(settings.kosync.deviceId).not.toBe('old-kosync-id');
    expect(settings.bookorbit.deviceId).not.toBe('old-bookorbit-id');
    expect(settings.replicaDeviceId).not.toBe('old-replica-id');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatch(UUID_RE);
  });

  it('leaves the IDs alone when the anchor read fails (fail-soft, never breaks startup)', async () => {
    const settings = settingsWithIds();
    const { store, saves } = fakeStore(new Error('keychain unavailable'));
    const saveSettings = vi.fn();

    expect(await ensureDeviceIdentity(settings, true, store, saveSettings)).toBe(false);

    expect(settings.kosync.deviceId).toBe('old-kosync-id');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(saves).toHaveLength(0);
  });

  it('leaves the IDs alone when the anchor read returns an error', async () => {
    const settings = settingsWithIds();
    const { store, saves } = fakeStore({ error: 'OSStatus -34018' });
    const saveSettings = vi.fn();

    expect(await ensureDeviceIdentity(settings, true, store, saveSettings)).toBe(false);

    expect(settings.kosync.deviceId).toBe('old-kosync-id');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(saves).toHaveLength(0);
  });

  it('does not throw when the anchor write fails on a fresh install', async () => {
    const settings = settingsWithIds('', '', '');
    const { store, saves, failNextSave } = fakeStore({});
    const saveSettings = vi.fn();
    failNextSave();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await ensureDeviceIdentity(settings, false, store, saveSettings)).toBe(false);

    expect(saves).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not store the anchor when the settings save fails during migration', async () => {
    const settings = settingsWithIds();
    const { store, saves } = fakeStore({});
    const saveSettings = vi.fn().mockRejectedValueOnce(new Error('disk full'));

    await expect(ensureDeviceIdentity(settings, true, store, saveSettings)).rejects.toThrow(
      'disk full',
    );

    expect(saves).toHaveLength(0);
  });
});

describe('createDeviceAnchorStore', () => {
  it('stores the anchor device-bound so it does not migrate with the app container', async () => {
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });

    const store = await createDeviceAnchorStore();
    await store.saveAnchor('new-anchor');

    expect(setSecureItem).toHaveBeenCalledWith({
      key: DEVICE_ANCHOR_KEY,
      value: 'new-anchor',
      deviceBound: true,
    });
  });

  it('reads the anchor through the keyed secure store', async () => {
    vi.mocked(getSecureItem).mockResolvedValue({ value: 'stored-anchor' });

    const store = await createDeviceAnchorStore();
    const res = await store.loadAnchor();

    expect(getSecureItem).toHaveBeenCalledWith({ key: DEVICE_ANCHOR_KEY });
    expect(res).toEqual({ value: 'stored-anchor' });
  });

  it('clears the anchor through the keyed secure store', async () => {
    vi.mocked(clearSecureItem).mockResolvedValue({ success: true });

    const store = await createDeviceAnchorStore();
    await store.clearAnchor();

    expect(clearSecureItem).toHaveBeenCalledWith({ key: DEVICE_ANCHOR_KEY });
  });
});
