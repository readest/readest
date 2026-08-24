// Pairing an ebook with an audiobook that lives on an Audiobookshelf server.
//
// The pairing wizard and the narration player both see the item as ONE
// virtual file on the item's global timeline: ABS times its chapters globally
// and they routinely span several media files, which per-file chapter clocks
// (the local pairing model) cannot express. The track list travels with the
// association so playback can map that timeline onto the server's files
// without fetching the expanded item again.

import type { NarrationTrack } from '@/services/tts/mediaOverlay/MultiTrackNarrationClock';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import { findABSServerById, isAbsBookOrphaned } from '@/store/absServerStore';
import type { ABSLibraryItem } from '@/types/audiobookshelf';
import type { AudiobookChapter, AudiobookFile, Book, PairedAudiobookAbsSource } from '@/types/book';
import type { AppService } from '@/types/system';
import {
  buildAbsMediaUrl,
  isAudiobook,
  makeAbsFilePath,
  parseAbsFilePath,
} from '@/utils/audiobook';
import { getBaseFilename } from '@/utils/path';

export const ABS_PAIRED_FILE_ID = 'abs';

/** Everything the wizard needs before the user maps chapters. */
export interface AbsPairingSource {
  title?: string;
  narrator?: string;
  files: AudiobookFile[];
  chapters: AudiobookChapter[];
  source: PairedAudiobookAbsSource;
}

/** Library audiobooks that can be paired: live ABS books whose server is still configured. */
export const listPairableAbsBooks = (library: Book[]): Book[] =>
  library
    .filter(
      (book) =>
        isAudiobook(book) &&
        !book.deletedAt &&
        book.absMediaType !== 'podcast' &&
        !isAbsBookOrphaned(book),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

export const buildAbsPairingSource = (item: ABSLibraryItem, serverId: string): AbsPairingSource => {
  const tracks = [...(item.media.tracks ?? [])].sort((a, b) => a.startOffset - b.startOffset);
  if (!tracks.length) throw new Error('This audiobook has no audio tracks.');
  // The global endpoint, not the sum: a gap or overlap between track offsets
  // makes the two differ, and chapter ends are clamped against this value.
  const duration = Math.max(...tracks.map((track) => track.startOffset + track.duration));
  const title = item.media.metadata.title?.trim() || undefined;
  const { narrators, narratorName } = item.media.metadata;
  const narrator =
    narrators
      ?.map((name) => name.trim())
      .filter(Boolean)
      .join(', ') ||
    narratorName?.trim() ||
    undefined;

  const fromItem = (item.media.chapters ?? []).flatMap((chapter, index) => {
    const end = Math.min(chapter.end, duration);
    if (!(end > chapter.start)) return [];
    return [
      {
        id: `${ABS_PAIRED_FILE_ID}:${chapter.id}`,
        fileId: ABS_PAIRED_FILE_ID,
        label: chapter.title.trim() || `Chapter ${index + 1}`,
        start: chapter.start,
        end,
      },
    ];
  });
  // No chapter table: each media file is a chapter, as the local flow does
  // for tracks without chapter metadata.
  const chapters = fromItem.length
    ? fromItem
    : tracks.map((track, index) => ({
        id: `${ABS_PAIRED_FILE_ID}:track:${track.index}`,
        fileId: ABS_PAIRED_FILE_ID,
        label: track.title?.trim() ? getBaseFilename(track.title) : `Track ${index + 1}`,
        start: track.startOffset,
        end: track.startOffset + track.duration,
      }));

  return {
    ...(title ? { title } : {}),
    ...(narrator ? { narrator } : {}),
    files: [
      {
        id: ABS_PAIRED_FILE_ID,
        name: title ?? 'audiobook',
        path: makeAbsFilePath(serverId, item.id),
        duration,
      },
    ],
    chapters,
    source: {
      kind: 'audiobookshelf',
      serverId,
      itemId: item.id,
      tracks: tracks.map(({ index, startOffset, duration, contentUrl }) => ({
        index,
        startOffset,
        duration,
        contentUrl,
      })),
    },
  };
};

/** Fetches the expanded item behind a library ABS book and prepares it for pairing. */
export const loadAbsPairingSource = async (
  appService: AppService,
  book: Book,
): Promise<AbsPairingSource> => {
  const parsed = parseAbsFilePath(book.filePath);
  const server = parsed ? findABSServerById(parsed.serverId) : undefined;
  if (!parsed || !server) throw new Error('Audiobookshelf server not found');
  const item = await createAbsClient(appService, server).getItemExpanded(parsed.itemId);
  return buildAbsPairingSource(item, server.id);
};

/**
 * The source's tracks as streamable URLs carrying the server's CURRENT
 * access token, read at call time so a token rotated mid-session (by any
 * client) is picked up by the next file load. Null when the server row is
 * gone.
 */
export const absNarrationTracks = (source: PairedAudiobookAbsSource): NarrationTrack[] | null => {
  const server = findABSServerById(source.serverId);
  if (!server) return null;
  return source.tracks.map((track) => ({
    url: buildAbsMediaUrl(server, track.contentUrl),
    startOffset: track.startOffset,
    duration: track.duration,
  }));
};

/**
 * The file holding a global position, for previewing a chapter from its start.
 * `duration` is the selected track's length, so a caller can keep the preview
 * within the file even when the chapter continues into the next track.
 */
export const absPreviewClip = (
  source: PairedAudiobookAbsSource,
  globalSec: number,
): { url: string; start: number; duration: number } | null => {
  const tracks = absNarrationTracks(source);
  if (!tracks?.length) return null;
  const sorted = [...tracks].sort((a, b) => a.startOffset - b.startOffset);
  const track =
    [...sorted].reverse().find((candidate) => candidate.startOffset <= globalSec) ?? sorted[0]!;
  return {
    url: track.url,
    start: Math.max(0, Math.min(globalSec - track.startOffset, track.duration)),
    duration: track.duration,
  };
};
