import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService, OsPlatform } from '@/types/system';
import type { Book } from '@/types/book';
import type { AudiobookSource } from '@/services/audiobook/AudiobookController';
import type { ABSLibraryItem, ABSServer } from '@/types/audiobookshelf';
import { makeAbsFilePath } from '@/utils/audiobook';

// vi.mock factories are hoisted above const initializers, so shared spies
// referenced eagerly inside a factory MUST come from vi.hoisted() (mirrors
// abs-form.test.tsx).
const mocks = vi.hoisted(() => ({
  getItemExpanded: vi.fn(),
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
    Object.assign(this, { server, getItemExpanded: mocks.getItemExpanded });
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

import { openAudiobookSession } from '@/services/audiobook/openAudiobook';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import { HtmlAudioClock } from '@/services/audiobook/AudiobookClock';
import { NativeAudiobookClock } from '@/services/audiobook/NativeAudiobookClock';
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
    const fakeController = { kind: 'audiobook' } as unknown as AudiobookController;
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
