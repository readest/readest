import { describe, expect, test } from 'vitest';
import { CURRENT_ALG, decryptFromEnvelope, encryptToEnvelope } from '@/libs/crypto/envelope';
import { derivePbkdf2Key } from '@/libs/crypto/derive';
import { isCipherEnvelope } from '@/types/replica';

const enc = new TextEncoder();
const ITER = 1000;

const makeKey = () => derivePbkdf2Key('p', enc.encode('s'), ITER);

describe('encryptToEnvelope / decryptFromEnvelope', () => {
  test('round-trip identity for string plaintext', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('hello', key, 'salt-id-1');
    expect(isCipherEnvelope(env)).toBe(true);
    const recovered = await decryptFromEnvelope(env, key);
    expect(recovered).toBe('hello');
  });

  test('envelope shape: c, i, s, alg, h all present and base64', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('x', key, 'salt-v1');
    expect(env.alg).toBe(CURRENT_ALG);
    expect(env.s).toBe('salt-v1');
    expect(env.c).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(env.i).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(env.h).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('alg field is exactly aes-gcm/pbkdf2-600k-sha256', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('x', key, 'salt-v1');
    expect(env.alg).toBe('aes-gcm/pbkdf2-600k-sha256');
  });

  test('SHA-256 sidecar mismatch (tampered c) raises INTEGRITY', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('original', key, 'salt-v1');
    const goodPlain = await decryptFromEnvelope(env, key);
    expect(goodPlain).toBe('original');
    const otherEnv = await encryptToEnvelope('different', key, 'salt-v1');
    const tampered = { ...env, h: otherEnv.h };
    await expect(decryptFromEnvelope(tampered, key)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'INTEGRITY',
    });
  });

  test('tampered ciphertext raises DECRYPT (auth tag fail)', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('secret', key, 'salt-v1');
    const corrupted = atob(env.c);
    const bytes = new Uint8Array(corrupted.length);
    for (let i = 0; i < corrupted.length; i++) bytes[i] = corrupted.charCodeAt(i);
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...env, c: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptFromEnvelope(tampered, key)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'DECRYPT',
    });
  });

  test('unknown alg raises UNSUPPORTED_ALG', async () => {
    const key = await makeKey();
    const env = await encryptToEnvelope('x', key, 'salt-v1');
    const futureAlg = { ...env, alg: 'aes-gcm/pbkdf2-2m-sha512' };
    await expect(decryptFromEnvelope(futureAlg, key)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'UNSUPPORTED_ALG',
    });
  });

  test('UTF-8 plaintext round-trip', async () => {
    const key = await makeKey();
    const original = '密码 password — 🔐';
    const env = await encryptToEnvelope(original, key, 'salt-v1');
    const recovered = await decryptFromEnvelope(env, key);
    expect(recovered).toBe(original);
  });

  test('two envelopes of same plaintext have different c/i but same h', async () => {
    const key = await makeKey();
    const a = await encryptToEnvelope('same', key, 'salt-v1');
    const b = await encryptToEnvelope('same', key, 'salt-v1');
    expect(a.c).not.toBe(b.c);
    expect(a.i).not.toBe(b.i);
    expect(a.h).toBe(b.h);
  });
});
