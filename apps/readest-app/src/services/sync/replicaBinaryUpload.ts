import { transferManager } from '@/services/transferManager';
import { enumerateDictionaryFiles } from './adapters/dictionary';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { AppService } from '@/types/system';
import type { ReplicaTransferFile } from '@/store/transferStore';
import type { ClosableFile } from '@/utils/file';

/**
 * Resolve the on-disk byteSize for one bundle file. Mirrors the
 * bookService.getBookFileSize pattern: openFile + .size + close.
 * On Tauri, openFile streams metadata; .size doesn't read the body.
 */
const resolveByteSize = async (appService: AppService, lfp: string): Promise<number> => {
  const file = await appService.openFile(lfp, 'Dictionaries');
  const size = file.size;
  const closable = file as ClosableFile;
  if (closable && closable.close) {
    await closable.close();
  }
  return size;
};

/**
 * Queue a dictionary's binary files for upload via TransferManager.
 * Reads each file's byteSize once up-front so progress reporting is
 * accurate, then dispatches to the existing replica-transfer pipeline.
 *
 * No-op when:
 *   - the dictionary lacks contentId (legacy bundle, needs rehash)
 *   - TransferManager isn't initialized yet (pre-library mount)
 *
 * Caller is responsible for ordering this AFTER publishDictionaryUpsert
 * so the metadata row exists before the manifest commit fires.
 */
export const queueDictionaryBinaryUpload = async (
  dict: ImportedDictionary,
  appService: AppService,
): Promise<string | null> => {
  if (!dict.contentId) return null;
  if (!transferManager.isReady()) return null;

  const enumerated = enumerateDictionaryFiles(dict);
  if (enumerated.length === 0) return null;

  const files: ReplicaTransferFile[] = await Promise.all(
    enumerated.map(async (f) => ({
      logical: f.logical,
      lfp: f.lfp,
      byteSize: await resolveByteSize(appService, f.lfp),
    })),
  );

  return transferManager.queueReplicaUpload(
    'dictionary',
    dict.contentId,
    dict.name,
    files,
    'Dictionaries',
    { reincarnation: dict.reincarnation },
  );
};
