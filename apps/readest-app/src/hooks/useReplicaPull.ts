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
import type { Hlc } from '@/types/replica';
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
/** Periodic incremental-pull cadence for long-lived foreground tabs. */
const REPLICA_PULL_PERIODIC_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Minimum gap between visibility-triggered pulls. Rapid alt-tab cycles
 * (or browsers that fire `visibilitychange` on every workspace switch)
 * would otherwise pump a pull on every focus event. Online and periodic
 * triggers bypass this — they signal genuinely new conditions.
 */
const REPLICA_PULL_VISIBILITY_THROTTLE_MS = 10_000;

// Module-level dedup so navigating between pages (library → reader → …)
// doesn't fire a fresh boot pull every time. Once a kind has had its
// boot pull initiated (or completed) it stays in this set until the
// page unloads. Subsequent re-syncs for the same kind go through the
// incremental auto-pull path below.
const pulledKinds = new Set<ReplicaKind>();
// Per-kind in-flight gate covering BOTH boot and incremental pulls.
// Prevents concurrent pulls (e.g. visibilitychange firing while the
// boot pull is still resolving, or two triggers landing in the same
// tick).
const pullInFlight = new Set<ReplicaKind>();
// Union of every kind any mount has ever asked us to keep in sync.
// Drives the visibility / online / periodic-tick fan-out, which fires
// for the lifetime of the tab regardless of which page is currently
// mounted.
const registeredKinds = new Set<ReplicaKind>();
// Latest service + envConfig captured by a hook mount; the auto-sync
// triggers read this so the listeners (installed once) don't capture
// stale references when the env hot-reloads.
let autoSyncContext: { service: AppService; envConfig: EnvConfigType } | null = null;
let autoSyncListenersInstalled = false;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let lastVisibilityPullAt = 0;
// Shared promise for the boot-time settings pull. All other kinds'
// boot pulls await this so applyRemoteSettings has a chance to seed
// `lastPublishedFields` with server-authoritative values before
// dict/font/texture/opds_catalog auto-saves fire — without that
// ordering, those auto-saves diff against `undefined` on a fresh
// boot and republish the local default (e.g.
// `dictionarySettings.providerOrder`) with a fresh HLC, clobbering
// cross-device state under per-field LWW.
let settingsBootPullPromise: Promise<void> | null = null;

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
  pullOpts?: { since?: Hlc | null },
): PullAndApplyDeps<T> => ({
  adapter: config.adapter,
  // Boot path passes { since: null } so we always re-fetch and apply
  // locally, ignoring any previously-advanced cursor. The visibility /
  // online / periodic incremental triggers omit pullOpts so manager.pull
  // falls back to the persisted cursor — cheap delta fetch.
  pull: () => manager.pull(config.kind, pullOpts),
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
  pullOpts?: { since?: Hlc | null },
): Promise<void> => {
  const ctx = getReplicaSync();
  if (!ctx) return;
  // Per-kind dispatch keeps the generic record type sound — collapsing
  // the three configs into a Record<ReplicaKind, ReplicaPullConfig<...>>
  // would force a contravariant cast that loses type safety.
  switch (kind) {
    case 'dictionary':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, dictionaryPullConfig, pullOpts),
      );
      return;
    case 'font':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, fontPullConfig, pullOpts),
      );
      return;
    case 'texture':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, texturePullConfig, pullOpts),
      );
      return;
    case 'opds_catalog':
      await replicaPullAndApply(
        buildReplicaPullDeps(ctx.manager, service, envConfig, opdsCatalogPullConfig, pullOpts),
      );
      return;
    case 'settings':
      await replicaPullAndApply(
        buildReplicaPullDeps(
          ctx.manager,
          service,
          envConfig,
          settingsPullConfig(envConfig),
          pullOpts,
        ),
      );
      return;
  }
};

/**
 * Cursor-based incremental pull, gated by a per-kind in-flight set so
 * concurrent triggers (visibility + online firing in the same tick,
 * periodic timer racing with a focus event) collapse to one network
 * round-trip.
 */
const runIncrementalPullForKind = async (
  kind: ReplicaKind,
  service: AppService,
  envConfig: EnvConfigType,
): Promise<void> => {
  if (pullInFlight.has(kind)) return;
  // Skip until the kind's boot pull has at least been initiated. Boot
  // does the full re-fetch (since=null); incremental builds on whatever
  // cursor that pull advanced.
  if (!pulledKinds.has(kind)) return;
  pullInFlight.add(kind);
  try {
    await runPullForKind(kind, service, envConfig);
  } catch (err) {
    console.warn(`replica ${kind} incremental pull failed`, err);
  } finally {
    pullInFlight.delete(kind);
  }
};

const triggerIncrementalPullAll = (): void => {
  if (!autoSyncContext) return;
  const { service, envConfig } = autoSyncContext;
  for (const kind of registeredKinds) {
    void runIncrementalPullForKind(kind, service, envConfig);
  }
};

const onVisibilityChange = (): void => {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - lastVisibilityPullAt < REPLICA_PULL_VISIBILITY_THROTTLE_MS) return;
  lastVisibilityPullAt = now;
  triggerIncrementalPullAll();
};

