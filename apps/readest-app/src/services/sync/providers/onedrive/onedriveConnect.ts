/**
 * Wire the platform OAuth runner + env client id + keychain into the
 * {@link connectOneDrive} orchestration, so the settings UI's Connect button is a
 * single call. The runner is platform-resolved (desktop deep-link, Android Custom
 * Tab, iOS web-auth session); see {@link resolveOAuthRunner}.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { type as osType } from '@tauri-apps/plugin-os';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { getMicrosoftClientId } from './buildOneDriveProvider';
import { createOneDriveTokenPersistence } from './onedriveTokenStore';
import { runDesktopDeepLinkOAuth } from '@/services/sync/providers/oauth/oauthDesktop';
import { runAndroidOAuth } from '@/services/sync/providers/oauth/oauthAndroid';
import { runIosOAuth } from '@/services/sync/providers/oauth/oauthIos';
import { buildMicrosoftOAuthConfig } from './microsoftOAuthConfig';
import { resetFileSyncProviderCache } from '@/services/sync/file/providerRegistry';
import { connectOneDrive, disconnectOneDrive, type ConnectOneDriveResult } from './connectOneDrive';
import { beginWebOneDriveRedirect, clearWebOneDriveToken } from './webAuthCodeFlow';
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';
import type { TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { FetchFn } from './OneDriveProvider';

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

/** Run the platform OneDrive sign-in and return the connected account label. */
export const runOneDriveConnect = async (): Promise<ConnectOneDriveResult> => {
  // The memoised provider holds the previous connection's auth; a (re)connect
  // must not keep serving it.
  resetFileSyncProviderCache();
  // Web: full-page redirect to Microsoft. This navigates away and never
  // resolves — the auth code returns to the /onedrive-callback route, which
  // finalizes the connection and routes back.
  if (isWebAppPlatform()) {
    const clientId = getMicrosoftClientId();
    if (!clientId) throw new Error('OneDrive is not configured for the web build');
    beginWebOneDriveRedirect({
      clientId,
      returnPath: window.location.pathname + window.location.search,
    });
    return new Promise<ConnectOneDriveResult>(() => {});
  }
  const clientId = getMicrosoftClientId();
  if (!clientId) throw new Error('OneDrive is not configured in this build');
  const persistence = await createOneDriveTokenPersistence();
  if (!persistence) throw new Error('OneDrive requires a Readest app build with secure storage');
  return connectOneDrive({
    config: buildMicrosoftOAuthConfig(clientId),
    fetchFn: resolveFetch(),
    persistence,
    runOAuth: resolveOAuthRunner(),
  });
};

/** Forget the stored OneDrive token (the settings flag is cleared by the caller). */
export const runOneDriveDisconnect = async (): Promise<void> => {
  resetFileSyncProviderCache();
  if (isWebAppPlatform()) {
    clearWebOneDriveToken();
    return;
  }
  const persistence = await createOneDriveTokenPersistence();
  if (persistence) await disconnectOneDrive(persistence);
};
