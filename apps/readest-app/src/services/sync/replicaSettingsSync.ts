/**
 * Settings publish/apply orchestration. Sits between useSettingsStore
 * and the replica-sync pipeline so per-field LWW works on bundled
 * SystemSettings preferences.
 *
 * Push side: `publishSettingsIfChanged(settings)` runs after every
 * settingsStore save. It walks the whitelist, diffs against the
 * snapshot, and emits a single replica upsert with only the changed
 * fields. Encrypted paths use a SHA-256 hash of the value as the
 * snapshot (persisted in localStorage so refresh-after-credential-set
 * doesn't re-fire the prompt). When the diff includes a new
 * non-empty encrypted value AND the CryptoSession is locked, we
 * proactively trigger the passphrase gate — that's the moment the
 * user is opting into encrypted-credential sync.
 *
 * Pull side: `applyRemoteSettings(record)` merges a remote partial
 * into useSettingsStore, persists, and updates both snapshots so the
 * post-save publish hook sees no diff and we don't echo the remote
 * update back at the server.
 *
 * Users who never use credential-bearing features (kosync, readwise,
 * hardcover, OPDS-with-creds) never see the passphrase prompt: every
 * encrypted path's snapshot is empty / matches "" so the diff doesn't
 * include them.
 */
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { publishReplicaUpsert } from '@/services/sync/replicaPublish';
import {
  SETTINGS_ENCRYPTED_FIELDS,
  SETTINGS_KIND,
  SETTINGS_REPLICA_ID,
  SETTINGS_WHITELIST,
  readPath,
  writePath,
  type SettingsRemoteRecord,
} from '@/services/sync/adapters/settings';
import { cryptoSession } from '@/libs/crypto/session';
import { ensurePassphraseUnlocked } from '@/services/sync/passphraseGate';

const ENCRYPTED_PATHS: ReadonlySet<string> = new Set(SETTINGS_ENCRYPTED_FIELDS);

const HASH_KEY_PREFIX = 'readest_settings_pushed_hash_v1:';
const CIPHER_KEY = 'readest_settings_last_seen_cipher_v1';

/**
 * In-memory snapshot for plaintext (non-encrypted) whitelisted paths.
 * Resets on tab close — the worst case is a redundant publish on the
 * next save, which is harmless (server-side per-field LWW dedupes).
 */
const lastPublishedFields = new Map<string, unknown>();

const equalShallow = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
};

const isMeaningful = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.length > 0;
  return true;
};

const sha256Hex = async (value: unknown): Promise<string> => {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // SSR / test env without WebCrypto: fall back to the raw string.
    // The diff still works (just no privacy benefit), and the only
    // place we'd compare against persisted hashes is in a real browser.
    return str;
  }
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
};

const safeLocalStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

const getStoredEncryptedHash = (path: string): string | null => {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    return ls.getItem(HASH_KEY_PREFIX + path);
  } catch {
    return null;
  }
};

const setStoredEncryptedHash = (path: string, hash: string): void => {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(HASH_KEY_PREFIX + path, hash);
  } catch {
    /* ignore quota / private mode */
  }
};

/**
 * Auto-recovery hook for the orphaned-cipher case: when the orchestrator
 * tells us a row's cipher referenced a saltId that's no longer in
 * `replica_keys` (server-side reset out of band), clear the published
 * hash for those paths. The next saveSettings will see the local
 * plaintext as "never published" → re-encrypts under the current
 * (post-reset) salt → overwrites the orphan cipher on the server.
 *
 * Safe no-op when the path isn't tracked or localStorage is
 * unavailable.
 */
export const clearStoredEncryptedHashes = (paths: readonly string[]): void => {
  const ls = safeLocalStorage();
  if (!ls) return;
  for (const path of paths) {
    try {
      ls.removeItem(HASH_KEY_PREFIX + path);
    } catch {
      /* ignore */
    }
  }
};

