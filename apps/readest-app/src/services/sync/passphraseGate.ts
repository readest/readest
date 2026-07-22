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
 * - The entered passphrase is verified against a cipher envelope the
 *   account is known to hold (`verifyWith`, or the sample the pull path
 *   last saw). A wrong one is never accepted: the prompt re-opens with an
 *   error until it verifies or the user cancels.
 * - When the user cancels the modal, ensurePassphraseUnlocked rejects
 *   with `NO_PASSPHRASE`. Callers handle by aborting the sync action
 *   (e.g., refusing to save credentials, falling back to plaintext-only).
 *   A cancel also silences `auto: true` (pull-triggered) requests for the
 *   rest of the run so a declined user isn't re-prompted on every pull;
 *   any user-initiated request clears that.
 *
 * The gate is platform-agnostic — same path on web (ephemeral session)
 * and native (OS keychain). On native, `cryptoSession.tryRestoreFromStore`
 * unlocks from the keychain at boot without re-prompting.
 */
import { isWrongPassphraseError, SyncError } from '@/libs/errors';
import { cryptoSession as defaultCryptoSession } from '@/libs/crypto/session';
import { replicaSyncClient } from '@/libs/replicaSyncClient';
import { isCipherEnvelope } from '@/types/replica';
import { stubTranslation as _ } from '@/utils/misc';
import type { CipherEnvelope } from '@/types/replica';
import type { CryptoSession } from '@/libs/crypto/session';
import type { ReplicaSyncClient } from '@/libs/replicaSyncClient';

export type PassphrasePromptKind = 'unlock' | 'setup';

export interface PassphrasePromptRequest {
  kind: PassphrasePromptKind;
  /** Set on a re-prompt after the previous attempt failed to verify. */
  error?: string;
}

export type PassphrasePrompter = (req: PassphrasePromptRequest) => Promise<string | null>;

/** How long a caller waits for the prompt UI to mount before giving up. */
const PROMPTER_WAIT_MS = 10_000;

let prompter: PassphrasePrompter | null = null;
let dismisser: (() => void) | null = null;
let prompterWaiters: Array<(p: PassphrasePrompter) => void> = [];
let inflight: Promise<void> | null = null;
let declined = false;
let recoveryFailed = false;
/**
 * The most recent cipher envelope the pull path saw for this account. Lets
 * a caller with no envelope of its own still verify a candidate passphrase
 * — notably the Settings → Enter passphrase action, which runs long after
 * the row that carried the ciphertext was applied.
 */
let verificationSample: CipherEnvelope | null = null;

export const setPassphrasePrompter = (p: PassphrasePrompter | null): void => {
  prompter = p;
  if (!p) return;
  const waiters = prompterWaiters;
  prompterWaiters = [];
  for (const resolve of waiters) resolve(p);
};

/**
 * Register the UI's "close the modal" callback. The prompter's promise
 * resolves the moment the user submits, but the modal stays up while we
 * derive the key and trial-decrypt — a wrong passphrase then re-prompts in
 * place instead of the dialog blinking out and back. The gate calls this
 * once the whole unlock cycle is done, however it ended.
 */
export const setPassphraseDismisser = (d: (() => void) | null): void => {
  dismisser = d;
};

const SAMPLE_KEY = 'readest_passphrase_verify_sample_v1';

const safeLocalStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Remember a cipher envelope this account holds, for later verification.
 *
 * Persisted, because the pull that carries the ciphertext only runs on the
 * library / reader routes — without this, the Settings action (a separate
 * route, and a fresh page load on web) would have nothing to check an
 * entered passphrase against. Only ciphertext is written; the plaintext it
 * protects already lives in local settings on this device.
 */
export const rememberVerificationSample = (envelope: CipherEnvelope): void => {
  verificationSample = envelope;
  try {
    safeLocalStorage()?.setItem(SAMPLE_KEY, JSON.stringify(envelope));
  } catch {
    /* ignore quota / private mode */
  }
};

/** Drop the sample — its ciphertext is gone server-side (forgot passphrase). */
export const clearVerificationSample = (): void => {
  verificationSample = null;
  try {
    safeLocalStorage()?.removeItem(SAMPLE_KEY);
  } catch {
    /* ignore */
  }
};

