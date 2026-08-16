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

export const importPairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  mappings: AudiobookChapterMapping[],
  importFiles: AudiobookImportFile[],
  previous?: PairedAudiobook,
): Promise<PairedAudiobook> => {
  const directory = getAudiobookDirectory(bookHash);
  await storage.createDir(directory, 'Books', true);

  const files: AudiobookFile[] = [];
  for (const { file, sourcePath, metadata } of importFiles) {
    const filename = `${metadata.id}-${makeSafeFilename(metadata.name)}`;
    const path = `${directory}/${filename}`;
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

  const nextPaths = new Set(files.map((file) => file.path));
  for (const oldFile of previous?.files ?? []) {
    if (!nextPaths.has(oldFile.path)) await storage.deleteFile(oldFile.path, 'Books');
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
    createdAt: Date.now(),
  };
};

export const removePairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  _association: PairedAudiobook,
): Promise<void> => {
  await storage.deleteDir(getAudiobookDirectory(bookHash), 'Books', true);
};
