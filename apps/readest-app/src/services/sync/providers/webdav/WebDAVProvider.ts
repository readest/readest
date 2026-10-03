import { WebDAVSettings } from '@/types/settings';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload, tauriUpload } from '@/utils/transfer';
import {
  FileEntry,
  FileHead,
  FileSyncError,
  FileSyncErrorCode,
  FileSyncProvider,
} from '@/services/sync/file/provider';
import {
  WebDAVConfig,
  WebDAVRequestError,
  buildBasicAuthHeader,
  buildRequestUrl,
  deleteDirectory,
  ensureDirectory,
  getFile,
  getFileBinary,
  headFile,
  listDirectory,
  normalizeRootPath,
  putFile,
  putFileBinary,
} from './client';

/**
 * WebDAV implementation of {@link FileSyncProvider} — the first concrete
 * backend for the provider-agnostic file-sync engine.
 *
 * Responsibilities unique to this layer:
 *   - own the WebDAV transport config (serverUrl + Basic-auth credentials);
 *   - translate the transport client's {@link WebDAVRequestError} into the
 *     engine's neutral {@link FileSyncError} so nothing above this file
 *     knows the backend is WebDAV;
 *   - own streaming upload/download (URL + auth + the Tauri-side
 *     `tauriUpload`/`tauriDownload`), keeping gigabyte-scale book payloads out
 *     of the JS heap. Streaming is exposed only on Tauri; on web the engine
 *     falls back to buffered {@link FileSyncProvider.writeBinary}/`readBinary`.
 */

const mapError = (e: unknown): FileSyncError => {
  if (e instanceof FileSyncError) return e;
  if (e instanceof WebDAVRequestError) {
    const code: FileSyncErrorCode =
      e.code === 'AUTH_FAILED'
        ? 'AUTH_FAILED'
        : e.code === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : e.code === 'NETWORK'
            ? 'NETWORK'
            : e.status === 409
              ? 'CONFLICT'
              : 'UNKNOWN';
    return new FileSyncError(e.message, code, e.status);
  }
  const message = e instanceof Error ? e.message : String(e);
  // Tauri serializes transfer errors as strings, including HTTP status codes.
  const match = /^request failed with status code (\d{3}):/.exec(message);
  const status = match ? Number(match[1]) : undefined;
  const code =
    status === 401 || status === 403
      ? 'AUTH_FAILED'
      : status === 404
        ? 'NOT_FOUND'
        : status === 409
          ? 'CONFLICT'
          : 'UNKNOWN';
  return new FileSyncError(message, code, status);
};

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw mapError(e);
  }
};

export const createWebDAVProvider = (settings: WebDAVSettings): FileSyncProvider => {
  const config: WebDAVConfig = {
    serverUrl: settings.serverUrl,
    username: settings.username,
    password: settings.password,
  };

  const provider: FileSyncProvider = {
    rootPath: normalizeRootPath(settings.rootPath),
    readText: (path) => wrap(() => getFile(config, path)),
    readBinary: (path) => wrap(() => getFileBinary(config, path)),
    head: (path): Promise<FileHead | null> => wrap(() => headFile(config, path)),
    list: (path): Promise<FileEntry[]> => wrap(() => listDirectory(config, path)),
    writeText: (path, body, contentType) => wrap(() => putFile(config, path, body, contentType)),
    writeBinary: (path, body, contentType) =>
      wrap(() => putFileBinary(config, path, body, contentType)),
    ensureDir: (paths) => wrap(() => ensureDirectory(config, paths)),
    deleteDir: (path) => wrap(() => deleteDirectory(config, path)),
  };

  if (isTauriAppPlatform()) {
    const authHeaders = (): Record<string, string> => ({
      Authorization: buildBasicAuthHeader(settings.username, settings.password),
    });
    provider.uploadStream = async (remotePath, localPath) => {
      const url = buildRequestUrl(settings.serverUrl, remotePath);
      try {
        // tauriUpload's TS type says Map, but the Rust command accepts a JSON
        // object → HashMap<String, String>; pass the headers object directly.
        await tauriUpload(
          url,
          localPath,
          'PUT',
          undefined,
          authHeaders() as unknown as Map<string, string>,
        );
        return true;
      } catch (e) {
        throw mapError(e);
      }
    };
    provider.downloadStream = async (remotePath, localPath, onProgress) => {
      const url = buildRequestUrl(settings.serverUrl, remotePath);
      try {
        await tauriDownload(url, localPath, onProgress, authHeaders());
        return true;
      } catch (e) {
        throw mapError(e);
      }
    };
  }

  return provider;
};
