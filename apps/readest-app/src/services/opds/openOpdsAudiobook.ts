// Opens a playback session for an OPDS audiobook (#6224).
//
// Kept beside the other OPDS services rather than folded into
// `openAudiobook.ts`: that opener is wholly about Audiobookshelf -- its
// client, its progress sessions, its podcast episodes -- and an OPDS catalog
// shares none of it. All this needs from the audiobook layer is the pieces
// that are already source-agnostic: AudiobookController, AudiobookTimeline via
// ABSTrack, and the TTS session manager.
import { BlobAudioClock, HtmlAudioClock } from '@/services/audiobook/AudiobookClock';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import type { AudiobookSource } from '@/services/audiobook/AudiobookController';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import type { TTSMediaBridgeMeta } from '@/services/tts/ttsMediaBridge';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { uniqueId } from '@/utils/misc';
import { buildOpdsAudioTracks, parseOpdsAudioFilePath } from './audiobook';
import {
  buildOpdsAudioUrl,
  canStreamOpdsAudio,
  fetchOpdsAudioBlob,
  opdsAudioBlocker,
  probeAudioDurations,
  resolveOpdsAudioAuth,
} from './audioStream';

export interface OpdsAudiobookSession {
  bookKey: string;
  controller: AudiobookController;
}

/** Thrown when a password-protected catalog is opened on the web platform. */
export class OpdsAudioWebAuthError extends Error {
  constructor() {
    super('opds-audio-web-auth');
    this.name = 'OpdsAudioWebAuthError';
  }
}

/** At least one track's duration could not be read, so the timeline is wrong. */
export class OpdsAudioIncompleteError extends Error {
  constructor() {
    super('opds-audio-incomplete');
    this.name = 'OpdsAudioIncompleteError';
  }
}

/** Matches the ABS syncer: keep the row live in the store, write to disk rarely. */
const PERSIST_THROTTLE_MS = 15000;

/**
 * Resume position. OPDS has no server-side playback state, so unlike the ABS
 * path this is purely local: `Book.progress` is the only record, written back
 * through the controller's hooks.
 *
 * A book saved at its end is finished, not paused. Resuming there puts the
 * clock past the last track, the session ends the instant it starts, and
 * PlayerView#onGoBack bounces the route straight back out -- so a finished
 * audiobook could never be played again. Replay from the start instead.
 */
const readLocalPosition = (book: Book, duration: number): number => {
  const position = book.progress?.[0] ?? 0;
  if (position <= 0) return 0;
  const end = book.progress?.[1] || duration;
  return end > 0 && position >= end - 1 ? 0 : position;
};

/**
 * Record the book's length on its library row.
 *
 * The shelf reads `book.duration` (see BookItem), not `progress[1]`. A
 * streaming stub is created before its tracks are known, so without this the
 * row has no length: unplayed it showed nothing, and once playback wrote a
 * position it rendered "-0:00" while the player showed the real remaining
 * time.
 */
const recordDuration = (appService: AppService, bookHash: string, duration: number): void => {
  const { library, setLibrary } = useLibraryStore.getState();
  const idx = library.findIndex((b) => b.hash === bookHash);
  if (idx === -1 || library[idx]!.duration === duration) return;
  const newLibrary = library.slice();
  newLibrary[idx] = { ...library[idx]!, duration };
  setLibrary(newLibrary);
  Promise.resolve(appService.saveLibraryBooks(newLibrary)).catch(console.warn);
};

const makeProgressSaver = (appService: AppService, bookHash: string, duration: number) => {
  let lastPersistAt = 0;
  return (positionSec: number, force: boolean): void => {
    const { library, setLibrary } = useLibraryStore.getState();
    const idx = library.findIndex((b) => b.hash === bookHash);
    if (idx === -1) return;
    const now = Date.now();
    const progress: [number, number] = [Math.round(positionSec), Math.round(duration)];
    // Bump updatedAt so Date Read sorting reflects listening activity, the
    // same way the reader's progress saves do for regular books.
    const newLibrary = library.slice();
    newLibrary[idx] = { ...library[idx]!, progress, updatedAt: now };
    setLibrary(newLibrary);

    if (force || now - lastPersistAt >= PERSIST_THROTTLE_MS) {
      lastPersistAt = now;
      Promise.resolve(appService.saveLibraryBooks(newLibrary)).catch(console.warn);
    }
  };
};

