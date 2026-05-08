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
 * Decrypt the named fields of a row's fields_jsonb in place. Each named
 * field's CRDT envelope value (the `v` slot) is replaced with the
 * decrypted plaintext so the adapter's unpackRow sees a plain value.
 * Fields whose envelope value isn't a CipherEnvelope (e.g., the
 * publishing device hadn't unlocked yet, or this is a metadata-only
 * legacy row) are left untouched. Decrypt failures delete the field
 * from fields_jsonb entirely.
 */
export const decryptRowFields = async (
  fields: FieldsObject,
  encryptedFields: readonly string[] | undefined,
  session: CryptoSession = defaultCryptoSession,
): Promise<void> => {
  if (!encryptedFields || encryptedFields.length === 0) return;
  for (const fieldName of encryptedFields) {
    const envelope = fields[fieldName];
    if (!envelope || typeof envelope !== 'object' || !('v' in envelope)) continue;
    const v = (envelope as { v: unknown }).v;
    if (!isCipherEnvelope(v)) continue;
    if (!session.isUnlocked()) {
      // Locked: drop the cipher field so unpackRow doesn't see opaque
      // data. The store's applyRemote merge preserves the local
      // plaintext copy, so the user isn't locked out of their own
      // catalog.
      delete fields[fieldName];
      continue;
    }
    try {
      const plaintext = await session.decryptField(v as CipherEnvelope);
      (envelope as { v: unknown }).v = plaintext;
    } catch (err) {
      const code = isSyncError(err) ? (err as SyncError).code : 'unknown';
      console.warn(
        `[replicaCrypto] failed to decrypt field "${fieldName}" (${code}) — preserving local copy`,
        err,
      );
      delete fields[fieldName];
    }
  }
};
