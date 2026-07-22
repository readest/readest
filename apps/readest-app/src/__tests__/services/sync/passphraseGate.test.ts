import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CryptoSession } from '@/libs/crypto/session';
import {
  ensurePassphraseUnlocked,
  setPassphrasePrompter,
  __resetPassphraseGateForTests,
} from '@/services/sync/passphraseGate';
import { isSyncError } from '@/libs/errors';
import type { CipherEnvelope } from '@/types/replica';
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

  test('throws NO_PASSPHRASE when no prompter ever registers', async () => {
    vi.useFakeTimers();
    try {
      const pending = ensurePassphraseUnlocked({ session, client });
      const caught = pending.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_000);
      const err = await caught;
      expect(isSyncError(err) && err.code).toBe('NO_PASSPHRASE');
    } finally {
      vi.useRealTimers();
    }
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

  test('waits for a prompter that registers after the request', async () => {
    const pending = ensurePassphraseUnlocked({ session, client });
    await Promise.resolve();
    setPassphrasePrompter(async () => 'pw');
    await pending;
    expect(session.isUnlocked()).toBe(true);
  });
});

describe('ensurePassphraseUnlocked — wrong passphrase recovery', () => {
  let client: FakeClient;
  let session: CryptoSession;
  let cipher: CipherEnvelope;

  beforeEach(async () => {
    client = new FakeClient();
    const writer = new CryptoSession({ client, iterations: ITER });
    await writer.setup('correct');
    cipher = await writer.encryptField('secret');
    session = new CryptoSession({ client, iterations: ITER });
  });

  afterEach(() => {
    __resetPassphraseGateForTests();
  });

  test('re-prompts with an error until the passphrase verifies', async () => {
    const seen: (string | undefined)[] = [];
    const answers = ['wrong', 'still-wrong', 'correct'];
    setPassphrasePrompter(async ({ error }) => {
      seen.push(error);
      return answers.shift()!;
    });

    await ensurePassphraseUnlocked({ session, client, verifyWith: cipher });

    expect(session.isUnlocked()).toBe(true);
    expect(await session.decryptField(cipher)).toBe('secret');
    // First prompt is clean; every retry carries the "that was wrong" copy.
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeTruthy();
    expect(seen[2]).toBeTruthy();
  });

  test('cancelling a retry rejects with NO_PASSPHRASE and leaves the session locked', async () => {
    const answers: (string | null)[] = ['wrong', null];
    setPassphrasePrompter(async () => answers.shift()!);

    await expect(
      ensurePassphraseUnlocked({ session, client, verifyWith: cipher }),
    ).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });
    expect(session.isUnlocked()).toBe(false);
  });

  test('invalidate drops a known-bad unlocked session and prompts again', async () => {
    // The Android dead-end: a wrong passphrase was accepted before verification
    // existed, so the session reports unlocked while every decrypt fails.
    await session.unlock('wrong');
    expect(session.isUnlocked()).toBe(true);

    setPassphrasePrompter(async () => 'correct');
    await ensurePassphraseUnlocked({ session, client, verifyWith: cipher, invalidate: true });

    expect(await session.decryptField(cipher)).toBe('secret');
  });

  test('automatic recovery runs once per run, then stays out of the way', async () => {
    await session.unlock('wrong');
    // Answers a wrong passphrase, then cancels the retry — the first recovery
    // ends in failure.
    let call = 0;
    const prompter = vi.fn(async (): Promise<string | null> => (call++ === 0 ? 'nope' : null));
    setPassphrasePrompter(prompter);

    await expect(
      ensurePassphraseUnlocked({
        session,
        client,
        verifyWith: cipher,
        invalidate: true,
        auto: true,
      }),
    ).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });

    // An account whose rows carry ciphers under two different passphrases can
    // never satisfy them all — the next pull must not reopen the modal and
    // wipe the session again.
    prompter.mockClear();
    await expect(
      ensurePassphraseUnlocked({
        session,
        client,
        verifyWith: cipher,
        invalidate: true,
        auto: true,
      }),
    ).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });
    expect(prompter).not.toHaveBeenCalled();
  });

  test('concurrent recovery requests share one prompt', async () => {
    await session.unlock('wrong');
    const prompter = vi.fn(async (): Promise<string | null> => 'correct');
    setPassphrasePrompter(prompter);

    await Promise.all([
      ensurePassphraseUnlocked({ session, client, verifyWith: cipher, invalidate: true }),
      ensurePassphraseUnlocked({ session, client, verifyWith: cipher, invalidate: true }),
    ]);

    // The second request must not invalidate the session the first one just
    // unlocked — it waits for that same prompt instead.
    expect(prompter).toHaveBeenCalledTimes(1);
    expect(session.isUnlocked()).toBe(true);
    expect(await session.decryptField(cipher)).toBe('secret');
  });

  test('auto requests stay quiet after the user cancels, user-initiated ones do not', async () => {
    const prompter = vi.fn(async (): Promise<string | null> => null);
    setPassphrasePrompter(prompter);

    await expect(
      ensurePassphraseUnlocked({ session, client, verifyWith: cipher, auto: true }),
    ).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });
    // A declined user must not be re-prompted by every focus / periodic pull.
    await expect(
      ensurePassphraseUnlocked({ session, client, verifyWith: cipher, auto: true }),
    ).rejects.toMatchObject({ code: 'NO_PASSPHRASE' });
    expect(prompter).toHaveBeenCalledTimes(1);

    // ...but an explicit user action (Settings → Enter passphrase, saving a
    // new credential) always gets its prompt back.
    prompter.mockImplementation(async () => 'correct');
    await ensurePassphraseUnlocked({ session, client, verifyWith: cipher });
    expect(prompter).toHaveBeenCalledTimes(2);
    expect(session.isUnlocked()).toBe(true);
  });
});
