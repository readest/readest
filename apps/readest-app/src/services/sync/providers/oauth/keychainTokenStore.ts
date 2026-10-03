/**
 * OS-keychain refresh-token persistence over the keyed secure-KV bridge, shared
 * by every OAuth provider. Access tokens stay in memory and are reacquired from
 * the persisted refresh token after launch. Keyed by a caller-supplied storage
 * key so each provider owns a distinct slot; `label` names the provider in
 * error/log messages. `load` is fail-soft (a keychain error reads as "not
 * connected"); `save` is fail-loud (the connect flow must know the token did not
 * persist). No ephemeral fallback for the refresh token — a provider is simply
 * unavailable where secure storage is.
 */
import { isTauriAppPlatform } from '@/services/environment';
import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';
import { FileSyncError } from '@/services/sync/file/provider';
import type { TokenSet } from './tokenEndpoint';

export interface TokenPersistence {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

export class KeychainTokenPersistence implements TokenPersistence {
  constructor(
    private readonly key: string,
    private readonly label: string,
  ) {}

  async load(): Promise<TokenSet | null> {
    try {
      const res = await getSecureItem({ key: this.key });
      if (res.error || !res.value) return null;
      // Older builds stored the full TokenSet. Reading only refreshToken handles
      // both formats and deliberately expires any legacy access token.
      const stored = JSON.parse(res.value) as Partial<TokenSet>;
      if (!stored.refreshToken) return null;
      return { accessToken: '', refreshToken: stored.refreshToken, expiresAt: 0 };
    } catch (err) {
      console.warn(`[${this.label}] token load failed`, err);
      return null;
    }
  }

  async save(tokens: TokenSet): Promise<void> {
    if (!tokens.refreshToken) {
      throw new FileSyncError(
        `${this.label} did not issue a refresh token; reconnect`,
        'AUTH_FAILED',
      );
    }
    const res = await setSecureItem({
      key: this.key,
      value: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.success) {
      throw new FileSyncError(
        `OS keychain rejected the ${this.label} token: ${res.error ?? 'unknown error'}`,
        'AUTH_FAILED',
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await clearSecureItem({ key: this.key });
    } catch (err) {
      console.warn(`[${this.label}] token clear failed`, err);
    }
  }
}

export const createKeychainTokenPersistence = async (
  key: string,
  label: string,
): Promise<TokenPersistence | null> => {
  if (!isTauriAppPlatform()) return null;
  try {
    const res = await isSyncKeychainAvailable();
    if (res.available) return new KeychainTokenPersistence(key, label);
  } catch (err) {
    console.warn(`[${label}] keychain probe threw`, err);
  }
  return null;
};
