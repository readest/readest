/**
 * Browser {@link DriveAuth} for the web build — the counterpart of
 * {@link createGoogleDriveAuth} (which refreshes a keychain refresh token on
 * native).
 *
 * The web OAuth model (full-page implicit redirect; see {@link webRedirectFlow})
 * yields only a short-lived access token, kept in `sessionStorage` by
 * {@link webTokenStore}. There is no refresh token, so this just reads the stored
 * token and, once it expires, fails with `AUTH_FAILED` to prompt a reconnect — it
 * cannot refresh in the background (a server-side token broker would be required).
 */
import { FileSyncError } from '@/services/sync/file/provider';
import type { DriveAuth, FetchFn } from './GoogleDriveProvider';
import type { TokenSet } from '@/services/sync/providers/oauth/tokenEndpoint';
import { resolveGoogleAccountLabel } from './googleDriveAuth';
import { loadWebDriveToken } from './auth/webTokenStore';

export class WebDriveAuth implements DriveAuth {
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly loadToken: () => TokenSet | null = loadWebDriveToken,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getAccessToken(): Promise<string> {
    const tokens = this.loadToken();
    if (tokens && this.now() < tokens.expiresAt) return tokens.accessToken;
    throw new FileSyncError('Google Drive session expired; reconnect in Settings', 'AUTH_FAILED');
  }

  /** Human-readable account label (email, falling back to display name) or null. */
  async accountLabel(): Promise<string | null> {
    const token = await this.getAccessToken();
    return resolveGoogleAccountLabel(token, this.fetchFn);
  }
}
