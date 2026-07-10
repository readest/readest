/**
 * A refreshing OAuth token source shared by every provider: hands out a
 * currently-valid access token, refreshing transparently (single-flight, so
 * concurrent expiries collapse to one refresh + one keychain write) and
 * persisting the result. The refresh response's new refresh token is used when
 * present (Microsoft rotates them) and the old one carried forward otherwise
 * (Google omits it). The token endpoint, the account-label lookup, and the
 * provider name (for error messages) are injected.
 */
import { FileSyncError } from '@/services/sync/file/provider';
import { refreshAccessToken, type FetchFn, type TokenSet } from './tokenEndpoint';
import type { TokenPersistence } from './keychainTokenStore';

export interface PersistedOAuthDeps {
  clientId: string;
  tokenEndpoint: string;
  fetchFn: FetchFn;
  persistence: TokenPersistence;
  /** Provider display name used in auth-error messages. */
  providerLabel: string;
  /** Provider-specific account-label lookup (Google about.get / MS /me). */
  resolveAccountLabel: (accessToken: string, fetchFn: FetchFn) => Promise<string | null>;
  initialTokens?: TokenSet;
  now?: () => number;
}

export class PersistedOAuth {
  private tokens: TokenSet | null;
  private loaded: boolean;
  private refreshInFlight: Promise<TokenSet> | null = null;

  constructor(private readonly deps: PersistedOAuthDeps) {
    this.tokens = deps.initialTokens ?? null;
    this.loaded = deps.initialTokens !== undefined;
  }

  async getAccessToken(): Promise<string> {
    return (await this.ensureValidTokens()).accessToken;
  }

  async accountLabel(): Promise<string | null> {
    return this.deps.resolveAccountLabel(await this.getAccessToken(), this.deps.fetchFn);
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
      throw new FileSyncError(`${this.deps.providerLabel} is not connected`, 'AUTH_FAILED');
    }
    if (this.now() < this.tokens.expiresAt) return this.tokens;
    return this.refresh();
  }

  private refresh(): Promise<TokenSet> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async (): Promise<TokenSet> => {
      try {
        if (this.tokens && this.now() < this.tokens.expiresAt) return this.tokens;
        const refreshToken = this.tokens?.refreshToken;
        if (!refreshToken) {
          throw new FileSyncError(
            `${this.deps.providerLabel} session expired; reconnect`,
            'AUTH_FAILED',
          );
        }
        const refreshed = await refreshAccessToken(
          { refreshToken, clientId: this.deps.clientId, tokenEndpoint: this.deps.tokenEndpoint },
          this.deps.fetchFn,
        );
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