export const getStoredLastSeenCipher = (): Record<string, string> => {
  const ls = safeLocalStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(CIPHER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const setStoredLastSeenCipher = (val: Record<string, string>): void => {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(CIPHER_KEY, JSON.stringify(val));
  } catch {
    /* ignore */
  }
};

export const publishSettingsIfChanged = async (settings: SystemSettings): Promise<void> => {
  // Pass 1: figure out what's changed. Plaintext paths use the
  // in-memory snapshot; encrypted paths compare against the
  // persisted SHA-256 hash so refresh-after-credential-set doesn't
  // mistake a re-load for a fresh change.
  const plainChanged: Record<string, unknown> = {};
  const encryptedChanged: Array<{ path: string; value: unknown; hash: string }> = [];
  let hasNewEncryptedContent = false;

  for (const path of SETTINGS_WHITELIST) {
    const current = readPath(settings, path);
    if (current === undefined) continue;

    if (ENCRYPTED_PATHS.has(path)) {
      // Skip empty / cleared credentials entirely — there's nothing
      // useful to encrypt and pushing a plaintext "" would make the
      // server-side schema mix cipher envelopes with bare empty
      // strings for the same field. Local-clear stays local.
      if (!isMeaningful(current)) continue;
      const currentHash = await sha256Hex(current);
      if (currentHash === getStoredEncryptedHash(path)) continue;
      encryptedChanged.push({ path, value: current, hash: currentHash });
      hasNewEncryptedContent = true;
    } else {
      const previous = lastPublishedFields.get(path);
      if (equalShallow(current, previous)) continue;
      plainChanged[path] = current;
      lastPublishedFields.set(path, current);
    }
  }

  if (Object.keys(plainChanged).length === 0 && encryptedChanged.length === 0) return;

  // Proactive prompt: only fire when the user has actually entered a
  // meaningful encrypted value (not just blanked out) AND we don't
  // have an unlocked session to encrypt it. This is the user's first
  // moment of opting into credential sync — show the modal.
  // Plaintext-only changes never trigger the prompt.
  if (hasNewEncryptedContent && !cryptoSession.isUnlocked()) {
    try {
      await ensurePassphraseUnlocked();
    } catch {
      // User cancelled. We still proceed with the publish below —
      // plaintext paths sync, encrypted paths get dropped on the
      // wire by the middleware. We deliberately do NOT update the
      // stored hash for encrypted paths in this case, so the next
      // save retries the prompt.
    }
  }

  // Build the patch and fire one upsert.
  const patch: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(plainChanged)) {
    writePath(patch, path, value);
  }
  for (const { path, value } of encryptedChanged) {
    writePath(patch, path, value);
  }
  const record: SettingsRemoteRecord = {
    name: 'singleton',
    patch: patch as Partial<SystemSettings>,
  };
  void publishReplicaUpsert(SETTINGS_KIND, record, SETTINGS_REPLICA_ID);

  // Persist hashes for encrypted paths only when the session is
  // unlocked (the publish actually ships their values). Otherwise
  // the middleware drops them on the wire and we want the next save
  // to retry — so leave the stored hash stale.
  if (cryptoSession.isUnlocked()) {
    for (const { path, hash } of encryptedChanged) {
      setStoredEncryptedHash(path, hash);
    }
  }
};

/**
 * Merge a remote settings patch into the local store, persist it to
 * disk, and update both the in-memory plaintext snapshot AND the
 * persisted encrypted-hash snapshot so the post-save publish hook
 * doesn't echo the change back at the server. Also persists the
 * cipher fingerprint the orchestrator captured so the next pull
 * doesn't re-prompt for unchanged ciphers.
 */
export const applyRemoteSettings = (
  envConfig: EnvConfigType,
  record: SettingsRemoteRecord,
): void => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();

  // Persist cipher fingerprint regardless of patch content — the
  // orchestrator may attach a fingerprint update for fields that
  // were already in sync but whose ciphers rotated server-side.
  if (record.lastSeenCipher && Object.keys(record.lastSeenCipher).length > 0) {
    setStoredLastSeenCipher(record.lastSeenCipher);
  }

  if (!settings || Object.keys(record.patch).length === 0) return;

  // Mark the incoming values as "already published" so the
  // post-save publish hook sees no diff and stays quiet.
  for (const path of SETTINGS_WHITELIST) {
    const v = readPath(record.patch, path);
    if (v === undefined) continue;
    if (ENCRYPTED_PATHS.has(path)) {
      // Stored hash mirrors the just-applied plaintext.
      void sha256Hex(v).then((h) => setStoredEncryptedHash(path, h));
    } else {
      lastPublishedFields.set(path, v);
    }
  }

  const merged: SystemSettings = mergeSettings(settings, record.patch);
  setSettings(merged);
  saveSettings(envConfig, merged);
};

const mergeSettings = (current: SystemSettings, patch: Partial<SystemSettings>): SystemSettings => {
  // Top-level shallow merge plus single-level deep merges for the
  // nested groups the whitelist touches. If a future whitelist entry
  // points into a new top-level group, add the corresponding deep
  // merge here.
  const out: SystemSettings = { ...current, ...patch };
  if (patch.globalViewSettings) {
    out.globalViewSettings = { ...current.globalViewSettings, ...patch.globalViewSettings };
  }
  if (patch.globalReadSettings) {
    out.globalReadSettings = { ...current.globalReadSettings, ...patch.globalReadSettings };
  }
  if (patch.kosync) {
    out.kosync = { ...current.kosync, ...patch.kosync };
  }
  if (patch.readwise) {
    out.readwise = { ...current.readwise, ...patch.readwise };
  }
  if (patch.hardcover) {
    out.hardcover = { ...current.hardcover, ...patch.hardcover };
  }
  return out;
};

/**
 * Subscribe to settingsStore changes and run publishSettingsIfChanged
 * on every settings mutation. The diff inside the helper short-circuits
 * when no whitelisted field changed, so subscribing to the broad
 * "any state changed" feed is cheap. Reference-equality check on
 * `settings` filters out unrelated mutations (dialog open/close,
 * activeSettingsItemId, etc.) before we even hit the diff.
 *
 * Idempotent — second call is a no-op. Mount once at the Providers
 * root.
 */
let unsubscribe: (() => void) | null = null;
export const initSettingsSync = (): void => {
  if (unsubscribe) return;
  unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (state.settings && state.settings !== prev?.settings) {
      void publishSettingsIfChanged(state.settings);
    }
  });
};

/** Test seam — drop the snapshot + subscription between specs. */
export const __resetSettingsSyncForTests = (): void => {
  lastPublishedFields.clear();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  const ls = safeLocalStorage();
  if (ls) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && (k.startsWith(HASH_KEY_PREFIX) || k === CIPHER_KEY)) keys.push(k);
      }
      for (const k of keys) ls.removeItem(k);
    } catch {
      /* ignore */
    }
  }
};
