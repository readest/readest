import type { Configuration, ZipWriter } from '@zip.js/zip.js';
import { AppService } from '@/types/system';
import { EXTS } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { Book, BookConfig, BookNote } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { getLibraryFilename } from '@/utils/book';
import { stampBookConfigSchema } from '@/utils/serializer';
import { configureZip } from '@/utils/zip';

/** Book file extensions for identifying book files in backup directories. */
const BOOK_EXTS = new Set(Object.values(EXTS));

/** Root-level zip entry name for the backed-up global settings snapshot. */
export const SETTINGS_BACKUP_FILENAME = 'settings.json';

/**
 * Options controlling what a backup zip includes.
 */
export interface BackupOptions {
  /**
   * Include account credentials (sync tokens, passwords, API keys) in the
   * settings snapshot. The backup zip is unencrypted, so this is opt-in and
   * defaults to false.
   */
  includeCredentials?: boolean;
}

/**
 * SystemSettings dot-paths excluded from backups. Each is either tied to
 * this device (and meaningless to restore elsewhere) or sync/migration
 * bookkeeping that would corrupt state if restored stale. Restore keeps
 * the current device's value for every path here — see issue #4098.
 */
export const BACKUP_SETTINGS_BLACKLIST = [
  // Device filesystem paths — invalid on another device / OS.
  'localBooksDir',
  'customRootDir',
  'externalLibraryFolders',
  'autoImportFolders',
  'savedBookCoverForLockScreenPath',
  // Per-device identity — restoring causes sync identity / HLC collisions.
  'replicaDeviceId',
  'kosync.deviceId',
  // Sync cursors — stale values make sync skip pulls or re-push everything.
  'lastSyncedAtBooks',
  'lastSyncedAtConfigs',
  'lastSyncedAtNotes',
  'lastSyncedAtReplicas',
  'readwise.lastSyncedAt',
  'hardcover.lastSyncedAt',
  'googleDrive.deviceId',
  'googleDrive.lastSyncedAt',
  'webdav.deviceId',
  'webdav.lastSyncedAt',
  // Transient runtime state — book keys may not exist post-restore; screen
  // brightness is live device state.
  'lastOpenBooks',
  'screenBrightness',
  // Schema versioning — restore keeps the current device's value so its
  // migrations are not skipped.
  'version',
  'migrationVersion',
] as const;

/**
 * Credential dot-paths stripped from backups unless `includeCredentials`
 * is set. OPDS catalog credentials live inside the `opdsCatalogs` array
 * and are handled separately in `sanitizeSettingsForBackup`.
 */
export const BACKUP_SETTINGS_CREDENTIAL_FIELDS = [
  'kosync.username',
  'kosync.userkey',
  'kosync.password',
  'readwise.accessToken',
  'hardcover.accessToken',
  'aiSettings.aiGatewayApiKey',
  'aiSettings.openrouterApiKey',
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Delete a dot-path key from a deep object; no-op when the path is absent. */
const deletePath = (obj: Record<string, unknown>, path: string): void => {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]!];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]!];
};

/**
 * Produce a copy of SystemSettings safe to write into a backup zip:
 * strips device-specific / sync-bookkeeping fields always, and account
 * credentials unless `includeCredentials` is set. Input is not mutated.
 */
export function sanitizeSettingsForBackup(
  settings: SystemSettings,
  options: BackupOptions = {},
): SystemSettings {
  const clone = structuredClone(settings) as SystemSettings & Record<string, unknown>;
  for (const path of BACKUP_SETTINGS_BLACKLIST) {
    deletePath(clone, path);
  }
  if (!options.includeCredentials) {
    for (const path of BACKUP_SETTINGS_CREDENTIAL_FIELDS) {
      deletePath(clone, path);
    }
    if (Array.isArray(clone.opdsCatalogs)) {
      clone.opdsCatalogs = clone.opdsCatalogs.map((catalog) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { username: _username, password: _password, ...rest } = catalog;
        return rest;
      });
    }
  }
  return clone;
}

