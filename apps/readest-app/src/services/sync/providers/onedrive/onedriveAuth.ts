/**
 * OneDrive's binding to the shared PersistedOAuth: the `/me` account-label
 * lookup + the Microsoft token endpoint (which rotates refresh tokens — the
 * shared PersistedOAuth already saves the rotated one).
 */
import { PersistedOAuth } from '@/services/sync/providers/oauth/persistedOAuth';
import type { FetchFn, TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import type { TokenPersistence } from '@/services/sync/providers/oauth/keychainTokenStore';
import { meUrl } from './graphRest';
import { MICROSOFT_TOKEN_ENDPOINT } from './microsoftOAuthConfig';

export const resolveOneDriveAccountLabel = async (
  accessToken: string,
  fetchFn: FetchFn,
): Promise<string | null> => {
  const res = await fetchFn(meUrl(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    userPrincipalName?: string;
    mail?: string;
    displayName?: string;
  };
  return body.userPrincipalName ?? body.mail ?? body.displayName ?? null;
};

export const createOneDriveAuth = (deps: {
  clientId: string;
  fetchFn: FetchFn;
  persistence: TokenPersistence;
  initialTokens?: TokenSet;
}): PersistedOAuth =>
  new PersistedOAuth({
    clientId: deps.clientId,
    tokenEndpoint: MICROSOFT_TOKEN_ENDPOINT,
    fetchFn: deps.fetchFn,
    persistence: deps.persistence,
    providerLabel: 'OneDrive',
    resolveAccountLabel: resolveOneDriveAccountLabel,
    initialTokens: deps.initialTokens,
  });
