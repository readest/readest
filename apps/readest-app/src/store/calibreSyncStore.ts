import { create } from 'zustand';

/**
 * Live progress of a Calibre server sync, published by
 * syncCalibreServer and consumed by the settings form's progress bar.
 * In-memory only: a finished sync removes its entry, and the server row's
 * lastSyncedAt takes over as the durable record.
 */
export interface CalibreSyncProgress {
  /** 'books' = fetching metadata pages, 'covers' = downloading cover images. */
  phase: 'books' | 'covers';
  fetched: number;
  /** Server-reported book total, when the API exposes one. */
  total?: number;
}

interface CalibreSyncProgressState {
  byServer: Record<string, CalibreSyncProgress | undefined>;
  begin: (serverId: string) => void;
  update: (
    serverId: string,
    patch: Partial<Omit<CalibreSyncProgress, 'phase'>> & { phase?: 'books' | 'covers' },
  ) => void;
  /** Drop the entry once the sync settles (successfully or not). */
  finish: (serverId: string) => void;
}

export const useCalibreSyncProgressStore = create<CalibreSyncProgressState>((set) => ({
  byServer: {},
  begin: (serverId) =>
    set((state) => ({
      byServer: { ...state.byServer, [serverId]: { phase: 'books', fetched: 0 } },
    })),
  update: (serverId, patch) =>
    set((state) => {
      const current = state.byServer[serverId];
      if (!current) return state;
      return {
        byServer: {
          ...state.byServer,
          [serverId]: { ...current, ...patch },
        },
      };
    }),
  finish: (serverId) =>
    set((state) => {
      if (!state.byServer[serverId]) return state;
      const byServer = { ...state.byServer };
      delete byServer[serverId];
      return { byServer };
    }),
}));
