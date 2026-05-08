import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useCustomDictionaryStore, findDictionaryByContentId } from '@/store/customDictionaryStore';
import {
  useCustomFontStore,
  findFontByContentId,
  migrateLegacyFonts,
} from '@/store/customFontStore';
import {
  useCustomTextureStore,
  findTextureByContentId,
  migrateLegacyTextures,
} from '@/store/customTextureStore';
import { useCustomOPDSStore, findOPDSCatalogByContentId } from '@/store/customOPDSStore';
import { transferManager } from '@/services/transferManager';
import { getReplicaSync, subscribeReplicaSyncReady } from '@/services/sync/replicaSync';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';
import { fontAdapter } from '@/services/sync/adapters/font';
import { textureAdapter } from '@/services/sync/adapters/texture';
import { opdsCatalogAdapter } from '@/services/sync/adapters/opdsCatalog';
import { settingsAdapter, type SettingsRemoteRecord } from '@/services/sync/adapters/settings';
import {
  applyRemoteSettings,
  clearStoredEncryptedHashes,
  getStoredLastSeenCipher,
  publishSettingsIfChanged,
} from '@/services/sync/replicaSettingsSync';
import { useSettingsStore } from '@/store/settingsStore';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import {
  replicaPullAndApply,
  type PullAndApplyDeps,
  type ReplicaLocalRecord,
} from '@/services/sync/replicaPullAndApply';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import { getAccessToken } from '@/utils/access';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { uniqueId } from '@/utils/misc';
import type { EnvConfigType } from '@/services/environment';
import type { AppService, BaseDir } from '@/types/system';
import type { ReplicaSyncManager } from '@/services/sync/replicaSyncManager';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { CustomFont } from '@/styles/fonts';
import type { CustomTexture } from '@/styles/textures';
import type { OPDSCatalog } from '@/types/opds';
import type { SystemSettings } from '@/types/settings';

export type ReplicaKind = 'dictionary' | 'font' | 'texture' | 'opds_catalog' | 'settings';

export interface UseReplicaPullOpts {
  /** Replica kinds this page wants pulled. */
  kinds: readonly ReplicaKind[];
  /** Delay before firing the pull. Defaults to 5s — keeps the boot
   *  critical path clean and lets feature mounts hydrate first. */
  delayMs?: number;
}

const REPLICA_PULL_DEFAULT_DELAY_MS = 5_000;

// Module-level dedup so navigating between pages (library → reader → …)
// doesn't fire a fresh pull every time. Periodic resync is handled by
// ReplicaSyncManager.startAutoSync (visibility / online listeners),
// which is wired once in EnvContext.
const pulledKinds = new Set<ReplicaKind>();

/**
 * Per-kind config consumed by `buildReplicaPullDeps`. The factory fills
 * in everything that is structurally identical across kinds (creating
 * bundle dirs, queueing downloads, checking files exist, queueing
 * upload of the local copy, gating on auth). Per-kind logic stays
 * here: the adapter, base dir, find/hydrate/apply/soft-delete store
 * accessors.
 */
interface ReplicaPullConfig<T extends ReplicaLocalRecord> {
  kind: ReplicaKind;
  /** Required for binary-bearing kinds; omitted for metadata-only kinds. */
  baseDir?: BaseDir;
  adapter: ReplicaAdapter<T>;
  findByContentId: (id: string) => T | undefined;
  hydrateLocalStore?: (envConfig: EnvConfigType) => Promise<void>;
  applyRemote: (record: T) => void;
  softDeleteByContentId: (id: string) => void;
  /** Forwarded to PullAndApplyDeps; see that field for semantics. */
  silentDecrypt?: boolean;
  /** Forwarded to PullAndApplyDeps; see that field for semantics. */
  onSaltNotFound?: (paths: readonly string[]) => void;
}

const buildReplicaPullDeps = <T extends ReplicaLocalRecord>(
  manager: ReplicaSyncManager,
  service: AppService,
  envConfig: EnvConfigType,
  config: ReplicaPullConfig<T>,
): PullAndApplyDeps<T> => ({
  adapter: config.adapter,
  // Boot path uses since=null so we always re-fetch and apply locally,
  // ignoring any previously-advanced cursor. Periodic sync (visibility /
  // online) goes through manager.pull(kind) which keeps using the cursor.
  pull: () => manager.pull(config.kind, { since: null }),
  findByContentId: config.findByContentId,
  hydrateLocalStore: config.hydrateLocalStore
    ? () => config.hydrateLocalStore!(envConfig)
    : undefined,
  applyRemote: config.applyRemote,
  softDeleteByContentId: config.softDeleteByContentId,
  silentDecrypt: config.silentDecrypt,
  onSaltNotFound: config.onSaltNotFound,
  // The bundle / binary callbacks below are only reached when the
  // adapter declares a `binary` capability — replicaPullAndApply
  // short-circuits metadata-only kinds before invoking them. The
  // non-null assertion on baseDir is therefore safe in the binary
  // path; metadata-only kinds (opds_catalog) leave config.baseDir
  // unset and never hit these.
  createBundleDir: async () => {
    const id = uniqueId();
    await service.createDir(id, config.baseDir!, true);
    return id;
  },
  queueReplicaDownload: (contentId, displayTitle, files, _bundleDir, base) =>
    transferManager.queueReplicaDownload(config.kind, contentId, displayTitle, files, base),
  filesExist: async (bundleDir, filenames) => {
    for (const filename of filenames) {
      const exists = await service.exists(`${bundleDir}/${filename}`, config.baseDir!);
      if (!exists) return false;
    }
    return true;
  },
  queueLocalBinaryUpload: async (record) => {
    await queueReplicaBinaryUpload(config.kind, record, service);
  },
  // The pull skips when this resolves false. We piggyback the
  // user-facing category gate here so disabling a kind in
  // `User → Manage Sync` no-ops the pull (no HTTP, no warnings)
  // alongside the auth precheck — same effect, half the wiring.
  isAuthenticated: async () => {
    if (!isSyncCategoryEnabled(config.kind)) return false;
    return !!(await getAccessToken());
  },
});

