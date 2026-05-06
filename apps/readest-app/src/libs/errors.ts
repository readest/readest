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

export const assertNever = (x: never): never => {
  throw new SyncError('VALIDATION', `Unexpected value: ${JSON.stringify(x)}`);
};
