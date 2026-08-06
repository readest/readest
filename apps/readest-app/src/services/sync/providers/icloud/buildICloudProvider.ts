import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { getICloudContainerStatus } from '@/utils/bridge';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createICloudProvider } from './ICloudProvider';

/**
 * iCloud sync exists only in the iOS and macOS Tauri apps. This platform gate
 * ALSO protects other devices in the account: `icloud.enabled` can arrive on
 * any device via a settings backup restore, and `canBackendRun` consults this
 * so a Windows/Android/web device never tries (and fails) to run the backend.
 */
export const isICloudSupportedPlatform = (): boolean =>
  isTauriAppPlatform() && ['ios', 'macos'].includes(getOSPlatform());

/**
 * Probe the ubiquity container and assemble the provider, or `null` when
 * iCloud cannot run here: unsupported platform, a build without the iCloud
 * entitlement, or no iCloud session on the device. Callers treat `null` as
 * "backend unavailable" (same contract as the Drive/OneDrive builders).
 */
export const buildICloudProvider = async (): Promise<FileSyncProvider | null> => {
  if (!isICloudSupportedPlatform()) return null;
  try {
    const status = await getICloudContainerStatus();
    if (!status.available || !status.documentsPath) return null;
    return createICloudProvider(status.documentsPath);
  } catch (e) {
    console.warn('[icloud] container status probe failed', e);
    return null;
  }
};
