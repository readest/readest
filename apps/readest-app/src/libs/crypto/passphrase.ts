import { SyncError } from '@/libs/errors';

export interface PassphraseStore {
  set(passphrase: string): Promise<void>;
  get(): Promise<string | null>;
  clear(): Promise<void>;
  isAvailable(): boolean;
}

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

export class TauriPassphraseStore implements PassphraseStore {
  async set(_passphrase: string): Promise<void> {
    throw new SyncError(
      'CRYPTO_UNAVAILABLE',
      'Tauri keychain backend not yet wired (TODO before PR 4 ships).',
    );
  }

  async get(): Promise<string | null> {
    return null;
  }

  async clear(): Promise<void> {}

  isAvailable(): boolean {
    return false;
  }
}

export const createPassphraseStore = (): PassphraseStore => new EphemeralPassphraseStore();
