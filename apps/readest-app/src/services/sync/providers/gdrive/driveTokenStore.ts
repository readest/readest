/**
 * Persistence for the Google Drive OAuth token set, over the OS keychain.
 *
 * Unlike the sync passphrase — which falls back to an in-memory store on web —
 * the Drive refresh token has NO ephemeral fallback: a refresh token is a
 * long-lived credential, and "connected" UI that silently forgets the account on
 * the next launch is worse than refusing to connect. So Drive connect requires
 * real secure storage (Tauri keychain); {@link createDriveTokenPersistence}
 * returns `null` when none is available, and the connect flow fails on `null`.
 *
 * The keychain is reached through the generic keyed secure-KV bridge commands
 * (`set/get/clear_secure_item`), keyed by {@link DRIVE_TOKEN_KEY}, so the same
 * native store the sync passphrase uses also holds the token set without a
 * Drive-specific native command.
 */
import { isTauriAppPlatform } from '@/services/environment';
import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';
import { FileSyncError } from '@/services/sync/file/provider';
import type { TokenSet } from './auth/tokenStore';

/** Keychain key under which the serialised {@link TokenSet} is stored. */
export const DRIVE_TOKEN_KEY = 'gdrive_token_set';

/**
 * Load / save / clear the Drive {@link TokenSet}. `load` is fail-soft (a keychain
 * error reads as "not connected"); `save` is fail-loud (the connect flow must
 * know the token did not persist, so it can refuse to mark Drive connected).
 */
export interface TokenPersistence {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

/** OS-keychain backed {@link TokenPersistence} via the keyed secure-KV bridge. */
export class KeychainTokenPersistence implements TokenPersistence {
  async load(): Promise<TokenSet | null> {
    try {
      const res = await getSecureItem({ key: DRIVE_TOKEN_KEY });
      if (res.error || !res.value) return null;
      return JSON.parse(res.value) as TokenSet;
    } catch (err) {
      console.warn('[gdrive] token load failed', err);
      return null;
    }
  }

  async save(tokens: TokenSet): Promise<void> {
    const res = await setSecureItem({ key: DRIVE_TOKEN_KEY, value: JSON.stringify(tokens) });
    if (!res.success) {
      throw new FileSyncError(
        `OS keychain rejected the Drive token: ${res.error ?? 'unknown error'}`,
        'AUTH_FAILED',
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await clearSecureItem({ key: DRIVE_TOKEN_KEY });
    } catch (err) {
      console.warn('[gdrive] token clear failed', err);
    }
  }
}

/**
 * Resolve the Drive token store, or `null` when secure persistence is
 * unavailable (web, or a Tauri build whose keychain probe fails). Callers treat
 * `null` as "Drive cannot be connected here" — there is deliberately no
 * in-memory fallback for the refresh token.
 */
export const createDriveTokenPersistence = async (): Promise<TokenPersistence | null> => {
  if (!isTauriAppPlatform()) return null;
  try {
    const res = await isSyncKeychainAvailable();
    if (res.available) return new KeychainTokenPersistence();
  } catch (err) {
    console.warn('[gdrive] keychain probe threw', err);
  }
  return null;
};
