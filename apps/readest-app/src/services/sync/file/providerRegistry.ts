/**
 * Registry that maps a backend kind to a concrete {@link FileSyncProvider}, so
 * the reader hook and the Sync-now form stay backend-agnostic: they ask which
 * backends are enabled and build each one by kind, never naming WebDAV or Drive
 * directly.
 *
 * The settings view here is intentionally narrow — just the `enabled` flags plus
 * the WebDAV transport config — so this PR can land the seam without depending on
 * the full Google Drive settings shape and Integrations UI (which arrive with the
 * settings-UI phase). Drive builds itself from the env-baked client id + the
 * keychain token, so it needs no settings to construct.
 */
import type { FileSyncProvider } from './provider';
import type { S3Settings, WebDAVSettings } from '@/types/settings';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import { buildGoogleDriveProvider } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import { buildOneDriveProvider } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
import { createS3Provider } from '@/services/sync/providers/s3/S3Provider';

export type FileSyncBackendKind = 'webdav' | 'gdrive' | 's3' | 'onedrive';

/** Minimal settings the registry reads to pick + build backends. */
export interface FileSyncBackendsSettings {
  webdav?: WebDAVSettings;
  googleDrive?: { enabled?: boolean };
  s3?: S3Settings;
  onedrive?: { enabled?: boolean };
}

/**
 * One provider is memoised PER BACKEND and shared by every surface (the reader's
 * per-book sync, the library auto-sync, Sync now / pull to refresh). What makes
 * reuse worth it is the provider's path->id cache (Drive): a cold provider
 * re-resolves /Readest, books/ and library.json by name query on every engine
 * build, so one engine per book open/close/sync turned each user action into a
 * burst of redundant remote requests.
 *
 * The cache is keyed by backend kind because several backends now sync in the
 * same pass (#5062) — a single shared slot would have them evict each other on
 * every alternation. The value's `key` mirrors the connection-relevant settings,
 * so a config edit rebuilds that backend only; stale cached ids self-heal through
 * the provider's 404 eviction. Drive / OneDrive connect and disconnect must call
 * {@link resetFileSyncProviderCache} — their token source changes identity
 * without any key input changing.
 */
const providerCache = new Map<FileSyncBackendKind, { key: string; provider: FileSyncProvider }>();

const providerCacheKey = (
  kind: FileSyncBackendKind,
  settings: FileSyncBackendsSettings,
): string => {
  if (kind === 'webdav') {
    const w = settings.webdav;
    return `webdav:${w?.enabled}:${w?.serverUrl}:${w?.username}:${w?.password}:${w?.rootPath}`;
  }
  if (kind === 's3') {
    const c = settings.s3;
    return `s3:${c?.enabled}:${c?.endpoint}:${c?.region}:${c?.bucket}:${c?.accessKeyId}:${c?.secretAccessKey}`;
  }
  if (kind === 'onedrive') return 'onedrive';
  return 'gdrive';
};

export const resetFileSyncProviderCache = (): void => {
  providerCache.clear();
};

/**
 * Build the provider for one backend, or `null` when it cannot run here (WebDAV
 * without config, Drive without a baked client id / secure storage). Async
 * because Drive probes the keychain to assemble its token store.
 */
export const createFileSyncProvider = async (
  kind: FileSyncBackendKind,
  settings: FileSyncBackendsSettings,
): Promise<FileSyncProvider | null> => {
  const key = providerCacheKey(kind, settings);
  const cached = providerCache.get(kind);
  if (cached?.key === key) return cached.provider;
  const provider =
    kind === 'webdav'
      ? settings.webdav
        ? createWebDAVProvider(settings.webdav)
        : null
      : kind === 's3'
        ? settings.s3
          ? createS3Provider(settings.s3)
          : null
        : kind === 'onedrive'
          ? await buildOneDriveProvider()
          : await buildGoogleDriveProvider();
  if (provider) providerCache.set(kind, { key, provider });
  return provider;
};
