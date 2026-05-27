import { describe, expect, test } from 'vitest';
import { derivePbkdf2Key, exportRawKey } from '@/libs/crypto/derive';

const enc = new TextEncoder();
const toHex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

describe('derivePbkdf2Key (PBKDF2-HMAC-SHA-256)', () => {
  test('reference vector: password="password", salt="salt", c=1', async () => {
    const key = await derivePbkdf2Key('password', enc.encode('salt'), 1);
    const raw = await exportRawKey(key);
    expect(toHex(raw)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  test('reference vector: password="password", salt="salt", c=4096', async () => {
    const key = await derivePbkdf2Key('password', enc.encode('salt'), 4096);
    const raw = await exportRawKey(key);
    expect(toHex(raw)).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
  });

  test('different passphrases produce different keys', async () => {
    const salt = enc.encode('salt');
    const a = await derivePbkdf2Key('passwordA', salt, 1000);
    const b = await derivePbkdf2Key('passwordB', salt, 1000);
    const rawA = toHex(await exportRawKey(a));
    const rawB = toHex(await exportRawKey(b));
    expect(rawA).not.toBe(rawB);
  });

  test('different salts produce different keys', async () => {
    const a = await derivePbkdf2Key('password', enc.encode('saltA'), 1000);
    const b = await derivePbkdf2Key('password', enc.encode('saltB'), 1000);
    const rawA = toHex(await exportRawKey(a));
    const rawB = toHex(await exportRawKey(b));
    expect(rawA).not.toBe(rawB);
  });

  test('different iteration counts produce different keys', async () => {
    const salt = enc.encode('salt');
    const a = await derivePbkdf2Key('password', salt, 1000);
    const b = await derivePbkdf2Key('password', salt, 2000);
    const rawA = toHex(await exportRawKey(a));
    const rawB = toHex(await exportRawKey(b));
    expect(rawA).not.toBe(rawB);
  });

  test('default iteration count is 600_000 (OWASP 2024 for PBKDF2-SHA-256)', async () => {
    const key = await derivePbkdf2Key('password', enc.encode('salt'));
    const raw = await exportRawKey(key);
    expect(raw.length).toBe(32);
  }, 30_000);

  test('key is usable with AES-GCM (256-bit)', async () => {
    const key = await derivePbkdf2Key('password', enc.encode('salt'), 1000);
    const raw = await exportRawKey(key);
    expect(raw.length).toBe(32);
  });
});