const getVerificationSample = (): CipherEnvelope | undefined => {
  if (verificationSample) return verificationSample;
  try {
    const raw = safeLocalStorage()?.getItem(SAMPLE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isCipherEnvelope(parsed)) return undefined;
    verificationSample = parsed;
    return parsed;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the registered prompter, waiting briefly if the UI hasn't mounted
 * yet. Without the wait, a pull that lands before `PassphrasePrompt`'s
 * registration effect runs throws NO_PASSPHRASE and silently skips the
 * prompt — the "sometimes the popup shows, sometimes it doesn't, so I keep
 * refreshing" symptom.
 */
const waitForPrompter = async (): Promise<PassphrasePrompter> => {
  if (prompter) return prompter;
  return new Promise<PassphrasePrompter>((resolve, reject) => {
    const onReady = (p: PassphrasePrompter) => {
      clearTimeout(timer);
      resolve(p);
    };
    const timer = setTimeout(() => {
      prompterWaiters = prompterWaiters.filter((w) => w !== onReady);
      reject(new SyncError('NO_PASSPHRASE', 'No passphrase prompter registered'));
    }, PROMPTER_WAIT_MS);
    prompterWaiters.push(onReady);
  });
};

export interface EnsureUnlockedDeps {
  session?: CryptoSession;
  client?: Pick<ReplicaSyncClient, 'listReplicaKeys'>;
  /**
   * Cipher envelope used to check the entered passphrase. Defaults to the
   * sample the pull path last recorded.
   */
  verifyWith?: CipherEnvelope;
  /**
   * The session's current passphrase is known-bad (a decrypt failed with an
   * auth-tag mismatch). Drop it — and the copy in the OS keychain — before
   * prompting, instead of returning early on `isUnlocked()`.
   */
  invalidate?: boolean;
  /**
   * Automatic, pull-triggered request. Suppressed for the rest of the run
   * once the user has cancelled a prompt. User-initiated requests (saving a
   * credential, Settings → Enter passphrase) leave this off, and clear the
   * suppression.
   */
  auto?: boolean;
}

/**
 * Resolves once the CryptoSession is unlocked with a passphrase that
 * actually decrypts this account's ciphertext. If unlocked already,
 * resolves immediately. If a prompt is already in flight, awaits the
 * existing one (so concurrent calls don't open multiple modals).
 *
 * Throws `NO_PASSPHRASE` when the user cancels, when a declined `auto`
 * request is suppressed, or when no prompter shows up. Throws other
 * SyncError codes for crypto failures (CRYPTO_UNAVAILABLE, AUTH, ...).
 */
export const ensurePassphraseUnlocked = async (deps: EnsureUnlockedDeps = {}): Promise<void> => {
  const session = deps.session ?? defaultCryptoSession;
  const client = deps.client ?? replicaSyncClient;
  if (deps.auto && declined) {
    throw new SyncError('NO_PASSPHRASE', 'User declined the passphrase prompt this run');
  }
  if (deps.auto && deps.invalidate && recoveryFailed) {
    // One *failed* automatic recovery per run. An account whose rows were
    // encrypted under two different passphrases (two devices raced the first
    // setup) can never satisfy every row at once — without this bound, each
    // pull would throw away the session the previous one just unlocked and
    // prompt again, forever. The Settings action stays available either way.
    throw new SyncError('NO_PASSPHRASE', 'Passphrase recovery already failed this run');
  }
  if (!deps.auto) {
    declined = false;
    recoveryFailed = false;
  }
  if (!deps.invalidate && session.isUnlocked()) return;
  // Checked before invalidating: a prompt that's already up will produce a
  // verified passphrase that serves this caller too, and throwing away the
  // session it is about to unlock would strand it.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      // Inside the IIFE so `inflight` is assigned synchronously above — an
      // await before the assignment would let a second caller slip past the
      // check and open a second modal.
      if (deps.invalidate) await session.invalidatePassphrase();
      const prompt = await waitForPrompter();
      // Decide setup vs unlock by checking whether the server has any
      // salt rows for this user. The gate doesn't try to silently
      // unlock — it always prompts; the kind argument lets the modal
      // render the right copy.
      const rows = await client.listReplicaKeys();
      const kind: PassphrasePromptKind = rows.length === 0 ? 'setup' : 'unlock';
      const verifyWith = deps.verifyWith ?? getVerificationSample();

      let error: string | undefined;
      for (;;) {
        const passphrase = await prompt(error ? { kind, error } : { kind });
        if (passphrase === null || passphrase === '') {
          declined = true;
          throw new SyncError('NO_PASSPHRASE', 'User cancelled the passphrase prompt');
        }
        if (kind === 'setup') {
          await session.setup(passphrase);
          return;
        }
        try {
          await session.unlock(passphrase, verifyWith ? { verifyWith } : {});
          return;
        } catch (err) {
          // A wrong passphrase is the one failure worth retrying — network,
          // auth or missing-WebCrypto errors won't resolve on a second try.
          if (!isWrongPassphraseError(err)) throw err;
          error = _('Incorrect passphrase. Please try again.');
        }
      }
    } catch (err) {
      // Burn the once-per-run recovery budget only on a recovery that
      // actually failed — a successful one, or one that simply joined the
      // prompt another caller had already opened, leaves it intact.
      if (deps.auto && deps.invalidate) recoveryFailed = true;
      throw err;
    } finally {
      inflight = null;
      dismisser?.();
    }
  })();

  return inflight;
};

/** Test seam — clear in-flight + prompter between specs. */
export const __resetPassphraseGateForTests = (): void => {
  prompter = null;
  dismisser = null;
  prompterWaiters = [];
  inflight = null;
  declined = false;
  recoveryFailed = false;
  clearVerificationSample();
};
