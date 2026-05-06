import { eventDispatcher } from '@/utils/event';
import { partialMD5 } from '@/utils/md5';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { publishDictionaryManifest } from './replicaPublish';
import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import type { ReplicaTransferFile } from '@/store/transferStore';

interface ReplicaTransferCompleteDetail {
  kind: string;
  replicaId: string;
  reincarnation?: string;
  type: 'upload' | 'download' | 'delete';
  files?: ReplicaTransferFile[];
  filenames?: string[];
}

let started = false;
let appServiceRef: AppService | null = null;
let listener: ((event: CustomEvent) => Promise<void>) | null = null;

const handleReplicaUpload = async (detail: ReplicaTransferCompleteDetail): Promise<void> => {
  if (!detail.files || detail.files.length === 0) return;
  if (!appServiceRef) return;

  try {
    const manifestFiles = await Promise.all(
      detail.files.map(async (f) => {
        const file = await appServiceRef!.openFile(f.lfp, 'Dictionaries');
        const partialMd5 = await partialMD5(file);
        const closable = file as ClosableFile;
        if (closable && closable.close) await closable.close();
        return { filename: f.logical, byteSize: f.byteSize, partialMd5 };
      }),
    );
    await publishDictionaryManifest(detail.replicaId, manifestFiles, detail.reincarnation);
  } catch (err) {
    console.warn('replica-transfer-complete upload handler failed', err);
  }
};

const handleReplicaDownload = (detail: ReplicaTransferCompleteDetail): void => {
  // The pull orchestrator created the local dict with unavailable=true
  // as a placeholder. Now that the binaries are on disk, clear the flag
  // so the provider registry surfaces the dict for lookups.
  try {
    useCustomDictionaryStore.getState().markAvailableByContentId(detail.replicaId);
  } catch (err) {
    console.warn('replica-transfer-complete download handler failed', err);
  }
};

const handleReplicaTransferComplete = async (event: CustomEvent): Promise<void> => {
  const detail = event.detail as ReplicaTransferCompleteDetail | undefined;
  if (!detail) return;
  if (detail.kind !== 'dictionary') return;

  if (detail.type === 'upload') {
    await handleReplicaUpload(detail);
  } else if (detail.type === 'download') {
    handleReplicaDownload(detail);
  }
  // 'delete' is fire-and-forget; no follow-up needed.
};

/**
 * Wires the long-lived `replica-transfer-complete` listener that turns
 * a finished binary upload into a manifest commit (per the upload state
 * machine: binaries first, manifest LAST). Called once from EnvContext
 * after appService boots; idempotent.
 *
 * Callers that subsequently sign in / out shouldn't re-call this — the
 * listener doesn't need to know auth state, and publishDictionaryManifest
 * already gates on the user being authenticated.
 */
export const startReplicaTransferIntegration = (appService: AppService): void => {
  appServiceRef = appService;
  if (started) return;
  started = true;
  listener = handleReplicaTransferComplete;
  eventDispatcher.on('replica-transfer-complete', listener);
};

export const __resetReplicaTransferIntegrationForTests = (): void => {
  if (listener) {
    eventDispatcher.off('replica-transfer-complete', listener);
    listener = null;
  }
  started = false;
  appServiceRef = null;
};
