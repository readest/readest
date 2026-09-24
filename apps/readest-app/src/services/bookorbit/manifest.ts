// BookOrbit's audiobook manifest, and the mapping onto the timeline types the
// player already speaks.
//
// This is the whole reason for a BookOrbit connector alongside the generic OPDS
// path: OPDS hands out files to acquire, so a multi-part audiobook arrives as
// unordered links with no durations, no chapters and a generic media type. The
// manifest answers all of that in one request, and its asset route serves real
// byte ranges — so nothing has to be downloaded to build a timeline.
import type { ABSChapter, ABSTrack } from '@/types/audiobookshelf';

export const MANIFEST_SCHEMA = 'bookorbit.audiobook-manifest';

/**
 * The manifest version this client understands. BookOrbit stamps a schema name
 * and version on every manifest, which is what lets us refuse a payload we
 * would otherwise misread — the caller falls back to the OPDS path instead.
 */
export const SUPPORTED_SCHEMA_VERSION = 2;

export interface BookOrbitAsset {
  assetId: string;
  sequence: number;
  format: string;
  durationMs: number;
  sizeBytes: number;
  etag: string;
}

export interface BookOrbitChapter {
  id: string;
  title: string;
  assetId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  assetOffsetMs: number;
}

export interface BookOrbitManifest {
  schema: string;
  schemaVersion: number;
  /** Changes when the book's files do; playback-state writes are keyed to it. */
  revision: string;
  book: { id: number; title: string; authors: string[]; narrators: string[]; hasCover?: boolean };
  assets: BookOrbitAsset[];
  chapters: BookOrbitChapter[];
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

export const isSupportedManifest = (value: unknown): value is BookOrbitManifest => {
  const m = value as BookOrbitManifest | null;
  return (
    !!m &&
    m.schema === MANIFEST_SCHEMA &&
    m.schemaVersion === SUPPORTED_SCHEMA_VERSION &&
    Array.isArray(m.assets) &&
    Array.isArray(m.chapters) &&
    !!m.book
  );
};

/** Server-relative path of an asset's bytes; answers HTTP Range with 206. */
export const assetContentPath = (bookId: number, assetId: string): string =>
  `/api/v1/audiobooks/${bookId}/assets/${encodeURIComponent(assetId)}/content`;

/**
 * Assets as timeline tracks, laid end to end in `sequence` order.
 *
 * Offsets are derived here rather than read from the manifest: the chapter
 * entries carry absolute times, but the assets themselves only declare their
 * own duration, so the running total is ours to keep.
 */
export const manifestTracks = (manifest: BookOrbitManifest): ABSTrack[] => {
  const ordered = [...manifest.assets].sort((a, b) => a.sequence - b.sequence);
  let startOffset = 0;
  return ordered.map((asset, index) => {
    const duration = asset.durationMs / 1000;
    const track: ABSTrack = {
      index,
      startOffset,
      duration,
      contentUrl: assetContentPath(manifest.book.id, asset.assetId),
      mimeType: AUDIO_MIME_TYPES[asset.format.toLowerCase()] ?? 'audio/mpeg',
      metadata: { size: asset.sizeBytes },
    };
    startOffset += duration;
    return track;
  });
};

/** Chapters in the global seconds `AudiobookTimeline` sorts and searches by. */
export const manifestChapters = (manifest: BookOrbitManifest): ABSChapter[] =>
  [...manifest.chapters]
    .sort((a, b) => a.sequence - b.sequence)
    // `ABSChapter.id` is numeric; the manifest's `ch_<hex>` id has no ordering,
    // so the sequence carries the identity the player actually uses.
    .map((chapter) => ({
      id: chapter.sequence,
      start: chapter.startMs / 1000,
      end: chapter.endMs / 1000,
      title: chapter.title,
    }));

/**
 * Asset ids in the same order as {@link manifestTracks} returns tracks, so a
 * track index addresses both.
 */
export const manifestAssetIds = (manifest: BookOrbitManifest): string[] =>
  [...manifest.assets].sort((a, b) => a.sequence - b.sequence).map((asset) => asset.assetId);

/**
 * A BookOrbit playback position (an offset *within one asset*) as an offset
 * into the whole book. Reading it as a global position put every resume in the
 * first chapter, however far in the listener actually was.
 */
export const globalFromAssetPosition = (
  tracks: ABSTrack[],
  assetIds: string[],
  assetId: string,
  positionMs: number,
): number | null => {
  const index = assetIds.indexOf(assetId);
  const track = index >= 0 ? tracks[index] : undefined;
  // An asset the manifest no longer lists means the book's files changed; the
  // caller falls back to the local position rather than guessing.
  if (!track) return null;
  return track.startOffset + positionMs / 1000;
};

/** The inverse: which asset a global position falls in, and how far into it. */
export const assetPositionFromGlobal = (
  tracks: ABSTrack[],
  assetIds: string[],
  globalSec: number,
): { assetId: string; positionMs: number } | null => {
  if (tracks.length === 0) return null;
  const clamped = Math.max(0, globalSec);
  // Last track whose start is at or before the position; a position exactly on
  // a boundary belongs to the track beginning there.
  let index = 0;
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i]!.startOffset <= clamped) index = i;
    else break;
  }
  const track = tracks[index]!;
  const within = Math.min(clamped - track.startOffset, track.duration);
  return { assetId: assetIds[index]!, positionMs: Math.round(within * 1000) };
};
