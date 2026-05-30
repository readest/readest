import { SyncError } from '@/libs/errors';
import type { CipherEnvelope } from '@/types/replica';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import type { ReplicaKeyRow, ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { derivePbkdf2Key } from './derive';
import { CURRENT_ALG, decryptFromEnvelope, encryptToEnvelope } from './envelope';
import { createPassphraseStore } from './passphrase';
import type { PassphraseStore } from './passphrase';

const PBKDF2_ALG = 'pbkdf2-600k-sha256';

const base64ToBytes = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

interface KnownSalt {
  saltId: string;
  alg: string;
  bytes: Uint8Array;
}

export interface CryptoSessionDeps {
  client?: Pick<ReplicaSyncClient, 'listReplicaKeys' | 'createReplicaKey' | 'forgetReplicaKeys'>;
  /** Override PBKDF2 iterations. Tests pass a low value; production omits. */
  iterations?: number;
  /**
   * Where to persist the passphrase across app launches. Production
   * defaults to the lazy module-level store (ephemeral on web,
   * upgrades to OS keychain on Tauri). Tests pass a mock.
   */
  store?: PassphraseStore;
}

export class CryptoSession {
  private passphrase: string | null = null;
  private salts = new Map<string, KnownSalt>();
  private keys = new Map<string, CryptoKey>();
  private activeSaltId: string | null = null;
  private readonly client: Pick<
    ReplicaSyncClient,
    'listReplicaKeys' | 'createReplicaKey' | 'forgetReplicaKeys'
  >;
  private readonly iterations: number | undefined;
  /**
   * Optional store override, only set when a test passes a mock.
   * Production resolves the store via `createPassphraseStore()` on
   * every storage touch so the keychain upgrade (probed
   * asynchronously at boot) is picked up transparently.
   */
  private readonly storeOverride: PassphraseStore | undefined;

  constructor(deps: CryptoSessionDeps = {}) {
    this.client = deps.client ?? replicaSyncClient;
    this.iterations = deps.iterations;
    this.storeOverride = deps.store;
  }

  private store(): PassphraseStore {
    return this.storeOverride ?? createPassphraseStore();
  }

  isUnlocked(): boolean {
    return this.passphrase !== null && this.activeSaltId !== null;
  }

  /** Drop in-memory passphrase and derived keys. Idempotent. */
  lock(): void {
    this.passphrase = null;
    this.salts.clear();
    this.keys.clear();
    this.activeSaltId = null;
  }

  /**
   * Derive against the user's existing newest salt. Throws NO_PASSPHRASE if
   * the account has no salt yet — callers must call setup() instead.
   * On success, persists the passphrase to the configured store so the
   * next launch can silently restore (Tauri keychain) or re-prompt (web).
   */
  async unlock(passphrase: string): Promise<void> {
    const rows = await this.client.listReplicaKeys();
    if (rows.length === 0) {
      throw new SyncError(
        'NO_PASSPHRASE',
        'No replica_keys row exists for this account. Call setup() to create one.',
      );
    }
    this.ingestRows(rows);
    this.passphrase = passphrase;
    this.activeSaltId = rows[0]!.saltId;
    await this.deriveKeyFor(this.activeSaltId);
    await this.persistPassphrase(passphrase);
  }

  /**
   * Forget the user's passphrase entirely: server-side wipe of every
   * encrypted-field envelope across all the user's replica rows + drop
   * every salt + clear the local keychain entry. The next encrypted
   * push from any device will mint a fresh salt + key. Local plaintext
   * copies on each device are preserved — the user just has to
   * re-enter the sync passphrase (or set a new one) to start re-
   * encrypting.
   */
  async forget(): Promise<void> {
    await this.client.forgetReplicaKeys();
    try {
      await this.store().clear();
    } catch (err) {
      console.warn('[cryptoSession] failed to clear passphrase store', err);
    }
    this.lock();
  }

  /**
   * Create a fresh salt server-side, then derive against it. Used on first
   * passphrase setup. If a salt already exists this still appends a new one,
   * matching passphrase-rotation semantics. On success, persists the
   * passphrase to the configured store.
   */
  async setup(passphrase: string): Promise<void> {
    const row = await this.client.createReplicaKey(PBKDF2_ALG);
    this.ingestRows([row]);
    this.passphrase = passphrase;
    this.activeSaltId = row.saltId;
    await this.deriveKeyFor(row.saltId);
    await this.persistPassphrase(passphrase);
  }

  /**
   * Try to silently unlock the session by reading a previously-saved
   * passphrase from the store (OS keychain on Tauri). No-op when:
   *   * already unlocked
   *   * no passphrase is stored locally
   *   * the account has no salt server-side (treated as "no setup yet")
   *   * any underlying call throws (logged + swallowed)
   *
   * Called from the Providers boot effect so the user doesn't see the
   * passphrase modal on every app launch on native.
   */
  async tryRestoreFromStore(): Promise<boolean> {
    if (this.isUnlocked()) return true;
    try {
      const saved = await this.store().get();
      if (!saved) return false;
      const rows = await this.client.listReplicaKeys();
      if (rows.length === 0) {
        // Account has no salt: stale local entry. Clean it up so the
        // next prompt path runs setup() cleanly.
        await this.store().clear();
        return false;
      }
      this.ingestRows(rows);
      this.passphrase = saved;
      this.activeSaltId = rows[0]!.saltId;
      await this.deriveKeyFor(this.activeSaltId);
      return true;
    } catch (err) {
      console.warn('[cryptoSession] silent restore failed', err);
      return false;
    }
  }

  private async persistPassphrase(passphrase: string): Promise<void> {
    try {
      await this.store().set(passphrase);
    } catch (err) {
      // Persistence failure is non-fatal: the session is unlocked in
      // memory for this run, but we log so a broken keychain shows up.
      console.warn('[cryptoSession] failed to persist passphrase', err);
    }
  }

  async encryptField(plaintext: string): Promise<CipherEnvelope> {
    if (!this.activeSaltId) {
      throw new SyncError('NO_PASSPHRASE', 'CryptoSession is locked');
    }
    const key = await this.deriveKeyFor(this.activeSaltId);
    return encryptToEnvelope(plaintext, key, this.activeSaltId);
  }

  async decryptField(envelope: CipherEnvelope): Promise<string> {
    if (envelope.alg !== CURRENT_ALG) {
      throw new SyncError('UNSUPPORTED_ALG', `Unsupported envelope alg: ${envelope.alg}`);
    }
    const key = await this.deriveKeyFor(envelope.s);
    return decryptFromEnvelope(envelope, key);
  }

  private ingestRows(rows: ReplicaKeyRow[]): void {
    for (const row of rows) {
      if (row.alg !== PBKDF2_ALG) continue;
      this.salts.set(row.saltId, {
        saltId: row.saltId,
        alg: row.alg,
        bytes: base64ToBytes(row.salt),
      });
    }
  }

  private async deriveKeyFor(saltId: string): Promise<CryptoKey> {
    const cached = this.keys.get(saltId);
    if (cached) return cached;
    if (!this.passphrase) {
      throw new SyncError('NO_PASSPHRASE', 'CryptoSession is locked');
    }
    let salt = this.salts.get(saltId);
    if (!salt) {
      const rows = await this.client.listReplicaKeys();
      this.ingestRows(rows);
      salt = this.salts.get(saltId);
      if (!salt) {
        throw new SyncError('SALT_NOT_FOUND', `Unknown saltId: ${saltId}`);
      }
    }
    const key = await derivePbkdf2Key(this.passphrase, salt.bytes, this.iterations);
    this.keys.set(saltId, key);
    return key;
  }
}

export const cryptoSession = new CryptoSession();
