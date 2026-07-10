/** Google Drive's binding to the shared PersistedOAuth: the about.get account
 * label + the Google token endpoint. */
import { PersistedOAuth } from '@/services/sync/providers/oauth/persistedOAuth';
import type { FetchFn, TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { TokenPersistence } from '@/services/sync/providers/oauth/keychainTokenStore';
import { aboutUrl } from './driveRest';
import { GOOGLE_TOKEN_ENDPOINT } from './googleOAuthConfig';

export const resolveGoogleAccountLabel = async (
  accessToken: string,
  fetchFn: FetchFn,
): Promise<string | null> => {
  const res = await fetchFn(aboutUrl(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
  return body.user?.emailAddress ?? body.user?.displayName ?? null;
};

export const createGoogleDriveAuth = (deps: {
  clientId: string;
  fetchFn: FetchFn;
  persistence: TokenPersistence;
  initialTokens?: TokenSet;
}): PersistedOAuth =>
  new PersistedOAuth({
    clientId: deps.clientId,
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    fetchFn: deps.fetchFn,
    persistence: deps.persistence,
    providerLabel: 'Google Drive',
    resolveAccountLabel: resolveGoogleAccountLabel,
    initialTokens: deps.initialTokens,
  });
