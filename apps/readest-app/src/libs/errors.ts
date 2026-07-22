export type SyncErrorCode =
  | 'TIMEOUT'
  | 'AUTH'
  | 'QUOTA_EXCEEDED'
  | 'CLOCK_SKEW'
  | 'VALIDATION'
  | 'SERVER'
  | 'DECRYPT'
  | 'INTEGRITY'
  | 'UNSUPPORTED_ALG'
  | 'SALT_NOT_FOUND'
  | 'CRYPTO_UNAVAILABLE'
  | 'NO_PASSPHRASE'
  | 'LOCAL_FILE_MISSING'
  | 'TRANSFER'
  | 'STORAGE'
  | 'MANIFEST_COMMIT'
  | 'UNKNOWN_KIND'
  | 'SCHEMA_TOO_NEW'
  | 'LEGACY_MIGRATION_SKIP'
  | 'HLC_PERSIST';

export interface SyncErrorContext {
  replicaId?: string;
  kind?: string;
  field?: string;
  status?: number;
  cause?: unknown;
}

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly context: SyncErrorContext;

  constructor(code: SyncErrorCode, message: string, context: SyncErrorContext = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.context = context;
  }
}

export const isSyncError = (e: unknown): e is SyncError =>
  e instanceof SyncError || (e instanceof Error && e.name === 'SyncError');

/**
 * The signature of "this key can't read this ciphertext": AES-GCM auth-tag
 * failure or SHA-256 sidecar mismatch. In practice both mean the passphrase
 * behind the derived key is wrong. Distinct from SALT_NOT_FOUND /
 * CRYPTO_UNAVAILABLE, which say nothing about the passphrase.
 */
export const isWrongPassphraseError = (e: unknown): boolean =>
  isSyncError(e) && (e.code === 'DECRYPT' || e.code === 'INTEGRITY');

export const assertNever = (x: never): never => {
  throw new SyncError('VALIDATION', `Unexpected value: ${JSON.stringify(x)}`);
};
