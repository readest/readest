import { beforeEach, describe, expect, test } from 'vitest';
import { CryptoSession } from '@/libs/crypto/session';
import { encryptPackedFields, decryptRowFields } from '@/services/sync/replicaCryptoMiddleware';
import { isCipherEnvelope } from '@/types/replica';
import type { CipherEnvelope, FieldsObject, Hlc } from '@/types/replica';
import type { ReplicaKeyRow } from '@/libs/replicaSyncClient';

const ITER = 1000;
const PBKDF2_ALG = 'pbkdf2-600k-sha256';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
};

const makeSaltRow = (saltId: string, createdAt: string): ReplicaKeyRow => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (i + saltId.length) & 0xff;
  return { saltId, alg: PBKDF2_ALG, salt: bytesToBase64(bytes), createdAt };
};

class FakeClient {
  rows: ReplicaKeyRow[] = [];
  async listReplicaKeys(): Promise<ReplicaKeyRow[]> {
    return [...this.rows];
  }
  async createReplicaKey(): Promise<ReplicaKeyRow> {
    const row = makeSaltRow(`salt-${this.rows.length + 1}`, new Date().toISOString());
    this.rows.push(row);
    return row;
  }
  async forgetReplicaKeys(): Promise<void> {
    this.rows = [];
  }
}

const HLC = '00000000001-00000000-dev' as Hlc;
const wrapField = (v: unknown) => ({ v, t: HLC, s: 'dev' });

describe('replicaCryptoMiddleware', () => {
  let client: FakeClient;
  let session: CryptoSession;

  beforeEach(async () => {
    client = new FakeClient();
    session = new CryptoSession({ client, iterations: ITER });
  });

  describe('encryptPackedFields', () => {
    test('replaces named fields with cipher envelopes when unlocked', async () => {
      await session.setup('pw');
      const packed: Record<string, unknown> = { name: 'Public', password: 'hunter2' };
      await encryptPackedFields(packed, ['password'], session);
      expect(packed['name']).toBe('Public');
      expect(isCipherEnvelope(packed['password'])).toBe(true);
    });

    test('drops named fields when session is locked (no plaintext leak)', async () => {
      const packed: Record<string, unknown> = { name: 'Public', password: 'hunter2' };
      await encryptPackedFields(packed, ['password'], session);
      expect(packed['name']).toBe('Public');
      expect(packed['password']).toBeUndefined();
      expect('password' in packed).toBe(false);
    });

    test('skips empty / undefined values without erroring', async () => {
      await session.setup('pw');
      const packed: Record<string, unknown> = { name: 'X', password: '', username: undefined };
      await encryptPackedFields(packed, ['password', 'username'], session);
      expect(packed['password']).toBe('');
      expect(packed['username']).toBeUndefined();
    });

    test('no-op when encryptedFields is undefined or empty', async () => {
      await session.setup('pw');
      const packed: Record<string, unknown> = { password: 'hunter2' };
      await encryptPackedFields(packed, undefined, session);
      expect(packed['password']).toBe('hunter2');
      await encryptPackedFields(packed, [], session);
      expect(packed['password']).toBe('hunter2');
    });
  });

  describe('decryptRowFields', () => {
    test('replaces cipher envelope values with plaintext when unlocked', async () => {
      await session.setup('pw');
      const cipher = await session.encryptField('hunter2');
      const fields: FieldsObject = {
        name: wrapField('Public'),
        password: wrapField(cipher),
      };
      await decryptRowFields(fields, ['password'], session);
      expect((fields['name'] as { v: unknown }).v).toBe('Public');
      expect((fields['password'] as { v: unknown }).v).toBe('hunter2');
    });

    test('drops the field on locked session (preserves local plaintext at the merge layer)', async () => {
      // Encrypt with one session, decrypt with another that's locked.
      const writer = new CryptoSession({ client, iterations: ITER });
      await writer.setup('pw');
      const cipher = await writer.encryptField('secret');

      const reader = new CryptoSession({ client, iterations: ITER });
      const fields: FieldsObject = { password: wrapField(cipher) };
      await decryptRowFields(fields, ['password'], reader);
      expect(fields['password']).toBeUndefined();
    });

    test('drops the field on wrong-passphrase decrypt failure', async () => {
      const writer = new CryptoSession({ client, iterations: ITER });
      await writer.setup('correct');
      const cipher = await writer.encryptField('secret');

      const reader = new CryptoSession({ client, iterations: ITER });
      await reader.unlock('wrong');
      const fields: FieldsObject = { password: wrapField(cipher) };
      await decryptRowFields(fields, ['password'], reader);
      expect(fields['password']).toBeUndefined();
    });

    test('leaves plaintext envelopes untouched (no cipher detected)', async () => {
      await session.setup('pw');
      const fields: FieldsObject = {
        password: wrapField('not-encrypted-but-we-asked'),
      };
      await decryptRowFields(fields, ['password'], session);
      // Not a cipher envelope → middleware leaves it alone.
      expect((fields['password'] as { v: unknown }).v).toBe('not-encrypted-but-we-asked');
    });

    test('no-op when encryptedFields is undefined or empty', async () => {
      await session.setup('pw');
      const cipher: CipherEnvelope = { c: 'x', i: 'y', s: 'salt-1', alg: 'rot13', h: 'z' };
      const fields: FieldsObject = { password: wrapField(cipher) };
      await decryptRowFields(fields, undefined, session);
      expect(fields['password']).toBeDefined();
    });
  });
});
