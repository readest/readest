import type { SystemSettings } from '@/types/settings';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * Return settings with exactly one third-party cloud-sync provider active (or
 * none). WebDAV and Google Drive are mutually exclusive — only one syncs the
 * library at a time — so enabling one always disables the other. Provider config
 * (WebDAV creds, the Drive keychain token) is left untouched, so switching back
 * to a previously-configured provider needs no re-entry; only an explicit
 * Disconnect tears a provider's config down.
 */
export const withActiveCloudProvider = (
  settings: SystemSettings,
  active: FileSyncBackendKind | null,
): SystemSettings => ({
  ...settings,
  webdav: { ...settings.webdav, enabled: active === 'webdav' },
  googleDrive: { ...settings.googleDrive, enabled: active === 'gdrive' },
});
