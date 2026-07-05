import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const bridgeBind = vi.fn().mockResolvedValue(undefined);
const bridgeUnbind = vi.fn();
const releaseKeepAlive = vi.fn();

vi.mock('@/services/tts/ttsMediaBridge', () => ({
  ttsMediaBridge: {
    bind: (...args: unknown[]) => bridgeBind(...args),
    unbind: () => bridgeUnbind(),
  },
  releaseUnblockAudio: () => releaseKeepAlive(),
  unblockAudio: vi.fn(),
}));

const setConfig = vi.fn();
const saveConfig = vi.fn().mockResolvedValue(undefined);
const getConfig = vi.fn().mockReturnValue({ viewSettings: { ttsLocation: '' } });
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({ setConfig, saveConfig, getConfig }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { fake: true } }) },
}));
vi.mock('@/services/environment', () => ({ default: { env: 'test' } }));
vi.mock('@/utils/bridge', () => ({
  invokeUseBackgroundAudio: vi.fn().mockResolvedValue(undefined),
}));

import { TTSSessionManager, getBookHashFromKey } from '@/services/tts/TTSSessionManager';
import type { TTSController } from '@/services/tts/TTSController';
import { eventDispatcher } from '@/utils/event';

class FakeController extends EventTarget {
  state = 'playing';
  terminated = false;
  isViewAttached = true;
  shutdown = vi.fn().mockResolvedValue(undefined);
  detachView = vi.fn().mockImplementation(() => {
    this.isViewAttached = false;
  });

  emitState(state: string) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('tts-state-change', { detail: { state } }));
  }
  emitEnded(reason: string) {
    this.terminated = true;
    this.dispatchEvent(new CustomEvent('tts-session-ended', { detail: { reason } }));
  }
  emitMark(cfi: string) {
    this.dispatchEvent(new CustomEvent('tts-highlight-mark', { detail: { cfi } }));
  }
}

const meta = (bookKey: string) => ({
  bookKey,
  title: 'Alice',
  author: 'Carroll',
  coverImageUrl: null,
  metadataMode: 'sentence' as const,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('getBookHashFromKey', () => {
  test('extracts the hash prefix from an ephemeral bookKey', () => {
    expect(getBookHashFromKey('c9f7c5aa-1a2b3c')).toBe('c9f7c5aa');
  });
});

describe('TTSSessionManager', () => {
  let manager: TTSSessionManager;
  let controller: FakeController;
  let playbackStates: Array<{ bookKey: string; state: string }>;
  let sessionEvents: Array<{ reason: string }>;
  const playbackListener = (e: CustomEvent) => {
    playbackStates.push(e.detail as { bookKey: string; state: string });
  };

  const claim = (bookKey = 'hashA-r1', ctrl = controller) =>
    manager.claim(bookKey, ctrl as unknown as TTSController, meta(bookKey));

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TTSSessionManager();
    controller = new FakeController();
    playbackStates = [];
    sessionEvents = [];
    eventDispatcher.on('tts-playback-state', playbackListener as never);
    manager.addEventListener('session-changed', (e) => {
      sessionEvents.push({ reason: (e as CustomEvent).detail.reason });
    });
  });

  afterEach(() => {
    eventDispatcher.off('tts-playback-state', playbackListener as never);
    manager.setSleepTimer(0);
  });

  test('claim registers a hash-keyed session and binds the bridge', () => {
    claim();
    expect(manager.getSessionByHash('hashA')?.bookKey).toBe('hashA-r1');
    expect(manager.getActiveSession()?.bookHash).toBe('hashA');
    expect(bridgeBind).toHaveBeenCalled();
    expect(sessionEvents.at(-1)?.reason).toBe('claimed');
  });

  test('claim for the same hash replaces the controller without stopping the slot', async () => {
    claim();
    const second = new FakeController();
    claim('hashA-r2', second);
    await flush();
    // Old controller unsubscribed and shut down by the manager; no bar-level stop.
    expect(controller.shutdown).toHaveBeenCalled();
    expect(manager.getActiveSession()?.controller).toBe(second as unknown as TTSController);
    // Old controller events no longer relay.
    playbackStates.length = 0;
    controller.emitState('playing');
    await flush();
    expect(playbackStates).toHaveLength(0);
  });

  test('claim for a DIFFERENT hash stops the prior session first', async () => {
    claim();
    const other = new FakeController();
    claim('hashB-r1', other);
    await flush();
    expect(controller.shutdown).toHaveBeenCalled();
    expect(bridgeUnbind).toHaveBeenCalled();
    expect(manager.getActiveSession()?.bookHash).toBe('hashB');
    expect(manager.getSessionByHash('hashA')).toBeNull();
  });

  test('detach keeps the session retrievable and detaches the view', () => {
    claim();
    manager.detach('hashA');
    expect(controller.detachView).toHaveBeenCalled();
    expect(manager.getSessionByHash('hashA')).not.toBeNull();
    expect(sessionEvents.at(-1)?.reason).toBe('detached');
  });

  test('state relay: playing/paused re-emit, transit stopped is swallowed', async () => {
    claim();
    controller.emitState('paused');
    controller.emitState('stopped'); // paragraph advance transit
    controller.emitState('playing');
    await flush();
    const states = playbackStates.map((s) => s.state);
    expect(states).toEqual(['paused', 'playing']);
  });

  test('tts-session-ended (not state) stops the session with its reason', async () => {
    claim();
    manager.detach('hashA');
    controller.emitEnded('ended');
    await flush();
    expect(manager.getActiveSession()).toBeNull();
    expect(bridgeUnbind).toHaveBeenCalled();
    expect(releaseKeepAlive).toHaveBeenCalled();
    expect(playbackStates.at(-1)?.state).toBe('stopped');
    expect(sessionEvents.at(-1)?.reason).toBe('stopped');
  });

  test('sleep timer fires stopActive and is cleared by it', async () => {
    vi.useFakeTimers();
    claim();
    manager.setSleepTimer(60);
    expect(manager.getSleepTimer()?.timeoutSec).toBe(60);
    vi.advanceTimersByTime(61_000);
    vi.useRealTimers();
    await flush();
    expect(manager.getActiveSession()).toBeNull();
    expect(manager.getSleepTimer()).toBeNull();
  });

  test('headless persistence writes through setConfig and flushes to disk on stop', async () => {
    vi.useFakeTimers();
    claim();
    manager.detach('hashA');
    controller.emitMark('epubcfi(/6/8!/4/2)');
    expect(setConfig).toHaveBeenCalledWith(
      'hashA-r1',
      expect.objectContaining({
        viewSettings: expect.objectContaining({ ttsLocation: 'epubcfi(/6/8!/4/2)' }),
      }),
    );
    vi.useRealTimers();
    await manager.stopActive('user');
    expect(saveConfig).toHaveBeenCalled();
  });

  test('persistence is a no-op while the view is attached (the hook owns it)', () => {
    claim();
    controller.emitMark('epubcfi(/6/8!/4/4)');
    expect(setConfig).not.toHaveBeenCalled();
  });

  test('release clears the slot without shutting the controller down', () => {
    claim();
    manager.release('hashA');
    expect(controller.shutdown).not.toHaveBeenCalled();
    expect(manager.getActiveSession()).toBeNull();
    expect(sessionEvents.at(-1)?.reason).toBe('released');
  });
});
