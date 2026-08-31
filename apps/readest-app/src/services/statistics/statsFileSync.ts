// File-based reading-statistics sync, riding the same remote tree as
// library.json + config.json over ANY FileSyncProvider backend (LAN, WebDAV,
// ...). Complements the Readest Cloud `/api/sync` channel for users who only
// enable file backends.
//
// Design: each device maintains ONE snapshot file `stats/<deviceKey>.json`
// holding its full page-event history. Devices write only their own file and
// read everyone else's, so there are no write conflicts; the receiving side
// merges through `StatisticsDb.applyRemoteEvents`, whose union-by-key +
// longer-duration-wins semantics make re-application idempotent. A per-peer
// `exportedAt` memo skips unchanged peer files so a sync run costs one list +
// one read per unchanged device.
//
// Like the cloud channel, the push cursor is a start_time high-water mark: a
// re-flushed event with a longer duration but an unchanged start_time is not
// re-pushed (accepted simplification of the stats design doc §5.2).
//
// Everything here is best-effort housekeeping: failures are logged and never
// break reading or the main sync pipeline.

import { useSettingsStore } from '@/store/settingsStore';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { ancestorsOf, buildStatsDirPath, buildStatsFilePath } from '@/services/sync/file/layout';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { PageStatEvent, StatBook } from '@/types/statistics';
import type { StatisticsDb } from './statisticsDb';

interface StatsSnapshot {
  version: 1;
  deviceKey: string;
  /** Wall-clock millis when this file was last written. */
  exportedAt: number;
  books: StatBook[];
  events: PageStatEvent[];
}

const DEVICE_KEY_STORAGE_KEY = 'readest.stats.deviceKey';

/** Stable per-device file key (uuid-ish), persisted in localStorage. */
const getDeviceKey = (): string => {
  try {
    let key = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (!key) {
      key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY_STORAGE_KEY, key);
    }
    return key;
  } catch {
    return 'device';
  }
};

/** Peer files already merged, keyed by file name -> snapshot exportedAt. */
const APPLIED_STORAGE_KEY = 'readest.stats.appliedSnapshots';

const readAppliedMemo = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(APPLIED_STORAGE_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

const writeAppliedMemo = (memo: Record<string, number>): void => {
  try {
    localStorage.setItem(APPLIED_STORAGE_KEY, JSON.stringify(memo));
  } catch {
    // Private-mode quota errors etc. — the memo is an optimization only.
  }
};

/**
 * Every enabled file-sync backend (LAN included — unlike the cloud-gated
 * channels, stats snapshots ride whatever the user switched on). When a cloud
 * plan pauses third-party backends, the active-backend helper still preserves
 * LAN because it is local and outside the cloud quota.
 */
const getActiveProviders = async (): Promise<FileSyncProvider[]> => {
  try {
    const settings = useSettingsStore.getState().settings;
    const providers: FileSyncProvider[] = [];
    for (const backend of getActiveFileSyncBackends(settings)) {
      const provider = await createFileSyncProvider(backend, settings);
      if (provider) providers.push(provider);
    }
    return providers;
  } catch {
    return [];
  }
};

/**
 * Rewrite this device's snapshot on every enabled backend when new local
 * events exist since the last push. Full-history rewrite: a fresh device can
 * rebuild from any single peer file. Returns how many backends were written.
 */
export const pushStatsSnapshot = async (db: StatisticsDb): Promise<number> => {
  try {
    const cursor = await db.getCursor('file-push');
    const { events } = await db.getEventsForPush(cursor);
    if (events.length === 0) return 0;

    // The file is a full-history snapshot (any single peer file must be able
    // to rebuild a fresh device); the cursor query above only gates whether a
    // rewrite is needed. This query is local SQLite, not network.
    const full = await db.getEventsForPush(0);
    const snapshot: StatsSnapshot = {
      version: 1,
      deviceKey: getDeviceKey(),
      exportedAt: Date.now(),
      books: full.books,
      events: full.events,
    };
    const text = JSON.stringify(snapshot);

    const providers = await getActiveProviders();
    let pushed = 0;
    for (const provider of providers) {
      try {
        const path = buildStatsFilePath(provider.rootPath, snapshot.deviceKey);
        await provider.ensureDir(ancestorsOf(path));
        await provider.writeText(path, text, 'application/json');
        pushed++;
      } catch (err) {
        console.warn('[stats] snapshot push failed:', err);
      }
    }
    if (pushed > 0) {
      const newest = events.reduce((m, e) => Math.max(m, e.startTime), cursor);
      await db.setCursor('file-push', newest);
    }
    return pushed;
  } catch (err) {
    console.warn('[stats] snapshot push failed:', err);
    return 0;
  }
};

/**
 * Read every peer snapshot from every enabled backend and merge the ones that
 * changed since the last pull. Returns how many snapshots were applied.
 */
export const pullStatsSnapshots = async (db: StatisticsDb): Promise<number> => {
  try {
    const providers = await getActiveProviders();
    if (providers.length === 0) return 0;
    const deviceKey = getDeviceKey();
    const myFile = `${deviceKey}.json`;
    const memo = readAppliedMemo();
    const memoDirty = { value: false };
    let applied = 0;

    for (const provider of providers) {
      let names: string[] = [];
      try {
        const entries = await provider.list(buildStatsDirPath(provider.rootPath));
        names = entries
          .filter((e) => !e.isDirectory && e.name.endsWith('.json'))
          .map((e) => e.name);
      } catch {
        // No stats dir on this backend yet (nothing ever pushed) — fine.
        continue;
      }
      for (const name of names) {
        if (name === myFile) continue;
        try {
          const text = await provider.readText(buildStatsFilePath(provider.rootPath, name));
          if (!text) continue;
          let snapshot: StatsSnapshot;
          try {
            snapshot = JSON.parse(text) as StatsSnapshot;
          } catch {
            continue;
          }
          if (snapshot.version !== 1 || !Array.isArray(snapshot.events)) continue;
          if (memo[name] === snapshot.exportedAt) continue;
          await db.applyRemoteEvents(snapshot.books ?? [], snapshot.events);
          memo[name] = snapshot.exportedAt;
          memoDirty.value = true;
          applied++;
        } catch (err) {
          console.warn('[stats] snapshot pull failed for', name, err);
        }
      }
    }
    if (memoDirty.value) writeAppliedMemo(memo);
    return applied;
  } catch (err) {
    console.warn('[stats] snapshot pull failed:', err);
    return 0;
  }
};
