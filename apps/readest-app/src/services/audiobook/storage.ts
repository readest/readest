import type { ParsedAudiobookFile } from './metadata';
import type { AudiobookChapterMapping, PairedAudiobook, AudiobookFile } from '@/types/book';
import type { AppService } from '@/types/system';
import { makeSafeFilename } from '@/utils/misc';

export type AudiobookStorage = Pick<
  AppService,
  'createDir' | 'copyFile' | 'writeFile' | 'deleteFile' | 'deleteDir'
>;

export interface AudiobookImportFile {
  file: File;
  sourcePath?: string;
  metadata: ParsedAudiobookFile;
}

export const getAudiobookDirectory = (bookHash: string): string => `${bookHash}/audiobook`;

export const isAudiobookFilePath = (bookHash: string, path: string): boolean => {
  const prefix = `${getAudiobookDirectory(bookHash)}/`;
  const filename = path.startsWith(prefix) ? path.slice(prefix.length) : '';
  return (
    filename.length > 0 &&
    filename !== '.' &&
    filename !== '..' &&
    !filename.includes('/') &&
    !filename.includes('\\')
  );
};

const deleteAudiobookFiles = async (
  storage: AudiobookStorage,
  bookHash: string,
  files: AudiobookFile[],
): Promise<void> => {
  for (const file of files) {
    if (isAudiobookFilePath(bookHash, file.path)) {
      await storage.deleteFile(file.path, 'Books');
    }
  }
};

export const importPairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  mappings: AudiobookChapterMapping[],
  importFiles: AudiobookImportFile[],
  previous?: PairedAudiobook,
): Promise<PairedAudiobook> => {
  const directory = getAudiobookDirectory(bookHash);
  await storage.createDir(directory, 'Books', true);
  const createdAt = Math.max(Date.now(), (previous?.createdAt ?? 0) + 1);

  const files: AudiobookFile[] = [];
  const createdPaths: string[] = [];
  try {
    for (const { file, sourcePath, metadata } of importFiles) {
      const filename = `${createdAt}-${metadata.id}-${makeSafeFilename(metadata.name)}`;
      const path = `${directory}/${filename}`;
      createdPaths.push(path);
      if (sourcePath) {
        await storage.copyFile(sourcePath, 'None', path, 'Books');
      } else {
        await storage.writeFile(path, 'Books', file);
      }
      files.push({
        id: metadata.id,
        name: metadata.name,
        path,
        duration: metadata.duration,
      });
    }
  } catch (error) {
    await Promise.allSettled(createdPaths.map((path) => storage.deleteFile(path, 'Books')));
    throw error;
  }

  const title = importFiles.find(({ metadata }) => metadata.title)?.metadata.title;
  const narrator = importFiles.find(({ metadata }) => metadata.narrator)?.metadata.narrator;
  return {
    version: 1,
    ...(title ? { title } : {}),
    ...(narrator ? { narrator } : {}),
    files,
    chapters: importFiles.flatMap(({ metadata }) => metadata.chapters),
    mappings,
    createdAt,
  };
};

export const replacePairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  mappings: AudiobookChapterMapping[],
  importFiles: AudiobookImportFile[],
  previous: PairedAudiobook | undefined,
  persist: (association: PairedAudiobook) => Promise<void>,
): Promise<PairedAudiobook> => {
  const association = await importPairedAudiobook(
    storage,
    bookHash,
    mappings,
    importFiles,
    previous,
  );
  try {
    await persist(association);
  } catch (error) {
    await Promise.allSettled(
      association.files.map((file) => storage.deleteFile(file.path, 'Books')),
    );
    throw error;
  }

  const nextPaths = new Set(association.files.map((file) => file.path));
  const obsolete = (previous?.files ?? []).filter((file) => !nextPaths.has(file.path));
  try {
    await deleteAudiobookFiles(storage, bookHash, obsolete);
  } catch (error) {
    console.warn('Failed to remove replaced audiobook files:', error);
  }
  return association;
};

/**
 * Saves a pairing that streams from a server: nothing to copy, so only the
 * association is persisted, after which whatever local audio the previous
 * pairing kept under this book is deleted.
 */
export const persistStreamedPairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  association: PairedAudiobook,
  previous: PairedAudiobook | undefined,
  persist: (association: PairedAudiobook) => Promise<void>,
): Promise<PairedAudiobook> => {
  await persist(association);
  try {
    await deleteAudiobookFiles(storage, bookHash, previous?.files ?? []);
  } catch (error) {
    console.warn('Failed to remove replaced audiobook files:', error);
  }
  return association;
};

export const removePairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  association: PairedAudiobook,
  persist: (association: undefined) => Promise<void>,
): Promise<void> => {
  await persist(undefined);
  // A streamed pairing never created the directory.
  if (association.source) return;
  await storage.deleteDir(getAudiobookDirectory(bookHash), 'Books', true);
};
