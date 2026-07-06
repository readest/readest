import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * Return settings with exactly one third-party cloud-sync provider active (or
 * none). WebDAV and Google Drive are mutually exclusive — only one syncs the
 * library at a time — so enabling one always disables the other. Provider config
 * (WebDAV creds, the Drive keychain token) is left untouched, so switching back
 * to a previously-configured provider needs no re-entry; only an explicit
 * Disconnect tears a provider's config down.
 *
 * Activating a provider (disabled -> enabled) also turns its `syncBooks` on:
 * the selected provider owns the book-file channel — native Readest Cloud
 * uploads gate off — so leaving syncBooks at its `false` default would back
 * books up nowhere. An explicit opt-out while the provider stays active is
 * respected (re-activation of an already-active provider changes nothing).
 */
export const withActiveCloudProvider = (
  settings: SystemSettings,
  active: FileSyncBackendKind | null,
): SystemSettings => ({
  ...settings,
  webdav: {
    ...settings.webdav,
    enabled: active === 'webdav',
    ...(active === 'webdav' && !settings.webdav?.enabled ? { syncBooks: true } : {}),
  },
  googleDrive: {
    ...settings.googleDrive,
    enabled: active === 'gdrive',
    ...(active === 'gdrive' && !settings.googleDrive?.enabled ? { syncBooks: true } : {}),
  },
});
