import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';
import { parseAbsFilePath } from '@/utils/audiobook';
import { useSettingsStore } from './settingsStore';
import { getReplicaPersistEnv } from '@/services/sync/replicaPersist';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import { computeAbsServerContentId, ABS_SERVER_KIND } from '@/services/sync/adapters/absServer';

const publishAbsUpsert = (server: ABSServer): void => {
  if (!server.contentId) return;
  void publishReplicaUpsert(ABS_SERVER_KIND, server, server.contentId, server.reincarnation);
};

const publishAbsDelete = (contentId: string): void => {
  void publishReplicaDelete(ABS_SERVER_KIND, contentId);
};

/**
 * Backfill `contentId` (and `addedAt`) on legacy servers that predate
 * replica sync. Returns the same array reference if no changes were
 * required so callers can cheaply detect a no-op.
 *
 * `addedAt` is assigned per array index so the existing display order
 * survives the migration: index 0 (newest in the legacy array) gets
 * the largest timestamp, index N gets the smallest. The total span is
 * tiny (≤ N ms) so newly-imported servers (with `Date.now()`) still
 * sort above the migrated set, which matches the legacy "prepend new
 * entries" UX.
 */
const backfillSyncFields = (servers: ABSServer[]): ABSServer[] => {
  let mutated = false;
  const baseTime = Date.now();
  const next = servers.map((s, i) => {
    if (s.contentId && s.addedAt !== undefined) return s;
    mutated = true;
    return {
      ...s,
      contentId: s.contentId ?? computeAbsServerContentId(s.url),
      addedAt: s.addedAt ?? baseTime - i,
    };
  });
  return mutated ? next : servers;
};

interface ABSServerStoreState {
  servers: ABSServer[];
  loading: boolean;

  /** Visible servers (tombstones filtered out). */
  getAvailableServers(): ABSServer[];
  getServer(id: string): ABSServer | undefined;
  /** Look up by stable cross-device content id. */
  findByContentId(contentId: string): ABSServer | undefined;

  /**
   * Add (or revive) a server. Computes `contentId` from URL if absent and
   * uses it as the local `id` too — the id is baked into every ABS book's
   * `filePath` (`abs://<serverId>/<itemId>`) and therefore into its hash,
   * so it must be the same value on every device and must never change.
   * Always attaches a reincarnation token (minted when absent, existing
   * one preserved) so the upsert replaces any server-side tombstone with
   * a fresh row instead of losing to it under remove-wins.
   */
  addServer(server: Omit<ABSServer, 'id' | 'contentId'> & { contentId?: string }): ABSServer;
  /** Patch a server's mutable fields. Only the patched fields are republished. */
  updateServer(id: string, patch: Partial<ABSServer>): ABSServer | undefined;
  /** Soft-delete by id; pushes a tombstone if the entry has a contentId. */
  removeServer(id: string): boolean;

  /**
   * Apply a server received via replica sync from another device. Same
   * effect on local state as addServer, but does NOT republish.
   */
  applyRemoteServer(server: ABSServer): void;
  /** Mirror a server-side tombstone locally without re-publishing. */
  softDeleteByContentId(contentId: string): void;

  /** Hydrate from `settings.absServers`. Backfills sync fields if needed. */
  loadABSServers(envConfig: EnvConfigType): Promise<void>;
  /** Persist current state back into settings. */
  saveABSServers(envConfig: EnvConfigType): Promise<void>;
}

