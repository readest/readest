/**
 * Build the Google OAuth client config consumed by the shared runners: the
 * reverse-DNS redirect derived from the iOS-type client id, Google's auth/token
 * endpoints, and the access_type/prompt params that make Google issue a refresh
 * token. Keeping Google's specifics here lets the runners stay provider-agnostic.
 */
import {
  deriveReverseDnsRedirectScheme,
  deriveReverseDnsRedirectUri,
} from './auth/reverseDnsRedirect';
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';

/** Google's OAuth 2.0 authorization endpoint (the page where the user consents). */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Google's OAuth 2.0 token endpoint (exchanges/refreshes tokens). */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Build the OAuth client config for a Google Drive sign-in.
 *
 * `access_type=offline` makes Google issue a refresh token; `prompt=consent`
 * forces re-consent so a refresh token is actually returned (Google only grants
 * one on first consent otherwise).
 */
export const buildGoogleOAuthConfig = (clientId: string, scope: string): OAuthClientConfig => ({
  clientId,
  scope,
  authEndpoint: GOOGLE_AUTH_ENDPOINT,
  tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
  redirectUri: deriveReverseDnsRedirectUri(clientId),
  redirectScheme: deriveReverseDnsRedirectScheme(clientId),
  authParams: { access_type: 'offline', prompt: 'consent' },
});
