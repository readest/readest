/**
 * Wire the platform OAuth runner + env client id + keychain into the
 * {@link connectGoogleDrive} orchestration, so the settings UI's Connect button
 * is a single call. The runner is platform-resolved (desktop deep-link, Android
 * Custom Tab, iOS web-auth session); see {@link resolveOAuthRunner}.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { type as osType } from '@tauri-apps/plugin-os';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { getGoogleClientId, getGoogleWebClientId } from './buildGoogleDriveProvider';
import { createDriveTokenPersistence } from './driveTokenStore';
import { runDesktopDeepLinkOAuth } from './auth/oauthDesktop';
import { runAndroidOAuth } from './auth/oauthAndroid';
import { runIosOAuth } from './auth/oauthIos';
import { resetFileSyncProviderCache } from '@/services/sync/file/providerRegistry';
import { beginWebDriveRedirect, webDriveRedirectUri } from './auth/webRedirectFlow';
import { clearWebDriveToken } from './auth/webTokenStore';
import type { OAuthClientConfig } from './auth/oauthFlow';
import type { TokenSet } from './auth/tokenStore';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  DRIVE_FILE_SCOPE,
  type ConnectGoogleDriveResult,
} from './connectGoogleDrive';
import type { FetchFn } from './GoogleDriveProvider';

const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch) as unknown as FetchFn;

/**
 * Pick the platform OAuth runner: Android uses a Chrome Custom Tab; iOS uses an
 * `ASWebAuthenticationSession`; desktop (macOS/Windows/Linux) uses the system
 * browser + deep-link.
 */
const resolveOAuthRunner = (): ((
  config: OAuthClientConfig,
  fetchFn: FetchFn,
) => Promise<TokenSet>) => {
  try {
    const os = osType();
    if (os === 'android') return runAndroidOAuth;
    if (os === 'ios') return runIosOAuth;
  } catch {
    // osType() is Tauri-only; off-Tauri this path isn't reached anyway.
  }
  return runDesktopDeepLinkOAuth;
};

/** Run the platform Drive sign-in and return the connected account label. */
export const runGoogleDriveConnect = async (): Promise<ConnectGoogleDriveResult> => {
  // The memoised provider holds the previous connection's auth (and its
  // path->id cache, which is account-scoped under drive.file); a (re)connect
  // must not keep serving it.
  resetFileSyncProviderCache();
  // Web: full-page redirect to Google (the popup/GIS path is broken by the
  // app's COOP). This navigates away and never resolves — the token returns to
  // the /gdrive-callback route, which finalizes the connection and routes back.
  if (isWebAppPlatform()) {
    const webClientId = getGoogleWebClientId();
    if (!webClientId) {
      throw new Error('Google Drive is not configured for the web build');
    }
    beginWebDriveRedirect({
      clientId: webClientId,
      scope: DRIVE_FILE_SCOPE,
      redirectUri: webDriveRedirectUri(),
      returnPath: window.location.pathname + window.location.search,
    });
    return new Promise<ConnectGoogleDriveResult>(() => {});
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Drive is not configured in this build');
  }
  const persistence = await createDriveTokenPersistence();
  if (!persistence) {
    throw new Error('Google Drive requires a Readest app build with secure storage');
  }
  return connectGoogleDrive({
    clientId,
    fetchFn: resolveFetch(),
    persistence,
    runOAuth: resolveOAuthRunner(),
  });
};

/** Forget the stored Drive token (the settings flag is cleared by the caller). */
export const runGoogleDriveDisconnect = async (): Promise<void> => {
  resetFileSyncProviderCache();
  if (isWebAppPlatform()) {
    clearWebDriveToken();
    return;
  }
  const persistence = await createDriveTokenPersistence();
  if (persistence) await disconnectGoogleDrive(persistence);
};
