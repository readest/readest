import type { IChapter } from 'music-metadata';

import type { AudiobookChapter } from '@/types/book';
import { getBaseFilename } from '@/utils/path';

export interface ParsedAudiobookFile {
  id: string;
  name: string;
  duration: number;
  title?: string;
  narrator?: string;
  chapters: AudiobookChapter[];
}

const chapterTime = (value: number | undefined, timeScale: number | undefined): number | null => {
  if (value === undefined || !Number.isFinite(value)) return null;
  return timeScale && timeScale > 0 ? value / timeScale : value;
};

export const buildAudiobookChapters = (
  fileId: string,
  fileName: string,
  duration: number,
  sourceChapters: Pick<IChapter, 'title' | 'start' | 'end' | 'timeScale'>[],
): AudiobookChapter[] => {
  const starts = sourceChapters.map((chapter) => chapterTime(chapter.start, chapter.timeScale));
  const chapters = sourceChapters.flatMap((chapter, index) => {
    const start = starts[index] ?? null;
    const explicitEnd = chapterTime(chapter.end, chapter.timeScale);
    const end = explicitEnd ?? starts[index + 1] ?? duration;
    if (start === null || end === null || end <= start) return [];

    return [
      {
        id: `${fileId}:${index}`,
        fileId,
        label: chapter.title.trim() || `Chapter ${index + 1}`,
        start,
        end,
      },
    ];
  });

  if (chapters.length) return chapters;
  return [
    {
      id: `${fileId}:0`,
      fileId,
      label: getBaseFilename(fileName),
      start: 0,
      end: duration,
    },
  ];
};

export const parseAudiobookFile = async (
  file: File,
  fileId: string,
): Promise<ParsedAudiobookFile> => {
  // Keep the parser's sizeable codec graph out of the reader's initial chunk;
  // it is only needed after the user opens the pairing wizard and picks audio.
  const { parseBlob } = await import('music-metadata');
  const metadata = await parseBlob(file, {
    duration: true,
    includeChapters: true,
    skipCovers: true,
  });
  const duration = metadata.format.duration ?? 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine the duration of ${file.name}`);
  }

  const chapters = buildAudiobookChapters(
    fileId,
    file.name,
    duration,
    metadata.format.chapters ?? [],
  );
  if (!metadata.format.chapters?.length && metadata.common.title?.trim()) {
    chapters[0]!.label = metadata.common.title.trim();
  }

  const title = metadata.common.album?.trim() || metadata.common.work?.trim() || undefined;
  const narrator =
    metadata.common.albumartist?.trim() || metadata.common.artist?.trim() || undefined;
  return {
    id: fileId,
    name: file.name,
    duration,
    ...(title ? { title } : {}),
    ...(narrator ? { narrator } : {}),
    chapters,
  };
};