export const useABSServerStore = create<ABSServerStoreState>((set, get) => ({
  servers: [],
  loading: false,

  getAvailableServers: () => get().servers.filter((s) => !s.deletedAt),

  getServer: (id) => get().servers.find((s) => s.id === id),

  findByContentId: (contentId) =>
    contentId ? get().servers.find((s) => s.contentId === contentId) : undefined,

  addServer: (input) => {
    const contentId = input.contentId ?? computeAbsServerContentId(input.url);
    const existing = get().servers.find((s) => s.contentId === contentId);
    // Under CRDT remove-wins a plain upsert can't revive a server-side
    // tombstone, so a re-added server silently vanishes on the next
    // pull (issue #5180, same class as fonts/textures #4410). We can't
    // see the server's tombstone from here, and — unlike fonts/textures —
    // saveABSServers strips local tombstones at persistence, so after an
    // app restart `existing` is usually absent even when the server row
    // is dead. Always carry a reincarnation token on add so the upsert
    // beats any server tombstone; the token is inert when the row is
    // alive. Preserve an existing token to avoid churning a new one on
    // every add.
    const reincarnation =
      input.reincarnation ?? existing?.reincarnation ?? Math.random().toString(36).slice(2);
    const server: ABSServer = {
      ...input,
      // id === contentId, always. `librarySync` bakes the id into each
      // book's `abs://<serverId>/<itemId>` filePath and hashes that path,
      // so a per-device id (the old `Date.now()`) gave the same audiobook
      // a different hash on every device, and any later id change orphaned
      // the whole set (removeAbsServerBooks / openAudiobookSession look up
      // by the current id). The URL-derived contentId is stable everywhere.
      id: contentId,
      contentId,
      addedAt: input.addedAt ?? existing?.addedAt ?? Date.now(),
      deletedAt: undefined,
      reincarnation,
    };
    set((state) => {
      const idx = state.servers.findIndex((s) => s.contentId === contentId);
      const servers =
        idx >= 0
          ? state.servers.map((s, i) => (i === idx ? server : s))
          : [...state.servers, server];
      return { servers };
    });
    publishAbsUpsert(server);
    return server;
  },

  updateServer: (id, patch) => {
    let updated: ABSServer | undefined;
    set((state) => {
      const idx = state.servers.findIndex((s) => s.id === id);
      if (idx < 0) return state;
      const old = state.servers[idx]!;
      if (old.deletedAt) return state;
      updated = { ...old, ...patch };
      // Recompute contentId only if the URL itself changed; otherwise
      // preserve the existing one so we keep the same server row.
      if (patch.url && patch.url !== old.url) {
        updated.contentId = computeAbsServerContentId(patch.url);
      }
      return {
        servers: state.servers.map((s, i) => (i === idx ? updated! : s)),
      };
    });
    if (updated) publishAbsUpsert(updated);
    return updated;
  },

  removeServer: (id) => {
    const server = get().servers.find((s) => s.id === id);
    if (!server) return false;
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s)),
    }));
    if (server.contentId) publishAbsDelete(server.contentId);
    return true;
  },

  applyRemoteServer: (server) => {
    set((state) => {
      const idx = state.servers.findIndex((s) => s.contentId === server.contentId);
      if (idx >= 0) {
        // Preserve local credentials when remote arrives without them
        // (publishing device hadn't unlocked the CryptoSession, or the
        // local session couldn't decrypt). When remote DOES include
        // decrypted creds, accept them — that's the cross-device sync
        // path enabled by replicaCryptoMiddleware.decryptRowFields.
        // `??` is nullish so an explicit "" from remote (user cleared
        // the password) still overwrites.
        const old = state.servers[idx]!;
        const merged: ABSServer = {
          ...server,
          // The local id is book identity (see addServer): every ABS book's
          // filePath/hash was derived from it. Taking the remote row's id
          // here would orphan and duplicate this server's whole shelf. With
          // id === contentId the two agree anyway; this keeps that true for
          // rows added before the rule existed.
          id: old.id,
          // Device-local: when THIS device last talked to the ABS server.
          // It never travels in the replica row, so a merge must not blank it.
          lastSyncedAt: old.lastSyncedAt,
          username: server.username ?? old.username,
          password: server.password ?? old.password,
          accessToken: server.accessToken ?? old.accessToken,
          refreshToken: server.refreshToken ?? old.refreshToken,
          // Preserve the previously-applied cipher fingerprint when
          // the orchestrator didn't attach a fresh one (e.g., row
          // carried no cipher fields, or every decrypt failed).
          // Without this fallback the next pull would treat the row
          // as "never decrypted" and prompt again unnecessarily.
          lastSeenCipher: server.lastSeenCipher ?? old.lastSeenCipher,
          deletedAt: undefined,
        };
        return { servers: state.servers.map((s, i) => (i === idx ? merged : s)) };
      }
      return { servers: [...state.servers, server] };
    });
    const env = getReplicaPersistEnv();
    if (env) void get().saveABSServers(env);
  },

  softDeleteByContentId: (contentId) => {
    const target = get().servers.find((s) => s.contentId === contentId && !s.deletedAt);
    if (!target) return;
    set((state) => ({
      servers: state.servers.map((s) => (s.id === target.id ? { ...s, deletedAt: Date.now() } : s)),
    }));
    const env = getReplicaPersistEnv();
    if (env) void get().saveABSServers(env);
  },

  loadABSServers: async (_envConfig) => {
    try {
      const { settings } = useSettingsStore.getState();
      const persisted = settings?.absServers ?? [];
      const backfilled = backfillSyncFields(persisted);
      set({ servers: backfilled });
      // If backfill mutated anything, persist + publish the fresh
      // contentIds so existing servers start syncing on next push.
      if (backfilled !== persisted) {
        await get().saveABSServers(_envConfig);
        for (const s of backfilled) {
          if (s.contentId && !s.deletedAt) publishAbsUpsert(s);
        }
      }
    } catch (error) {
      console.error('Failed to load ABS servers:', error);
    }
  },

  saveABSServers: async (_envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { servers } = get();
      // Tombstoned entries stay in memory so the orchestrator can detect
      // re-import / reincarnation, but they're stripped at the
      // persistence boundary. The next pull will mirror server-side
      // tombstones back into memory if the row is still deleted.
      const live = servers.filter((s) => !s.deletedAt);
      // An in-memory list the store never loaded is NO INFORMATION about the
      // configured servers — it must never be published as "the user has
      // none". `EnvProvider` sets `appService` before `loadSettings()`
      // resolves, so the library-mount hydration (`useABSSync`) can read the
      // `{}` placeholder settings and leave the store empty for the whole
      // session; the ABS token refresh then persisted that empty store
      // (`onTokensUpdated` -> `updateServer` silently no-ops -> this save)
      // over the user's real server list. Carry through every persisted entry
      // the store has no record of — neither a live copy nor a tombstone.
      // Deletions always leave a tombstone in `servers`, so a removed server
      // is never resurrected here.
      const known = new Set(
        servers.flatMap((s) => [s.id, s.contentId]).filter((v): v is string => !!v),
      );
      const unseen = (settings.absServers ?? []).filter(
        (s) => !known.has(s.id) && !(s.contentId && known.has(s.contentId)),
      );
      settings.absServers = [...live, ...unseen];
      setSettings(settings);
      saveSettings(_envConfig, settings);
    } catch (error) {
      console.error('Failed to save ABS servers:', error);
      throw error;
    }
  },
}));

