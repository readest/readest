/**
 * Orchestrates connecting / disconnecting Google Drive: run the platform OAuth
 * flow, persist the token, and resolve the account label. Kept free of platform
 * specifics (the OAuth runner is injected) so it is unit-testable and shared by
 * every platform's connect button.
 */
import { PersistedDriveAuth } from './PersistedDriveAuth';
import type { FetchFn } from './GoogleDriveProvider';
import type { TokenPersistence } from './driveTokenStore';
import type { OAuthClientConfig } from './auth/oauthFlow';
import type { TokenSet } from './auth/tokenStore';

/** The Drive scope: the app sees only the files it created (a private namespace). */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface ConnectGoogleDriveDeps {
  /** The env-baked official OAuth client id. */
  clientId: string;
  /** Platform `fetch` for the token exchange + `about.get`. */
  fetchFn: FetchFn;
  /** Where the token set is saved (keychain). */
  persistence: TokenPersistence;
  /** Platform OAuth runner (desktop deep-link / Android Custom Tab / iOS Safari). */
  runOAuth: (config: OAuthClientConfig, fetchFn: FetchFn) => Promise<TokenSet>;
}

export interface ConnectGoogleDriveResult {
  /** Connected account's email/display name, or null when it could not be read. */
  accountLabel: string | null;
}

/**
 * Run the platform OAuth flow, persist the resulting token set, and resolve the
 * connected account's label.
 *
 * The token is saved BEFORE success is reported, and a save failure THROWS — the
 * caller must not mark Drive enabled if the refresh token did not persist, since
 * a "connected" account that vanishes on the next launch is worse than a failed
 * connect. The account label is best-effort (null when `about.get` fails).
 */
export const connectGoogleDrive = async (
  deps: ConnectGoogleDriveDeps,
): Promise<ConnectGoogleDriveResult> => {
  const tokens = await deps.runOAuth(
    { clientId: deps.clientId, scope: DRIVE_FILE_SCOPE },
    deps.fetchFn,
  );
  // Fail-loud: if the keychain rejects the token, surface it so the UI does not
  // enable Drive against a token that won't survive a restart.
  await deps.persistence.save(tokens);

  const auth = new PersistedDriveAuth({
    clientId: deps.clientId,
    fetchFn: deps.fetchFn,
    persistence: deps.persistence,
    initialTokens: tokens,
  });
  let accountLabel: string | null = null;
  try {
    accountLabel = await auth.accountLabel();
  } catch (e) {
    console.warn('[gdrive] account label fetch failed', e);
  }
  return { accountLabel };
};

/** Forget the stored Drive credentials (the settings flag is cleared by the caller). */
export const disconnectGoogleDrive = async (persistence: TokenPersistence): Promise<void> => {
  await persistence.clear();
};
