import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useCustomDictionaryStore, findDictionaryByContentId } from '@/store/customDictionaryStore';
import {
  useCustomFontStore,
  findFontByContentId,
  migrateLegacyFonts,
} from '@/store/customFontStore';
import { transferManager } from '@/services/transferManager';
import { getReplicaSync, subscribeReplicaSyncReady } from '@/services/sync/replicaSync';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';
import { fontAdapter } from '@/services/sync/adapters/font';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import { replicaPullAndApply, type PullAndApplyDeps } from '@/services/sync/replicaPullAndApply';
import { getAccessToken } from '@/utils/access';
import { uniqueId } from '@/utils/misc';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { CustomFont } from '@/styles/fonts';

export type ReplicaKind = 'dictionary' | 'font';

export interface UseReplicaPullOpts {
  /** Replica kinds this page wants pulled. */
  kinds: readonly ReplicaKind[];
  /** Delay before firing the pull. Defaults to 10s — keeps the boot
   *  critical path clean and lets feature mounts hydrate first. */
  delayMs?: number;
}

const REPLICA_PULL_DEFAULT_DELAY_MS = 10_000;

// Module-level dedup so navigating between pages (library → reader → …)
// doesn't fire a fresh pull every time. Periodic resync is handled by
// ReplicaSyncManager.startAutoSync (visibility / online listeners),
// which is wired once in EnvContext.
const pulledKinds = new Set<ReplicaKind>();

const buildDictionaryPullDeps = (
  manager: ReplicaSyncManager,
  service: AppService,
  envConfig: EnvConfigType,
): PullAndApplyDeps<ImportedDictionary> => ({
  adapter: dictionaryAdapter,
  // Boot path uses since=null so we always re-fetch and apply locally,
  // ignoring any previously-advanced cursor. Periodic sync (visibility /
  // online) goes through manager.pull(kind) which keeps using the cursor.
  pull: () => manager.pull('dictionary', { since: null }),
  // The page may mount before loadCustomDictionaries has hydrated the
  // in-memory store, so the dedup helper falls back to settings.
  findByContentId: (id: string) => findDictionaryByContentId(id),
  // Pull-side relies on the in-memory dict store reflecting persisted
  // state — without this, the auto-persist fired by applyRemoteDictionary
  // would write back only the just-applied rows and clobber every
  // persisted dict that hadn't been hydrated by an Annotator/Settings
  // mount. Library-page refreshes were the visible victim.
  hydrateLocalStore: () => useCustomDictionaryStore.getState().loadCustomDictionaries(envConfig),
  applyRemote: (dict) => useCustomDictionaryStore.getState().applyRemoteDictionary(dict),
  softDeleteByContentId: (id) => useCustomDictionaryStore.getState().softDeleteByContentId(id),
  createBundleDir: async () => {
    const id = uniqueId();
    await service.createDir(id, 'Dictionaries', true);
    return id;
  },
  queueReplicaDownload: (contentId, displayTitle, files, _bundleDir, base) =>
    transferManager.queueReplicaDownload('dictionary', contentId, displayTitle, files, base),
  filesExist: async (bundleDir, filenames) => {
    for (const filename of filenames) {
      const exists = await service.exists(`${bundleDir}/${filename}`, 'Dictionaries');
      if (!exists) return false;
    }
    return true;
  },
  queueLocalBinaryUpload: async (record) => {
    await queueReplicaBinaryUpload('dictionary', record, service);
  },
  isAuthenticated: async () => !!(await getAccessToken()),
});

const buildFontPullDeps = (
  manager: ReplicaSyncManager,
  service: AppService,
  envConfig: EnvConfigType,
): PullAndApplyDeps<CustomFont> => ({
  adapter: fontAdapter,
  pull: () => manager.pull('font', { since: null }),
  findByContentId: (id: string) => findFontByContentId(id),
  hydrateLocalStore: async () => {
    await useCustomFontStore.getState().loadCustomFonts(envConfig);
    // Rehash legacy flat-path fonts so the user doesn't have to
    // re-import them by hand to get them onto other devices.
    await migrateLegacyFonts(envConfig);
  },
  applyRemote: (font) => useCustomFontStore.getState().applyRemoteFont(font),
  softDeleteByContentId: (id) => useCustomFontStore.getState().softDeleteByContentId(id),
  createBundleDir: async () => {
    const id = uniqueId();
    await service.createDir(id, 'Fonts', true);
    return id;
  },
  queueReplicaDownload: (contentId, displayTitle, files, _bundleDir, base) =>
    transferManager.queueReplicaDownload('font', contentId, displayTitle, files, base),
  filesExist: async (bundleDir, filenames) => {
    for (const filename of filenames) {
      const exists = await service.exists(`${bundleDir}/${filename}`, 'Fonts');
      if (!exists) return false;
    }
    return true;
  },
  queueLocalBinaryUpload: async (record) => {
    await queueReplicaBinaryUpload('font', record, service);
  },
  isAuthenticated: async () => !!(await getAccessToken()),
});

const runPullForKind = async (
  kind: ReplicaKind,
  service: AppService,
  envConfig: EnvConfigType,
): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  if (kind === 'dictionary') {
    await replicaPullAndApply(buildDictionaryPullDeps(ctx.manager, service, envConfig));
    return;
  }
  if (kind === 'font') {
    await replicaPullAndApply(buildFontPullDeps(ctx.manager, service, envConfig));
    return;
  }
  // Future: dispatch to other per-kind dep builders here.
};

/**
 * Schedules a deferred replica pull for the requested kinds. Mount this
 * on a page that wants those kinds present (library, reader, etc.).
 *
 * Per-kind dedup is module-scoped: the first mount that schedules a
 * pull for `dictionary` claims that kind for the rest of the session;
 * subsequent mounts (re-navigation, hot reload, parallel pages mounting
 * simultaneously) skip. ReplicaSyncManager.startAutoSync handles the
 * "tab regained focus / network came back" resync — this hook is only
 * for the initial pull each session.
 */
export const useReplicaPull = ({
  kinds,
  delayMs = REPLICA_PULL_DEFAULT_DELAY_MS,
}: UseReplicaPullOpts): void => {
  const { envConfig, appService } = useEnv();
  // Stable cache key so the effect doesn't re-run when the caller
  // passes a freshly-allocated array literal each render.
  const kindsKey = kinds.join(',');

  useEffect(() => {
    if (!appService) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const schedule = () => {
      if (timer) return;
      const pendingKinds = kinds.filter((k) => !pulledKinds.has(k));
      if (pendingKinds.length === 0) return;
      timer = setTimeout(() => {
        for (const kind of pendingKinds) {
          if (pulledKinds.has(kind)) continue;
          // Claim the slot up front so a concurrently-scheduled mount
          // (e.g., library + reader mounting back-to-back) doesn't
          // double-pull. On failure we release the slot so a
          // subsequent navigation can retry.
          pulledKinds.add(kind);
          void runPullForKind(kind, appService, envConfig).catch((err) => {
            console.warn(`replica ${kind} pull failed`, err);
            pulledKinds.delete(kind);
          });
        }
      }, delayMs);
    };

    if (getReplicaSync()) {
      schedule();
    } else {
      // Hard-refresh race: appService resolved before
      // EnvContext.initReplicaSync finished (loadSettings is async,
      // setAppService runs first). Wait for the ready signal so the
      // pull still fires once the singleton lands.
      unsubscribe = subscribeReplicaSyncReady(schedule);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey, appService, envConfig, delayMs]);
};

/** Test seam — clear the per-kind dedup state between specs. */
export const __resetReplicaPullForTests = (): void => {
  pulledKinds.clear();
};
