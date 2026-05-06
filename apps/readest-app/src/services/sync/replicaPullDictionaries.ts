import { isReplicaRowAlive } from '@/libs/replicaInterpret';
import type { ReplicaRow } from '@/types/replica';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { ReplicaTransferFile } from '@/store/transferStore';
import type { BaseDir } from '@/types/system';
import { buildLocalDictFromRow } from './replicaDictionaryApply';

export interface PullDictionariesDeps {
  /** Pulls dictionary rows since the last cursor advance. */
  pull(): Promise<ReplicaRow[]>;
  /** Looks up an existing local dict by its cross-device contentId. */
  findByContentId(contentId: string): ImportedDictionary | undefined;
  /** Adds a remote-sourced dict to the local store WITHOUT republishing. */
  applyRemoteDictionary(dict: ImportedDictionary): void;
  /**
   * Tombstones the local entry whose contentId matches. Implementer
   * looks up by contentId, calls removeDictionary on the local store,
   * but skips publishDictionaryDelete (the row is already tombstoned
   * server-side; we just observed that fact).
   */
  softDeleteByContentId(contentId: string): void;
  /**
   * Mints a fresh local bundleDir, creates the directory on disk under
   * the 'Dictionaries' base dir, returns the directory name (relative).
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
   * Optional auth precheck. When provided and resolves to false, the
   * orchestrator skips the entire pull (no network call, no warnings).
   * Lets the boot site avoid spamming "Not authenticated" errors when
   * the user is signed out but a prior session left a deviceId behind.
   */
  isAuthenticated?(): Promise<boolean>;
}

const MANIFEST_FILE_TO_TRANSFER = (
  filename: string,
  byteSize: number,
  bundleDir: string,
): ReplicaTransferFile => ({
  logical: filename,
  // Local file path under the 'Dictionaries' base — TransferManager
  // resolves it via appService for the actual download IO.
  lfp: `${bundleDir}/${filename}`,
  byteSize,
});

const applyRow = async (row: ReplicaRow, deps: PullDictionariesDeps): Promise<void> => {
  const local = deps.findByContentId(row.replica_id);
  const alive = isReplicaRowAlive(row);

  if (!alive) {
    if (local && !local.deletedAt) {
      deps.softDeleteByContentId(row.replica_id);
    }
    return;
  }

  if (local) {
    // Already present locally. Field-level merge (rename, lang, etc.)
    // and revival of soft-deleted-locally entries are deferred to a
    // follow-up slice — for v1 the most important case is "row from
    // another device, never seen here before".
    return;
  }

  const bundleDir = await deps.createBundleDir();
  const dict = buildLocalDictFromRow(row, bundleDir);
  if (!dict) return;

  deps.applyRemoteDictionary(dict);

  if (row.manifest_jsonb && row.manifest_jsonb.files.length > 0) {
    const files = row.manifest_jsonb.files.map((f) =>
      MANIFEST_FILE_TO_TRANSFER(f.filename, f.byteSize, bundleDir),
    );
    deps.queueReplicaDownload(row.replica_id, dict.name, files, bundleDir, 'Dictionaries');
  }
};

/**
 * Pull-side dispatcher: walks rows since the last cursor advance and
 * applies each via applyRow. Errors per row are isolated — one bad
 * row never blocks the others.
 */
export const pullDictionariesAndApply = async (deps: PullDictionariesDeps): Promise<void> => {
  if (deps.isAuthenticated && !(await deps.isAuthenticated())) return;
  const rows = await deps.pull();
  for (const row of rows) {
    try {
      await applyRow(row, deps);
    } catch (err) {
      console.warn('replica pull row apply failed', { replicaId: row.replica_id, err });
    }
  }
};