export const openOpdsAudiobookSession = async (input: {
  appService: AppService;
  book: Book;
}): Promise<OpdsAudiobookSession | null> => {
  const { appService, book } = input;
  const data = parseOpdsAudioFilePath(book.filePath);
  if (!data || data.tracks.length === 0) return null;

  // `getSessionByHash` returns the last session for this hash whether or not
  // its controller is still alive, so a book played once would hand the player
  // a terminated controller on every later open and the route bounced right
  // back out. Only a live controller is worth reusing.
  const existing = ttsSessionManager.getSessionByHash(book.hash);
  if (existing && existing.controller.kind === 'audiobook' && !existing.controller.terminated) {
    return { bookKey: existing.bookKey, controller: existing.controller as AudiobookController };
  }

  const first = data.tracks[0]!;
  const auth = await resolveOpdsAudioAuth(data.catalogId, first.href);

  // Web has no way to reach an authenticated catalog once the proxy is ruled
  // out (see audioStream.ts): the element cannot send credentials and a
  // cross-origin fetch needs CORS the catalog will not send. Fail loudly here
  // rather than relaying the user's media through Readest's servers.
  if (opdsAudioBlocker(first.href, auth) === 'web-auth') {
    throw new OpdsAudioWebAuthError();
  }

  // Streamable: the element fetches the URL itself, so it issues its own Range
  // requests straight to the catalog and playback starts on the first few KB.
  // Otherwise the bytes come through a headered fetch first (native only).
  const streamable = canStreamOpdsAudio(auth);

  // Durations come from each file's header (a few KB), so nothing has to be
  // downloaded to build the timeline. That is what lets the non-streamable
  // path stay lazy: BlobAudioClock fetches a track when it is actually played
  // and releases the previous one, instead of pulling the whole book up front.
  const playUrls = data.tracks.map((track) => buildOpdsAudioUrl(track.href));
  const durations = await probeAudioDurations(
    playUrls,
    data.tracks.map((track) => ({ href: track.href, auth })),
  );
  const tracks = buildOpdsAudioTracks(data.tracks, durations);
  if (tracks.length === 0) return null;
  // A track whose duration could not be read is dropped by the layout above,
  // which closes the gap and shifts every later track earlier. Playing that
  // silently would lose a chapter and put every seek and saved position in the
  // wrong place, so an incomplete timeline is refused instead.
  if (tracks.length !== data.tracks.length) throw new OpdsAudioIncompleteError();

  const mimeByHref = new Map(data.tracks.map((track) => [track.href, track.mimeType]));

  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

  const source: AudiobookSource = {
    itemId: book.hash,
    title: data.title || book.title,
    author: data.author || book.author,
    tracks,
    // OPDS carries no chapter metadata. With none supplied the timeline falls
    // back to track boundaries, which for a per-chapter-file audiobook (the
    // common shape) is the same thing.
    chapters: [],
    // Both clocks take the catalog href as-is: the streaming clock loads it
    // directly, the blob clock hands it to the loader below.
    resolveUrl: (contentPath: string) => contentPath,
    startAt: readLocalPosition(book, totalDuration),
  };

  recordDuration(appService, book.hash, totalDuration);
  const saveProgress = makeProgressSaver(appService, book.hash, totalDuration);

  const clock = streamable
    ? new HtmlAudioClock()
    : new BlobAudioClock((href) =>
        fetchOpdsAudioBlob(href, auth, mimeByHref.get(href) ?? 'audio/mpeg'),
      );

  const controller = new AudiobookController(source, clock, {
    onTick: (position) => saveProgress(position, false),
    onSeek: (position) => saveProgress(position, false),
    onPause: (position) => saveProgress(position, true),
    onEnd: (position) => saveProgress(position, true),
  });

  const bookKey = `${book.hash}-${uniqueId()}`;
  const meta: TTSMediaBridgeMeta = {
    bookKey,
    title: source.title,
    author: source.author,
    coverImageUrl: book.coverImageUrl ?? null,
    metadataMode: 'chapter',
    // HtmlAudioClock plays through the WebView media element, which requests
    // Android audio focus itself; the media service must not also claim it.
    ownsAudioFocus: false,
    getSectionLabel: () => controller.getCurrentChapter()?.title,
  };
  ttsSessionManager.claim(bookKey, controller, meta);

  return { bookKey, controller };
};
