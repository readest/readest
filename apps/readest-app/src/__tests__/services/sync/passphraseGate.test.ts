import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CryptoSession } from '@/libs/crypto/session';
import {
  ensurePassphraseUnlocked,
  setPassphrasePrompter,
  __resetPassphraseGateForTests,
} from '@/services/sync/passphraseGate';
import { isSyncError } from '@/libs/errors';
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

describe('ensurePassphraseUnlocked', () => {
  let client: FakeClient;
  let session: CryptoSession;

  beforeEach(() => {
    client = new FakeClient();
    session = new CryptoSession({ client, iterations: ITER });
  });

  afterEach(() => {
    __resetPassphraseGateForTests();
  });

  test('no-op when session is already unlocked', async () => {
    await session.setup('pw');
    const prompter = vi.fn();
    setPassphrasePrompter(prompter);
    await ensurePassphraseUnlocked({ session, client });
    expect(prompter).not.toHaveBeenCalled();
  });

  test('throws NO_PASSPHRASE when no prompter is registered', async () => {
    let caught: unknown = null;
    try {
      await ensurePassphraseUnlocked({ session, client });
    } catch (e) {
      caught = e;
    }
    expect(isSyncError(caught) && caught.code).toBe('NO_PASSPHRASE');
  });

  test('prompts with kind=setup when account has no salt', async () => {
    setPassphrasePrompter(async ({ kind }) => {
      expect(kind).toBe('setup');
      return 'pw';
    });
    await ensurePassphraseUnlocked({ session, client });
    expect(session.isUnlocked()).toBe(true);
    expect(client.rows).toHaveLength(1);
  });

  test('prompts with kind=unlock when account has a salt', async () => {
    // Pre-seed via a different session so this one starts locked.
    const seeder = new CryptoSession({ client, iterations: ITER });
    await seeder.setup('pw');

    setPassphrasePrompter(async ({ kind }) => {
      expect(kind).toBe('unlock');
      return 'pw';
    });
    await ensurePassphraseUnlocked({ session, client });
    expect(session.isUnlocked()).toBe(true);
  });

  test('rejects with NO_PASSPHRASE when user cancels (returns null)', async () => {
    setPassphrasePrompter(async () => null);
    let caught: unknown = null;
    try {
      await ensurePassphraseUnlocked({ session, client });
    } catch (e) {
      caught = e;
    }
    expect(isSyncError(caught) && caught.code).toBe('NO_PASSPHRASE');
    expect(session.isUnlocked()).toBe(false);
  });

  test('coalesces concurrent calls into a single prompt', async () => {
    let calls = 0;
    setPassphrasePrompter(async () => {
      calls += 1;
      return 'pw';
    });
    await Promise.all([
      ensurePassphraseUnlocked({ session, client }),
      ensurePassphraseUnlocked({ session, client }),
      ensurePassphraseUnlocked({ session, client }),
    ]);
    expect(calls).toBe(1);
    expect(session.isUnlocked()).toBe(true);
  });
});
