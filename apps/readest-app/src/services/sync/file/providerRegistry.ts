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
import type { WebDAVSettings } from '@/types/settings';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import { buildGoogleDriveProvider } from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';

export type FileSyncBackendKind = 'webdav' | 'gdrive';

/** Minimal settings the registry reads to pick + build backends. */
export interface FileSyncBackendsSettings {
  webdav?: WebDAVSettings;
  googleDrive?: { enabled?: boolean };
}

/** The backends the user has switched on, in a stable order. */
export const getEnabledFileSyncBackends = (
  settings: FileSyncBackendsSettings,
): FileSyncBackendKind[] => {
  const enabled: FileSyncBackendKind[] = [];
  if (settings.webdav?.enabled) enabled.push('webdav');
  if (settings.googleDrive?.enabled) enabled.push('gdrive');
  return enabled;
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
  if (kind === 'webdav') {
    return settings.webdav ? createWebDAVProvider(settings.webdav) : null;
  }
  return buildGoogleDriveProvider();
};
