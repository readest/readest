import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeOpdsCatalogContentId } from '@/services/sync/adapters/opdsCatalog';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

// Replica-publish helpers fan out to the network — stub them so tests
// stay hermetic. We assert they fire for upserts/deletes via spies.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

import { publishReplicaUpsert, publishReplicaDelete } from '@/services/sync/replicaPublish';

const makeEnvConfig = (): EnvConfigType =>
  ({
    getAppService: vi.fn(),
  }) as unknown as EnvConfigType;

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    opdsCatalogs: [],
    ...overrides,
  }) as unknown as SystemSettings;

beforeEach(() => {
  useCustomOPDSStore.setState({ catalogs: [], loading: false });
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
  vi.clearAllMocks();
});

describe('customOPDSStore', () => {
  describe('addCatalog', () => {
    test('mints a contentId from the URL when one is not provided', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'My Library',
        url: 'https://example.com/opds',
      });
      expect(cat.contentId).toBe(computeOpdsCatalogContentId('https://example.com/opds'));
      expect(cat.addedAt).toBeGreaterThan(0);
    });

    test('publishes the upsert via replicaPublish', () => {
      useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'My Library',
        url: 'https://example.com/opds',
      });
      expect(publishReplicaUpsert).toHaveBeenCalledTimes(1);
      const [kind] = (publishReplicaUpsert as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(kind).toBe('opds_catalog');
    });

    test('re-adding a soft-deleted entry mints a reincarnation token', () => {
      const first = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(first.id);
      vi.clearAllMocks();
      const revived = useCustomOPDSStore.getState().addCatalog({
        id: 'l2',
        name: 'L1 again',
        url: 'https://example.com/opds',
      });
      expect(revived.deletedAt).toBeUndefined();
      expect(revived.reincarnation).toBeTruthy();
      expect(publishReplicaUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateCatalog', () => {
    test('publishes the upsert for non-URL patches', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'Old',
        url: 'https://example.com/opds',
      });
      const oldContentId = cat.contentId;
      vi.clearAllMocks();
      const updated = useCustomOPDSStore.getState().updateCatalog(cat.id, { name: 'New' });
      expect(updated!.name).toBe('New');
      expect(updated!.contentId).toBe(oldContentId);
      expect(publishReplicaUpsert).toHaveBeenCalledTimes(1);
    });

    test('changing the URL recomputes contentId', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'local-1',
        name: 'Cat',
        url: 'https://example.com/opds',
      });
      const updated = useCustomOPDSStore
        .getState()
        .updateCatalog(cat.id, { url: 'https://other.example/opds' });
      expect(updated!.contentId).toBe(computeOpdsCatalogContentId('https://other.example/opds'));
      expect(updated!.contentId).not.toBe(cat.contentId);
    });

    test('no-op on tombstoned entry', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(cat.id);
      vi.clearAllMocks();
      const out = useCustomOPDSStore.getState().updateCatalog(cat.id, { name: 'X' });
      expect(out).toBeUndefined();
      expect(publishReplicaUpsert).not.toHaveBeenCalled();
    });
  });

  describe('removeCatalog', () => {
    test('soft-deletes and publishes the tombstone', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      vi.clearAllMocks();
      const removed = useCustomOPDSStore.getState().removeCatalog(cat.id);
      expect(removed).toBe(true);
      const stored = useCustomOPDSStore.getState().getCatalog(cat.id);
      expect(stored?.deletedAt).toBeGreaterThan(0);
      expect(publishReplicaDelete).toHaveBeenCalledWith('opds_catalog', cat.contentId);
    });

    test('returns false when id is unknown', () => {
      expect(useCustomOPDSStore.getState().removeCatalog('nope')).toBe(false);
    });
  });

  describe('applyRemoteCatalog', () => {
    test('inserts when the contentId is unknown locally', () => {
      const cat: OPDSCatalog = {
        id: 'remote-cid',
        contentId: 'remote-cid',
        name: 'Remote',
        url: 'https://remote.example/opds',
        addedAt: 1700000000000,
      };
      useCustomOPDSStore.getState().applyRemoteCatalog(cat);
      const stored = useCustomOPDSStore.getState().findByContentId('remote-cid');
      expect(stored?.name).toBe('Remote');
      expect(publishReplicaUpsert).not.toHaveBeenCalled();
    });

    test('preserves local username/password when overlaying a remote update', () => {
      const local = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'Local',
        url: 'https://example.com/opds',
        username: 'alice',
        password: 'hunter2',
      });
      vi.clearAllMocks();
      useCustomOPDSStore.getState().applyRemoteCatalog({
        id: local.contentId!,
        contentId: local.contentId,
        name: 'Renamed remotely',
        url: 'https://example.com/opds',
        addedAt: 1700000001000,
      });
      const merged = useCustomOPDSStore.getState().findByContentId(local.contentId!);
      expect(merged?.name).toBe('Renamed remotely');
      expect(merged?.username).toBe('alice');
      expect(merged?.password).toBe('hunter2');
      expect(publishReplicaUpsert).not.toHaveBeenCalled();
    });
  });

  describe('softDeleteByContentId', () => {
    test('marks the matching entry as deleted without re-publishing', () => {
      const cat = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'L1',
        url: 'https://example.com/opds',
      });
      vi.clearAllMocks();
      useCustomOPDSStore.getState().softDeleteByContentId(cat.contentId!);
      const stored = useCustomOPDSStore.getState().findByContentId(cat.contentId!);
      expect(stored?.deletedAt).toBeGreaterThan(0);
      expect(publishReplicaDelete).not.toHaveBeenCalled();
    });
  });

  describe('saveCustomOPDSCatalogs', () => {
    test('strips tombstoned entries from the persisted settings list', async () => {
      const live = useCustomOPDSStore.getState().addCatalog({
        id: 'l1',
        name: 'Live',
        url: 'https://example.com/opds',
      });
      const dead = useCustomOPDSStore.getState().addCatalog({
        id: 'l2',
        name: 'Dead',
        url: 'https://other.example/opds',
      });
      useCustomOPDSStore.getState().removeCatalog(dead.id);
      await useCustomOPDSStore.getState().saveCustomOPDSCatalogs(makeEnvConfig());
      const persisted = useSettingsStore.getState().settings.opdsCatalogs!;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.id).toBe(live.id);
    });
  });

  describe('loadCustomOPDSCatalogs', () => {
    test('backfills contentId on legacy entries and republishes them', async () => {
      const legacy: OPDSCatalog = {
        id: 'legacy-1',
        name: 'Legacy',
        url: 'https://legacy.example/opds',
      };
      useSettingsStore.setState({
        settings: makeSettings({ opdsCatalogs: [legacy] }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      const inMemory = useCustomOPDSStore.getState().getCatalog('legacy-1')!;
      expect(inMemory.contentId).toBe(computeOpdsCatalogContentId('https://legacy.example/opds'));
      expect(publishReplicaUpsert).toHaveBeenCalledTimes(1);
    });

    test('preserves the existing array order via descending addedAt timestamps', async () => {
      const legacy: OPDSCatalog[] = [
        { id: 'a', name: 'Alpha', url: 'https://a.example/opds' },
        { id: 'b', name: 'Bravo', url: 'https://b.example/opds' },
        { id: 'c', name: 'Charlie', url: 'https://c.example/opds' },
      ];
      useSettingsStore.setState({
        settings: makeSettings({ opdsCatalogs: legacy }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      const ordered = useCustomOPDSStore.getState().getAvailableCatalogs();
      expect(ordered.map((c) => c.id)).toEqual(['a', 'b', 'c']);
      // Strict descending — first entry strictly newer than next.
      expect(ordered[0]!.addedAt!).toBeGreaterThan(ordered[1]!.addedAt!);
      expect(ordered[1]!.addedAt!).toBeGreaterThan(ordered[2]!.addedAt!);
    });

    test('hydrates without backfilling when entries already carry contentId', async () => {
      useSettingsStore.setState({
        settings: makeSettings({
          opdsCatalogs: [
            {
              id: 'a',
              contentId: 'a',
              name: 'A',
              url: 'https://example.com/opds',
              addedAt: 1700000000000,
            },
          ],
        }),
      } as unknown as ReturnType<typeof useSettingsStore.getState>);
      await useCustomOPDSStore.getState().loadCustomOPDSCatalogs(makeEnvConfig());
      expect(publishReplicaUpsert).not.toHaveBeenCalled();
      expect(useCustomOPDSStore.getState().catalogs).toHaveLength(1);
    });
  });
});
