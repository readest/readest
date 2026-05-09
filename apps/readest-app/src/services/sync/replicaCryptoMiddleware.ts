/**
 * Encryption middleware for replica adapters with `encryptedFields`.
 *
 * The publish path runs `encryptPackedFields` between adapter.pack and
 * envelope creation; the pull path runs `decryptRowFields` on the row
 * fields_jsonb before adapter.unpackRow sees it. Adapters themselves
 * stay sync and see plaintext only.
 *
 * Encryption is best-effort: when the CryptoSession is locked, encrypted
 * fields are silently dropped from the push (`encryptPackedFields`
 * deletes them from the packed object) and decryption failures on pull
 * leave the field absent (`decryptRowFields` deletes the cipher entry)
 * so the adapter's unpack sees nothing rather than ciphertext-as-string.
 * Local plaintext copies are preserved by the store's applyRemote
 * merge — see customOPDSStore.applyRemoteCatalog.
 */
import { isSyncError, SyncError } from '@/libs/errors';
import { isCipherEnvelope } from '@/types/replica';
import type { CipherEnvelope, FieldsObject } from '@/types/replica';
import type { CryptoSession } from '@/libs/crypto/session';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';
import { cryptoSession as defaultCryptoSession } from '@/libs/crypto/session';

/**
 * Encrypt the named fields of a packed-fields object in place. Fields
 * with undefined / empty values are skipped. When the session can't
 * encrypt (locked, no passphrase, web crypto unavailable), the
 * affected fields are deleted from the object so they don't leak as
 * plaintext into fields_jsonb.
 */
export const encryptPackedFields = async (
  packed: Record<string, unknown>,
  encryptedFields: readonly string[] | undefined,
  session: CryptoSession = defaultCryptoSession,
): Promise<void> => {
  if (!encryptedFields || encryptedFields.length === 0) return;
  if (!session.isUnlocked()) {
    for (const f of encryptedFields) delete packed[f];
    return;
  }
  for (const fieldName of encryptedFields) {
    const value = packed[fieldName];
    if (value === undefined || value === null || value === '') continue;
    try {
      packed[fieldName] = await session.encryptField(String(value));
    } catch (err) {
      // Encryption failure on a single field shouldn't block the push of
      // the other fields. Drop this one and log.
      console.warn(
        `[replicaCrypto] failed to encrypt field "${fieldName}" — dropping from push`,
        err,
      );
      delete packed[fieldName];
    }
  }
};

/**
 * Detect whether the row carries at least one cipher envelope in any of
 * the named fields. The orchestrator uses this to decide whether to
 * trigger a passphrase prompt before the decrypt loop runs — the
 * common case (no encrypted credentials on the row) skips the prompt
 * entirely.
 */
export const rowHasCipherFields = (
  fields: FieldsObject,
  encryptedFields: readonly string[] | undefined,
): boolean => {
  if (!encryptedFields || encryptedFields.length === 0) return false;
  for (const fieldName of encryptedFields) {
    const envelope = fields[fieldName];
    if (!envelope || typeof envelope !== 'object' || !('v' in envelope)) continue;
    if (isCipherEnvelope((envelope as { v: unknown }).v)) return true;
  }
  return false;
};

/**
 * Snapshot the cipher ciphertexts (the `c` slot of each cipher envelope)
 * for the named fields, BEFORE decryptRowFields mutates them in place.
 * Used by the orchestrator to detect when a cipher has changed since
 * the last pull (rotation / password update on another device).
 */
export const captureCipherTexts = (
  fields: FieldsObject,
  encryptedFields: readonly string[] | undefined,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!encryptedFields) return out;
  for (const f of encryptedFields) {
    const env = fields[f];
    if (!env || typeof env !== 'object' || !('v' in env)) continue;
    const v = (env as { v: unknown }).v;
    if (isCipherEnvelope(v)) out[f] = (v as { c: string }).c;
  }
  return out;
};

/**
 * True if any ciphertext in `current` differs from the corresponding
 * entry in `lastSeen`. New cipher fields (not previously seen) count
 * as changed — that's the fresh-device path and should prompt.
 */
export const cipherTextsChanged = (
  current: Record<string, string>,
  lastSeen: Record<string, string> | undefined,
): boolean => {
  for (const [f, c] of Object.entries(current)) {
    if (!lastSeen || lastSeen[f] !== c) return true;
  }
  return false;
};

/**
 * After decryptRowFields runs, walk the named fields and return the
 * cipher snapshot for those whose decryption succeeded (the field's
 * `v` slot is now a string). Used by the orchestrator to update the
 * local record's `lastSeenCipher` so the next pull compares against
 * the most recently-decrypted cipher rather than re-prompting.
 */
export const collectDecryptSuccess = (
  fields: FieldsObject,
  beforeDecrypt: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of Object.keys(beforeDecrypt)) {
    const env = fields[f];
    if (!env || typeof env !== 'object' || !('v' in env)) continue;
    const v = (env as { v: unknown }).v;
    if (typeof v === 'string') out[f] = beforeDecrypt[f]!;
  }
  return out;
};

