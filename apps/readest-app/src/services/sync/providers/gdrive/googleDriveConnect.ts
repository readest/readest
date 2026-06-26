/**
 * Wire the platform OAuth runner + env client id + keychain into the
 * {@link connectGoogleDrive} orchestration, so the settings UI's Connect button
 * is a single call. Desktop only for now — Android / iOS runners land in later
 * phases; the Drive row is hidden off-desktop.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { getGoogleClientId } from './buildGoogleDriveProvider';
import { createDriveTokenPersistence } from './driveTokenStore';
import { runDesktopDeepLinkOAuth } from './auth/oauthDesktop';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  type ConnectGoogleDriveResult,
} from './connectGoogleDrive';
import type { FetchFn } from './GoogleDriveProvider';

const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch) as unknown as FetchFn;

/** Run the desktop Drive sign-in and return the connected account label. */
export const runGoogleDriveConnect = async (): Promise<ConnectGoogleDriveResult> => {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Drive is not configured in this build');
  }
  const persistence = await createDriveTokenPersistence();
  if (!persistence) {
    throw new Error('Google Drive requires the desktop app with secure storage');
  }
  return connectGoogleDrive({
    clientId,
    fetchFn: resolveFetch(),
    persistence,
    runOAuth: runDesktopDeepLinkOAuth,
  });
};

/** Forget the stored Drive token (the settings flag is cleared by the caller). */
export const runGoogleDriveDisconnect = async (): Promise<void> => {
  const persistence = await createDriveTokenPersistence();
  if (persistence) await disconnectGoogleDrive(persistence);
};
