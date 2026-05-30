import { SyncError } from '@/libs/errors';

const PBKDF2_DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;

const requireSubtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new SyncError('CRYPTO_UNAVAILABLE', 'Web Crypto subtle is not available');
  }
  return crypto.subtle;
};

export const derivePbkdf2Key = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS,
): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    passphraseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
};

export const exportRawKey = async (key: CryptoKey): Promise<Uint8Array> => {
  const subtle = requireSubtle();
  const raw = await subtle.exportKey('raw', key);
  return new Uint8Array(raw);
};

export const PBKDF2_ITERATIONS = PBKDF2_DEFAULT_ITERATIONS;
