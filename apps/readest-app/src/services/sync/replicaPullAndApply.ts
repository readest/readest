import { isReplicaRowAlive } from '@/libs/replicaInterpret';
import type { ReplicaRow } from '@/types/replica';
import type { ReplicaTransferFile } from '@/store/transferStore';
import type { BaseDir } from '@/types/system';
import type { ReplicaAdapter } from './replicaRegistry';
import {
  captureCipherTexts,
  cipherTextsChanged,
  collectDecryptSuccess,
  decryptRowFields,
} from './replicaCryptoMiddleware';
import { ensurePassphraseUnlocked } from './passphraseGate';
import { cryptoSession } from '@/libs/crypto/session';

export interface ReplicaLocalRecord {
  /**
   * Per-record on-disk directory under the kind's base. Required for
   * sync-era records; legacy entries (created before replica sync) may
   * have it unset and the orchestrator treats them as non-syncable.
   */
  bundleDir?: string;
  name: string;
  deletedAt?: number;
  /**
   * Per-field cipher fingerprint of the last successfully-decrypted
   * pull. Used to skip the passphrase prompt when nothing's changed
   * since last apply. See replicaCryptoMiddleware.captureCipherTexts.
   */
  lastSeenCipher?: Record<string, string>;
}

export interface PullAndApplyDeps<T extends ReplicaLocalRecord> {
  /** Replica adapter for this kind. Provides unpackRow + binary base dir. */
  adapter: ReplicaAdapter<T>;
  /** Pulls rows for this kind. Boot caller passes since=null for full sync. */
  pull(): Promise<ReplicaRow[]>;
  /** Looks up an existing local record by its cross-device contentId. */
  findByContentId(contentId: string): T | undefined;
  /** Adds a remote-sourced record to the local store WITHOUT republishing. */
  applyRemote(record: T): void;
  /**
   * Tombstones the local entry whose contentId matches. Implementer
   * looks up by contentId and removes it from the local store, but
   * skips re-publishing the tombstone — the row is already tombstoned
   * server-side; we just observed that fact.
   */
  softDeleteByContentId(contentId: string): void;
  /**
   * Mints a fresh local bundleDir, creates the directory on disk under
   * the kind's base dir, returns the directory name (relative).
   */
  createBundleDir(): Promise<string>;
  /**
   * Hands the manifest's binary files off to TransferManager for
   * download. Returns the transfer id (or null if the queue isn't
   * ready). Caller arguments mirror transferManager.queueReplicaDownload.
   */
  queueReplicaDownload(
    contentId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    bundleDir: string,
    base: BaseDir,
  ): string | null;
  /**
   * Returns true iff EVERY filename exists on disk under
   * `<bundleDir>/<filename>` in the kind's base dir. Lets the
   * orchestrator skip the download queue when the binaries from a
   * previous session are still around.
   */
  filesExist(bundleDir: string, filenames: string[]): Promise<boolean>;
  /**
   * Hydrates the local store from disk before the orchestrator queries
   * findByContentId. Without this, applyRemote's auto-persist round-
   * trip overwrites persisted entries that hadn't yet been pulled into
   * the in-memory store by a feature mount.
   */
  hydrateLocalStore?(): Promise<void>;
  /**
   * Reconciliation hook for "server has the row but no manifest, and
   * we're the device with the local binaries". The orchestrator
   * invokes this when applyRow finds an alive row with empty
   * `manifest_jsonb` AND a matching local record. Implementation
   * should fan out to the binary-upload pipeline (typically
   * `queueReplicaBinaryUpload(kind, record, appService)`), which in
   * turn fires `replica-transfer-complete` and commits the manifest.
   * Without this, transient upload failures or "TM not ready at
   * import time" leave the server row stuck with manifest_jsonb=null
   * forever — a refresh wouldn't recover it.
   */
  queueLocalBinaryUpload?(record: T): Promise<void>;
  /**
   * Optional auth precheck. When provided and resolves to false, the
   * orchestrator skips the entire pull (no network call, no warnings).
   */
  isAuthenticated?(): Promise<boolean>;
}

const MANIFEST_FILE_TO_TRANSFER = (
  filename: string,
  byteSize: number,
  bundleDir: string,
): ReplicaTransferFile => ({
  logical: filename,
  lfp: `${bundleDir}/${filename}`,
  byteSize,
});

