// Playable audio from an ordinary OPDS catalog (#6224).
//
// OPDS has no audiobook profile: a feed gives us acquisition links and nothing
// else -- no durations, no chapters, no track ordering beyond document order.
// So this module does the two things the player needs and the feed cannot
// supply: it picks the audio links out of an entry, and it turns them into the
// ABSTrack shape AudiobookTimeline already understands, using durations probed
// from the files themselves.
//
// Everything here is deliberately server-agnostic. The BookOrbit case that
// prompted the issue (#6224) is just the worst-behaved example: it types audio
// as application/octet-stream and names the format only in the link title, so
// detection lives in `formats.ts` and is shared with the download path.
import type { ABSTrack } from '@/types/audiobookshelf';
import type { FormatLink } from './formats';
import { getAudioFormat, isAudioLink } from './formats';

/** Scheme prefix for the synthetic filePath of an OPDS streaming audiobook. */
export const OPDS_AUDIO_SCHEME = 'opdsaudio://';

/** One audio file in an OPDS entry, in feed order. */
export interface OpdsAudioTrackLink {
  href: string;
  mimeType: string;
  title?: string;
}

export interface OpdsAudiobookData {
  /** Catalog the links belong to; the source of credentials at playback time. */
  catalogId: string;
  title: string;
  author: string;
  tracks: OpdsAudioTrackLink[];
}

/**
 * The audio acquisition links of an entry, in feed order.
 *
 * Feed order is the only ordering signal OPDS gives us. Servers that split an
 * audiobook into per-chapter files list them in order (BookOrbit sorts by
 * filename), so it is a better guess than sorting by a title we cannot parse
 * reliably across languages.
 */
export const pickAudioLinks = <T extends FormatLink>(links: T[]): T[] => links.filter(isAudioLink);

/** The media type to hand the audio element, falling back to the detected format. */
export const audioMimeType = (link: FormatLink): string => {
  const declared = (link.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (declared.startsWith('audio/')) return declared;
  const ext = getAudioFormat(link);
  const byExt: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4b: 'audio/mp4',
    m4a: 'audio/mp4',
    opus: 'audio/opus',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    wav: 'audio/wav',
  };
  return byExt[ext] ?? 'audio/mpeg';
};

/**
 * Lay probed durations out into the contiguous timeline AudiobookTimeline
 * expects, where each track's `startOffset` is the sum of everything before it.
 *
 * A track whose duration could not be probed is dropped rather than given a
 * zero: `AudiobookTimeline` derives both the book's total duration and every
 * seek target from these numbers, so one NaN or bogus 0 silently corrupts the
 * position of every later track instead of costing just that file.
 */
export const buildOpdsAudioTracks = (
  links: OpdsAudioTrackLink[],
  durations: number[],
): ABSTrack[] => {
  const tracks: ABSTrack[] = [];
  let startOffset = 0;
  links.forEach((link, i) => {
    const duration = durations[i];
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return;
    tracks.push({
      index: tracks.length,
      startOffset,
      duration,
      contentUrl: link.href,
      mimeType: link.mimeType,
      ...(link.title ? { title: link.title } : {}),
    });
    startOffset += duration;
  });
  return tracks;
};

/**
 * What makes two plays the same audiobook: the catalog it came from and its
 * ordered track URLs. Deliberately excludes title and author, which the
 * catalog can correct without the book becoming a different one.
 */
export const opdsAudioIdentity = (catalogId: string, tracks: OpdsAudioTrackLink[]): string =>
  JSON.stringify({ catalogId, tracks: tracks.map((track) => track.href) });

export const isOpdsAudioFilePath = (filePath: string | undefined): boolean =>
  !!filePath && filePath.startsWith(OPDS_AUDIO_SCHEME);

/**
 * Pack the whole entry into the synthetic filePath, the way `pse://` does for a
 * streamed comic. An OPDS audiobook has no server-side id to point at -- the
 * links ARE its identity -- so they travel with the book rather than being
 * re-fetched from a feed the user may have navigated away from.
 */
export const makeOpdsAudioFilePath = (data: OpdsAudiobookData): string =>
  OPDS_AUDIO_SCHEME + encodeURIComponent(JSON.stringify(data));

const isAudiobookData = (value: unknown): value is OpdsAudiobookData => {
  const data = value as OpdsAudiobookData | null;
  return (
    !!data &&
    typeof data.catalogId === 'string' &&
    typeof data.title === 'string' &&
    typeof data.author === 'string' &&
    Array.isArray(data.tracks) &&
    data.tracks.every(
      (track) => !!track && typeof track.href === 'string' && typeof track.mimeType === 'string',
    )
  );
};

/**
 * The entry packed into a synthetic filePath, or null when it is not one we can
 * play. Validated rather than cast: the string survives in the library across
 * releases, so a row written by an older build (or edited by hand) must fail
 * here rather than as a property access deep inside the session opener.
 */
export const parseOpdsAudioFilePath = (filePath: string | undefined): OpdsAudiobookData | null => {
  if (!isOpdsAudioFilePath(filePath)) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(filePath!.slice(OPDS_AUDIO_SCHEME.length)));
    return isAudiobookData(data) ? data : null;
  } catch {
    return null;
  }
};
