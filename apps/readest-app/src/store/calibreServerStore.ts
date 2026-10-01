import { create } from 'zustand';
import type { EnvConfigType } from '@/services/environment';
import type { CalibreServer } from '@/types/calibre';
import { computeCalibreServerId, parseCalibreFilePath } from '@/utils/calibre';
import { useSettingsStore } from './settingsStore';

/**
 * Store for configured Calibre content servers, persisted to
 * `settings.calibreServers` (the OPDSCatalog precedent — no dedicated replica
 * kind yet, so cross-device config sync rides on whatever the user's settings
 * sync carries). `id === computeCalibreServerId(url)` always: the id is baked
 * into every synced book's synthetic `calibre://` filePath and therefore into
 * its hash, so it is URL-derived and immutable.
 */
interface CalibreServerStoreState {
  servers: CalibreServer[];

  /** Visible servers (tombstones filtered out). */
  getAvailableServers(): CalibreServer[];
  getServer(id: string): CalibreServer | undefined;

  /** Add (or revive/update) a server. Returns the stored row. */
  addServer(server: Omit<CalibreServer, 'id'> & { id?: string }): CalibreServer;
  /** Patch a server's mutable fields. */
  updateServer(id: string, patch: Partial<CalibreServer>): CalibreServer | undefined;
  /** Remove by id; returns the removed row so the caller can clean up its books. */
  removeServer(id: string): CalibreServer | undefined;

  /** Hydrate from `settings.calibreServers`. */
  loadCalibreServers(): Promise<void>;
  /** Persist current state back into settings. */
  saveCalibreServers(envConfig: EnvConfigType): Promise<void>;
}

export const useCalibreServerStore = create<CalibreServerStoreState>((set, get) => ({
  servers: [],

  getAvailableServers: () => get().servers.filter((s) => !s.deletedAt),

  getServer: (id) => get().servers.find((s) => s.id === id),

  addServer: (input) => {
    const existing = get().servers.find(
      (s) => s.id === (input.id ?? computeCalibreServerId(input.url)),
    );
    const server: CalibreServer = {
      ...input,
      id: existing?.id ?? computeCalibreServerId(input.url),
      addedAt: input.addedAt ?? existing?.addedAt ?? Date.now(),
      deletedAt: undefined,
    };
    set((state) => {
      const idx = state.servers.findIndex((s) => s.id === server.id);
      const servers =
        idx >= 0
          ? state.servers.map((s, i) => (i === idx ? server : s))
          : [...state.servers, server];
      return { servers };
    });
    return server;
  },

  updateServer: (id, patch) => {
    let updated: CalibreServer | undefined;
    set((state) => {
      const idx = state.servers.findIndex((s) => s.id === id);
      if (idx < 0) return state;
      if (state.servers[idx]!.deletedAt) return state;
      updated = { ...state.servers[idx]!, ...patch };
      return { servers: state.servers.map((s, i) => (i === idx ? updated! : s)) };
    });
    return updated;
  },

  removeServer: (id) => {
    const server = get().servers.find((s) => s.id === id);
    if (!server) return undefined;
    // Tombstone instead of removing: the row must survive in `servers` so the
    // next saveCalibreServers persists deletedAt into settings — dropping it
    // here would let the unseen-rows merge resurrect the server on the next
    // save. getAvailableServers/loadCalibreServers/findCalibreServerById all
    // skip tombstoned rows, so nothing active ever sees it.
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, deletedAt: Date.now() } : s)),
    }));
    return server;
  },

  loadCalibreServers: async () => {
    try {
      const { settings } = useSettingsStore.getState();
      const persisted = settings?.calibreServers ?? [];
      set({ servers: persisted.filter((s) => !s.deletedAt) });
    } catch (error) {
      console.error('Failed to load Calibre servers:', error);
    }
  },

  saveCalibreServers: async (_envConfig) => {
    try {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const { servers } = get();
      // Same hydration-race guard as saveABSServers: a settings object the
      // store never loaded carries no information about configured servers.
      const known = new Set(servers.map((s) => s.id));
      const unseen = (settings.calibreServers ?? []).filter((s) => !known.has(s.id));
      settings.calibreServers = [...servers, ...unseen];
      setSettings(settings);
      saveSettings(_envConfig, settings);
    } catch (error) {
      console.error('Failed to save Calibre servers:', error);
      throw error;
    }
  },
}));

/**
 * Look up a Calibre server by id, falling back to persisted settings when the
 * in-memory store hasn't been hydrated yet (the reader can open a downloaded
 * Calibre book before any settings panel mounted). Mirrors findABSServerById.
 */
export const findCalibreServerById = (id: string): CalibreServer | undefined => {
  if (!id) return undefined;
  const inMemory = useCalibreServerStore.getState().getServer(id);
  if (inMemory) return inMemory;
  const persisted = useSettingsStore.getState().settings?.calibreServers ?? [];
  return persisted.find((s) => s.id === id && !s.deletedAt);
};

/**
 * True for a Calibre sync stub whose server row is gone (removed or not yet
 * synced to this device): the stub can neither download its file nor fetch
 * covers, so the library display hides it until the server row lands.
 * Downloaded copies have a real local file (no synthetic filePath) and stay
 * openable regardless of the server row.
 */
export const isCalibreBookOrphaned = (book: { filePath?: string }): boolean => {
  const parsed = parseCalibreFilePath(book.filePath);
  if (!parsed) return false;
  const server = findCalibreServerById(parsed.serverId);
  return !server || !!server.deletedAt;
};
