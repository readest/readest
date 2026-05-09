/**
 * Coordinates the passphrase prompt UI with the CryptoSession.
 *
 * - The UI registers a prompter at app boot via `setPassphrasePrompter`.
 * - Callers about to sync an encrypted field call `ensurePassphraseUnlocked`.
 *   - If the session is already unlocked, returns immediately.
 *   - If the user has an existing salt on the server, the prompter is
 *     called with `{ kind: 'unlock' }` and the entered passphrase is
 *     used to derive the existing key.
 *   - If the server has no salt yet (first encrypted op for the
 *     account), the prompter is called with `{ kind: 'setup' }` and
 *     the entered passphrase mints a fresh salt + key.
 * - When the user cancels the modal, ensurePassphraseUnlocked rejects
 *   with `NO_PASSPHRASE`. Callers handle by aborting the sync action
 *   (e.g., refusing to save credentials, falling back to plaintext-only).
 *
 * The gate is platform-agnostic — same path on web (ephemeral session)
 * and native (also ephemeral until PR 4d wires the keychain). Once 4d
 * lands, the only change is that `cryptoSession.unlock` reads the
 * passphrase from the keychain on subsequent launches without
 * re-prompting.
 */
import { SyncError } from '@/libs/errors';
import { cryptoSession as defaultCryptoSession } from '@/libs/crypto/session';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import type { CryptoSession } from '@/libs/crypto/session';
import type { ReplicaSyncClient } from '@/libs/replicaSyncClient';

export type PassphrasePromptKind = 'unlock' | 'setup';

export interface PassphrasePromptRequest {
  kind: PassphrasePromptKind;
}

export type PassphrasePrompter = (req: PassphrasePromptRequest) => Promise<string | null>;

let prompter: PassphrasePrompter | null = null;
let inflight: Promise<void> | null = null;

export const setPassphrasePrompter = (p: PassphrasePrompter | null): void => {
  prompter = p;
};

interface EnsureUnlockedDeps {
  session?: CryptoSession;
  client?: Pick<ReplicaSyncClient, 'listReplicaKeys'>;
}

/**
 * Resolves once the CryptoSession is unlocked. If unlocked already,
 * resolves immediately. If a prompt is already in flight, awaits the
 * existing one (so concurrent calls don't open multiple modals).
 *
 * Throws `NO_PASSPHRASE` when the user cancels or no prompter has
 * been registered. Throws other SyncError codes for crypto failures
 * (CRYPTO_UNAVAILABLE, AUTH, SERVER, ...).
 */
export const ensurePassphraseUnlocked = async (deps: EnsureUnlockedDeps = {}): Promise<void> => {
  const session = deps.session ?? defaultCryptoSession;
  const client = deps.client ?? replicaSyncClient;
  if (session.isUnlocked()) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      if (!prompter) {
        throw new SyncError('NO_PASSPHRASE', 'No passphrase prompter registered');
      }
      // Decide setup vs unlock by checking whether the server has any
      // salt rows for this user. The gate doesn't try to silently
      // unlock — it always prompts; the kind argument lets the modal
      // render the right copy.
      const rows = await client.listReplicaKeys();
      const kind: PassphrasePromptKind = rows.length === 0 ? 'setup' : 'unlock';

      const passphrase = await prompter({ kind });
      if (passphrase === null || passphrase === '') {
        throw new SyncError('NO_PASSPHRASE', 'User cancelled the passphrase prompt');
      }

      if (kind === 'setup') {
        await session.setup(passphrase);
      } else {
        await session.unlock(passphrase);
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
};

/** Test seam — clear in-flight + prompter between specs. */
export const __resetPassphraseGateForTests = (): void => {
  prompter = null;
  inflight = null;
};
