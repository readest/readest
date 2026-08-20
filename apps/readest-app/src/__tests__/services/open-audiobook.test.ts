import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService, OsPlatform } from '@/types/system';
import type { Book } from '@/types/book';
import type { AudiobookSource } from '@/services/audiobook/AudiobookController';
import type { ABSLibraryItem, ABSMediaProgress, ABSServer } from '@/types/audiobookshelf';
import { makeAbsFilePath } from '@/utils/audiobook';

// vi.mock factories are hoisted above const initializers, so shared spies
// referenced eagerly inside a factory MUST come from vi.hoisted() (mirrors
// abs-form.test.tsx).
const mocks = vi.hoisted(() => ({
  getItemExpanded: vi.fn(),
  getMe: vi.fn(async (): Promise<{ mediaProgress: ABSMediaProgress[] }> => ({ mediaProgress: [] })),
  syncerBegin: vi.fn(async () => 42),
  readLocalLastPlayedAt: vi.fn(() => 0),
  syncerHooksResult: { onPause: vi.fn() },
  claim: vi.fn(),
  getSessionByHash: vi.fn(() => null as { bookKey: string; controller: unknown } | null),
  controllerCtor: vi.fn(),
  getOSPlatform: vi.fn((): OsPlatform => 'macos'),
  isTauriAppPlatform: vi.fn(() => false),
}));

vi.mock('@/services/audiobookshelf/client', () => ({
  ABSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    server: ABSServer,
  ) {
    Object.assign(this, { server, getItemExpanded: mocks.getItemExpanded, getMe: mocks.getMe });
  }),
}));

vi.mock('@/services/audiobookshelf/progressSync', () => ({
  AbsProgressSyncer: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, { begin: mocks.syncerBegin, hooks: vi.fn(() => mocks.syncerHooksResult) });
  }),
  readLocalLastPlayedAt: mocks.readLocalLastPlayedAt,
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    getSessionByHash: mocks.getSessionByHash,
    claim: mocks.claim,
  },
}));

// The controller itself is fully covered by audiobook-controller.test.ts;
// here we only need to observe what openAudiobookSession constructs it
// with (source/clock/hooks) and hands to ttsSessionManager.claim.
vi.mock('@/services/audiobook/AudiobookController', () => ({
  AudiobookController: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    source: unknown,
    clock: unknown,
    hooks: unknown,
  ) {
    mocks.controllerCtor(source, clock, hooks);
    Object.assign(this, {
      kind: 'audiobook',
      getCurrentChapter: vi.fn(() => ({ title: 'Chapter One' })),
    });
  }),
}));

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: mocks.getOSPlatform };
});

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: mocks.isTauriAppPlatform };
});

import { loadAbsEpisodes, openAudiobookSession } from '@/services/audiobook/openAudiobook';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import { HtmlAudioClock } from '@/services/audiobook/AudiobookClock';
import { NativeAudiobookClock } from '@/services/audiobook/NativeAudiobookClock';
import { AbsProgressSyncer } from '@/services/audiobookshelf/progressSync';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import type { SystemSettings } from '@/types/settings';

const server: ABSServer = {
  id: 'srv1',
  name: 'Home',
  url: 'http://abs.local:13378',
  accessToken: 'token-1',
};

const item: ABSLibraryItem = {
  id: 'item1',
  mediaType: 'book',
  media: {
    metadata: { title: 'Pride and Prejudice', authorName: 'Jane Austen' },
    duration: 36000,
    tracks: [
      {
        index: 1,
        startOffset: 0,
        duration: 18000,
        contentUrl: '/api/items/item1/file/1',
        mimeType: 'audio/mpeg',
      },
    ],
    chapters: [{ id: 0, start: 0, end: 100, title: 'Chapter One' }],
  },
};

const book: Book = {
  hash: 'h1',
  format: 'ABS',
  filePath: makeAbsFilePath('srv1', 'item1'),
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  coverImageUrl: 'https://cover.example/pp.jpg',
  createdAt: 0,
  updatedAt: 0,
};

const appService = {} as AppService;