/**
 * Decrypt the named fields of a row's fields_jsonb in place. Each named
 * field's CRDT envelope value (the `v` slot) is replaced with the
 * decrypted plaintext so the adapter's unpackRow sees a plain value.
 * Fields whose envelope value isn't a CipherEnvelope (e.g., the
 * publishing device hadn't unlocked yet, or this is a metadata-only
 * legacy row) are left untouched. Decrypt failures delete the field
 * from fields_jsonb entirely.
 *
 * `onLocked` is invoked at most once per call when the session is
 * locked AND a cipher field is encountered. The orchestrator wires
 * this to the passphrase gate so a sync fresh device prompts the user
 * before silently dropping the encrypted creds.
 */
export interface DecryptRowResult {
  /**
   * Field paths whose decrypt failed because the cipher envelope's
   * `saltId` no longer exists server-side (the user / admin reset
   * `replica_keys` out of band). The orchestrator hands these to the
   * adapter so it can clear any persisted "already-published"
   * fingerprint for the path — the next save then re-encrypts the
   * (still locally-held) plaintext under the current salt and the
   * orphaned cipher gets overwritten on the server.
   */
  saltNotFound: string[];
}

export const decryptRowFields = async (
  fields: FieldsObject,
  encryptedFields: readonly string[] | undefined,
  session: CryptoSession = defaultCryptoSession,
  onLocked?: () => Promise<void>,
): Promise<DecryptRowResult> => {
  if (!encryptedFields || encryptedFields.length === 0) return { saltNotFound: [] };
  const saltNotFound: string[] = [];
  let promptAttempted = false;
  let lastFailureCode: string | null = null;
  let failedFieldCount = 0;
  for (const fieldName of encryptedFields) {
    const envelope = fields[fieldName];
    if (!envelope || typeof envelope !== 'object' || !('v' in envelope)) continue;
    const v = (envelope as { v: unknown }).v;
    if (!isCipherEnvelope(v)) continue;
    // Locked session + cipher field: ask the gate to unlock once per
    // decryptRowFields call. If the unlock succeeds, fall through to
    // decrypt; if it fails (user cancelled, gate has no prompter),
    // drop the field and preserve the local plaintext copy.
    if (!session.isUnlocked() && onLocked && !promptAttempted) {
      promptAttempted = true;
      try {
        await onLocked();
      } catch {
        // Ignore — the next isUnlocked() check below decides what to do.
      }
    }
    if (!session.isUnlocked()) {
      delete fields[fieldName];
      continue;
    }
    try {
      const plaintext = await session.decryptField(v as CipherEnvelope);
      (envelope as { v: unknown }).v = plaintext;
    } catch (err) {
      const code = isSyncError(err) ? (err as SyncError).code : 'unknown';
      // Loud + uniformly prefixed so it's easy to grep in production
      // console output. AES-GCM failures (wrong passphrase) surface
      // as DECRYPT; SHA-256 sidecar mismatches as INTEGRITY.
      console.warn(
        `[replicaCrypto] failed to decrypt field "${fieldName}" (${code}) — preserving local copy`,
        err,
      );
      lastFailureCode = code;
      failedFieldCount += 1;
      if (code === 'SALT_NOT_FOUND') saltNotFound.push(fieldName);
      delete fields[fieldName];
    }
  }

  // One toast per call, surfaced after the loop so the user notices
  // even if they don't watch the console.
  //   * DECRYPT / INTEGRITY: AES-GCM or sidecar verification failed —
  //     almost always "wrong sync passphrase entered on this device".
  //     Local plaintext copy is preserved.
  //   * SALT_NOT_FOUND: the row's cipher envelope references a salt
  //     that no longer exists in `replica_keys` server-side. This
  //     happens when the salts were deleted out-of-band (e.g.,
  //     manually) without also wiping the cipher envelopes — the
  //     proper Forgot-passphrase RPC does both atomically. The orphan
  //     The orchestrator hands the saltNotFound list back to the
  //     adapter so it can clear any "already-published" snapshot for
  //     those paths — the next save then re-encrypts under the
  //     current salt and overwrites the orphan.
  if (failedFieldCount > 0 && lastFailureCode !== null) {
    let message: string;
    if (lastFailureCode === 'DECRYPT' || lastFailureCode === 'INTEGRITY') {
      message = _('Wrong sync passphrase — synced credentials could not be decrypted');
    } else if (lastFailureCode === 'SALT_NOT_FOUND') {
      message = _(
        'Sync passphrase data on the server was reset. Re-encrypting your credentials under the new passphrase…',
      );
    } else {
      message = _('Failed to decrypt synced credentials');
    }
    eventDispatcher.dispatch('toast', { type: 'error', message });
  }

  return { saltNotFound };
};
