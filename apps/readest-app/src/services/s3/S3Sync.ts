import { Book, BookConfig, BookNote } from '@/types/book';
import { S3Settings } from '@/types/settings';
import { getFile, getFileBinary, putFile, headFile, deleteDirectory } from './S3Client';
import {
  buildBookConfigPath,
  buildBookCoverPath,
  buildBookDirPath,
  buildBookFilePath,
  buildLibraryPath,
} from './S3Paths';

export interface RemoteBookConfig {
  schemaVersion: 1;
  bookHash: string;
  metaHash?: string;
  config: Partial<BookConfig>;
  booknotes: BookNote[];
  writerDeviceId: string;
  writerVersion: 'readest-s3-1';
  updatedAt: number;
}

const buildRemotePayload = (book: Book, config: BookConfig, deviceId: string): RemoteBookConfig => {
  const trimmed: Partial<BookConfig> = {
    progress: config.progress,
    location: config.location,
    xpointer: config.xpointer,
    updatedAt: config.updatedAt,
  };
  return {
    schemaVersion: 1,
    bookHash: book.hash,
    metaHash: book.metaHash,
    config: trimmed,
    booknotes: config.booknotes ?? [],
    writerDeviceId: deviceId,
    writerVersion: 'readest-s3-1',
    updatedAt: Date.now(),
  };
};

const parseRemotePayload = (raw: string | null): RemoteBookConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteBookConfig;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
};

const mergeNotes = (local: BookNote[], remote: BookNote[]): BookNote[] => {
  const byId = new Map<string, BookNote>();
  for (const n of local) byId.set(n.id, n);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    const lUpdated = l.updatedAt ?? 0;
    const rUpdated = r.updatedAt ?? 0;
    const lDeleted = l.deletedAt ?? 0;
    const rDeleted = r.deletedAt ?? 0;
    if (rUpdated > lUpdated || rDeleted > lDeleted) {
      byId.set(r.id, { ...l, ...r });
    } else {
      byId.set(r.id, { ...r, ...l });
    }
  }
  return Array.from(byId.values());
};

export interface PullResult {
  applied: boolean;
  mergedConfig?: BookConfig;
  mergedNotes?: BookNote[];
  remoteDeviceId?: string;
}

