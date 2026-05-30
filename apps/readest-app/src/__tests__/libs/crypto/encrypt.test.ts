import { describe, expect, test } from 'vitest';
import { decryptCiphertext, encryptPlaintext } from '@/libs/crypto/encrypt';
import { derivePbkdf2Key } from '@/libs/crypto/derive';
import { SyncError } from '@/libs/errors';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 1000;

const makeKey = () => derivePbkdf2Key('test-passphrase', enc.encode('test-salt'), ITER);

describe('encryptPlaintext / decryptCiphertext', () => {
  test('round-trip identity for ASCII string', async () => {
    const key = await makeKey();
    const plain = enc.encode('hello world');
    const payload = await encryptPlaintext(plain, key);
    const recovered = await decryptCiphertext(payload, key);
    expect(dec.decode(recovered)).toBe('hello world');
  });

  test('round-trip identity for UTF-8 / emoji', async () => {
    const key = await makeKey();
    const original = '密码🔐 password — multi-byte';
    const payload = await encryptPlaintext(enc.encode(original), key);
    const recovered = await decryptCiphertext(payload, key);
    expect(dec.decode(recovered)).toBe(original);
  });

  test('round-trip for empty plaintext', async () => {
    const key = await makeKey();
    const payload = await encryptPlaintext(new Uint8Array(0), key);
    const recovered = await decryptCiphertext(payload, key);
    expect(recovered.length).toBe(0);
  });

  test('round-trip for large plaintext (10 KiB)', async () => {
    const key = await makeKey();
    const plain = new Uint8Array(10 * 1024);
    for (let i = 0; i < plain.length; i++) plain[i] = i & 0xff;
    const payload = await encryptPlaintext(plain, key);
    const recovered = await decryptCiphertext(payload, key);
    expect(recovered).toEqual(plain);
  });

  test('random IV per encryption: same plaintext produces different ciphertext', async () => {
    const key = await makeKey();
    const plain = enc.encode('same plaintext');
    const a = await encryptPlaintext(plain, key);
    const b = await encryptPlaintext(plain, key);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  test('IV is 12 bytes (AES-GCM standard)', async () => {
    const key = await makeKey();
    const payload = await encryptPlaintext(enc.encode('x'), key);
    expect(payload.iv.length).toBe(12);
  });

  test('wrong key throws SyncError DECRYPT', async () => {
    const keyA = await makeKey();
    const keyB = await derivePbkdf2Key('different', enc.encode('test-salt'), ITER);
    const payload = await encryptPlaintext(enc.encode('secret'), keyA);
    await expect(decryptCiphertext(payload, keyB)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'DECRYPT',
    });
  });

  test('tampered ciphertext throws SyncError DECRYPT (auth tag fails)', async () => {
    const key = await makeKey();
    const payload = await encryptPlaintext(enc.encode('secret'), key);
    const tampered = {
      iv: payload.iv,
      ciphertext: new Uint8Array(payload.ciphertext),
    };
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 0xff;
    await expect(decryptCiphertext(tampered, key)).rejects.toBeInstanceOf(SyncError);
  });

  test('tampered IV throws SyncError DECRYPT', async () => {
    const key = await makeKey();
    const payload = await encryptPlaintext(enc.encode('secret'), key);
    const tampered = {
      iv: new Uint8Array(payload.iv),
      ciphertext: payload.ciphertext,
    };
    tampered.iv[0] = tampered.iv[0]! ^ 0xff;
    await expect(decryptCiphertext(tampered, key)).rejects.toBeInstanceOf(SyncError);
  });
});