const dictionaryPullConfig: ReplicaPullConfig<ImportedDictionary> = {
  kind: 'dictionary',
  baseDir: 'Dictionaries',
  adapter: dictionaryAdapter,
  // Page may mount before loadCustomDictionaries has hydrated the
  // in-memory store, so the dedup helper falls back to settings.
  findByContentId: findDictionaryByContentId,
  // Pull-side relies on the in-memory dict store reflecting persisted
  // state — without this, the auto-persist fired by applyRemoteDictionary
  // would write back only the just-applied rows and clobber every
  // persisted dict that hadn't been hydrated by an Annotator/Settings
  // mount. Library-page refreshes were the visible victim.
  hydrateLocalStore: (envConfig) =>
    useCustomDictionaryStore.getState().loadCustomDictionaries(envConfig),
  applyRemote: (dict) => useCustomDictionaryStore.getState().applyRemoteDictionary(dict),
  softDeleteByContentId: (id) => useCustomDictionaryStore.getState().softDeleteByContentId(id),
};

const fontPullConfig: ReplicaPullConfig<CustomFont> = {
  kind: 'font',
  baseDir: 'Fonts',
  adapter: fontAdapter,
  findByContentId: findFontByContentId,
  hydrateLocalStore: async (envConfig) => {
    await useCustomFontStore.getState().loadCustomFonts(envConfig);
    // Rehash legacy flat-path fonts so the user doesn't have to
    // re-import them by hand to get them onto other devices.
    await migrateLegacyFonts(envConfig);
  },
  applyRemote: (font) => useCustomFontStore.getState().applyRemoteFont(font),
  softDeleteByContentId: (id) => useCustomFontStore.getState().softDeleteByContentId(id),
};

const texturePullConfig: ReplicaPullConfig<CustomTexture> = {
  kind: 'texture',
  baseDir: 'Images',
  adapter: textureAdapter,
  findByContentId: findTextureByContentId,
  hydrateLocalStore: async (envConfig) => {
    await useCustomTextureStore.getState().loadCustomTextures(envConfig);
    // Rehash legacy flat-path textures so the user doesn't have to
    // re-import them by hand to get them onto other devices.
    await migrateLegacyTextures(envConfig);
  },
  applyRemote: (texture) => useCustomTextureStore.getState().applyRemoteTexture(texture),
  softDeleteByContentId: (id) => useCustomTextureStore.getState().softDeleteByContentId(id),
};

const opdsCatalogPullConfig: ReplicaPullConfig<OPDSCatalog> = {
  kind: 'opds_catalog',
  // metadata-only — no baseDir
  adapter: opdsCatalogAdapter,
  findByContentId: findOPDSCatalogByContentId,
  hydrateLocalStore: (envConfig) => useCustomOPDSStore.getState().loadCustomOPDSCatalogs(envConfig),
  applyRemote: (catalog) => useCustomOPDSStore.getState().applyRemoteCatalog(catalog),
  softDeleteByContentId: (id) => useCustomOPDSStore.getState().softDeleteByContentId(id),
};

const settingsPullConfig = (envConfig: EnvConfigType): ReplicaPullConfig<SettingsRemoteRecord> => ({
  kind: 'settings',
  // metadata-only — no baseDir
  adapter: settingsAdapter,
  // Synthesize a "local" record carrying the persisted cipher
  // fingerprint so the orchestrator's cipher-fingerprint comparison
  // works for settings the same way it does for OPDS:
  //   * fingerprint matches → skip prompt (already-decrypted ciphers
  //     unchanged); no spam on refresh
  //   * fingerprint differs (rotation / fresh device / new device A
  //     just set credentials) → prompt fires for the user to enter
  //     the passphrase
  // The empty patch is fine: applyRow re-applies metadata-only kinds
  // unconditionally for the actual data.
  findByContentId: () => ({
    name: 'singleton' as const,
    patch: {} as Partial<SystemSettings>,
    lastSeenCipher: getStoredLastSeenCipher(),
  }),
  applyRemote: (record) => applyRemoteSettings(envConfig, record),
  // Settings is a singleton — never tombstoned. The server-side
  // forget-passphrase wipe doesn't touch this row.
  softDeleteByContentId: () => {},
  // Auto-recovery for the orphan-cipher case: clear the persisted
  // "already-published" hash so the next save re-encrypts under the
  // current salt and overwrites the orphan. Then trigger an
  // immediate re-publish so the user doesn't have to touch settings
  // before the server heals itself.
  onSaltNotFound: (paths) => {
    clearStoredEncryptedHashes(paths);
    const settings = useSettingsStore.getState().settings;
    if (settings) void publishSettingsIfChanged(settings);
  },
});

const runPullForKind = async (
  kind: ReplicaKind,
  service: AppService,
  envConfig: EnvConfigType,
): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  // Per-kind dispatch keeps the generic record type sound — collapsing
  // the three configs into a Record<ReplicaKind, ReplicaPullConfig<...>>
  // would force a contravariant cast that loses type safety.
  switch (kind) {
    case 'dictionary':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, dictionaryPullConfig),
      );
      return;
    case 'font':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, fontPullConfig),
      );
      return;
    case 'texture':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, texturePullConfig),
      );
      return;
    case 'opds_catalog':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, opdsCatalogPullConfig),
      );
      return;
    case 'settings':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, settingsPullConfig(envConfig)),
      );
      return;
  }
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
