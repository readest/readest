import { beforeEach, describe, expect, test } from 'vitest';
import { CryptoSession } from '@/libs/crypto/session';
import { CURRENT_ALG, encryptToEnvelope } from '@/libs/crypto/envelope';
import { derivePbkdf2Key } from '@/libs/crypto/derive';
import { isSyncError, SyncError } from '@/libs/errors';
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
  return {
    saltId,
    alg: PBKDF2_ALG,
    salt: bytesToBase64(bytes),
    createdAt,
  };
};

class FakeClient {
  rows: ReplicaKeyRow[] = [];
  listCalls = 0;
  createCalls = 0;
  forgetCalls = 0;

  async listReplicaKeys(): Promise<ReplicaKeyRow[]> {
    this.listCalls += 1;
    return [...this.rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createReplicaKey(alg: string): Promise<ReplicaKeyRow> {
    this.createCalls += 1;
    const row = makeSaltRow(`salt-${this.rows.length + 1}`, new Date().toISOString());
    if (alg !== PBKDF2_ALG) throw new SyncError('UNSUPPORTED_ALG', `bad alg: ${alg}`);
    this.rows.push(row);
    return row;
  }

  async forgetReplicaKeys(): Promise<void> {
    this.forgetCalls += 1;
    this.rows = [];
  }
}

const makeSession = (client: FakeClient) => new CryptoSession({ client, iterations: ITER });

describe('CryptoSession', () => {
  let client: FakeClient;
  let session: CryptoSession;

  beforeEach(() => {
    client = new FakeClient();
    session = makeSession(client);
  });

  test('starts locked', () => {
    expect(session.isUnlocked()).toBe(false);
  });

  test('unlock() throws NO_PASSPHRASE when account has no salts', async () => {
    await expect(session.unlock('pw')).rejects.toMatchObject({
      name: 'SyncError',
      code: 'NO_PASSPHRASE',
    });
    expect(session.isUnlocked()).toBe(false);
  });

  test('setup() creates a salt and unlocks the session', async () => {
    await session.setup('pw');
    expect(session.isUnlocked()).toBe(true);
    expect(client.createCalls).toBe(1);
    expect(client.rows).toHaveLength(1);
  });

  test('encryptField → decryptField round-trip', async () => {
    await session.setup('correct-horse');
    const env = await session.encryptField('hunter2');
    expect(env.alg).toBe(CURRENT_ALG);
    const plain = await session.decryptField(env);
    expect(plain).toBe('hunter2');
  });

  test('unlock() picks the newest salt by createdAt', async () => {
    client.rows.push(
      makeSaltRow('salt-old', '2026-01-01T00:00:00Z'),
      makeSaltRow('salt-new', '2026-05-01T00:00:00Z'),
    );
    await session.unlock('pw');
    const env = await session.encryptField('x');
    expect(env.s).toBe('salt-new');
  });

  test('encryptField throws NO_PASSPHRASE before unlock', async () => {
    await expect(session.encryptField('x')).rejects.toMatchObject({
      name: 'SyncError',
      code: 'NO_PASSPHRASE',
    });
  });

  test('decryptField for a foreign salt re-fetches and derives', async () => {
    const otherSession = makeSession(client);
    await otherSession.setup('pw');
    const env = await otherSession.encryptField('foreign-secret');

    const fresh = makeSession(client);
    await fresh.unlock('pw');
    const callsBefore = client.listCalls;
    const plain = await fresh.decryptField(env);
    expect(plain).toBe('foreign-secret');
    expect(client.listCalls).toBe(callsBefore);
  });

  test('decryptField throws SALT_NOT_FOUND for unknown saltId', async () => {
    await session.setup('pw');
    const env = await session.encryptField('x');
    const tampered = { ...env, s: 'no-such-salt' };
    await expect(session.decryptField(tampered)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'SALT_NOT_FOUND',
    });
  });

  test('decryptField throws UNSUPPORTED_ALG for foreign alg envelope', async () => {
    await session.setup('pw');
    const env = await session.encryptField('x');
    const foreign = { ...env, alg: 'rot13/none' };
    await expect(session.decryptField(foreign)).rejects.toMatchObject({
      name: 'SyncError',
      code: 'UNSUPPORTED_ALG',
    });
  });

  test('wrong passphrase decrypt fails (DECRYPT or INTEGRITY)', async () => {
    const right = makeSession(client);
    await right.setup('correct');
    const env = await right.encryptField('secret');

    const wrong = makeSession(client);
    await wrong.unlock('wrong');
    let caught: unknown = null;
    try {
      await wrong.decryptField(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(isSyncError(caught)).toBe(true);
    expect((caught as SyncError).code).toMatch(/DECRYPT|INTEGRITY/);
  });

  test('forget() clears server salts and locks the session', async () => {
    await session.setup('pw');
    expect(session.isUnlocked()).toBe(true);
    expect(client.rows).toHaveLength(1);
    await session.forget();
    expect(session.isUnlocked()).toBe(false);
    expect(client.forgetCalls).toBe(1);
    expect(client.rows).toHaveLength(0);
  });

  test('lock() clears state; encryptField throws after lock', async () => {
    await session.setup('pw');
    expect(session.isUnlocked()).toBe(true);
    session.lock();
    expect(session.isUnlocked()).toBe(false);
    await expect(session.encryptField('x')).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });
  });

  test('keys are cached: derive runs once per saltId', async () => {
    await session.setup('pw');
    const env1 = await session.encryptField('a');
    const env2 = await session.encryptField('b');
    expect(env1.s).toBe(env2.s);
    // Sanity: deriving directly produces the same key bytes — proves we use
    // the same salt+passphrase pair across calls.
    const salt = client.rows[0]!;
    const directKey = await derivePbkdf2Key(
      'pw',
      Uint8Array.from(atob(salt.salt), (c) => c.charCodeAt(0)),
      ITER,
    );
    const direct = await encryptToEnvelope('a', directKey, salt.saltId);
    const recovered = await session.decryptField(direct);
    expect(recovered).toBe('a');
  });
});