/** Recursively merge `source` onto `target`; objects merge, scalars/arrays replace. */
const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Merge a restored settings snapshot onto the current device settings.
 * Blacklisted fields are absent from the snapshot, so the current
 * device's values for them are preserved. Neither input is mutated.
 */
export function mergeRestoredSettings(
  current: SystemSettings,
  backup: Partial<SystemSettings>,
): SystemSettings {
  return deepMerge(
    current as unknown as Record<string, unknown>,
    backup as unknown as Record<string, unknown>,
  ) as unknown as SystemSettings;
}

/**
 * Merge two BookConfigs: uses the config with higher reading progress as base,
 * then merges booknotes from both (deduplicating by id, latest updatedAt wins).
 */
export function mergeBookConfigs(
  current: Partial<BookConfig>,
  backup: Partial<BookConfig>,
): Partial<BookConfig> {
  const currentPage = current.progress?.[0] ?? 0;
  const backupPage = backup.progress?.[0] ?? 0;

  // Use the config with higher progress as base
  const base = backupPage > currentPage ? { ...backup } : { ...current };

  // Merge booknotes from both configs
  const noteMap = new Map<string, BookNote>();
  for (const note of current.booknotes ?? []) {
    noteMap.set(note.id, note);
  }
  for (const note of backup.booknotes ?? []) {
    const existing = noteMap.get(note.id);
    if (!existing || (note.updatedAt || 0) > (existing.updatedAt || 0)) {
      noteMap.set(note.id, note);
    }
  }
  base.booknotes = [...noteMap.values()];

  return stampBookConfigSchema(base);
}

/**
 * Merge two Book metadata records: uses the one with higher updatedAt as base,
 * then reconciles timestamps. Only marks as deleted if BOTH sides agree.
 */
export function mergeBookMetadata(current: Book, backup: Book): Book {
  const base = backup.updatedAt > current.updatedAt ? { ...backup } : { ...current };
  base.updatedAt = Math.max(current.updatedAt, backup.updatedAt);
  base.createdAt = Math.min(current.createdAt, backup.createdAt);
  // Only deleted if BOTH sides agree
  base.deletedAt =
    current.deletedAt && backup.deletedAt ? Math.max(current.deletedAt, backup.deletedAt) : null;
  return base;
}

/** A book restored from a backup whose local copy had been soft-deleted. */
export interface RevivedBook {
  /** The live library record, mutated in place by `reviveRestoredBooks`. */
  book: Book;
  /** The book's metadata as stored in the backup. */
  backup: Book;
}

/**
 * Fix up books revived from a backup — present (not deleted) in the backup
 * but soft-deleted in the current library — see issue #4098.
 *
 * Their files were just re-extracted, so `downloadedAt` / `coverDownloadedAt`
 * are taken from the backup record (the local deletion had cleared them).
 *
 * `updatedAt` is bumped so the restore out-ranks the cloud's deletion
 * tombstone in the next sync's last-writer-wins merge. A single uniform
 * offset is applied to every revived book, so their relative `updatedAt`
 * order — and thus the library's "Updated" sort — is preserved exactly.
 * `syncedAt` is cleared so the next push re-uploads them and corrects the
 * cloud rows. Mutates the `book` of each entry in place.
 */
export function reviveRestoredBooks(revived: RevivedBook[], now: number = Date.now()): void {
  if (revived.length === 0) return;
  let maxUpdatedAt = 0;
  for (const { book } of revived) {
    if (book.updatedAt > maxUpdatedAt) maxUpdatedAt = book.updatedAt;
  }
  // offset >= 1 guarantees every book out-ranks its (un-bumped) cloud copy
  // while a single shared offset keeps their relative order intact.
  const offset = Math.max(1, now - maxUpdatedAt);
  for (const { book, backup } of revived) {
    book.updatedAt += offset;
    book.syncedAt = null;
    book.downloadedAt = backup.downloadedAt ?? book.downloadedAt ?? now;
    book.coverDownloadedAt = backup.coverDownloadedAt ?? book.coverDownloadedAt ?? now;
  }
}

/** Library metadata files to skip from the directory scan. */
const LIBRARY_META_FILES = new Set([
  'library.json',
  'library.json.bak',
  'library_backup.json',
  'library.db',
  'library.db-shm',
  'library.db-wal',
]);