/**
 * Look up an ABS server by its local id, falling back to persisted settings
 * when the in-memory store hasn't been hydrated yet. `openAudiobookSession`
 * can run before anything has hydrated the store (no IntegrationsPanel
 * mount, no replica pull), and without this fallback a fresh app boot fails
 * every audiobook open with a "server not found" toast. Mirrors
 * `findOPDSCatalogByContentId` in customOPDSStore.ts.
 */
export const findABSServerById = (id: string): ABSServer | undefined => {
  if (!id) return undefined;
  const inMemory = useABSServerStore.getState().getServer(id);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.absServers ?? [];
  return persisted.find((s) => s.id === id && !s.deletedAt);
};

/**
 * True for an ABS book whose server row is absent (not yet synced to this
 * device, or removed). All audio data lives on the ABS server, so without
 * the server row the book cannot stream, has no cover source, and cannot be
 * opened — the library display hides orphans until the server row lands.
 * The rows themselves stay in the store and keep syncing. A `disabled`
 * server still counts as configured: disabling only pauses auto-sync.
 */
export const isAbsBookOrphaned = (book: Book): boolean => {
  const parsed = parseAbsFilePath(book.filePath);
  if (!parsed) return false;
  const server = findABSServerById(parsed.serverId);
  return !server || !!server.deletedAt;
};
