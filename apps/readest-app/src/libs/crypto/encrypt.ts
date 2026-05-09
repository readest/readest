import { SyncError } from '@/libs/errors';

const IV_BYTES = 12;

export interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

const requireSubtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new SyncError('CRYPTO_UNAVAILABLE', 'Web Crypto subtle is not available');
  }
  return crypto.subtle;
};

export const encryptPlaintext = async (
  plaintext: Uint8Array,
  key: CryptoKey,
): Promise<EncryptedPayload> => {
  const subtle = requireSubtle();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
};

export const decryptCiphertext = async (
  payload: EncryptedPayload,
  key: CryptoKey,
): Promise<Uint8Array> => {
  const subtle = requireSubtle();
  try {
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: payload.iv as BufferSource },
      key,
      payload.ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch (cause) {
    throw new SyncError('DECRYPT', 'AES-GCM decryption failed', { cause });
  }
};
