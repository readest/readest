import { FileSyncError, type FileSyncProvider } from '@/services/sync/file/provider';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import { ancestorsOf, buildBookKindDirPath } from '@/services/sync/file/layout';
import type { BookDataDestination } from './types';

export const createFileSyncDestination = (
  id: FileSyncBackendKind,
  provider: FileSyncProvider,
): BookDataDestination => {
  const dirOf = (bookHash: string, kind: string) =>
    buildBookKindDirPath(provider.rootPath, bookHash, kind);
  const prepared = new Set<string>();

  return {
    id,
    async list(bookHash, kind) {
      try {
        const entries = await provider.list(dirOf(bookHash, kind));
        return new Set(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));
      } catch (err) {
        // A missing folder means nothing synced yet. Any other error throws, so
        // push skips this destination instead of uploading everything again.
        if (err instanceof FileSyncError && err.code === 'NOT_FOUND') return new Set();
        throw err;
      }
    },
    async read(bookHash, kind, name) {
      try {
        return await provider.readBinary(`${dirOf(bookHash, kind)}/${name}`);
      } catch {
        return null;
      }
    },
    async write(bookHash, kind, name, body, contentType) {
      const dir = dirOf(bookHash, kind);
      if (!prepared.has(dir)) {
        await provider.ensureDir([...ancestorsOf(dir), dir]);
        prepared.add(dir);
      }
      await provider.writeBinary(`${dir}/${name}`, body, contentType);
    },
  };
};
