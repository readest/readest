// Wires a library book backed by an Audiobookshelf server into a live
// AudiobookController session: resolves the server, fetches the expanded
// item (tracks + chapters), opens the server-side listening session (which
// resolves the resume position), and claims the controller on the shared
// TTSSessionManager slot so the same background-session machinery TTS uses
// (lock screen, sleep timer, NowPlayingBar) drives audiobook playback too.
//
// Idempotent: reopening the same book hash while its session is still alive
// reuses it instead of claiming a second one.

import { AudiobookController, type AudiobookSource } from './AudiobookController';
import { HtmlAudioClock } from './AudiobookClock';
import { NativeAudiobookClock } from './NativeAudiobookClock';
import { ABSClient } from '@/services/audiobookshelf/client';
import { AbsProgressSyncer, readLocalLastPlayedAt } from '@/services/audiobookshelf/progressSync';
import { findABSServerById, useABSServerStore } from '@/store/absServerStore';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import type { TTSMediaBridgeMeta } from '@/services/tts/ttsMediaBridge';
import { parseAbsFilePath } from '@/utils/audiobook';
import { getOSPlatform, stubTranslation as _, uniqueId } from '@/utils/misc';
import { isTauriAppPlatform, type EnvConfigType } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { ABSServer } from '@/types/audiobookshelf';

// iOS Tauri must use the app-process AVPlayer (mirrors MediaOverlayClient's
// NativeNarrationPlayer split): WebKit HTMLMediaElement / WebAudio cannot own
// the app's non-mixable audio session.
const isIOSTauri = (): boolean => isTauriAppPlatform() && getOSPlatform() === 'ios';

const toEnvConfig = (appService: AppService): EnvConfigType => ({
  getAppService: async () => appService,
});

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

/** Idempotent: reuses the live session for the same book hash, else claims a new one. */
export const openAudiobookSession = async (input: {
  appService: AppService;
  book: Book;
}): Promise<{ bookKey: string; controller: AudiobookController } | null> => {
  const { appService, book } = input;

  const existing = ttsSessionManager.getSessionByHash(book.hash);
  if (existing && existing.controller.kind === 'audiobook') {
    return { bookKey: existing.bookKey, controller: existing.controller as AudiobookController };
  }

  const parsed = parseAbsFilePath(book.filePath);
  const server: ABSServer | undefined = parsed ? findABSServerById(parsed.serverId) : undefined;
  if (!parsed || !server) {
    notifyServerNotFound();
    return null;
  }

  try {
    const client = new ABSClient(server, {
      onTokensUpdated: (patch) => {
        useABSServerStore.getState().updateServer(server.id, patch);
        void useABSServerStore.getState().saveABSServers(toEnvConfig(appService));
      },
    });

    const item = await client.getItemExpanded(parsed.itemId);
    const tracks = item.media.tracks ?? [];
    const chapters = item.media.chapters ?? [];
    const duration = item.media.duration ?? tracks.reduce((sum, track) => sum + track.duration, 0);

    const syncer = new AbsProgressSyncer({
      client,
      itemId: parsed.itemId,
      bookHash: book.hash,
      duration,
      appService,
    });
    const startAt = await syncer.begin(book.progress?.[0] ?? 0, readLocalLastPlayedAt(book.hash));

    const sourceObj: AudiobookSource = {
      itemId: parsed.itemId,
      title: book.title,
      author: book.author,
      tracks,
      chapters,
      // Reads the server's CURRENT accessToken on every call - never a
      // captured copy - so a track load issued after a 401-triggered token
      // refresh (by this client or another, e.g. the periodic library sync)
      // carries the rotated token instead of the one this session started
      // with.
      resolveUrl: (contentPath: string) => {
        const current = useABSServerStore.getState().getServer(server.id) ?? server;
        const base = current.url.replace(/\/+$/, '');
        const separator = contentPath.includes('?') ? '&' : '?';
        return `${base}${contentPath}${separator}token=${current.accessToken ?? ''}`;
      },
      startAt,
    };

    const clock = isIOSTauri() ? new NativeAudiobookClock() : new HtmlAudioClock();
    const controller = new AudiobookController(sourceObj, clock, syncer.hooks());

    const bookKey = `${book.hash}-${uniqueId()}`;
    const meta: TTSMediaBridgeMeta = {
      bookKey,
      title: book.title,
      author: book.author,
      coverImageUrl: book.coverImageUrl ?? null,
      metadataMode: 'chapter',
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