const onOnline = (): void => {
  triggerIncrementalPullAll();
};

const onPeriodicTick = (): void => {
  // Don't burn battery on a backgrounded tab — the visibilitychange
  // listener will fire a catch-up pull when the tab returns to
  // foreground.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  triggerIncrementalPullAll();
};

/**
 * Idempotent settings boot pull. First caller starts the pull; every
 * subsequent caller (other kinds awaiting the seed, additional mounts)
 * receives the same promise. Settings is also added to
 * `registeredKinds` so the auto-pull triggers fan it out alongside the
 * caller's requested kinds.
 */
const ensureSettingsBootPulled = (service: AppService, envConfig: EnvConfigType): Promise<void> => {
  if (settingsBootPullPromise) return settingsBootPullPromise;
  registeredKinds.add('settings');
  pulledKinds.add('settings');
  pullInFlight.add('settings');
  settingsBootPullPromise = runPullForKind('settings', service, envConfig, { since: null })
    .catch((err) => {
      console.warn('replica settings pull failed', err);
      pulledKinds.delete('settings');
    })
    .finally(() => {
      pullInFlight.delete('settings');
    });
  return settingsBootPullPromise;
};

/**
 * Install document/window listeners + periodic interval for incremental
 * pulls. Idempotent — first call wires everything, subsequent calls
 * just refresh `autoSyncContext` (so listeners always see the latest
 * appService / envConfig). Listeners stay attached for the lifetime of
 * the page.
 */
const installAutoSyncListeners = (service: AppService, envConfig: EnvConfigType): void => {
  autoSyncContext = { service, envConfig };
  if (autoSyncListenersInstalled) return;
  autoSyncListenersInstalled = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }
  periodicTimer = setInterval(onPeriodicTick, REPLICA_PULL_PERIODIC_INTERVAL_MS);
};

/**
 * Schedules a deferred replica pull for the requested kinds. Mount this
 * on a page that wants those kinds present (library, reader, etc.).
 *
 * Two pull lifecycles share this hook:
 *
 *  1. Boot pull — one-shot per session (dedup'd by `pulledKinds`),
 *     fired `delayMs` after first mount. Uses `since=null` for a full
 *     re-fetch that recovers from any prior cursor-advanced-but-not-
 *     applied gaps. The `settings` kind is implicitly pulled FIRST
 *     (regardless of whether the caller requested it) so the rest of
 *     the kinds' auto-saves don't republish stale local providerOrder /
 *     providerEnabled with a fresh HLC.
 *  2. Incremental auto-pull — runs for the lifetime of the tab via
 *     module-level visibility / online listeners + a 5-minute interval.
 *     Uses the persisted cursor for cheap delta fetches. Concurrent
 *     triggers collapse via `pullInFlight`.
 *
 * Listeners install once on the first mount that has a ready replica-
 * sync singleton, and stay attached after subsequent unmounts so a
 * long-lived tab keeps catching up across other devices' edits.
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

    for (const kind of kinds) registeredKinds.add(kind);

    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const schedule = () => {
      installAutoSyncListeners(appService, envConfig);
      if (timer) return;
      // Settings is implicitly pulled first regardless of whether the
      // caller asked for it (e.g. the reader page only requests
      // dictionary/font/texture). Without that seeding, applyRemote
      // for a binary kind on a fresh device appends the new id to the
      // local default `dictionarySettings.providerOrder` and the
      // ensuing auto-save publishes that order with a fresh HLC,
      // overwriting the cross-device order set on another device.
      const otherPending = kinds.filter((k) => k !== 'settings' && !pulledKinds.has(k));
      const needsSettings = !pulledKinds.has('settings');
      if (otherPending.length === 0 && !needsSettings) return;
      timer = setTimeout(() => {
        void (async () => {
          // Await the settings boot pull before dispatching the others.
          // Subsequent mounts share `settingsBootPullPromise` so the
          // pull only happens once per session.
          await ensureSettingsBootPulled(appService, envConfig);
          for (const kind of otherPending) {
            if (pulledKinds.has(kind)) continue;
            // Claim both slots up front so a concurrently-scheduled mount
            // (e.g., library + reader mounting back-to-back) doesn't
            // double-pull, and so a visibility/online trigger landing
            // mid-boot doesn't fire a second pull alongside this one.
            // On failure we release `pulledKinds` so a subsequent
            // navigation can retry; `pullInFlight` is always cleared.
            pulledKinds.add(kind);
            pullInFlight.add(kind);
            void runPullForKind(kind, appService, envConfig, { since: null })
              .catch((err) => {
                console.warn(`replica ${kind} pull failed`, err);
                pulledKinds.delete(kind);
              })
              .finally(() => {
                pullInFlight.delete(kind);
              });
          }
        })();
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

/** Test seam — clear all module-level state and tear down listeners. */
export const __resetReplicaPullForTests = (): void => {
  pulledKinds.clear();
  pullInFlight.clear();
  registeredKinds.clear();
  autoSyncContext = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  autoSyncListenersInstalled = false;
  lastVisibilityPullAt = 0;
  settingsBootPullPromise = null;
};
