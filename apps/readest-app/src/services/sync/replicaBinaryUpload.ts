import { transferManager } from '@/services/transferManager';
import { getReplicaAdapter, type BinaryCapability } from './replicaRegistry';
import { isSyncCategoryEnabled } from './syncCategories';
import { getAccessToken } from '@/utils/access';
import type { AppService, BaseDir } from '@/types/system';
import type { ReplicaTransferFile } from '@/store/transferStore';
import type { ClosableFile } from '@/utils/file';

/**
 * Open the file just to read its `.size` (Tauri streams metadata; the
 * body isn't read). Used as a fallback when the adapter's
 * enumerateFiles doesn't carry a byteSize — e.g. the dictionary
 * adapter, which doesn't track per-file sizes on its records.
 */
const resolveByteSize = async (
  appService: AppService,
  lfp: string,
  base: BaseDir,
): Promise<number> => {
  const file = await appService.openFile(lfp, base);
  const size = file.size;
  const closable = file as ClosableFile;
  if (closable && closable.close) {
    await closable.close();
  }
  return size;
};

interface ReplicaBinaryRecord {
  contentId?: string;
  name: string;
  reincarnation?: string;
}

/**
 * Shared gate for binary transfers: the record's binary capability, or
 * null when the kind's sync category is off, the record is legacy (no
 * contentId), the user is signed out, or TransferManager isn't ready.
 */
const getTransferableBinary = async <T extends ReplicaBinaryRecord>(
  kind: string,
  record: T,
): Promise<BinaryCapability<T> | null> => {
  if (!isSyncCategoryEnabled(kind)) return null;
  if (!record.contentId) return null;
  if (!(await getAccessToken())) return null;
  if (!transferManager.isReady()) return null;
  return getReplicaAdapter<T>(kind)?.binary ?? null;
};

/**
 * Queue a replica's binary files for upload via TransferManager.
 * Generic across kinds — uses the adapter registry to dispatch:
 *   - adapter.binary.enumerateFiles to list the per-record files
 *   - adapter.binary.localBaseDir for the upload base
 *
 * Resolves missing byteSize entries via openFile so progress reporting
 * is accurate. The TransferManager fires `replica-transfer-complete`
 * on success; replicaTransferIntegration converts that into a
 * publishReplicaManifest call (binaries first, manifest last).
 *
 * No-op when:
 *   - the user has turned the matching sync category off in Manage Sync
 *     (`dictionary`, `font`, `texture` — i.e. backgrounds). Skipping
 *     here keeps potentially large bundle uploads from leaving the
 *     device when the user has opted out, and matches the metadata-side
 *     gate already enforced by `publishReplicaUpsert`.
 *   - the record lacks contentId (legacy / unsynced)
 *   - the kind isn't registered or has no binary capability
 *   - TransferManager isn't initialized yet (pre-library mount)
 *
 * Caller is responsible for ordering this AFTER publishReplicaUpsert
 * so the metadata row exists before the manifest commit fires.
 */
export const queueReplicaBinaryUpload = async <T extends ReplicaBinaryRecord>(
  kind: string,
  record: T,
  appService: AppService,
): Promise<string | null> => {
  const binary = await getTransferableBinary<T>(kind, record);
  if (!binary) return null;
  const base = binary.localBaseDir;

  const enumerated = binary.enumerateFiles(record);
  if (enumerated.length === 0) return null;

  const files: ReplicaTransferFile[] = await Promise.all(
    enumerated.map(async (f) => ({
      logical: f.logical,
      lfp: f.lfp,
      byteSize: f.byteSize > 0 ? f.byteSize : await resolveByteSize(appService, f.lfp, base),
    })),
  );

  return transferManager.queueReplicaUpload(kind, record.contentId!, record.name, files, base, {
    reincarnation: record.reincarnation,
  });
};

/**
 * Fetch a replica's binaries from the cloud on request, for kinds whose
 * adapter sets `downloadOnDemand`. Completion fires the kind's download
 * handler (registered in replicaBootstrap), which activates the record.
 */
export const queueReplicaBinaryDownload = async <T extends ReplicaBinaryRecord>(
  kind: string,
  record: T,
): Promise<string | null> => {
  const binary = await getTransferableBinary<T>(kind, record);
  if (!binary) return null;
  return transferManager.queueReplicaDownload(
    kind,
    record.contentId!,
    record.name,
    binary.enumerateFiles(record),
    binary.localBaseDir,
  );
};

/**
 * Delete a replica's binaries from the cloud. Pair with
 * `publishReplicaDelete`: the tombstone removes the row, this removes the
 * files it pointed at so they stop counting against cloud storage.
 */
export const queueReplicaBinaryDelete = async <T extends ReplicaBinaryRecord>(
  kind: string,
  record: T,
): Promise<string | null> => {
  const binary = await getTransferableBinary<T>(kind, record);
  if (!binary) return null;
  const filenames = binary.enumerateFiles(record).map((f) => f.logical);
  return transferManager.queueReplicaDelete(kind, record.contentId!, record.name, filenames);
};

/**
 * Backwards-compatible alias for the dictionary-specific helper that
 * call sites used before the kind-agnostic refactor.
 */
export const queueDictionaryBinaryUpload = <T extends ReplicaBinaryRecord>(
  dict: T,
  appService: AppService,
): Promise<string | null> => queueReplicaBinaryUpload('dictionary', dict, appService);
