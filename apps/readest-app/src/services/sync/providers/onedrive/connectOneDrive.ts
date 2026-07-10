/**
 * Orchestrates connecting / disconnecting OneDrive: run the platform OAuth flow,
 * persist the token, and resolve the account label. Kept free of platform
 * specifics (the OAuth runner and the fully-built {@link OAuthClientConfig} are
 * injected) so it is unit-testable and shared by every platform's connect
 * button. Mirrors `gdrive/connectGoogleDrive.ts`.
 */
import { createOneDriveAuth } from './onedriveAuth';
import type { FetchFn } from './OneDriveProvider';
import type { TokenPersistence } from './onedriveTokenStore';
import type { OAuthClientConfig } from '@/services/sync/providers/oauth/oauthFlow';
import type { TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';

export interface ConnectOneDriveDeps {
  /** The fully-built Microsoft OAuth client config (see `buildMicrosoftOAuthConfig`). */
  config: OAuthClientConfig;
  /** Platform `fetch` for the token exchange + `/me`. */
  fetchFn: FetchFn;
  /** Where the token set is saved (keychain). */
  persistence: TokenPersistence;
  /** Platform OAuth runner (desktop deep-link / Android Custom Tab / iOS Safari). */
  runOAuth: (config: OAuthClientConfig, fetchFn: FetchFn) => Promise<TokenSet>;
}

export interface ConnectOneDriveResult {
  /** Connected account's UPN/email/display name, or null when it could not be read. */
  accountLabel: string | null;
}

/**
 * Run the platform OAuth flow, persist the resulting token set, and resolve the
 * connected account's label.
 *
 * The token is saved BEFORE success is reported, and a save failure THROWS — the
 * caller must not mark OneDrive enabled if the refresh token did not persist,
 * since a "connected" account that vanishes on the next launch is worse than a
 * failed connect. The account label is best-effort (null when `/me` fails).
 */
export const connectOneDrive = async (
  deps: ConnectOneDriveDeps,
): Promise<ConnectOneDriveResult> => {
  const tokens = await deps.runOAuth(deps.config, deps.fetchFn);
  // Fail-loud: if the keychain rejects the token, surface it so the UI does not
  // enable OneDrive against a token that won't survive a restart.
  await deps.persistence.save(tokens);

  const auth = createOneDriveAuth({
    clientId: deps.config.clientId,
    fetchFn: deps.fetchFn,
    persistence: deps.persistence,
    initialTokens: tokens,
  });
  let accountLabel: string | null = null;
  try {
    accountLabel = await auth.accountLabel();
  } catch (e) {
    console.warn('[onedrive] account label fetch failed', e);
  }
  return { accountLabel };
};

/** Forget the stored OneDrive credentials (the settings flag is cleared by the caller). */
export const disconnectOneDrive = async (persistence: TokenPersistence): Promise<void> => {
  await persistence.clear();
};