function isLibraryMetaFile(path: string): boolean {
  return LIBRARY_META_FILES.has(path);
}

type ProgressCallback = (current: number, total: number, filename: string) => void;

/**
 * Shared logic: add all library entries to a ZipWriter.
 */
export async function addBackupEntriesToZip(
  writer: ZipWriter<unknown>,
  appService: AppService,
  options: BackupOptions,
  onProgress?: ProgressCallback,
): Promise<void> {
  const { Uint8ArrayReader } = await import('@zip.js/zip.js');

  // Generate canonical library.json from the current storage backend
  const books = await appService.loadLibraryBooks();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
  const libraryJson = new TextEncoder().encode(JSON.stringify(libraryBooks, null, 2));
  await writer.add(getLibraryFilename(), new Uint8ArrayReader(libraryJson));

  // Add the global settings snapshot, sanitized of device-specific and
  // (unless opted in) credential fields.
  try {
    const settings = await appService.loadSettings();
    const sanitized = sanitizeSettingsForBackup(settings, options);
    const settingsJson = new TextEncoder().encode(JSON.stringify(sanitized, null, 2));
    await writer.add(SETTINGS_BACKUP_FILENAME, new Uint8ArrayReader(settingsJson));
  } catch (error) {
    console.warn('Skipping settings backup:', error);
  }

  // Add all book files, skipping library metadata files
  const booksDir = await appService.resolveFilePath('', 'Books');
  const files = await appService.readDirectory(booksDir, 'None');
  const bookFiles = files.filter((f) => f.size > 0 && !isLibraryMetaFile(f.path));
  const total = bookFiles.length;

  for (let i = 0; i < bookFiles.length; i++) {
    const file = bookFiles[i]!;
    onProgress?.(i + 1, total, file.path);
    try {
      const content = await appService.readFile(file.path, 'Books', 'binary');
      const data = new Uint8Array(content as ArrayBuffer);
      // `readDirectory` returns host-separator paths; on Windows that is a
      // backslash (e.g. `hash\cover.png`). Zip entry names must use forward
      // slashes so the backup restores on every platform — restore matches a
      // book's files by `${hash}/` (see `restoreFromBackupZip`). Issue #4703.
      const entryName = file.path.replace(/\\/g, '/');
      await writer.add(entryName, new Uint8ArrayReader(data), { level: 0 });
    } catch (error) {
      console.warn(`Skipping file ${file.path}:`, error);
    }
  }
}

const ZIP_WRITE_CONFIG: Partial<Configuration> = {
  useWebWorkers: true,
  useCompressionStream: true,
  chunkSize: 1 * 1024 * 1024, // 1MB chunks for streaming
};

/**
 * Create a backup zip in memory, returning an ArrayBuffer.
 * Used on web where streaming to a file is not available.
 */
export async function createBackupZip(
  appService: AppService,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
  await configureZip(ZIP_WRITE_CONFIG);
  const { BlobWriter, ZipWriter } = await import('@zip.js/zip.js');

  const blobWriter = new BlobWriter('application/zip');
  const writer = new ZipWriter(blobWriter);
  await addBackupEntriesToZip(writer, appService, options, onProgress);
  await writer.close();
  const blob = await blobWriter.getData();
  return await blob.arrayBuffer();
}

/**
 * Stream a backup zip directly to a file path on disk.
 * Uses TransformStream so only chunks are held in memory at a time.
 * Only available on Tauri (requires @tauri-apps/plugin-fs).
 */
export async function createBackupZipToFile(
  appService: AppService,
  filePath: string,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
): Promise<void> {
  await configureZip(ZIP_WRITE_CONFIG);
  const { ZipWriter } = await import('@zip.js/zip.js');
  const { writeFile } = await import('@tauri-apps/plugin-fs');

  const { readable, writable } = new TransformStream<Uint8Array>();

  // Start streaming readable side to the file (runs concurrently)
  const writePromise = writeFile(filePath, readable);

  const writer = new ZipWriter(writable);
  await addBackupEntriesToZip(writer, appService, options, onProgress);
  await writer.close();
  await writePromise;
}

