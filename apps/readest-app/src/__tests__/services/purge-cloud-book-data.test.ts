// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SyncClient } from '@/libs/sync';
import type { SystemSettings } from '@/types/settings';
import { purgeCloudBookData } from '@/services/purgeCloudBookData';
import { useSettingsStore } from '@/store/settingsStore';

const makeSyncClient = () =>
  ({
    pullChanges: vi.fn().mockResolvedValue({ configs: [], notes: [] }),
    pushChanges: vi.fn().mockResolvedValue({}),
  }) as unknown as SyncClient & {
    pullChanges: ReturnType<typeof vi.fn>;
    pushChanges: ReturnType<typeof vi.fn>;
  };

const setSettings = (settings: Partial<SystemSettings>) => {
  useSettingsStore.setState({ settings: settings as SystemSettings });
};

beforeEach(() => {
  setSettings({});
});

describe('purgeCloudBookData', () => {
  test('skips Readest server calls when Readest Cloud is explicitly disabled (#7826)', async () => {
    setSettings({ readestCloud: { enabled: false } } as Partial<SystemSettings>);
    const syncClient = makeSyncClient();
    syncClient.pullChanges.mockRejectedValue(new Error('Network unreachable'));

    await expect(purgeCloudBookData('book-1', syncClient)).resolves.toBeUndefined();
    expect(syncClient.pullChanges).not.toHaveBeenCalled();
    expect(syncClient.pushChanges).not.toHaveBeenCalled();
  });

  test('skips Readest server calls when only a third-party provider is enabled', async () => {
    setSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    const syncClient = makeSyncClient();

    await purgeCloudBookData('book-1', syncClient);
    expect(syncClient.pullChanges).not.toHaveBeenCalled();
    expect(syncClient.pushChanges).not.toHaveBeenCalled();
  });

  test('purges configs and notes when Readest Cloud is enabled alongside a third-party provider (#5062)', async () => {
    setSettings({
      readestCloud: { enabled: true },
      webdav: { enabled: true },
    } as Partial<SystemSettings>);
    const syncClient = makeSyncClient();
    syncClient.pullChanges
      .mockResolvedValueOnce({ configs: [{ book_hash: 'book-1', meta_hash: 'm1' }] })
      .mockResolvedValueOnce({
        notes: [{ id: 'n1', book_hash: 'book-1', type: 'bookmark', deleted_at: null }],
      });

    await purgeCloudBookData('book-1', syncClient);

    expect(syncClient.pullChanges).toHaveBeenCalledTimes(2);
    expect(syncClient.pushChanges).toHaveBeenCalledTimes(1);
    const payload = syncClient.pushChanges.mock.calls[0]![0];
    expect(payload.configs).toHaveLength(1);
    expect(payload.configs[0]).toMatchObject({
      bookHash: 'book-1',
      metaHash: 'm1',
      location: null,
      progress: null,
    });
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0].deletedAt).toBeTypeOf('number');
  });

  test('fails fast when Readest Cloud is enabled and the server is unreachable', async () => {
    const syncClient = makeSyncClient();
    syncClient.pullChanges.mockRejectedValue(new Error('Failed to pull changes'));

    await expect(purgeCloudBookData('book-1', syncClient)).rejects.toThrow(
      'Failed to pull changes',
    );
  });

  test('does not push when the book has no cloud configs or active notes', async () => {
    const syncClient = makeSyncClient();

    await purgeCloudBookData('book-1', syncClient);
    expect(syncClient.pullChanges).toHaveBeenCalledTimes(2);
    expect(syncClient.pushChanges).not.toHaveBeenCalled();
  });
});
