// Wires a library book backed by an Audiobookshelf server into a live
// AudiobookController session: resolves the server, fetches the expanded
// item (tracks + chapters), opens the server-side listening session (which
// resolves the resume position), and claims the controller on the shared
// TTSSessionManager slot so the same background-session machinery TTS uses
// (lock screen, sleep timer, NowPlayingBar) drives audiobook playback too.
//
// Idempotent: reopening the same book hash while its session is still alive
// reuses it instead of claiming a second one.

import { convertFileSrc } from '@tauri-apps/api/core';
import { AudiobookController, type AudiobookSource } from './AudiobookController';
import { BlobAudioClock, HtmlAudioClock } from './AudiobookClock';
import { NativeAudiobookClock } from './NativeAudiobookClock';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import { AbsProgressSyncer, readLocalLastPlayedAt } from '@/services/audiobookshelf/progressSync';
import { loadAbsOfflineManifest } from '@/services/audiobookshelf/offline';
import { findABSServerById, useABSServerStore } from '@/store/absServerStore';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import type { TTSMediaBridgeMeta } from '@/services/tts/ttsMediaBridge';
import { buildAbsMediaUrl, parseAbsFilePath } from '@/utils/audiobook';
import { getOSPlatform, stubTranslation as _, uniqueId } from '@/utils/misc';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type {
  ABSChapter,
  ABSEpisode,
  ABSMediaProgress,
  ABSServer,
  ABSTrack,
} from '@/types/audiobookshelf';

// iOS Tauri must use the app-process AVPlayer (mirrors MediaOverlayClient's
// NativeNarrationPlayer split): WebKit HTMLMediaElement / WebAudio cannot own
// the app's non-mixable audio session.
const isIOSTauri = (): boolean => isTauriAppPlatform() && getOSPlatform() === 'ios';

// Android's WebView cannot seek media served by a custom scheme (Chromium
// 40739128), so a downloaded track plays through the same native ExoPlayer
// that EPUB narration uses, straight from its file path.
const isAndroidTauri = (): boolean => isTauriAppPlatform() && getOSPlatform() === 'android';

// The Linux runtime (CEF) has the same custom-scheme range bug and no native
// player, so a downloaded track plays from memory there (BlobAudioClock).
const isLinuxTauri = (): boolean => isTauriAppPlatform() && getOSPlatform() === 'linux';

// A downloaded book opens even when the server is down: past this, playback
// resumes from the local position instead of waiting on the listening session.
const OFFLINE_SESSION_TIMEOUT_MS = 5000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const notifyConnectionError = (serverName: string): void => {
  eventDispatcher.dispatch('toast', {
    message: _('Unable to connect to {{server}}').replace('{{server}}', serverName),
    type: 'error',
  });
};

const notifyServerNotFound = (): void => {
  eventDispatcher.dispatch('toast', {
    message: _('Audiobookshelf server not found'),
    type: 'error',
  });
};

const notifyEpisodeNotFound = (): void => {
  eventDispatcher.dispatch('toast', {
    message: _('Episode not found'),
    type: 'error',
  });
};

/** Resolves the server config for a library book, toasting when it's gone. */
const resolveServer = (book: Book): { itemId: string; server: ABSServer } | null => {
  const parsed = parseAbsFilePath(book.filePath);
  const server = parsed ? findABSServerById(parsed.serverId) : undefined;
  if (!parsed || !server) {
    notifyServerNotFound();
    return null;
  }
  return { itemId: parsed.itemId, server };
};

/**
 * Idempotent: reuses the live session for the same (book hash, episodeId),
 * else claims a new one.
 *
 * A podcast book (`book.absMediaType === 'podcast'`) has no book-level
 * session: `episodeId` is required to open one. Without it, this returns
 * null without claiming or opening any server session, and without a toast
 * - the player route renders the episode list instead, so this isn't an
 * error (see loadAbsEpisodes).
 */
