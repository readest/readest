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
   * Returns true iff EVERY filename exists on disk under
   * `<bundleDir>/<filename>` in the kind's base dir. Lets the
   * orchestrator skip the download queue when the binaries from a
   * previous session are still around — refreshing the page or pulling
   * a row whose contentId already maps to a populated bundle is a
   * no-op rather than a re-download.
   */
  filesExist(bundleDir: string, filenames: string[]): Promise<boolean>;
  /**
   * Hydrates the persistence-aware local store from disk before the
   * orchestrator queries findByContentId. Without this, applyRow's
   * subsequent applyRemoteDictionary + auto-persist round-trip
   * overwrites settings.customDictionaries with only the rows we just
   * applied — wiping persisted entries that hadn't yet been pulled
   * into the zustand store by a feature mount.
   */
  hydrateLocalStore?(): Promise<void>;
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

  // Decide bundleDir + display name. If a local entry already maps this
  // contentId, reuse its bundleDir so we don't orphan the previously
  // downloaded binaries; otherwise mint a fresh dir and apply the remote
  // dict to the local store.
  let bundleDir: string;
  let displayName: string;
  if (local) {
    bundleDir = local.bundleDir;
    displayName = local.name;
  } else {
    bundleDir = await deps.createBundleDir();
    const dict = buildLocalDictFromRow(row, bundleDir);
    if (!dict) return;
    deps.applyRemoteDictionary(dict);
    displayName = dict.name;
  }

  if (!row.manifest_jsonb || row.manifest_jsonb.files.length === 0) return;

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
  deps.queueReplicaDownload(row.replica_id, displayName, files, bundleDir, 'Dictionaries');
};

/**
 * Pull-side dispatcher: walks rows since the last cursor advance and
 * applies each via applyRow. Errors per row are isolated — one bad
 * row never blocks the others.
 */
export const pullDictionariesAndApply = async (deps: PullDictionariesDeps): Promise<void> => {
  if (deps.isAuthenticated && !(await deps.isAuthenticated())) return;
  // Hydrate the in-memory dict store from disk BEFORE the apply loop.
  // applyRemoteDictionary auto-persists the in-memory list back to
  // settings, so if the in-memory list isn't already populated, the
  // first save would clobber every persisted dict that we hadn't
  // re-read into memory.
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
