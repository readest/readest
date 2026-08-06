import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { icloudEnsureDownloaded } from '@/utils/bridge';
import {
  FileEntry,
  FileHead,
  FileSyncError,
  FileSyncProvider,
} from '@/services/sync/file/provider';

/**
 * iCloud Drive implementation of {@link FileSyncProvider}. The "remote" is the
 * app's ubiquity container: plain local file I/O that the OS replicates. Two
 * iCloud-specific wrinkles live here and nowhere else:
 *
 *  - files created by ANOTHER device may be undownloaded stubs
 *    (`.name.icloud` placeholders on iOS; evictable on macOS), so every read
 *    asks the native bridge to materialise the item first;
 *  - the OS uploads whatever bytes are on disk, so writes must be atomic
 *    (dot-prefixed temp file + rename) or a torn library.json could sync.
 *
 * There is no auth concept: a Tauri fs-scope denial ("forbidden path") is the
 * closest analogue and maps to AUTH_FAILED; a missing path maps to the
 * engine's 404-null contract. An iCloud sign-out is NOT an error state — the
 * container keeps working locally and the OS resumes replication on sign-in.
 */

const TMP_PREFIX = '.readest-tmp-';
const PLACEHOLDER_SUFFIX = '.icloud';
/** Book downloads can be slow on first access; library.json is instant. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

const mapError = (e: unknown): FileSyncError => {
  if (e instanceof FileSyncError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/forbidden path/i.test(message)) return new FileSyncError(message, 'AUTH_FAILED');
  if (/no such file|not found|os error 2/i.test(message)) {
    return new FileSyncError(message, 'NOT_FOUND');
  }
  return new FileSyncError(message, 'UNKNOWN');
};

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw mapError(e);
  }
};

const splitPath = (path: string): { dir: string; name: string } => {
  const i = path.lastIndexOf('/');
  return { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
};

export const createICloudProvider = (documentsPath: string): FileSyncProvider => {
  const root = documentsPath.replace(/\/+$/, '');
  const abs = (path: string): string => `${root}${path}`;
  const placeholderOf = (path: string): string => {
    const { dir, name } = splitPath(path);
    return `${dir}.${name}${PLACEHOLDER_SUFFIX}`;
  };
  const tmpOf = (path: string): string => {
    const { dir } = splitPath(path);
    return `${dir}${TMP_PREFIX}${Math.random().toString(36).slice(2)}`;
  };

  /** Materialise an evicted file. False = neither file nor placeholder exists. */
  const ensureDownloaded = async (path: string): Promise<boolean> => {
    const res = await icloudEnsureDownloaded({ path: abs(path), timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (res.status === 'timeout') {
      throw new FileSyncError(`iCloud download timed out: ${path}`, 'NETWORK');
    }
    return res.status === 'ready';
  };

  /** Write to a dot-prefixed temp name, then rename into place (atomic). */
  const writeAtomic = async (
    path: string,
    write: (tmpAbs: string) => Promise<void>,
  ): Promise<void> => {
    const tmp = tmpOf(path);
    await write(abs(tmp));
    await rename(abs(tmp), abs(path));
  };

  const provider: FileSyncProvider = {
    rootPath: '/',

    readText: (path) =>
      wrap(async () => ((await ensureDownloaded(path)) ? readTextFile(abs(path)) : null)),

    readBinary: (path) =>
      wrap(async () => {
        if (!(await ensureDownloaded(path))) return null;
        const bytes = await readFile(abs(path));
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      }),

    head: (path): Promise<FileHead | null> =>
      wrap(async () => {
        try {
          const s = await stat(abs(path));
          return { size: s.size ?? undefined };
        } catch (e) {
          if (mapError(e).code !== 'NOT_FOUND') throw e;
          // Undownloaded placeholder: the file exists in iCloud but not on
          // disk. Report existence WITHOUT forcing a download (a HEAD probe
          // must not pull a gigabyte book); size is unknown.
          return (await exists(abs(placeholderOf(path)))) ? {} : null;
        }
      }),

    list: (path): Promise<FileEntry[]> =>
      wrap(async () => {
        const entries = await readDir(abs(path));
        const out: FileEntry[] = [];
        for (const entry of entries) {
          let name = entry.name;
          const isPlaceholder =
            !entry.isDirectory && name.startsWith('.') && name.endsWith(PLACEHOLDER_SUFFIX);
          if (isPlaceholder) name = name.slice(1, -PLACEHOLDER_SUFFIX.length);
          // Our own temp strays, .DS_Store, and other hidden junk are not
          // sync content. Placeholders are the one dot-name we surface.
          if (!isPlaceholder && name.startsWith('.')) continue;
          const entryPath = `${path === '/' ? '' : path}/${name}`;
          let size: number | undefined;
          let lastModified: string | undefined;
          if (!isPlaceholder) {
            try {
              const s = await stat(abs(entryPath));
              size = entry.isDirectory ? undefined : (s.size ?? undefined);
              lastModified = s.mtime ? new Date(s.mtime).toISOString() : undefined;
            } catch {
              // Raced deletion or eviction between readDir and stat: keep
              // the bare entry, metadata stays optional.
            }
          }
          out.push({
            name,
            path: entryPath,
            isDirectory: !!entry.isDirectory,
            size,
            lastModified,
          });
        }
        return out;
      }),

    writeText: (path, body) => wrap(() => writeAtomic(path, (tmp) => writeTextFile(tmp, body))),

    writeBinary: (path, body) =>
      wrap(() => writeAtomic(path, (tmp) => writeFile(tmp, new Uint8Array(body)))),

    ensureDir: (paths) =>
      wrap(async () => {
        for (const p of paths) {
          if (!(await exists(abs(p)))) await mkdir(abs(p));
        }
      }),

    deleteDir: (path) =>
      wrap(async () => {
        try {
          await remove(abs(path), { recursive: true });
        } catch (e) {
          if (mapError(e).code !== 'NOT_FOUND') throw e;
        }
      }),
  };

  provider.uploadStream = async (remotePath, localPath) => {
    try {
      const tmp = tmpOf(remotePath);
      await copyFile(localPath, abs(tmp));
      await rename(abs(tmp), abs(remotePath));
      return true;
    } catch (e) {
      console.warn('ICloudProvider.uploadStream failed', remotePath, e);
      return false;
    }
  };

  provider.downloadStream = async (remotePath, localPath) => {
    try {
      if (!(await ensureDownloaded(remotePath))) return false;
      await copyFile(abs(remotePath), localPath);
      return true;
    } catch (e) {
      console.warn('ICloudProvider.downloadStream failed', remotePath, e);
      return false;
    }
  };

  return provider;
};
