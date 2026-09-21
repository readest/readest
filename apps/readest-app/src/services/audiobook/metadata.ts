import type { IChapter } from 'music-metadata';

import type { AudiobookChapter } from '@/types/book';
import { getBaseFilename } from '@/utils/path';
import { readMp4Chapters } from './mp4Chapters';

type ChapterSource = Pick<IChapter, 'title' | 'start' | 'end' | 'timeScale'>;

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
  sourceChapters: ChapterSource[],
  fallbackLabel?: string,
): AudiobookChapter[] => {
  const starts = sourceChapters.map((chapter) => chapterTime(chapter.start, chapter.timeScale));
  const chapters = sourceChapters.flatMap((chapter, index) => {
    const start = starts[index] ?? null;
    const explicitEnd = chapterTime(chapter.end, chapter.timeScale);
    const rawEnd = explicitEnd ?? starts[index + 1] ?? duration;
    if (start === null || rawEnd === null) return [];
    // Clamping to the audio keeps a misread timescale from seeking past the
    // end, and leaves a chapter starting at or after it with no room, so the
    // check below drops it.
    const end = Math.min(rawEnd, duration);
    if (end <= start) return [];

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
      label: fallbackLabel?.trim() || getBaseFilename(fileName),
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

  let sourceChapters: ChapterSource[] = metadata.format.chapters ?? [];
  if (!sourceChapters.length) {
    // music-metadata misses MP4 chapters when moov follows the audio, and
    // never reads Nero chapters; see mp4Chapters.ts.
    sourceChapters = await readMp4Chapters(file).catch((error) => {
      console.warn(`Failed to read MP4 chapters from ${file.name}:`, error);
      return [];
    });
  }
  // The embedded title names the single chapter only when no chapter list
  // survived, so a file whose chapters are all rejected keeps its title.
  const chapters = buildAudiobookChapters(
    fileId,
    file.name,
    duration,
    sourceChapters,
    metadata.common.title,
  );

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
