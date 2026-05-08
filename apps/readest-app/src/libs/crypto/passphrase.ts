import { SyncError } from '@/libs/errors';
import { isTauriAppPlatform } from '@/services/environment';
import {
  clearSyncPassphrase,
  getSyncPassphrase,
  isSyncKeychainAvailable,
  setSyncPassphrase,
} from '@/utils/bridge';

export interface PassphraseStore {
  set(passphrase: string): Promise<void>;
  get(): Promise<string | null>;
  clear(): Promise<void>;
  isAvailable(): boolean;
}

/**
 * Web / fallback passphrase store. Holds the value in memory only;
 * dropped on tab close. Used on web (Web Crypto subtle key in memory)
 * and as a graceful fallback on native when the OS keychain is
 * unavailable.
 */
export class EphemeralPassphraseStore implements PassphraseStore {
  private value: string | null = null;

  async set(passphrase: string): Promise<void> {
    this.value = passphrase;
  }

  async get(): Promise<string | null> {
    return this.value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }

  isAvailable(): boolean {
    return true;
  }
}

/**
 * OS-keychain backed passphrase store. Calls the native-bridge plugin
 * commands wired in PR 4d:
 *   * macOS / Windows / Linux desktop → keyring crate (Security
 *     framework / Credential Manager / libsecret).
 *   * iOS → Security framework Keychain via SecItemAdd/Copy/Delete.
 *   * Android → EncryptedSharedPreferences (AndroidKeystore-derived
 *     AES-GCM master key).
 *
 * `set` is fail-loud: if the keychain rejects the write, the caller
 * sees the error so the UI can warn the user. `get` is fail-soft:
 * keychain errors return null so the gate falls back to prompting.
 */
export class TauriPassphraseStore implements PassphraseStore {
  async set(passphrase: string): Promise<void> {
    const res = await setSyncPassphrase({ passphrase });
    if (!res.success) {
      throw new SyncError(
        'CRYPTO_UNAVAILABLE',
        `OS keychain rejected the passphrase: ${res.error ?? 'unknown error'}`,
      );
    }
  }

  async get(): Promise<string | null> {
    try {
      const res = await getSyncPassphrase();
      if (res.error) {
        console.warn('[passphrase] keychain get failed', res.error);
        return null;
      }
      return res.passphrase ?? null;
    } catch (err) {
      console.warn('[passphrase] keychain get threw', err);
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await clearSyncPassphrase();
    } catch (err) {
      console.warn('[passphrase] keychain clear threw', err);
    }
  }

  isAvailable(): boolean {
    return true;
  }
}

let cached: PassphraseStore | null = null;

/**
 * Pick the right backend at boot. On Tauri, probe the native bridge
 * once and cache the result; if the keychain is reachable use it,
 * otherwise fall back to the ephemeral store. The probe is async; the
 * sync `createPassphraseStore` returns ephemeral immediately and
 * `upgradeToKeychainIfAvailable` swaps the cached backend in once the
 * probe resolves. CryptoSession reads the current backend each time
 * it touches storage, so the swap is transparent.
 */
export const createPassphraseStore = (): PassphraseStore => {
  if (cached) return cached;
  cached = new EphemeralPassphraseStore();
  return cached;
};

export const upgradeToKeychainIfAvailable = async (): Promise<PassphraseStore> => {
  const current = createPassphraseStore();
  if (current instanceof TauriPassphraseStore) return current;
  if (!isTauriAppPlatform()) return current;
  try {
    const res = await isSyncKeychainAvailable();
    if (res.available) {
      cached = new TauriPassphraseStore();
      return cached;
    }
  } catch (err) {
    console.warn('[passphrase] keychain probe threw, staying on ephemeral', err);
  }
  return current;
};

/** Test seam — reset the cached backend between specs. */
export const __resetPassphraseStoreForTests = (): void => {
  cached = null;
};
