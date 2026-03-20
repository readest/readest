import type { Configuration, ZipWriter } from '@zip.js/zip.js';
import { AppService } from '@/types/system';
import { EXTS } from '@/libs/document';
import { isTauriAppPlatform } from '@/services/environment';
import { Book, BookConfig, BookNote } from '@/types/book';
import { getLibraryFilename } from '@/utils/book';
import { configureZip } from '@/utils/zip';

/** Book file extensions for identifying book files in backup directories. */
const BOOK_EXTS = new Set(Object.values(EXTS));

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

  return base;
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
async function addBackupEntriesToZip(
  writer: ZipWriter<unknown>,
  appService: AppService,
  onProgress?: ProgressCallback,
): Promise<void> {
  const { Uint8ArrayReader } = await import('@zip.js/zip.js');

  // Generate canonical library.json from the current storage backend
  const books = await appService.loadLibraryBooks();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
  const libraryJson = new TextEncoder().encode(JSON.stringify(libraryBooks, null, 2));
  await writer.add(getLibraryFilename(), new Uint8ArrayReader(libraryJson));

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
      await writer.add(file.path, new Uint8ArrayReader(data), { level: 0 });
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
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
  await configureZip(ZIP_WRITE_CONFIG);
  const { BlobWriter, ZipWriter } = await import('@zip.js/zip.js');

  const blobWriter = new BlobWriter('application/zip');
  const writer = new ZipWriter(blobWriter);
  await addBackupEntriesToZip(writer, appService, onProgress);
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
  onProgress?: ProgressCallback,
): Promise<void> {
  await configureZip(ZIP_WRITE_CONFIG);
  const { ZipWriter } = await import('@zip.js/zip.js');
  const { writeFile } = await import('@tauri-apps/plugin-fs');

  const { readable, writable } = new TransformStream<Uint8Array>();

  // Start streaming readable side to the file (runs concurrently)
  const writePromise = writeFile(filePath, readable);

  const writer = new ZipWriter(writable);
  await addBackupEntriesToZip(writer, appService, onProgress);
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
 */
export async function restoreFromBackupZip(
  appService: AppService,
  zipBlob: Blob,
  onProgress?: (current: number, total: number, filename: string) => void,
): Promise<{ booksAdded: number; booksUpdated: number }> {
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

      // Merge book metadata (timestamps, deletedAt reconciliation)
      Object.assign(existingBook, mergeBookMetadata(existingBook, backupBook));
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
      const imported = await appService.importBook(filePath, currentBooks, true, true, true);
      if (imported) {
        currentBooksMap.set(imported.hash, imported);
        booksAdded++;
      }
    } catch (error) {
      console.warn(`Failed to import orphan book from ${hash}:`, error);
    }
  }

  // Save merged library
  await appService.saveLibraryBooks(currentBooks);

  await reader.close();

  return { booksAdded, booksUpdated };
}

/**
 * Create and save a backup zip file.
 * On Tauri, streams directly to disk to avoid holding the entire zip in memory.
 * On web, builds the zip in memory and triggers a download.
 */
export async function saveBackupFile(
  appService: AppService,
  filename: string,
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
    await createBackupZipToFile(appService, filePath, onProgress);
    return true;
  } else {
    // Web: build zip in memory then save
    const zipData = await createBackupZip(appService, onProgress);
    let filePath: string | undefined;
    return appService.saveFile(filename, zipData, { filePath, mimeType: 'application/zip' });
  }
}
