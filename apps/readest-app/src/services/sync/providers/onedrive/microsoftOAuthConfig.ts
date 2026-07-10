/**
 * The Microsoft identity platform OAuth config consumed by the shared runners:
 * the public-client auth/token endpoints (authority `/common` covers personal +
 * work/school accounts), the App Folder scope + offline_access (refresh token) +
 * User.Read (account label), and the fixed custom-scheme redirect registered in
 * the platform manifests. `prompt=select_account` lets a user pick which MS
 * account to connect.
 */
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';

export const MICROSOFT_AUTH_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MICROSOFT_TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder offline_access User.Read';
export const ONEDRIVE_REDIRECT_SCHEME = 'readest-onedrive';
export const ONEDRIVE_REDIRECT_URI = `${ONEDRIVE_REDIRECT_SCHEME}://auth`;

export const buildMicrosoftOAuthConfig = (clientId: string): OAuthClientConfig => ({
  clientId,
  scope: ONEDRIVE_SCOPE,
  authEndpoint: MICROSOFT_AUTH_ENDPOINT,
  tokenEndpoint: MICROSOFT_TOKEN_ENDPOINT,
  redirectUri: ONEDRIVE_REDIRECT_URI,
  redirectScheme: ONEDRIVE_REDIRECT_SCHEME,
  authParams: { prompt: 'select_account' },
});

/**
 * Whether an OS-delivered URL is the OneDrive OAuth redirect, so the deep-link
 * ingress can drop it before book-import consumers see it (the OAuth runner's
 * own listeners still receive it). Mirrors gdrive's `isGoogleOAuthRedirectUrl`.
 */
export const isOneDriveOAuthRedirectUrl = (url: string): boolean =>
  url.toLowerCase().startsWith(`${ONEDRIVE_REDIRECT_SCHEME}:`);
