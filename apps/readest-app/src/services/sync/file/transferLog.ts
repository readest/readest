import type { FileSyncBackendKind } from './providerRegistry';
import type { FileSyncProvider } from './provider';
import { useTransferStore, type TransferType } from '@/store/transferStore';
import { createProgressThrottle, toProgressPercent, type ProgressHandler } from '@/utils/transfer';

/** Observe actual file IO, including automatic sync, without changing its owner. */
export const withTransferLog = (
  provider: FileSyncProvider,
  kind: FileSyncBackendKind,
  parentTransferId?: string,
): FileSyncProvider => {
  const track = async <T>(
    path: string,
    type: TransferType,
    operation: (onProgress: ProgressHandler) => Promise<T>,
    byteSize?: number,
  ): Promise<T> => {
    const store = useTransferStore.getState();
    const parent = parentTransferId ? store.transfers[parentTransferId] : undefined;
    // A queued book owns its primary binary row; cover/config transfers get
    // their own file history. Keep the context local to this wrapper: providers
    // themselves are cached and shared across concurrent sync surfaces.
    const parts = path.split('/');
    const primary =
      parent?.kind === 'book' &&
      type === parent.type &&
      parts.at(-2) === parent.bookHash &&
      !['cover.png', 'config.json'].includes(parts.at(-1) ?? '');
    if (primary) {
      store.setTransferProvider(parent.id, kind);
      return operation(() => {});
    }
    const id = store.addFileTransfer(kind, path, type);
    let settled = false;
    const throttle = createProgressThrottle((progress) => {
      store.updateTransferProgress(
        id,
        toProgressPercent(progress),
        progress.progress,
        progress.total,
        progress.transferSpeed,
      );
    }, 100);
    try {
      const result = await operation((progress) => {
        if (!settled) throttle.push(progress);
      });
      settled = true;
      throttle.flush();
      if (result === null) {
        // Missing optional config/cover files and index probes transfer no file.
        store.removeTransfer(id);
      } else if (result === false) {
        store.setTransferStatus(id, 'failed');
      } else {
        const size =
          byteSize ??
          (typeof result === 'string'
            ? new TextEncoder().encode(result).byteLength
            : result instanceof ArrayBuffer
              ? result.byteLength
              : undefined);
        const row = useTransferStore.getState().transfers[id];
        store.updateTransferProgress(
          id,
          100,
          size ?? row?.transferredBytes ?? 0,
          size ?? row?.totalBytes ?? 0,
          row?.transferSpeed ?? 0,
        );
        store.setTransferStatus(id, 'completed');
      }
      return result;
    } catch (error) {
      store.setTransferStatus(id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      settled = true;
      throttle.cancel();
    }
  };

  return {
    rootPath: provider.rootPath,
    head: (path) => provider.head(path),
    list: (path) => provider.list(path),
    ensureDir: (paths) => provider.ensureDir(paths),
    readText: (path) => track(path, 'download', () => provider.readText(path)),
    readBinary: (path) => track(path, 'download', () => provider.readBinary(path)),
    writeText: (path, body, contentType) =>
      track(
        path,
        'upload',
        () => provider.writeText(path, body, contentType),
        new TextEncoder().encode(body).byteLength,
      ),
    writeBinary: (path, body, contentType) =>
      track(path, 'upload', () => provider.writeBinary(path, body, contentType), body.byteLength),
    deleteDir: (path) => track(path, 'delete', () => provider.deleteDir(path)),
    ...(provider.uploadStream
      ? {
          uploadStream: (remote: string, local: string) =>
            track(remote, 'upload', () => provider.uploadStream!(remote, local)),
        }
      : {}),
    ...(provider.downloadStream
      ? {
          downloadStream: (remote: string, local: string, onProgress?: ProgressHandler) =>
            track(remote, 'download', (report) =>
              provider.downloadStream!(remote, local, (progress) => {
                report(progress);
                onProgress?.(progress);
              }),
            ),
        }
      : {}),
  };
};