export const openAudiobookSession = async (input: {
  appService: AppService;
  book: Book;
  episodeId?: string;
}): Promise<{ bookKey: string; controller: AudiobookController } | null> => {
  const { appService, book } = input;
  const episodeId = input.episodeId || undefined;

  if (book.absMediaType === 'podcast' && !episodeId) {
    return null;
  }

  const existing = ttsSessionManager.getSessionByHash(book.hash);
  if (existing && existing.controller.kind === 'audiobook') {
    const controller = existing.controller as AudiobookController;
    // A show can have several live-switchable episodes: reuse only when the
    // live session is for the SAME episode. A different episode falls
    // through to claim a fresh session below - TTSSessionManager.claim
    // swaps it into the same slot, tearing the old one down via shutdown,
    // the same as switching to a different book.
    if (controller.getEpisodeId() === episodeId) {
      return { bookKey: existing.bookKey, controller };
    }
  }

  const resolved = resolveServer(book);
  if (!resolved) return null;
  const { itemId, server } = resolved;

  // A download for offline use (#6256) supplies the tracks and chapters, so
  // the server is only needed for progress sync, which may fail.
  const offline =
    book.absDownloadedAt && !episodeId ? await loadAbsOfflineManifest(appService, book.hash) : null;

  try {
    const client = createAbsClient(appService, server);

    let tracks: ABSTrack[];
    let chapters: ABSChapter[];
    let title: string;
    let author: string;
    let duration: number;

    if (offline) {
      tracks = await Promise.all(
        offline.tracks.map(async (track) => ({
          ...track,
          contentUrl: await appService.resolveFilePath(track.contentUrl, 'Books'),
        })),
      );
      chapters = offline.chapters;
      title = book.title;
      author = book.author;
      duration = offline.duration;
    } else if (episodeId) {
      const item = await client.getItemExpanded(itemId);
      const episode = item.media.episodes?.find((e) => e.id === episodeId);
      if (!episode?.audioTrack) {
        notifyEpisodeNotFound();
        return null;
      }
      tracks = [episode.audioTrack];
      chapters = episode.chapters ?? [];
      title = episode.title;
      author = item.media.metadata.title || book.title;
      duration = episode.duration ?? episode.audioTrack.duration;
    } else {
      const item = await client.getItemExpanded(itemId);
      tracks = item.media.tracks ?? [];
      chapters = item.media.chapters ?? [];
      title = book.title;
      author = book.author;
      duration = item.media.duration ?? tracks.reduce((sum, track) => sum + track.duration, 0);
    }

    const syncer = new AbsProgressSyncer({
      client,
      itemId,
      episodeId,
      bookHash: book.hash,
      duration,
      appService,
    });
    // Book.progress is show-level, never per-episode, so an episode has no
    // cached local position to compare against - only readLocalLastPlayedAt's
    // real per-episode timestamp, written on every pause/tick/seek/end by
    // AbsProgressSyncer#cacheLocally. Feeding that real timestamp in here
    // (alongside a hardcoded 0 position) let a fresher local stamp - the app
    // killed right after a pause, before the close-session call landed, or
    // the server's clock running behind the device's - win
    // resolveResumePosition and discard an at-worst-15s-stale server
    // position, restarting the episode from 0. Passing 0 for both args
    // instead makes the server always win for episodes.
    const localPosition = book.progress?.[0] ?? 0;
    const begin = episodeId
      ? syncer.begin(0, 0)
      : syncer.begin(localPosition, readLocalLastPlayedAt(book.hash));
    // Without a session the syncer still caches progress locally.
    const startAt = offline
      ? await withTimeout(begin, OFFLINE_SESSION_TIMEOUT_MS).catch(() => localPosition)
      : await begin;
    const nativeClock = isIOSTauri() || (!!offline && isAndroidTauri());
    const blobClock = !!offline && !nativeClock && isLinuxTauri();

    const sourceObj: AudiobookSource = {
      itemId,
      episodeId,
      title,
      author,
      tracks,
      chapters,
      // Downloaded tracks already carry absolute file paths: the native and
      // blob clocks take them as they are, the WebView element needs an asset
      // URL.
      // Streamed ones read the server's CURRENT accessToken on every call -
      // never a captured copy - so a track load issued after a 401-triggered
      // token refresh (by this client or another, e.g. the periodic library
      // sync) carries the rotated token instead of the one this session
      // started with.
      resolveUrl: offline
        ? (path: string) => (nativeClock || blobClock ? path : convertFileSrc(path))
        : (contentPath: string) =>
            buildAbsMediaUrl(
              useABSServerStore.getState().getServer(server.id) ?? server,
              contentPath,
            ),
      startAt,
    };

    const clock = nativeClock
      ? new NativeAudiobookClock()
      : blobClock
        ? new BlobAudioClock(async (path) => {
            const bytes = await appService.readFile(path, 'None', 'binary');
            const mimeType = tracks.find((track) => track.contentUrl === path)?.mimeType;
            return new Blob([bytes], { type: mimeType });
          })
        : new HtmlAudioClock();
    const controller = new AudiobookController(sourceObj, clock, syncer.hooks());

    const bookKey = `${book.hash}-${uniqueId()}`;
    const meta: TTSMediaBridgeMeta = {
      bookKey,
      title,
      author,
      coverImageUrl: book.coverImageUrl ?? null,
      metadataMode: 'chapter',
      // HtmlAudioClock plays through a WebView media element, and Chromium
      // requests Android audio focus for it in this same app. The media
      // service must not request focus too: Chromium's request preempts it,
      // and the service relays that AUDIOFOCUS_LOSS as a media-session-pause
      // that stopped playback right after it started.
      ownsAudioFocus: nativeClock,
      getSectionLabel: () => controller.getCurrentChapter()?.title,
    };
    ttsSessionManager.claim(bookKey, controller, meta);

    return { bookKey, controller };
  } catch (error) {
    console.warn('[ABS] failed to open audiobook session:', error);
    notifyConnectionError(server.name);
    return null;
  }
};

/**
 * Loads a podcast show's episodes and each episode's server-side progress,
 * for the player route's episode list. Episodes come back newest-first by
 * publishedAt. Never claims a session - pass the chosen episode's id to
 * openAudiobookSession to actually play it.
 */
export const loadAbsEpisodes = async (
  appService: AppService,
  book: Book,
): Promise<{
  episodes: ABSEpisode[];
  progressByEpisodeId: Map<string, ABSMediaProgress>;
} | null> => {
  const resolved = resolveServer(book);
  if (!resolved) return null;
  const { itemId, server } = resolved;

  try {
    const client = createAbsClient(appService, server);
    const [item, me] = await Promise.all([client.getItemExpanded(itemId), client.getMe()]);

    const episodes = [...(item.media.episodes ?? [])].sort(
      (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
    );
    const progressByEpisodeId = new Map<string, ABSMediaProgress>();
    for (const progress of me.mediaProgress) {
      if (progress.libraryItemId === itemId && progress.episodeId) {
        progressByEpisodeId.set(progress.episodeId, progress);
      }
    }

    return { episodes, progressByEpisodeId };
  } catch (error) {
    console.warn('[ABS] failed to load episodes:', error);
    notifyConnectionError(server.name);
    return null;
  }
};