describe('openAudiobookSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.getItemExpanded.mockResolvedValue(item);
    mocks.getMe.mockResolvedValue({ mediaProgress: [] });
    mocks.syncerBegin.mockResolvedValue(42);
    mocks.getOSPlatform.mockReturnValue('macos');
    mocks.isTauriAppPlatform.mockReturnValue(false);
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  afterEach(() => {
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  it('toasts and returns null when the server config is gone', async () => {
    useABSServerStore.setState({ servers: [] });
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await openAudiobookSession({ appService, book });

    expect(result).toBeNull();
    // Not the book title - there's no server to name in this branch.
    expect(toastSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error', message: 'Audiobookshelf server not found' }),
    );
    expect(mocks.getItemExpanded).not.toHaveBeenCalled();
  });

  it('resolves the server from settings when the in-memory store has not been hydrated yet', async () => {
    // Reproduces the fresh-boot bug: useABSServerStore is still empty (no
    // IntegrationsPanel mount, no replica pull), but the server is already
    // in persisted settings.
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({ settings: { absServers: [server] } as unknown as SystemSettings });

    const result = await openAudiobookSession({ appService, book });

    expect(result).not.toBeNull();
    expect(mocks.getItemExpanded).toHaveBeenCalledWith('item1');
  });

  it('fetches the expanded item, resumes at the syncer position, and claims the session', async () => {
    const result = await openAudiobookSession({ appService, book });

    expect(mocks.getItemExpanded).toHaveBeenCalledWith('item1');
    expect(mocks.syncerBegin).toHaveBeenCalledWith(0, 0);
    expect(result).not.toBeNull();
    expect(result!.bookKey.startsWith('h1-')).toBe(true);
    expect(result!.controller).toBeInstanceOf(AudiobookController);

    // The controller was built with startAt = the syncer's begin() result,
    // and the progress hooks handed straight through.
    const [source, , hooks] = mocks.controllerCtor.mock.calls[0]!;
    expect((source as AudiobookSource).startAt).toBe(42);
    expect(hooks).toBe(mocks.syncerHooksResult);

    expect(mocks.claim).toHaveBeenCalledTimes(1);
    const [claimedKey, claimedController, meta] = mocks.claim.mock.calls[0]!;
    expect(claimedKey).toBe(result!.bookKey);
    expect(claimedController).toBe(result!.controller);
    expect(meta).toMatchObject({
      bookKey: result!.bookKey,
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      coverImageUrl: 'https://cover.example/pp.jpg',
      metadataMode: 'chapter',
    });
    expect(meta.getSectionLabel()).toBe('Chapter One');
  });

  it('reuses the live session for the same book hash instead of claiming a second one', async () => {
    const fakeController = {
      kind: 'audiobook',
      getEpisodeId: () => undefined,
    } as unknown as AudiobookController;
    mocks.getSessionByHash.mockReturnValue({ bookKey: 'h1-existing', controller: fakeController });

    const result = await openAudiobookSession({ appService, book });

    expect(result).toEqual({ bookKey: 'h1-existing', controller: fakeController });
    expect(mocks.getItemExpanded).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('uses HtmlAudioClock when not on iOS Tauri', async () => {
    const result = await openAudiobookSession({ appService, book });
    expect(result).not.toBeNull();

    const [, clock] = mocks.controllerCtor.mock.calls[0]!;
    expect(clock).toBeInstanceOf(HtmlAudioClock);
  });

  it('uses NativeAudiobookClock on iOS Tauri', async () => {
    mocks.getOSPlatform.mockReturnValue('ios');
    mocks.isTauriAppPlatform.mockReturnValue(true);

    const result = await openAudiobookSession({ appService, book });
    expect(result).not.toBeNull();

    const [, clock] = mocks.controllerCtor.mock.calls[0]!;
    expect(clock).toBeInstanceOf(NativeAudiobookClock);
  });

  // The HTML clock is a WebView <audio> element, and Chromium requests Android
  // audio focus for it under the app's own uid. The media service requesting
  // focus too is preempted by it and gets AUDIOFOCUS_LOSS, which the service
  // relays as media-session-pause - stopping the audiobook ~300ms after it
  // auto-started.
  it('hands the session over as not owning audio focus when the clock is the WebView element', async () => {
    await openAudiobookSession({ appService, book });

    const [, , meta] = mocks.claim.mock.calls[0]!;
    expect(meta.ownsAudioFocus).toBe(false);
  });

  it('keeps audio focus with the media session when the clock is native', async () => {
    mocks.getOSPlatform.mockReturnValue('ios');
    mocks.isTauriAppPlatform.mockReturnValue(true);

    await openAudiobookSession({ appService, book });

    const [, , meta] = mocks.claim.mock.calls[0]!;
    expect(meta.ownsAudioFocus).toBe(true);
  });

  it('uses HtmlAudioClock on iOS web (Tauri check must gate, not OS alone)', async () => {
    mocks.getOSPlatform.mockReturnValue('ios');
    mocks.isTauriAppPlatform.mockReturnValue(false);

    const result = await openAudiobookSession({ appService, book });
    expect(result).not.toBeNull();

    const [, clock] = mocks.controllerCtor.mock.calls[0]!;
    expect(clock).toBeInstanceOf(HtmlAudioClock);
  });

  it("resolveUrl reads the server's current access token on every call, never a captured copy", async () => {
    const result = await openAudiobookSession({ appService, book });
    expect(result).not.toBeNull();

    const [source] = mocks.controllerCtor.mock.calls[0]!;
    const resolveUrl = (source as AudiobookSource).resolveUrl;
    expect(resolveUrl('/api/items/item1/file/1')).toContain('token=token-1');

    // Simulates a 401-triggered refresh landing (by this client or another,
    // e.g. the periodic library sync's own ABSClient instance) between the
    // session starting and a later track load.
    useABSServerStore.getState().updateServer('srv1', { accessToken: 'token-rotated' });
    expect(resolveUrl('/api/items/item1/file/1')).toContain('token=token-rotated');
  });
});

const podcastItem: ABSLibraryItem = {
  id: 'item1',
  mediaType: 'podcast',
  media: {
    metadata: { title: 'The Big Show', author: 'Some Network' },
    episodes: [
      {
        id: 'ep1',
        title: 'Episode One',
        publishedAt: 1000,
        duration: 1800,
        chapters: [{ id: 0, start: 0, end: 900, title: 'Intro' }],
        audioTrack: {
          index: 1,
          startOffset: 0,
          duration: 1800,
          contentUrl: '/api/items/item1/file/ep1',
          mimeType: 'audio/mpeg',
        },
      },
      {
        id: 'ep2',
        title: 'Episode Two',
        publishedAt: 2000,
        duration: 1200,
        audioTrack: {
          index: 1,
          startOffset: 0,
          duration: 1200,
          contentUrl: '/api/items/item1/file/ep2',
          mimeType: 'audio/mpeg',
        },
      },
      {
        id: 'ep3',
        title: 'Episode Three (no audio track)',
        publishedAt: 500,
      },
    ],
  },
};

const podcastBook: Book = {
  hash: 'p1',
  format: 'ABS',
  filePath: makeAbsFilePath('srv1', 'item1'),
  title: 'The Big Show',
  author: 'Some Network',
  createdAt: 0,
  updatedAt: 0,
  absMediaType: 'podcast',
};

describe('openAudiobookSession - podcast episodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionByHash.mockReturnValue(null);
    mocks.getItemExpanded.mockResolvedValue(podcastItem);
    mocks.getMe.mockResolvedValue({ mediaProgress: [] });
    mocks.syncerBegin.mockResolvedValue(42);
    mocks.readLocalLastPlayedAt.mockReturnValue(0);
    mocks.getOSPlatform.mockReturnValue('macos');
    mocks.isTauriAppPlatform.mockReturnValue(false);
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  afterEach(() => {
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  it('returns null without claiming, opening a session, or toasting when a podcast has no episodeId', async () => {
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await openAudiobookSession({ appService, book: podcastBook });

    expect(result).toBeNull();
    expect(mocks.getItemExpanded).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('claims a single-track source built from the episode when episodeId is given', async () => {
    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'ep1',
    });

    expect(result).not.toBeNull();
    expect(result!.bookKey.startsWith('p1-')).toBe(true);
    expect(mocks.getItemExpanded).toHaveBeenCalledWith('item1');
    // No per-episode position cache exists, so there is no local stamp
    // worth reading either - see the "always resumes... " test below for
    // why readLocalLastPlayedAt must stay uncalled for an episode.
    expect(mocks.readLocalLastPlayedAt).not.toHaveBeenCalled();
    // Episode progress is 0 at open, never fed from the show-level
    // Book.progress (which podcast shows never populate anyway).
    expect(mocks.syncerBegin).toHaveBeenCalledWith(0, 0);

    const [source] = mocks.controllerCtor.mock.calls[0]!;
    const src = source as AudiobookSource;
    expect(src.tracks).toEqual([podcastItem.media.episodes![0]!.audioTrack]);
    expect(src.chapters).toEqual(podcastItem.media.episodes![0]!.chapters);
    expect(src.title).toBe('Episode One');
    expect(src.author).toBe('The Big Show');

    expect(AbsProgressSyncer).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: 'ep1', bookHash: 'p1', itemId: 'item1' }),
    );
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('always resumes an episode from the server position, even when a fresher local stamp exists', async () => {
    // No per-episode position CACHE exists - only readLocalLastPlayedAt's
    // "last played" timestamp, written by AbsProgressSyncer#cacheLocally on
    // every pause/tick/seek/end. A fresher local stamp than the server's
    // mediaProgress.lastUpdate can happen legitimately (app killed right
    // after a pause, before the close-session call landed; or the server's
    // clock running behind the device's) - resolveResumePosition must not
    // be allowed to pick the hardcoded localCurrentTime=0 in that case, or
    // the episode silently restarts from 0 instead of the server's real,
    // at-worst-15s-stale position.
    mocks.readLocalLastPlayedAt.mockReturnValue(Date.now());
    mocks.syncerBegin.mockResolvedValue(900);

    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'ep1',
    });

    expect(result).not.toBeNull();
    expect(mocks.syncerBegin).toHaveBeenCalledWith(0, 0);
  });

  it('toasts "Episode not found" and returns null when the episode id does not match any episode', async () => {
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'missing',
    });

    expect(result).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error', message: 'Episode not found' }),
    );
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('toasts "Episode not found" and returns null when the matched episode has no audio track', async () => {
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'ep3',
    });

    expect(result).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error', message: 'Episode not found' }),
    );
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('reuses the live session when reopening the SAME episode', async () => {
    const fakeController = {
      kind: 'audiobook',
      getEpisodeId: () => 'ep1',
    } as unknown as AudiobookController;
    mocks.getSessionByHash.mockReturnValue({ bookKey: 'p1-existing', controller: fakeController });

    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'ep1',
    });

    expect(result).toEqual({ bookKey: 'p1-existing', controller: fakeController });
    expect(mocks.getItemExpanded).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('replaces the session when reopening a DIFFERENT episode of the same show', async () => {
    const fakeController = {
      kind: 'audiobook',
      getEpisodeId: () => 'ep1',
    } as unknown as AudiobookController;
    mocks.getSessionByHash.mockReturnValue({ bookKey: 'p1-existing', controller: fakeController });

    const result = await openAudiobookSession({
      appService,
      book: podcastBook,
      episodeId: 'ep2',
    });

    expect(result).not.toBeNull();
    expect(result!.bookKey).not.toBe('p1-existing');
    expect(mocks.getItemExpanded).toHaveBeenCalledWith('item1');
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });
});

