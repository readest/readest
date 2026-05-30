import { SyncError } from '@/libs/errors';
import type { CipherEnvelope } from '@/types/replica';
import { decryptCiphertext, encryptPlaintext } from './encrypt';

export const CURRENT_ALG = 'aes-gcm/pbkdf2-600k-sha256';
const SUPPORTED_ALGS = new Set<string>([CURRENT_ALG]);

const enc = new TextEncoder();
const dec = new TextDecoder();

const requireSubtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new SyncError('CRYPTO_UNAVAILABLE', 'Web Crypto subtle is not available');
  }
  return crypto.subtle;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const hash = await requireSubtle().digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(hash);
};

const constantTimeEq = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
};

export const encryptToEnvelope = async (
  plaintext: string | Uint8Array,
  key: CryptoKey,
  saltId: string,
): Promise<CipherEnvelope> => {
  const bytes = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const payload = await encryptPlaintext(bytes, key);
  const sidecar = await sha256(bytes);
  return {
    c: bytesToBase64(payload.ciphertext),
    i: bytesToBase64(payload.iv),
    s: saltId,
    alg: CURRENT_ALG,
    h: bytesToBase64(sidecar),
  };
};

export const decryptFromEnvelope = async (
  envelope: CipherEnvelope,
  key: CryptoKey,
): Promise<string> => {
  if (!SUPPORTED_ALGS.has(envelope.alg)) {
    throw new SyncError('UNSUPPORTED_ALG', `Unsupported envelope alg: ${envelope.alg}`, {
      cause: envelope.alg,
    });
  }
  const ciphertext = base64ToBytes(envelope.c);
  const iv = base64ToBytes(envelope.i);
  const expectedSidecar = base64ToBytes(envelope.h);
  const plain = await decryptCiphertext({ iv, ciphertext }, key);
  const actualSidecar = await sha256(plain);
  if (!constantTimeEq(expectedSidecar, actualSidecar)) {
    throw new SyncError('INTEGRITY', 'SHA-256 sidecar verification failed');
  }
  return dec.decode(plain);
};

export const isSupportedAlg = (alg: string): boolean => SUPPORTED_ALGS.has(alg);
