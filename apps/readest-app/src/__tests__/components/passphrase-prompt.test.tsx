import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PassphrasePrompt from '@/components/PassphrasePrompt';
import { CryptoSession } from '@/libs/crypto/session';
import {
  ensurePassphraseUnlocked,
  __resetPassphraseGateForTests,
} from '@/services/sync/passphraseGate';
import type { CipherEnvelope } from '@/types/replica';
import type { ReplicaKeyRow } from '@/libs/replicaSyncClient';

// Stand-in for a non-English UI: only the retry error has a translation. The
// gate can only `stubTranslation` that string (it is a non-React module), so
// the component has to run it through `_()` — if it renders the raw key
// instead, the assertion below catches it.
const WRONG_PASSPHRASE_KEY = 'Incorrect passphrase. Please try again.';
const WRONG_PASSPHRASE_TRANSLATED = '密语不正确，请重试。';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) =>
    key === WRONG_PASSPHRASE_KEY ? WRONG_PASSPHRASE_TRANSLATED : key,
}));

const ITER = 1000;
const PBKDF2_ALG = 'pbkdf2-600k-sha256';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
};

class FakeClient {
  rows: ReplicaKeyRow[] = [];
  async listReplicaKeys(): Promise<ReplicaKeyRow[]> {
    return [...this.rows];
  }
  async createReplicaKey(): Promise<ReplicaKeyRow> {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i;
    const row = {
      saltId: 'salt-1',
      alg: PBKDF2_ALG,
      salt: bytesToBase64(bytes),
      createdAt: '2026-01-01T00:00:00Z',
    };
    this.rows.push(row);
    return row;
  }
  async forgetReplicaKeys(): Promise<void> {
    this.rows = [];
  }
}

const submit = async (passphrase: string) => {
  const input = screen.getByPlaceholderText('Sync passphrase');
  fireEvent.change(input, { target: { value: passphrase } });
  await act(async () => {
    fireEvent.submit(input.closest('form')!);
  });
};

describe('PassphrasePrompt', () => {
  let client: FakeClient;
  let session: CryptoSession;
  let cipher: CipherEnvelope;

  beforeEach(async () => {
    client = new FakeClient();
    const writer = new CryptoSession({ client, iterations: ITER });
    await writer.setup('correct-passphrase');
    cipher = await writer.encryptField('hunter2');
    session = new CryptoSession({ client, iterations: ITER });
  });

  afterEach(() => {
    cleanup();
    __resetPassphraseGateForTests();
  });

  test('a wrong passphrase re-prompts in place, then the right one unlocks and closes', async () => {
    render(<PassphrasePrompt />);
    // Nothing on screen until a caller asks for the passphrase.
    expect(screen.queryByText('Enter sync passphrase')).toBeNull();

    let unlocked = false;
    await act(async () => {
      void ensurePassphraseUnlocked({ session, client, verifyWith: cipher }).then(() => {
        unlocked = true;
      });
    });
    expect(screen.getByText('Enter sync passphrase')).toBeTruthy();

    await submit('wrong-passphrase');

    // The dialog stays up and says why — translated, not the raw key — instead
    // of closing on a passphrase that was never checked (the bug behind issue
    // #5068). The trial decrypt is real WebCrypto, so wait for the re-prompt
    // rather than a microtask.
    await screen.findByText(WRONG_PASSPHRASE_TRANSLATED);
    expect(screen.queryByText(WRONG_PASSPHRASE_KEY)).toBeNull();
    expect(screen.getByText('Enter sync passphrase')).toBeTruthy();
    expect(session.isUnlocked()).toBe(false);
    expect(unlocked).toBe(false);

    await submit('correct-passphrase');
    await waitFor(() => expect(screen.queryByText('Enter sync passphrase')).toBeNull());

    expect(session.isUnlocked()).toBe(true);
    expect(unlocked).toBe(true);
  });

  test('cancelling closes the dialog and leaves the session locked', async () => {
    render(<PassphrasePrompt />);
    let rejected = false;
    await act(async () => {
      void ensurePassphraseUnlocked({ session, client, verifyWith: cipher }).catch(() => {
        rejected = true;
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(rejected).toBe(true);
    expect(session.isUnlocked()).toBe(false);
    expect(screen.queryByText('Enter sync passphrase')).toBeNull();
  });
});