describe('loadAbsEpisodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getItemExpanded.mockResolvedValue(podcastItem);
    mocks.getMe.mockResolvedValue({ mediaProgress: [] });
    useABSServerStore.setState({ servers: [server] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  afterEach(() => {
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  });

  it('returns episodes newest-first and a progress map keyed by episodeId', async () => {
    mocks.getMe.mockResolvedValue({
      mediaProgress: [
        {
          libraryItemId: 'item1',
          episodeId: 'ep1',
          currentTime: 300,
          duration: 1800,
          isFinished: false,
          lastUpdate: 111,
        },
        // Show-level progress entry (falsy episodeId) - must be excluded.
        {
          libraryItemId: 'item1',
          episodeId: null,
          currentTime: 0,
          duration: 0,
          isFinished: false,
          lastUpdate: 111,
        },
        // A different library item's episode progress - must be excluded.
        {
          libraryItemId: 'other-item',
          episodeId: 'ep9',
          currentTime: 10,
          duration: 20,
          isFinished: false,
          lastUpdate: 111,
        },
      ],
    });

    const result = await loadAbsEpisodes(appService, podcastBook);

    expect(result).not.toBeNull();
    expect(result!.episodes.map((e) => e.id)).toEqual(['ep2', 'ep1', 'ep3']);
    expect(result!.progressByEpisodeId.size).toBe(1);
    expect(result!.progressByEpisodeId.get('ep1')?.currentTime).toBe(300);
  });

  it('does not claim a session', async () => {
    await loadAbsEpisodes(appService, podcastBook);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('toasts and returns null when the server config is gone', async () => {
    useABSServerStore.setState({ servers: [] });
    useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await loadAbsEpisodes(appService, podcastBook);

    expect(result).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error', message: 'Audiobookshelf server not found' }),
    );
  });

  it('toasts a connection error and returns null when the item fetch fails', async () => {
    mocks.getItemExpanded.mockRejectedValue(new Error('network down'));
    const toastSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const result = await loadAbsEpisodes(appService, podcastBook);

    expect(result).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ type: 'error', message: 'Unable to connect to Home' }),
    );
  });
});
