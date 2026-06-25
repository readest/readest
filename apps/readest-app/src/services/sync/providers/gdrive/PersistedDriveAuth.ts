/**
 * Token-managing {@link DriveAuth}: hands the provider a currently-valid access
 * token, refreshing transparently and persisting the result.
 *
 * The file-sync engine is concurrent (books at concurrency 4), so several Drive
 * requests can find the access token expired at the same instant. Without care
 * that would fire several parallel refreshes and several racing keychain writes.
 * A single-flight guard collapses them: the first expiry starts one refresh, the
 * rest await it, and exactly one merged token set is saved. Google omits the
 * refresh token on a refresh response, so the previous one is carried forward.
 *
 * Adapted from ratatabananana-bit/Readest-google-drive-mod-patcher (AGPL-3.0),
 * used with the author's explicit permission.
 */
import { FileSyncError } from '@/services/sync/file/provider';
import type { DriveAuth, FetchFn } from './GoogleDriveProvider';
import { aboutUrl } from './driveRest';
import { refreshAccessToken, type TokenSet } from './auth/tokenStore';
import type { TokenPersistence } from './driveTokenStore';

export interface PersistedDriveAuthDeps {
  /** OAuth client ID (needed for the refresh grant). */
  clientId: string;
  /** Platform `fetch` for the refresh + `about.get` calls. */
  fetchFn: FetchFn;
  /** Where the token set is loaded from and saved to. */
  persistence: TokenPersistence;
  /**
   * Token set captured at connect time, seeded so the first request needs no
   * keychain read. Omit to lazily load from `persistence` on first use.
   */
  initialTokens?: TokenSet;
  /** Injectable clock (epoch ms); defaults to {@link Date.now} so tests can pin it. */
  now?: () => number;
}

export class PersistedDriveAuth implements DriveAuth {
  private tokens: TokenSet | null;
  private loaded: boolean;
  private refreshInFlight: Promise<TokenSet> | null = null;

  constructor(private readonly deps: PersistedDriveAuthDeps) {
    this.tokens = deps.initialTokens ?? null;
    // A seeded token set means we already hold the freshest tokens; skip the
    // lazy load so a just-connected session does not hit the keychain again.
    this.loaded = deps.initialTokens !== undefined;
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.ensureValidTokens();
    return tokens.accessToken;
  }

  /** Human-readable account label (email, falling back to display name) or null. */
  async accountLabel(): Promise<string | null> {
    const token = await this.getAccessToken();
    const res = await this.deps.fetchFn(aboutUrl(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
    return body.user?.emailAddress ?? body.user?.displayName ?? null;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private async ensureValidTokens(): Promise<TokenSet> {
    if (!this.loaded) {
      this.tokens = await this.deps.persistence.load();
      this.loaded = true;
    }
    if (!this.tokens) {
      throw new FileSyncError('Google Drive is not connected', 'AUTH_FAILED');
    }
    if (this.now() < this.tokens.expiresAt) return this.tokens;
    return this.refresh();
  }

  private refresh(): Promise<TokenSet> {
    // Single-flight: concurrent callers share one in-flight refresh.
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async (): Promise<TokenSet> => {
      try {
        // Re-check after winning the race: a refresh that completed while we were
        // queued may already have produced a valid token — don't refresh twice.
        if (this.tokens && this.now() < this.tokens.expiresAt) return this.tokens;
        const refreshToken = this.tokens?.refreshToken;
        if (!refreshToken) {
          throw new FileSyncError('Google Drive session expired; reconnect', 'AUTH_FAILED');
        }
        const refreshed = await refreshAccessToken(
          { refreshToken, clientId: this.deps.clientId },
          this.deps.fetchFn,
        );
        // Google omits the refresh token on a refresh — carry the old one forward.
        const merged: TokenSet = {
          ...refreshed,
          refreshToken: refreshed.refreshToken ?? refreshToken,
        };
        this.tokens = merged;
        await this.deps.persistence.save(merged);
        return merged;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }
}
