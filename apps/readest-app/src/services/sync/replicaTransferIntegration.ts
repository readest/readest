import { eventDispatcher } from '@/utils/event';
import { partialMD5 } from '@/utils/md5';
import { getReplicaAdapter } from './replicaRegistry';
import { publishReplicaManifest } from './replicaPublish';
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

type DownloadHandler = (replicaId: string) => void;

const downloadHandlers = new Map<string, DownloadHandler>();

/**
 * Per-kind download-completion handler. Called when binary downloads
 * for a replica row finish landing on disk. Each store that participates
 * in replica sync registers one; the dictionary store clears its
 * `unavailable` flag, the font store will activate its FontFace, etc.
 *
 * Calling twice with the same kind throws — defensive against doubly-
 * imported store modules during dev hot-reload.
 */
export const registerReplicaDownloadHandler = (kind: string, handler: DownloadHandler): void => {
  if (downloadHandlers.has(kind)) {
    throw new Error(`Replica download handler for kind="${kind}" is already registered`);
  }
  downloadHandlers.set(kind, handler);
};

let started = false;
let appServiceRef: AppService | null = null;
let listener: ((event: CustomEvent) => Promise<void>) | null = null;

const handleReplicaUpload = async (detail: ReplicaTransferCompleteDetail): Promise<void> => {
  if (!detail.files || detail.files.length === 0) return;
  if (!appServiceRef) return;
  const adapter = getReplicaAdapter(detail.kind);
  if (!adapter?.binary) return;
  const base = adapter.binary.localBaseDir;

  try {
    const manifestFiles = await Promise.all(
      detail.files.map(async (f) => {
        const file = await appServiceRef!.openFile(f.lfp, base);
        const partialMd5 = await partialMD5(file);
        const closable = file as ClosableFile;
        if (closable && closable.close) await closable.close();
        return { filename: f.logical, byteSize: f.byteSize, partialMd5 };
      }),
    );
    await publishReplicaManifest(
      detail.kind,
      detail.replicaId,
      manifestFiles,
      detail.reincarnation,
    );
  } catch (err) {
    console.warn('replica-transfer-complete upload handler failed', err);
  }
};

const handleReplicaDownload = (detail: ReplicaTransferCompleteDetail): void => {
  // Per-kind handler clears the `unavailable` placeholder flag now that
  // binaries are on disk. Stores register at boot via
  // registerReplicaDownloadHandler.
  const handler = downloadHandlers.get(detail.kind);
  if (!handler) return;
  try {
    handler(detail.replicaId);
  } catch (err) {
    console.warn('replica-transfer-complete download handler failed', err);
  }
};

const handleReplicaTransferComplete = async (event: CustomEvent): Promise<void> => {
  const detail = event.detail as ReplicaTransferCompleteDetail | undefined;
  if (!detail) return;
  if (!getReplicaAdapter(detail.kind)) return;

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
 * listener doesn't need to know auth state, and publishReplicaManifest
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
  downloadHandlers.clear();
};
