import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findABSServerById, isAbsBookOrphaned, useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeAbsServerContentId } from '@/services/sync/adapters/absServer';
import { makeAbsFilePath } from '@/utils/audiobook';
import type { ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';

// Mock replicaPublish like the OPDS store test does.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

const makeEnvConfig = (): EnvConfigType => ({ getAppService: vi.fn() }) as unknown as EnvConfigType;

describe('absServerStore', () => {
  beforeEach(() => {
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({
      settings: { absServers: [] } as unknown as SystemSettings,
      setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
      saveSettings: vi.fn(),
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
  });

  it('addServer computes contentId from normalized url and mints a reincarnation token', () => {
    const server = useABSServerStore.getState().addServer({
      name: 'Home',
      url: 'http://ABS.local:13378',
    });
    expect(server.contentId).toBe(computeAbsServerContentId('http://ABS.local:13378'));
    expect(server.reincarnation).toBeTruthy();
    expect(server.addedAt).toBeTruthy();
  });

  // The id is baked into every ABS book's `abs://<serverId>/<itemId>` filePath
  // and hashed from it. A device-local id (the old `Date.now()`) gave the same
  // audiobook a different hash on each device; an id that later changed
  // orphaned the whole shelf (removeAbsServerBooks / openAudiobookSession look
  // the server up by the current id).
  it('addServer uses the contentId as the local id, ignoring any other value', () => {
    const a = useABSServerStore.getState().addServer({ name: 'Home', url: 'http://abs.local' });
    expect(a.id).toBe(a.contentId);
    expect(a.id).toBe(computeAbsServerContentId('http://abs.local'));

    // A second device adding the same URL derives the identical id, so both
    // devices mint the same book hashes.
    useABSServerStore.setState({ servers: [] });
    const b = useABSServerStore
      .getState()
      .addServer({ name: 'Elsewhere', url: 'http://abs.local' });
    expect(b.id).toBe(a.id);
  });

  it('re-adding a removed server revives it under the same contentId', () => {
    const { addServer, removeServer, getAvailableServers } = useABSServerStore.getState();
    const server = addServer({ name: 'Home', url: 'http://abs.local' });
    removeServer(server.id);
    expect(getAvailableServers()).toHaveLength(0);
    addServer({ name: 'Home', url: 'http://abs.local' });
    expect(getAvailableServers()).toHaveLength(1);
    expect(useABSServerStore.getState().servers).toHaveLength(1);
  });

  it('applyRemoteServer preserves local credentials when remote arrives without them', () => {
    const { addServer, applyRemoteServer } = useABSServerStore.getState();
    const local = addServer({
      name: 'Home',
      url: 'http://abs.local',
      username: 'u',
      password: 'p',
      accessToken: 'a',
      refreshToken: 'r',
    });
    applyRemoteServer({
      id: local.contentId!,
      contentId: local.contentId,
      name: 'Home2',
      url: 'http://abs.local',
    });
    const merged = useABSServerStore.getState().findByContentId(local.contentId!);
    expect(merged?.name).toBe('Home2');
    expect(merged?.username).toBe('u');
    expect(merged?.accessToken).toBe('a');
  });

  it('applyRemoteServer never changes an existing server id, and keeps lastSyncedAt', () => {
    const { addServer, updateServer, applyRemoteServer } = useABSServerStore.getState();
    const local = addServer({ name: 'Home', url: 'http://abs.local' });
    updateServer(local.id, { lastSyncedAt: 4242 });

    // A remote row whose replica_id-derived id disagrees with the local one
    // (a pre-fix device, or any future id scheme change): taking it would
    // orphan and duplicate every book this server materialized.
    applyRemoteServer({
      id: 'some-other-id',
      contentId: local.contentId,
      name: 'Home',
      url: 'http://abs.local',
    });

    const merged = useABSServerStore.getState().findByContentId(local.contentId!);
    expect(merged?.id).toBe(local.id);
    expect(merged?.lastSyncedAt).toBe(4242);
  });

  it('removeServer soft-deletes and getAvailableServers filters tombstones', () => {
    const { addServer, removeServer, getAvailableServers } = useABSServerStore.getState();
    const server = addServer({ name: 'Home', url: 'http://abs.local' });
    expect(removeServer(server.id)).toBe(true);
    expect(getAvailableServers()).toHaveLength(0);
    expect(useABSServerStore.getState().servers[0]!.deletedAt).toBeTruthy();
  });

  describe('saveABSServers', () => {
    const persisted: ABSServer = {
      id: 'srv-1',
      contentId: 'srv-1',
      addedAt: 1,
      name: 'Home',
      url: 'http://abs.local',
      accessToken: 'stale',
    };

    // Device-reported data loss: `settings.absServers` came back empty on the
    // first boot after an app update. `EnvProvider` publishes `appService`
    // BEFORE `appService.loadSettings()` resolves, so the library-mount
    // hydration (`useABSSync` -> `loadABSServers`) reads the `{}` placeholder
    // settings and leaves the store empty for the whole session. Every later
    // `saveABSServers` then published that empty store as the complete server
    // list. The wipe trigger in the field was the ABS token refresh
    // (`openAudiobook`'s `onTokensUpdated`), whose `updateServer` silently
    // no-ops against the empty store before the unconditional persist.
    it('keeps persisted servers the store never loaded', async () => {
      // Boot race: the settings store still holds its `{}` placeholder.
      useSettingsStore.setState({ settings: {} as SystemSettings });
      await useABSServerStore.getState().loadABSServers(makeEnvConfig());
      expect(useABSServerStore.getState().servers).toHaveLength(0);

      // Settings land after that hydration already ran.
      useSettingsStore.setState({
        settings: { absServers: [persisted] } as unknown as SystemSettings,
      });

      // A 401 token refresh arrives on the un-hydrated store.
      useABSServerStore.getState().updateServer('srv-1', { accessToken: 'rotated' });
      await useABSServerStore.getState().saveABSServers(makeEnvConfig());

      expect(useSettingsStore.getState().settings.absServers).toEqual([persisted]);
    });

    it('still removes a server the store did load and tombstoned', async () => {
      useSettingsStore.setState({
        settings: { absServers: [persisted] } as unknown as SystemSettings,
      });
      await useABSServerStore.getState().loadABSServers(makeEnvConfig());
      expect(useABSServerStore.getState().getAvailableServers()).toHaveLength(1);

      useABSServerStore.getState().removeServer('srv-1');
      await useABSServerStore.getState().saveABSServers(makeEnvConfig());

      expect(useSettingsStore.getState().settings.absServers).toEqual([]);
    });
  });

  describe('findABSServerById', () => {
    const server: ABSServer = { id: 's1', name: 'Home', url: 'http://abs.local' };

    it('returns undefined for an empty id', () => {
      expect(findABSServerById('')).toBeUndefined();
    });

    it('finds a server already loaded into the in-memory store', () => {
      useABSServerStore.setState({ servers: [server] });
      expect(findABSServerById('s1')).toEqual(server);
    });

    it('falls back to persisted settings when the store has not been hydrated yet', () => {
      useABSServerStore.setState({ servers: [] });
      useSettingsStore.setState({
        settings: { absServers: [server] } as unknown as SystemSettings,
      });
      expect(findABSServerById('s1')).toEqual(server);
    });

    it('ignores a tombstoned entry in the settings fallback', () => {
      useABSServerStore.setState({ servers: [] });
      useSettingsStore.setState({
        settings: {
          absServers: [{ ...server, deletedAt: 123 }],
        } as unknown as SystemSettings,
      });
      expect(findABSServerById('s1')).toBeUndefined();
    });

    it('returns undefined when the server is in neither the store nor settings', () => {
      expect(findABSServerById('missing')).toBeUndefined();
    });
  });

  // An ABS book whose server row hasn't synced to this device (or whose
  // server was removed) cannot stream, has no cover source, and cannot be
  // opened — the library display hides it until the server row lands.
  describe('isAbsBookOrphaned', () => {
    const server: ABSServer = {
      id: 'srv1',
      contentId: 'srv1',
      addedAt: 1,
      name: 'Home',
      url: 'http://abs.local',
    };
    const absBook = {
      hash: 'h1',
      format: 'ABS',
      title: 'Peter Pan',
      filePath: makeAbsFilePath('srv1', 'item1'),
    } as Book;

    it('is false for a non-ABS book', () => {
      const epub = { hash: 'h2', format: 'EPUB', title: 'T', filePath: '/books/t.epub' } as Book;
      expect(isAbsBookOrphaned(epub)).toBe(false);
    });

    it('is true when the server is in neither the store nor settings', () => {
      expect(isAbsBookOrphaned(absBook)).toBe(true);
    });

    it('is false when the server is in the in-memory store', () => {
      useABSServerStore.setState({ servers: [server] });
      expect(isAbsBookOrphaned(absBook)).toBe(false);
    });

    it('is false when the server exists only in persisted settings (pre-hydration)', () => {
      useABSServerStore.setState({ servers: [] });
      useSettingsStore.setState({
        settings: { absServers: [server] } as unknown as SystemSettings,
      });
      expect(isAbsBookOrphaned(absBook)).toBe(false);
    });

    it('is true when the in-memory server row is tombstoned', () => {
      useABSServerStore.setState({ servers: [{ ...server, deletedAt: 123 }] });
      expect(isAbsBookOrphaned(absBook)).toBe(true);
    });

    it('is false for a disabled server — configured servers keep their shelf', () => {
      useABSServerStore.setState({ servers: [{ ...server, disabled: true }] });
      expect(isAbsBookOrphaned(absBook)).toBe(false);
    });
  });
});
