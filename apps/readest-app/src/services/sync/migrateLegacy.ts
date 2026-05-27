import { partialMD5 } from '@/utils/md5';
import { uniqueId } from '@/utils/misc';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import type { EnvConfigType } from '@/services/environment';
import type { BaseDir } from '@/types/system';

/**
 * Shared shape for legacy flat-path records that predate replica sync:
 * a flat `<filename>` path under the kind's base dir, no `contentId`
 * or `bundleDir`. The migration rehashes the bytes into a per-record
 * `<bundleDir>/<filename>` layout so the kind starts syncing without
 * forcing the user to re-import.
 */
interface LegacyReplicaRecord {
  id: string;
  name: string;
  path: string;
  contentId?: string;
  bundleDir?: string;
  byteSize?: number;
  reincarnation?: string;
  blobUrl?: string;
  loaded?: boolean;
  error?: string;
}

export interface MigrateLegacyReplicasDeps<T extends LegacyReplicaRecord> {
  /** Replica kind name — passed to `queueReplicaBinaryUpload`. */
  kind: string;
  /** App-service base dir for the kind (`'Fonts'`, `'Images'`, ...). */
  baseDir: BaseDir;
  /**
   * Snapshot of legacy candidates: live records with no `contentId` or
   * `bundleDir` and a flat `path`. The caller filters in-store; this
   * helper is purely the on-disk + publish side of the migration.
   */
  getCandidates: () => T[];
  /** `md5(partialMd5 ‖ byteSize ‖ filename)` — same recipe per kind. */
  computeContentId: (partialMd5: string, byteSize: number, filename: string) => string;
  /** Patch the in-memory record with the migrated fields. */
  updateRecord: (id: string, next: T) => void;
  /** Persist the kind's settings entry post-migration. */
  saveStore: (envConfig: EnvConfigType) => Promise<void>;
  /** Publish the now-syncable record to the replica row. */
  publishUpsert: (record: T) => void;
}

/**
 * One-time migration: rehash legacy flat-path records (imported before
 * replica sync shipped) into the per-bundle layout so they sync
 * across devices without forcing the user to re-import.
 *
 * For each candidate:
 *   1. Read bytes from `<baseDir>/<filename>`.
 *   2. Compute partialMD5 + size + filename → contentId.
 *   3. Mint `bundleDir = uniqueId()`; copy the file to
 *      `<baseDir>/<bundleDir>/<filename>` and remove the flat-path one.
 *   4. Patch the in-memory record (contentId, bundleDir, byteSize,
 *      path), persist via `saveStore`, then publish through
 *      `publishUpsert` and queue the binary upload.
 *
 * Idempotent: a record that already carries `contentId` is filtered
 * out upstream by `getCandidates`. If the file is missing on disk,
 * the migration leaves the record untouched. Per-record failures are
 * logged and don't block the rest.
 */
export const migrateLegacyReplicas = async <T extends LegacyReplicaRecord>(
  envConfig: EnvConfigType,
  deps: MigrateLegacyReplicasDeps<T>,
): Promise<void> => {
  const candidates = deps.getCandidates();
  if (candidates.length === 0) return;

  const appService = await envConfig.getAppService();
  const migrated: T[] = [];

  for (const legacy of candidates) {
    try {
      const exists = await appService.exists(legacy.path, deps.baseDir);
      if (!exists) continue;

      const file = await appService.openFile(legacy.path, deps.baseDir);
      const bytes = await file.arrayBuffer();
      const partialMd5 = await partialMD5(file);
      const byteSize = bytes.byteLength;
      const filename = legacy.path;
      const contentId = deps.computeContentId(partialMd5, byteSize, filename);
      const bundleDir = uniqueId();
      const newPath = `${bundleDir}/${filename}`;

      await appService.createDir(bundleDir, deps.baseDir, true);
      await appService.copyFile(legacy.path, deps.baseDir, newPath, deps.baseDir);
      await appService.deleteFile(legacy.path, deps.baseDir);

      const next: T = {
        ...legacy,
        contentId,
        bundleDir,
        byteSize,
        path: newPath,
        // Force a re-load on next render so the blob URL points at the
        // new on-disk path.
        blobUrl: undefined,
        loaded: false,
        error: undefined,
      };
      deps.updateRecord(legacy.id, next);
      migrated.push(next);
    } catch (err) {
      console.warn(`migrateLegacyReplicas[${deps.kind}]: failed for`, legacy.path, err);
    }
  }

  if (migrated.length === 0) return;

  try {
    await deps.saveStore(envConfig);
  } catch (err) {
    console.warn(`migrateLegacyReplicas[${deps.kind}]: save failed`, err);
  }
  for (const record of migrated) {
    deps.publishUpsert(record);
    void queueReplicaBinaryUpload(deps.kind, record, appService);
  }
};