const applyRow = async <T extends ReplicaLocalRecord>(
  row: ReplicaRow,
  deps: PullAndApplyDeps<T>,
): Promise<void> => {
  const local = deps.findByContentId(row.replica_id);

  // Decrypt encrypted-field cipher payloads in place so unpackRow sees
  // plaintext. The prompt-decision heuristic compares the row's
  // incoming ciphers against the local record's last-seen-cipher
  // fingerprint:
  //   * fingerprint matches → we already have the plaintext for this
  //     exact ciphertext; skip the prompt + decrypt entirely
  //   * fingerprint differs (or local has no fingerprint yet) AND
  //     session is locked → prompt the gate so we can decrypt the new
  //     value (covers fresh device + password rotation on Device A)
  //   * session already unlocked → just decrypt; no prompt
  // Cancel / failure leaves the field absent; the store's applyRemote
  // merge preserves any local plaintext copy.
  const encryptedFields = deps.adapter.encryptedFields;
  const beforeDecrypt = captureCipherTexts(row.fields_jsonb, encryptedFields);
  const localLastSeen = local?.lastSeenCipher;

  const needsPrompt =
    !cryptoSession.isUnlocked() &&
    Object.keys(beforeDecrypt).length > 0 &&
    cipherTextsChanged(beforeDecrypt, localLastSeen);
  const onLocked = needsPrompt ? () => ensurePassphraseUnlocked() : undefined;
  await decryptRowFields(row.fields_jsonb, encryptedFields, undefined, onLocked);

  // Build the lastSeenCipher fingerprint to attach to the unpacked
  // record. Only fields whose decrypt succeeded contribute — a failed
  // decrypt leaves the previous fingerprint in place so we'll re-try
  // (and re-prompt) on the next pull.
  const decryptedThisRound = collectDecryptSuccess(row.fields_jsonb, beforeDecrypt);
  const mergedLastSeen =
    Object.keys(decryptedThisRound).length > 0 || localLastSeen
      ? { ...(localLastSeen ?? {}), ...decryptedThisRound }
      : undefined;

  const alive = isReplicaRowAlive(row);

  if (!alive) {
    if (local && !local.deletedAt) {
      deps.softDeleteByContentId(row.replica_id);
    }
    return;
  }

  // Decide bundleDir + display name. If a local entry already maps this
  // contentId, reuse its bundleDir so we don't orphan the previously
  // downloaded binaries; otherwise mint a fresh dir and apply the remote
  // record to the local store. Legacy binary-kind records (pre-replica-
  // sync) may carry no bundleDir — skip them; they aren't sync-eligible.
  // Metadata-only kinds (no `binary` capability, e.g. opds_catalog) have
  // no on-disk anchor at all, so the bundleDir requirement is dropped.
  const needsBundleDir = !!deps.adapter.binary;
  let bundleDir: string;
  let displayName: string;
  if (local) {
    if (needsBundleDir && !local.bundleDir) return;
    bundleDir = local.bundleDir ?? '';
    displayName = deps.adapter.getDisplayName?.(local) ?? local.name;
    // For metadata-only kinds, always re-apply the unpacked row so
    // per-field updates merge into the local copy: renames pushed
    // from another device, newly-decrypted credentials that weren't
    // available on the previous pull (session was locked then), etc.
    // The store's applyRemote merge preserves identity-stable local
    // state. Binary kinds keep the skip-rebuild semantic so we don't
    // re-download files we already have.
    if (!needsBundleDir) {
      const record = deps.adapter.unpackRow(row, bundleDir);
      if (record) {
        if (mergedLastSeen) record.lastSeenCipher = mergedLastSeen;
        deps.applyRemote(record);
      }
    }
  } else {
    bundleDir = needsBundleDir ? await deps.createBundleDir() : '';
    const record = deps.adapter.unpackRow(row, bundleDir);
    if (!record) return;
    if (mergedLastSeen) record.lastSeenCipher = mergedLastSeen;
    deps.applyRemote(record);
    displayName = deps.adapter.getDisplayName?.(record) ?? record.name;
  }

  // Metadata-only kinds: nothing more to do. The orchestrator's manifest
  // / binary-download path is a no-op for them.
  if (!needsBundleDir) return;

  if (!row.manifest_jsonb || row.manifest_jsonb.files.length === 0) {
    // Server row has no manifest yet — typically the device that
    // wrote the metadata never finished the binary upload (TM wasn't
    // ready, transient failure, app close mid-upload). If we're the
    // device with the local copy, push the binaries now so the
    // manifest commits via replica-transfer-complete.
    if (local && deps.queueLocalBinaryUpload) {
      await deps.queueLocalBinaryUpload(local);
    }
    return;
  }
  if (!deps.adapter.binary) return;

  // Skip the download queue if every manifest file is already on disk
  // under the resolved bundle dir. Refresh-the-page is a no-op rather
  // than a re-download; partial-download recovery still queues because
  // some files would be missing.
  const filenames = row.manifest_jsonb.files.map((f) => f.filename);
  const allPresent = await deps.filesExist(bundleDir, filenames);
  if (allPresent) return;

  const files = row.manifest_jsonb.files.map((f) =>
    MANIFEST_FILE_TO_TRANSFER(f.filename, f.byteSize, bundleDir),
  );
  deps.queueReplicaDownload(
    row.replica_id,
    displayName,
    files,
    bundleDir,
    deps.adapter.binary.localBaseDir,
  );
};

/**
 * Generic pull-side dispatcher for any replica kind. Walks rows since
 * the last cursor advance and applies each via applyRow. Errors per
 * row are isolated — one bad row never blocks the others.
 *
 * The dictionary adapter and (future) font / texture adapters share
 * this orchestrator; per-kind translation lives entirely in the
 * adapter's unpackRow + binary capability.
 */
export const replicaPullAndApply = async <T extends ReplicaLocalRecord>(
  deps: PullAndApplyDeps<T>,
): Promise<void> => {
  if (deps.isAuthenticated && !(await deps.isAuthenticated())) return;
  if (deps.hydrateLocalStore) {
    await deps.hydrateLocalStore();
  }
  const rows = await deps.pull();
  for (const row of rows) {
    try {
      await applyRow(row, deps);
    } catch (err) {
      console.warn('replica pull row apply failed', { replicaId: row.replica_id, err });
    }
  }
};