export const pullBookConfig = async (
  settings: S3Settings,
  book: Book,
  localConfig: BookConfig,
): Promise<PullResult> => {
  const key = buildBookConfigPath(settings.rootPath, book.hash);
  const raw = await getFile(settings, key);
  const remote = parseRemotePayload(raw);
  if (!remote) {
    return { applied: false };
  }
  const remoteConfigUpdated = remote.config.updatedAt ?? remote.updatedAt;
  const localConfigUpdated = localConfig.updatedAt ?? 0;
  const filteredRemote = Object.fromEntries(
    Object.entries(remote.config).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<BookConfig>;
  const mergedConfig: BookConfig =
    remoteConfigUpdated >= localConfigUpdated
      ? ({ ...localConfig, ...filteredRemote } as BookConfig)
      : ({ ...filteredRemote, ...localConfig } as BookConfig);
  const mergedNotes = mergeNotes(localConfig.booknotes ?? [], remote.booknotes ?? []);
  mergedConfig.booknotes = mergedNotes;
  return {
    applied: true,
    mergedConfig,
    mergedNotes,
    remoteDeviceId: remote.writerDeviceId,
  };
};

export const pushBookConfig = async (
  settings: S3Settings,
  book: Book,
  config: BookConfig,
  deviceId: string,
): Promise<void> => {
  const key = buildBookConfigPath(settings.rootPath, book.hash);
  const payload = buildRemotePayload(book, config, deviceId);
  await putFile(settings, key, JSON.stringify(payload));
};

export interface BookFileSource {
  bytes: ArrayBuffer;
  size: number;
}

export type BookFileLoader = () => Promise<BookFileSource | null>;

export interface BookFileStreamingSource {
  size: number;
  upload: (signedUrl: string) => Promise<boolean>;
}

export type BookFileStreamingLoader = () => Promise<BookFileStreamingSource | null>;

export interface PushBookFileResult {
  uploaded: boolean;
  reason?: 'remote-matches' | 'no-source' | 'disabled';
}

export const pushBookFile = async (
  settings: S3Settings,
  book: Book,
  loader: BookFileLoader,
  streamingLoader?: BookFileStreamingLoader,
): Promise<PushBookFileResult> => {
  const key = buildBookFilePath(settings.rootPath, book);
  let remoteHead: { size?: number; etag?: string } | null = null;
  try {
    remoteHead = await headFile(settings, key);
  } catch (e) {
    // ignore
  }

  if (streamingLoader) {
    const meta = await streamingLoader();
    if (!meta) {
      if (!loader) return { uploaded: false, reason: 'no-source' };
    } else {
      if (remoteHead && remoteHead.size === meta.size) {
        return { uploaded: false, reason: 'remote-matches' };
      }
      const local = await loader();
      if (!local) {
        return { uploaded: false, reason: 'no-source' };
      }
      await putFile(settings, key, local.bytes, 'application/octet-stream');
      return { uploaded: true };
    }
  }

  const local = await loader();
  if (!local) {
    return { uploaded: false, reason: 'no-source' };
  }

  if (remoteHead && remoteHead.size === local.size) {
    return { uploaded: false, reason: 'remote-matches' };
  }

  await putFile(settings, key, local.bytes, 'application/octet-stream');
  return { uploaded: true };
};

export const pushBookCover = async (
  settings: S3Settings,
  bookHash: string,
  loader: BookFileLoader,
): Promise<PushBookFileResult> => {
  const key = buildBookCoverPath(settings.rootPath, bookHash);
  let remoteHead: { size?: number; etag?: string } | null = null;
  try {
    remoteHead = await headFile(settings, key);
  } catch (e) {
    // ignore
  }

  const local = await loader();
  if (!local) return { uploaded: false, reason: 'no-source' };

  if (remoteHead && remoteHead.size === local.size) {
    return { uploaded: false, reason: 'remote-matches' };
  }

  await putFile(settings, key, local.bytes, 'image/png');
  return { uploaded: true };
};

export const pullBookFile = async (
  settings: S3Settings,
  book: Book,
  explicitKey?: string,
): Promise<ArrayBuffer | null> => {
  const key = explicitKey || buildBookFilePath(settings.rootPath, book);
  return getFileBinary(settings, key);
};

export const pullBookCover = async (
  settings: S3Settings,
  bookHash: string,
): Promise<ArrayBuffer | null> => {
  const key = buildBookCoverPath(settings.rootPath, bookHash);
  return getFileBinary(settings, key);
};

export interface DeleteRemoteBookDirResult {
  ok: boolean;
  reason?: string;
}

export const deleteRemoteBookDir = async (
  settings: S3Settings,
  bookHash: string,
): Promise<DeleteRemoteBookDirResult> => {
  const prefix = buildBookDirPath(settings.rootPath, bookHash);
  try {
    await deleteDirectory(settings, prefix);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
};

export interface RemoteLibraryIndex {
  schemaVersion: 1;
  books: Book[];
  updatedAt: number;
}

export const pullLibraryIndex = async (
  settings: S3Settings,
): Promise<RemoteLibraryIndex | null> => {
  const key = buildLibraryPath(settings.rootPath);
  const raw = await getFile(settings, key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RemoteLibraryIndex;
    if (parsed && parsed.schemaVersion === 1) return parsed;
  } catch {
    // ignore
  }
  return null;
};

export const pushLibraryIndex = async (
  settings: S3Settings,
  index: RemoteLibraryIndex,
): Promise<void> => {
  const key = buildLibraryPath(settings.rootPath);
  await putFile(settings, key, JSON.stringify(index));
};

export interface SyncLibraryResult {
  totalBooks: number;
  configsUploaded: number;
  configsDownloaded: number;
  filesUploaded: number;
  filesAlreadyInSync: number;
  coversUploaded: number;
  booksDownloaded: number;
  failures: number;
  failedBooks: SyncFailureEntry[];
}

export interface SyncFailureEntry {
  hash: string;
  title: string;
  reason: string;
  phase: 'download' | 'upload-config' | 'upload-file' | 'upload-cover';
}

export interface SyncLibraryOptions {
  syncBooks: boolean;
  strategy?: 'silent' | 'send' | 'receive';
  loadConfig: (book: Book) => Promise<BookConfig | null>;
  loadBookFile: (book: Book) => Promise<BookFileSource | null>;
  loadBookFileStreaming?: (book: Book) => Promise<BookFileStreamingSource | null>;
  loadBookCover?: (book: Book) => Promise<BookFileSource | null>;
  saveBookFile?: (book: Book, bytes: ArrayBuffer) => Promise<void>;
  downloadBookFile?: (book: Book, remoteKey: string) => Promise<boolean>;
  saveBookCover?: (book: Book, bytes: ArrayBuffer) => Promise<void>;
  saveBookConfig?: (book: Book, config: BookConfig) => Promise<void>;
  addBookToLibrary?: (book: Book) => Promise<void>;
  deviceId: string;
  onProgress?: (info: { book: Book; index: number; total: number; action?: string }) => void;
}

const formatFailureReason = (e: unknown): string => {
  let message: string;
  if (e instanceof Error && 'code' in e && typeof (e as any).code === 'string') {
    message = (e as any).code;
  } else if (e instanceof Error) {
    message = e.message || e.name || 'Unknown error';
  } else {
    message = String(e);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
};

export const syncLibrary = async (
  settings: S3Settings,
  books: Book[],
  options: SyncLibraryOptions,
): Promise<SyncLibraryResult> => {
  const result: SyncLibraryResult = {
    totalBooks: books.length,
    configsUploaded: 0,
    configsDownloaded: 0,
    filesUploaded: 0,
    filesAlreadyInSync: 0,
    coversUploaded: 0,
    booksDownloaded: 0,
    failures: 0,
    failedBooks: [],
  };

  const strategy = options.strategy ?? 'silent';
  const canPull = strategy !== 'send';
  const canPush = strategy !== 'receive';

  let remoteIndex: RemoteLibraryIndex | null = null;
  if (canPull) {
    try {
      remoteIndex = await pullLibraryIndex(settings);
    } catch (e) {
      console.warn('S3 library sync: failed to pull index', e);
    }
  }

  const allBooksMap = new Map<string, Book>();
  for (const b of books) {
    allBooksMap.set(b.hash, b);
  }

  const remoteBooksToDownload: Book[] = [];
  const explicitRemoteKeys = new Map<string, string>();

  if (canPull && remoteIndex && remoteIndex.books) {
    for (const rb of remoteIndex.books) {
      if (!allBooksMap.has(rb.hash) && !rb.deletedAt) {
        const key = buildBookFilePath(settings.rootPath, rb);
        explicitRemoteKeys.set(rb.hash, key);
        remoteBooksToDownload.push(rb);
        allBooksMap.set(rb.hash, rb);
      }
    }
  }

  if (canPull && (options.saveBookFile || options.downloadBookFile) && options.addBookToLibrary) {
    for (let i = 0; i < remoteBooksToDownload.length; i++) {
      const rb = remoteBooksToDownload[i]!;
      options.onProgress?.({
        book: rb,
        index: i,
        total: remoteBooksToDownload.length,
        action: 'downloading',
      });
      try {
        let written = false;
        const explicitKey = explicitRemoteKeys.get(rb.hash);
        if (options.downloadBookFile && explicitKey) {
          written = await options.downloadBookFile(rb, explicitKey);
        } else if (options.saveBookFile) {
          const fileBytes = await pullBookFile(settings, rb, explicitKey);
          if (fileBytes) {
            await options.saveBookFile(rb, fileBytes);
            written = true;
          }
        }
        if (written) {
          if (options.saveBookCover) {
            try {
              const coverBytes = await pullBookCover(settings, rb.hash);
              if (coverBytes) await options.saveBookCover(rb, coverBytes);
            } catch (e) {
              console.warn('S3 library sync: cover download failed', rb.hash, e);
            }
          }
          if (options.saveBookConfig) {
            try {
              const emptyLocal: BookConfig = { updatedAt: 0, booknotes: [] };
              const pullResult = await pullBookConfig(settings, rb, emptyLocal);
              if (pullResult.applied && pullResult.mergedConfig) {
                await options.saveBookConfig(rb, pullResult.mergedConfig);
                result.configsDownloaded += 1;
              }
            } catch (e) {
              console.warn('S3 library sync: config download failed', rb.hash, e);
            }
          }
          await options.addBookToLibrary(rb);
          result.booksDownloaded += 1;
        } else {
          result.failures += 1;
          result.failedBooks.push({
            hash: rb.hash,
            title: rb.title || rb.hash,
            phase: 'download',
            reason: 'No bytes returned (file may have been moved or deleted on the server)',
          });
        }
      } catch (e) {
        result.failures += 1;
        result.failedBooks.push({
          hash: rb.hash,
          title: rb.title || rb.hash,
          phase: 'download',
          reason: formatFailureReason(e),
        });
        console.warn('S3 library sync: book download failed', rb.hash, e);
      }
    }
  }

  const downloadedHashes = new Set(remoteBooksToDownload.map((b) => b.hash));
  const booksToPush = books.filter((b) => !b.deletedAt && !downloadedHashes.has(b.hash));
  result.totalBooks = booksToPush.length;

  if (canPush && booksToPush.length > 0) {
    for (let i = 0; i < booksToPush.length; i++) {
      const book = booksToPush[i]!;
      options.onProgress?.({ book, index: i, total: booksToPush.length, action: 'uploading' });
      let phase: SyncFailureEntry['phase'] = 'upload-config';
      try {
        const config = await options.loadConfig(book);
        if (config) {
          await pushBookConfig(settings, book, config, options.deviceId);
          result.configsUploaded += 1;
        }
        if (options.syncBooks) {
          phase = 'upload-file';
          const fileResult = await pushBookFile(
            settings,
            book,
            () => options.loadBookFile(book),
            options.loadBookFileStreaming ? () => options.loadBookFileStreaming!(book) : undefined,
          );
          if (fileResult.uploaded) {
            result.filesUploaded += 1;
          } else if (fileResult.reason === 'remote-matches') {
            result.filesAlreadyInSync += 1;
          }
          if (options.loadBookCover) {
            try {
              const coverResult = await pushBookCover(settings, book.hash, () =>
                options.loadBookCover!(book),
              );
              if (coverResult.uploaded) result.coversUploaded += 1;
            } catch (e) {
              console.warn('S3 library sync: cover failed', book.hash, e);
            }
          }
        }
      } catch (e) {
        result.failures += 1;
        result.failedBooks.push({
          hash: book.hash,
          title: book.title || book.hash,
          phase,
          reason: formatFailureReason(e),
        });
        console.warn('S3 library sync: book failed', book.hash, e);
      }
    }
  }

  if (canPush) {
    try {
      const newIndex: RemoteLibraryIndex = {
        schemaVersion: 1,
        books: Array.from(allBooksMap.values()),
        updatedAt: Date.now(),
      };
      await pushLibraryIndex(settings, newIndex);
    } catch (e) {
      console.warn('S3 library sync: failed to push index', e);
    }
  }

  return result;
};
