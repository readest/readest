import { SyncError } from '@/libs/errors';
import type { CipherEnvelope } from '@/types/replica';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import type { ReplicaKeyRow, ReplicaSyncClient } from '@/libs/replicaSyncClient';
import { derivePbkdf2Key } from './derive';
import { CURRENT_ALG, decryptFromEnvelope, encryptToEnvelope } from './envelope';

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
  client?: Pick<ReplicaSyncClient, 'listReplicaKeys' | 'createReplicaKey'>;
  /** Override PBKDF2 iterations. Tests pass a low value; production omits. */
  iterations?: number;
}

export class CryptoSession {
  private passphrase: string | null = null;
  private salts = new Map<string, KnownSalt>();
  private keys = new Map<string, CryptoKey>();
  private activeSaltId: string | null = null;
  private readonly client: Pick<ReplicaSyncClient, 'listReplicaKeys' | 'createReplicaKey'>;
  private readonly iterations: number | undefined;

  constructor(deps: CryptoSessionDeps = {}) {
    this.client = deps.client ?? replicaSyncClient;
    this.iterations = deps.iterations;
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
  }

  /**
   * Create a fresh salt server-side, then derive against it. Used on first
   * passphrase setup. If a salt already exists this still appends a new one,
   * matching passphrase-rotation semantics.
   */
  async setup(passphrase: string): Promise<void> {
    const row = await this.client.createReplicaKey(PBKDF2_ALG);
    this.ingestRows([row]);
    this.passphrase = passphrase;
    this.activeSaltId = row.saltId;
    await this.deriveKeyFor(row.saltId);
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
