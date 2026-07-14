import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useFileSyncStore } from '@/store/fileSyncStore';

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
  },
}));

import { checkMixedFleetOnce } from '@/services/sync/fleetDetection';
import { eventDispatcher } from '@/utils/event';
import type { SyncClient } from '@/libs/sync';

const translationFn = (key: string) => key;

const makeSyncClient = (books: unknown[] | null): SyncClient =>
  ({
    pullChanges: vi.fn(async () => ({ books, configs: null, notes: null })),
  }) as unknown as SyncClient;

const settingsWith = (patch: Partial<SystemSettings>): SystemSettings =>
  ({
    version: 1,
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...patch,
  }) as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useFileSyncStore.setState({
    byKind: {},
    activeKind: null,
    lastErrorByKind: {},
    fleetNoticeShown: false,
  });
});

describe('checkMixedFleetOnce', () => {
  test('no probe when readest is the provider', async () => {
    const client = makeSyncClient([]);
    expect(await checkMixedFleetOnce(client, settingsWith({}), translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('no probe without a providerSelectedAt anchor', async () => {
    const client = makeSyncClient([]);
    const settings = settingsWith({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('probes read-only since the selection anchor and notifies when another writer exists', async () => {
    const client = makeSyncClient([{ book_hash: 'h1' }]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(true);

    expect(client.pullChanges).toHaveBeenCalledWith(12345, 'books', undefined, undefined, 1);
    expect(vi.mocked(eventDispatcher.dispatch)).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({
        message: expect.stringContaining('Another device is still syncing'),
      }),
    );
  });

  test('notifies only once per session', async () => {
    const client = makeSyncClient([{ book_hash: 'h1' }]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    await checkMixedFleetOnce(client, settings, translationFn);
    await checkMixedFleetOnce(client, settings, translationFn);

    expect(vi.mocked(eventDispatcher.dispatch)).toHaveBeenCalledTimes(1);
  });

  test('quiet when no newer rows exist', async () => {
    const client = makeSyncClient([]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(vi.mocked(eventDispatcher.dispatch)).not.toHaveBeenCalled();
  });

  test('probe failures are silent (offline is not a fleet problem)', async () => {
    const client = {
      pullChanges: vi.fn(async () => {
        throw new Error('Not authenticated');
      }),
    } as unknown as SyncClient;
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(vi.mocked(eventDispatcher.dispatch)).not.toHaveBeenCalled();
  });

  test('does not probe when Readest Cloud is enabled alongside a backend', async () => {
    const pullChanges = vi.fn();
    const settings = {
      readestCloud: { enabled: true },
      googleDrive: { enabled: true, providerSelectedAt: 1000 },
    } as unknown as SystemSettings;

    expect(await checkMixedFleetOnce({ pullChanges } as never, settings, translationFn)).toBe(
      false,
    );
    expect(pullChanges).not.toHaveBeenCalled();
  });

  test('probes since readestCloud.disabledAt when Readest Cloud is off', async () => {
    const pullChanges = vi.fn().mockResolvedValue({ books: [{ hash: 'h' }] });
    const settings = {
      readestCloud: { enabled: false, disabledAt: 5000 },
      googleDrive: { enabled: true, providerSelectedAt: 1000 },
    } as unknown as SystemSettings;

    expect(await checkMixedFleetOnce({ pullChanges } as never, settings, translationFn)).toBe(true);
    expect(pullChanges).toHaveBeenCalledWith(5000, 'books', undefined, undefined, 1);
  });

  test('falls back to the earliest providerSelectedAt for a legacy user', async () => {
    const pullChanges = vi.fn().mockResolvedValue({ books: [] });
    const settings = {
      // No readestCloud field: derived off, because a backend is enabled.
      // webdav is enumerated before onedrive by getEnabledFileSyncBackends,
      // but its providerSelectedAt is the LATER one, so a correct
      // implementation must take the minimum across backends rather than
      // the first enabled backend's value.
      webdav: { enabled: true, providerSelectedAt: 9000 },
      onedrive: { enabled: true, providerSelectedAt: 3000 },
    } as unknown as SystemSettings;

    await checkMixedFleetOnce({ pullChanges } as never, settings, translationFn);
    expect(pullChanges).toHaveBeenCalledWith(3000, 'books', undefined, undefined, 1);
  });
});
