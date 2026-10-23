import type { Entry, FileEntry } from '@zip.js/zip.js';
import { EXTS, MIMETYPES } from '@/libs/document';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { getLocalBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import { getFileExtension } from '@/utils/path';
import { configureZip } from '@/utils/zip';

export const READEST_PACK_EXT = 'rbooks';
export const READEST_PACK_MIME = 'application/x-readest-books';
export const MANIFEST_FILENAME = 'readest-manifest.json';

export const MAX_PACK_ENTRIES = 5_000;
export const MAX_PACK_ENTRY_BYTES = 1_024 * 1_024 * 1_024; // 1 GB per book
export const MAX_PACK_TOTAL_UNCOMPRESSED_BYTES = 4 * 1_024 * 1_024 * 1_024; // 4 GB total

const isFileEntry = (entry: Entry): entry is FileEntry => !entry.directory;

export interface ReadestPackBookMeta {
  filename: string;
  title: string;
  author?: string;
  format: string;
  tags?: string[];
  groupName?: string;
  fileSize?: number;
}

export interface ReadestPackManifest {
  format: 'rbooks';
  version: 1;
  createdAt: number;
  collection?: {
    name: string;
    count: number;
  };
  books: ReadestPackBookMeta[];
}

export interface ExtractedPackBook {
  file: File;
  /** The book's group in the exporting library, else the pack's collection. */
  groupName?: string;
}

export interface ExtractedPack {
  collectionName?: string;
  books: ExtractedPackBook[];
  manifest?: ReadestPackManifest;
}

export interface PackCreationResult {
  data: ArrayBuffer;
  filename: string;
  count: number;
}

export type PackProgressCallback = (current: number, total: number, title: string) => void;

/**
 * Where an imported book lands. A book's group from a pack wins over the import
 * target; otherwise `groupId` keeps its meaning (undefined = no preference,
 * '' = library root, any other string = that group).
 */
export const resolveImportGroup = (
  groupId: string | undefined,
  packGroupName: string | undefined,
  getGroupId: (name: string) => string | undefined,
  getGroupName: (id: string) => string | undefined,
): { groupId: string | undefined; groupName: string | undefined } => {
  // getGroupId fingerprints a name the library doesn't know yet, so the
  // group name has to be carried through: getGroupName can't recover it.
  if (packGroupName) {
    return { groupId: getGroupId(packGroupName), groupName: packGroupName };
  }
  return { groupId, groupName: groupId !== undefined ? getGroupName(groupId) : undefined };
};

/**
 * Checks if a given filename or path has the .rbooks extension.
 */
export const isReadestPackFile = (filename: string): boolean => {
  return getFileExtension(filename).toLowerCase() === READEST_PACK_EXT;
};

/**
 * Reads the raw on-disk binary data for a book, checking both managed Books storage
 * and the original imported path.
 */
export async function getBookBinaryData(
  book: Book,
  appService: AppService,
): Promise<{ data: Uint8Array; fileName: string } | null> {
  const managedPath = getLocalBookFilename(book);
  let path: string;
  let base: 'Books' | 'None';

  if (await appService.exists(managedPath, 'Books')) {
    path = managedPath;
    base = 'Books';
  } else if (book.filePath && (await appService.exists(book.filePath, 'None'))) {
    path = book.filePath;
    base = 'None';
  } else {
    return null;
  }

  try {
    const content = await appService.readFile(path, base, 'binary');
    if (typeof content === 'string') return null;
    const data = new Uint8Array(content as ArrayBuffer);
    const ext = EXTS[book.format] ?? 'bin';
    const baseTitle = makeSafeFilename(book.sourceTitle || book.title || book.hash);
    const fileName = `${baseTitle}.${ext}`;
    return { data, fileName };
  } catch (error) {
    console.warn(`Failed to read binary data for book ${book.title}:`, error);
    return null;
  }
}

/**
 * Bundles the given books and collection metadata into a secure .rbooks archive.
 */
export async function createCollectionPack(
  appService: AppService,
  books: Book[],
  collectionName?: string,
  onProgress?: PackProgressCallback,
): Promise<PackCreationResult | null> {
  if (!books || books.length === 0) return null;

  await configureZip();
  const { BlobWriter, Uint8ArrayReader, ZipWriter } = await import('@zip.js/zip.js');

  const blobWriter = new BlobWriter(READEST_PACK_MIME);
  const zipWriter = new ZipWriter(blobWriter);

  const manifestBooks: ReadestPackBookMeta[] = [];
  const usedFileNames = new Set<string>();
  let successfulBookCount = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (!book) continue;

    onProgress?.(i + 1, books.length, book.title);

    const binaryResult = await getBookBinaryData(book, appService);
    if (!binaryResult) continue;

    let targetFileName = binaryResult.fileName;
    if (usedFileNames.has(targetFileName)) {
      const ext = getFileExtension(targetFileName);
      const stem = ext ? targetFileName.slice(0, -(ext.length + 1)) : targetFileName;
      let n = i + 1;
      do {
        targetFileName = ext ? `${stem}_${n}.${ext}` : `${stem}_${n}`;
        n++;
      } while (usedFileNames.has(targetFileName));
    }
    usedFileNames.add(targetFileName);

    const zipEntryPath = `books/${targetFileName}`;
    await zipWriter.add(zipEntryPath, new Uint8ArrayReader(binaryResult.data), {
      level: 0,
    });

    manifestBooks.push({
      filename: zipEntryPath,
      title: book.title,
      author: book.author,
      format: book.format,
      tags: book.tags,
      groupName: book.groupName || collectionName,
      fileSize: binaryResult.data.length,
    });

    successfulBookCount++;
  }

  if (successfulBookCount === 0) {
    await zipWriter.close();
    return null;
  }

  const manifest: ReadestPackManifest = {
    format: 'rbooks',
    version: 1,
    createdAt: Date.now(),
    collection: collectionName
      ? {
          name: collectionName,
          count: successfulBookCount,
        }
      : undefined,
    books: manifestBooks,
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  await zipWriter.add(MANIFEST_FILENAME, new Uint8ArrayReader(manifestBytes));

  await zipWriter.close();
  const blob = await blobWriter.getData();
  const data = await blob.arrayBuffer();

  const sanitizedName = collectionName?.trim().replace(/\s+/g, '_');
  const safeColName = sanitizedName ? makeSafeFilename(sanitizedName) : 'readest-collection';
  const filename = `${safeColName}.${READEST_PACK_EXT}`;

  return {
    data,
    filename,
    count: successfulBookCount,
  };
}

/**
 * Extracts book files and manifest metadata from a .rbooks archive.
 * Includes Zip-Slip and path traversal protection.
 */
export async function extractCollectionPack(
  data: ArrayBuffer | Blob | Uint8Array,
): Promise<ExtractedPack | null> {
  await configureZip();
  const { BlobReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } = await import(
    '@zip.js/zip.js'
  );

  let readerSource: InstanceType<typeof BlobReader> | InstanceType<typeof Uint8ArrayReader>;
  if (data instanceof Blob) {
    readerSource = new BlobReader(data);
  } else if (data instanceof Uint8Array) {
    readerSource = new Uint8ArrayReader(data);
  } else {
    readerSource = new Uint8ArrayReader(new Uint8Array(data));
  }

  const zipReader = new ZipReader(readerSource);

  try {
    const allEntries = await zipReader.getEntries();
    if (!allEntries || allEntries.length === 0) {
      await zipReader.close();
      return null;
    }

    const entries = allEntries.filter(isFileEntry);
    if (entries.length > MAX_PACK_ENTRIES) {
      console.warn(
        `Rejected archive: entry count (${entries.length}) exceeds limit of ${MAX_PACK_ENTRIES}`,
      );
      await zipReader.close();
      return null;
    }

    let manifest: ReadestPackManifest | undefined;
    const manifestEntry = entries.find(
      (entry) =>
        entry.filename === MANIFEST_FILENAME || entry.filename.endsWith(`/${MANIFEST_FILENAME}`),
    );

    if (manifestEntry) {
      if (manifestEntry.uncompressedSize && manifestEntry.uncompressedSize > MAX_PACK_ENTRY_BYTES) {
        console.warn('Rejected manifest: uncompressed size exceeds limit');
      } else {
        try {
          const jsonText = await manifestEntry.getData(new TextWriter());
          const parsed: unknown = JSON.parse(jsonText);
          if (
            parsed &&
            typeof parsed === 'object' &&
            (parsed as { format?: unknown }).format === 'rbooks' &&
            Array.isArray((parsed as { books?: unknown }).books)
          ) {
            const candidate = parsed as ReadestPackManifest;
            const name = candidate.collection?.name;
            if (candidate.collection && (typeof name !== 'string' || !name.trim())) {
              candidate.collection = undefined;
            }
            manifest = candidate;
          }
        } catch (err) {
          console.warn('Failed to parse pack manifest:', err);
        }
      }
    }

    const manifestGroups = new Map<string, string>();
    for (const meta of manifest?.books ?? []) {
      const groupName = typeof meta?.groupName === 'string' ? meta.groupName.trim() : '';
      if (groupName && typeof meta.filename === 'string') {
        manifestGroups.set(meta.filename, groupName);
      }
    }

    const books: ExtractedPackBook[] = [];
    let totalUncompressedBytes = 0;

    for (const entry of entries) {
      const rawName = entry.filename.replace(/\\/g, '/');

      // Zip-Slip and path traversal protection: reject climbing paths and absolute drives
      if (
        rawName.includes('../') ||
        rawName.startsWith('/') ||
        rawName.includes('/../') ||
        /^[a-zA-Z]:/.test(rawName)
      ) {
        console.warn(`Rejected potentially malicious archive entry: ${entry.filename}`);
        continue;
      }

      if (rawName === MANIFEST_FILENAME || rawName.endsWith(`/${MANIFEST_FILENAME}`)) {
        continue;
      }

      const ext = getFileExtension(rawName).toLowerCase();
      // Ignore inner pack/zip archives to prevent recursion bombs
      if (!ext || ext === READEST_PACK_EXT || ext === 'zip') {
        continue;
      }

      // Enforce per-entry and cumulative uncompressed size limits (CWE-409)
      if (entry.uncompressedSize && entry.uncompressedSize > MAX_PACK_ENTRY_BYTES) {
        console.warn(`Rejected archive entry ${entry.filename}: uncompressed size exceeds limit`);
        continue;
      }

      totalUncompressedBytes += entry.uncompressedSize ?? 0;
      if (totalUncompressedBytes > MAX_PACK_TOTAL_UNCOMPRESSED_BYTES) {
        console.warn('Rejected archive: cumulative uncompressed size exceeds limit');
        await zipReader.close();
        return null;
      }

      const parts = rawName.split('/');
      const baseName = parts[parts.length - 1] || 'book';

      try {
        const bytes = await entry.getData(new Uint8ArrayWriter());
        const mime =
          MIMETYPES[ext.toUpperCase() as keyof typeof MIMETYPES]?.[0] || 'application/octet-stream';
        const file = new File([bytes], baseName, { type: mime });
        books.push({
          file,
          groupName: manifestGroups.get(rawName) ?? manifest?.collection?.name,
        });
      } catch (err) {
        console.warn(`Failed to extract entry ${entry.filename}:`, err);
      }
    }

    await zipReader.close();

    if (books.length === 0) {
      return null;
    }

    return {
      collectionName: manifest?.collection?.name,
      books,
      manifest,
    };
  } catch (err) {
    console.error('Failed to read archive:', err);
    try {
      await zipReader.close();
    } catch {
      // ignore close failure
    }
    return null;
  }
}