/**
 * Validate that zip entries contain a valid backup structure.
 * Must contain library.json at the root level.
 */
export function validateBackupStructure(entryNames: string[]): boolean {
  return entryNames.some((name) => name === getLibraryFilename());
}

/**
 * Restore library from a zip backup, merging with existing data.
 * - Override book files and cover images for existing books
 * - Merge book config files (keep higher progress, merge notes)
 * - Add new books not present in current library
 * - Import orphan hash directories not listed in library.json
 * - Restore global settings (settings.json), deep-merged onto current
 */
export async function restoreFromBackupZip(
  appService: AppService,
  zipBlob: Blob,
  onProgress?: (current: number, total: number, filename: string) => void,
): Promise<{ booksAdded: number; booksUpdated: number; settingsRestored: boolean }> {
  await configureZip();
  const { BlobReader, ZipReader, Uint8ArrayWriter } = await import('@zip.js/zip.js');

  const reader = new ZipReader(new BlobReader(zipBlob));
  const entries = await reader.getEntries();

  // Validate structure
  const entryNames = entries.map((e) => e.filename);
  if (!validateBackupStructure(entryNames)) {
    await reader.close();
    throw new Error('Invalid backup file: missing library.json');
  }

  // Filter to file entries only (directories don't have getData)
  const fileEntries = entries.filter((e) => !e.directory);

  // Read backup library.json
  const libraryEntry = fileEntries.find((e) => e.filename === getLibraryFilename());
  if (!libraryEntry) {
    await reader.close();
    throw new Error('Cannot read library.json from backup');
  }
  const libraryData = await libraryEntry.getData!(new Uint8ArrayWriter());
  const backupBooks: Book[] = JSON.parse(new TextDecoder().decode(libraryData));

  // Load current library
  const currentBooks = await appService.loadLibraryBooks();

  const currentBooksMap = new Map<string, Book>();
  for (const book of currentBooks) {
    currentBooksMap.set(book.hash, book);
  }

  // Collect orphan hash directories: in zip but not in library.json
  const backupHashes = new Set(backupBooks.map((b) => b.hash));
  const orphanHashes = new Set<string>();
  for (const entry of fileEntries) {
    const slashIdx = entry.filename.indexOf('/');
    if (slashIdx < 0) continue;
    const dir = entry.filename.slice(0, slashIdx);
    if (dir && !backupHashes.has(dir)) {
      orphanHashes.add(dir);
    }
  }

  let booksAdded = 0;
  let booksUpdated = 0;
  const revivedBooks: RevivedBook[] = [];
  const total = backupBooks.length + orphanHashes.size;

  for (let i = 0; i < backupBooks.length; i++) {
    const backupBook = backupBooks[i]!;
    onProgress?.(i + 1, total, backupBook.title);

    const existingBook = currentBooksMap.get(backupBook.hash);
    const bookDir = backupBook.hash;

    // Get all file entries for this book's directory
    const bookFileEntries = fileEntries.filter((e) => e.filename.startsWith(`${bookDir}/`));

    if (existingBook) {
      // Update: override book file and cover, merge config
      for (const entry of bookFileEntries) {
        const data = await entry.getData!(new Uint8ArrayWriter());

        if (entry.filename.endsWith('/config.json')) {
          // Merge config
          let currentConfig: Partial<BookConfig> = {};
          try {
            const str = (await appService.readFile(entry.filename, 'Books', 'text')) as string;
            currentConfig = JSON.parse(str);
          } catch {
            /* use empty config if current doesn't exist */
          }

          const backupConfig: Partial<BookConfig> = JSON.parse(new TextDecoder().decode(data));
          const mergedConfig = mergeBookConfigs(currentConfig, backupConfig);
          await appService.writeFile(entry.filename, 'Books', JSON.stringify(mergedConfig));
        } else {
          // Override book file and cover image
          await appService.writeFile(entry.filename, 'Books', data.buffer as ArrayBuffer);
        }
      }

      // Merge book metadata (timestamps, deletedAt reconciliation). A book
      // deleted locally but present in the backup is "revived" — collect it
      // so its download state and updatedAt can be fixed up after the loop.
      const wasRevived = !!existingBook.deletedAt && !backupBook.deletedAt;
      Object.assign(existingBook, mergeBookMetadata(existingBook, backupBook));
      if (wasRevived) revivedBooks.push({ book: existingBook, backup: backupBook });
      booksUpdated++;
    } else {
      // Add new book: extract all files
      if (!(await appService.exists(bookDir, 'Books'))) {
        await appService.createDir(bookDir, 'Books');
      }
      for (const entry of bookFileEntries) {
        const data = await entry.getData!(new Uint8ArrayWriter());
        await appService.writeFile(entry.filename, 'Books', data.buffer as ArrayBuffer);
      }
      currentBooks.push(backupBook);
      currentBooksMap.set(backupBook.hash, backupBook);
      booksAdded++;
    }
  }

  // Import orphan directories: hash dirs in zip not listed in library.json
  let orphanIdx = 0;
  for (const hash of orphanHashes) {
    orphanIdx++;
    if (currentBooksMap.has(hash)) continue;
    onProgress?.(backupBooks.length + orphanIdx, total, hash);
    const orphanEntries = fileEntries.filter((e) => e.filename.startsWith(`${hash}/`));
    // Find the book file by extension
    const bookEntry = orphanEntries.find((e) => {
      const ext = e.filename.split('.').pop()?.toLowerCase() ?? '';
      return BOOK_EXTS.has(ext);
    });
    if (!bookEntry) continue;

    // Extract all files to the Books directory
    if (!(await appService.exists(hash, 'Books'))) {
      await appService.createDir(hash, 'Books');
    }
    for (const entry of orphanEntries) {
      const data = await entry.getData!(new Uint8ArrayWriter());
      await appService.writeFile(entry.filename, 'Books', data.buffer as ArrayBuffer);
    }

    // Import the book file from the extracted location
    try {
      const filePath = await appService.resolveFilePath(bookEntry.filename, 'Books');
      const imported = await appService.importBook(filePath, currentBooks, { overwrite: true });
      if (imported) {
        currentBooksMap.set(imported.hash, imported);
        booksAdded++;
      }
    } catch (error) {
      console.warn(`Failed to import orphan book from ${hash}:`, error);
    }
  }

  // Make revived books out-rank the cloud's deletion tombstone in the
  // next sync, without disturbing the library's "Updated" sort order.
  reviveRestoredBooks(revivedBooks);

  // Save merged library
  await appService.saveLibraryBooks(currentBooks);

  // Restore global settings if the backup carries them. Blacklisted
  // fields are absent from the snapshot, so the current device keeps
  // its own values for those after the deep merge.
  let settingsRestored = false;
  const settingsEntry = fileEntries.find((e) => e.filename === SETTINGS_BACKUP_FILENAME);
  if (settingsEntry) {
    try {
      const data = await settingsEntry.getData!(new Uint8ArrayWriter());
      const backupSettings: Partial<SystemSettings> = JSON.parse(new TextDecoder().decode(data));
      const currentSettings = await appService.loadSettings();
      await appService.saveSettings(mergeRestoredSettings(currentSettings, backupSettings));
      settingsRestored = true;
    } catch (error) {
      console.warn('Failed to restore settings from backup:', error);
    }
  }

  await reader.close();

  return { booksAdded, booksUpdated, settingsRestored };
}

/**
 * Create and save a backup zip file.
 * On Tauri, streams directly to disk to avoid holding the entire zip in memory.
 * On web, builds the zip in memory and triggers a download.
 */
export async function saveBackupFile(
  appService: AppService,
  filename: string,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
): Promise<boolean> {
  if (isTauriAppPlatform()) {
    // Tauri: stream directly to the chosen file path
    const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const ext = filename.split('.').pop() || 'zip';
    const filePath = await saveDialog({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!filePath) return false;
    await createBackupZipToFile(appService, filePath, options, onProgress);
    return true;
  } else {
    // Web: build zip in memory then save
    const zipData = await createBackupZip(appService, options, onProgress);
    let filePath: string | undefined;
    return appService.saveFile(filename, zipData, { filePath, mimeType: 'application/zip' });
  }
}
