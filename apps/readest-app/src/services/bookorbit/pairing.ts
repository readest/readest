// Pairing a BookOrbit ebook with the audiobook of the same BookOrbit book.
//
// Unlike the Audiobookshelf pairing, there is nothing for the user to match
// up: one BookOrbit book owns both the EPUB and the audio assets, and its OPDS
// entry offers them together ("Download EPUB" beside "Play"). So the pairing
// can be built outright on import, chapter 1 against chapter 1, instead of
// putting a wizard in front of someone who has no choice to make.
//
// The shape follows the ABS pairing exactly: one virtual file spanning the
// book, chapters timed on the global timeline, and the track list carried
// along so playback can map that timeline onto the server's assets.
import { buildSequentialAudiobookMappings } from '@/services/audiobook/mapping';
import type { TOCItem } from '@/libs/document';
import type { AudiobookChapter, AudiobookFile, PairedAudiobook } from '@/types/book';
import { makeBookOrbitAudioFilePath } from './audiobookId';
import { manifestChapters, manifestTracks } from './manifest';
import type { BookOrbitManifest } from './manifest';

/** Id of the single virtual file a streamed BookOrbit pairing spans. */
export const BOOKORBIT_PAIRED_FILE_ID = 'bookorbit';

/**
 * Top-level TOC entries only, in reading order.
 *
 * A sub-section nested under a chapter ("I", "II", "III" inside one story) is
 * never its own audio chapter, so flattening the tree the way the pairing
 * wizard does makes the ebook list longer than the recording and defeats the
 * count check below.
 */
export const collectTopLevelChapterIds = (toc: TOCItem[]): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of toc) {
    const href = item.href?.trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    ids.push(href);
  }
  return ids;
};

// Non-narrative sections publishers put around the text. Standard Ebooks and
// most EPUB toolchains name these files predictably, and a recording of the
// book proper never includes them.
const MATTER = [
  'titlepage',
  'title-page',
  'halftitle',
  'half-title',
  'cover',
  'imprint',
  'colophon',
  'uncopyright',
  'copyright',
  'dedication',
  'epigraph',
  'acknowledgements',
  'acknowledgments',
  'toc',
  'contents',
];

const isMatter = (id: string): boolean => {
  const name = (id.split('/').pop() ?? id).replace(/\.x?html?$/i, '').toLowerCase();
  return MATTER.includes(name);
};

/**
 * The ebook chapters that correspond to a recording of `audioCount` chapters,
 * or an empty list when no confident alignment exists.
 *
 * Trimming front and back matter is allowed only to *reach* an exact match:
 * the whole risk of auto-pairing is narrating the wrong text, so an
 * approximate fit is worse than leaving it to the pairing dialog.
 */
export const alignEbookChapters = (ids: string[], audioCount: number): string[] => {
  if (audioCount <= 0) return [];
  if (ids.length === audioCount) return ids;
  if (ids.length < audioCount) return [];

  let start = 0;
  let end = ids.length;
  while (start < end && isMatter(ids[start]!)) start++;
  while (end > start && isMatter(ids[end - 1]!)) end--;
  const trimmed = ids.slice(start, end);
  return trimmed.length === audioCount ? trimmed : [];
};

export const buildBookOrbitPairing = (
  manifest: BookOrbitManifest,
  ebookChapterIds: string[],
): PairedAudiobook => {
  const tracks = manifestTracks(manifest);
  const chapters = manifestChapters(manifest);
  const duration = tracks.reduce((sum, track) => sum + track.duration, 0);

  const file: AudiobookFile = {
    id: BOOKORBIT_PAIRED_FILE_ID,
    name: manifest.book.title,
    path: makeBookOrbitAudioFilePath(manifest.book.id),
    duration,
  };

  // Keyed by sequence, not by position: `manifestChapters` sorts its output but
  // `manifest.chapters` keeps the server's order, so indexing into the raw
  // array pairs a title and timing with another chapter's id whenever the
  // server answers out of order.
  const idBySequence = new Map(manifest.chapters.map((chapter) => [chapter.sequence, chapter.id]));

  const audioChapters: AudiobookChapter[] = chapters.map((chapter) => ({
    // The manifest's own chapter id, so a re-pair against the same book keeps
    // existing mappings pointing at the same audio. `ABSChapter.id` carries the
    // sequence (see manifestChapters).
    id: idBySequence.get(chapter.id) ?? String(chapter.id),
    fileId: BOOKORBIT_PAIRED_FILE_ID,
    label: chapter.title,
    start: chapter.start,
    end: chapter.end,
  }));

  const audioChapterIds = audioChapters.map((chapter) => chapter.id);
  // Map first-to-first ONLY when the two lists are the same length. An EPUB
  // TOC usually opens with front matter (titlepage, imprint) and often nests
  // sub-sections, so anchoring blind shifted every chapter: titlepage took
  // audio chapter 1 and the real first chapter narrated the third. Equal
  // counts are the signal that the TOC really is one entry per audio chapter;
  // anything else is left for the pairing dialog, which opens pre-populated
  // with these files and chapters so only the anchor is left to choose.
  const aligned = alignEbookChapters(ebookChapterIds, audioChapterIds.length);
  const mappings =
    aligned.length > 0
      ? buildSequentialAudiobookMappings(aligned, audioChapterIds, {
          ebookChapterId: aligned[0]!,
          audioChapterId: audioChapterIds[0]!,
        })
      : [];

  return {
    version: 1,
    title: manifest.book.title,
    ...(manifest.book.narrators?.[0] ? { narrator: manifest.book.narrators[0] } : {}),
    files: [file],
    chapters: audioChapters,
    mappings,
    createdAt: Date.now(),
    source: {
      kind: 'bookorbit',
      bookId: manifest.book.id,
      tracks: tracks.map((track) => ({
        index: track.index,
        startOffset: track.startOffset,
        duration: track.duration,
        contentUrl: track.contentUrl,
      })),
    },
  };
};
