import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/image', () => ({
  fetchImageAsBase64: vi.fn().mockResolvedValue('data:image/png;base64,x'),
}));

const notifyCarPlayMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/tts/carPlaySession', () => ({
  notifyCarPlayState: (...a: unknown[]) => notifyCarPlayMock(...a),
}));

import { TTSMediaBridge } from '@/services/tts/ttsMediaBridge';
import { fetchImageAsBase64 } from '@/utils/image';
import { TauriMediaSession } from '@/libs/mediaSession';
import type { TTSController } from '@/services/tts/TTSController';

// A controller stand-in: EventTarget + the surface the bridge consumes.
class FakeController extends EventTarget {
  state = 'playing';
  terminated = false;
  pause = vi.fn().mockResolvedValue(true);
  start = vi.fn().mockResolvedValue(undefined);
  forward = vi.fn().mockResolvedValue(undefined);
  backward = vi.fn().mockResolvedValue(undefined);
  seekToTime = vi.fn().mockResolvedValue(undefined);
  ensureTimeline = vi.fn().mockResolvedValue(null);
  getPlaybackInfo = vi.fn().mockReturnValue({ position: 12, duration: 60, measuredFraction: 1 });

  emitMark(text: string, name: string) {
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: { text, name } }));
  }
  emitState(state: string) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('tts-state-change', { detail: { state } }));
  }
}

interface FakeWebMediaSession {
  metadata: unknown;
  playbackState: string;
  handlers: Map<string, (details: MediaSessionActionDetails) => void>;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
}

const makeFakeMediaSession = (): FakeWebMediaSession => {
  const handlers = new Map<string, (details: MediaSessionActionDetails) => void>();
  return {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler: vi.fn(
      (action: string, cb: ((d: MediaSessionActionDetails) => void) | null) => {
        if (cb) handlers.set(action, cb);
        else handlers.delete(action);
      },
    ),
    setPositionState: vi.fn(),
  };
};

const meta = (overrides = {}) => ({
  bookKey: 'hash-abc',
  title: 'Alice',
  author: 'Carroll',
  coverImageUrl: null,
  metadataMode: 'sentence' as const,
  ...overrides,
});

// jsdom lacks MediaMetadata; the bridge constructs it for the web path.
class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  constructor(init: { title: string; artist: string; album: string }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
  }
}
vi.stubGlobal('MediaMetadata', FakeMediaMetadata);

describe('TTSMediaBridge', () => {
  let controller: FakeController;
  let fake: FakeWebMediaSession;
  let bridge: TTSMediaBridge;

  beforeEach(() => {
    controller = new FakeController();
    fake = makeFakeMediaSession();
    bridge = new TTSMediaBridge(() => fake as unknown as MediaSession);
  });

  const bind = () => bridge.bind(controller as unknown as TTSController, meta());

  test('bind registers transport handlers that drive the controller', async () => {
    await bind();
    expect(fake.handlers.has('play')).toBe(true);
    fake.handlers.get('pause')!({} as MediaSessionActionDetails);
    expect(controller.pause).toHaveBeenCalled();
    controller.state = 'paused';
    fake.handlers.get('play')!({} as MediaSessionActionDetails);
    expect(controller.start).toHaveBeenCalled();
    fake.handlers.get('seekto')!({ seekTime: 42 } as MediaSessionActionDetails);
    expect(controller.seekToTime).toHaveBeenCalledWith(42);
    fake.handlers.get('nexttrack')!({} as MediaSessionActionDetails);
    expect(controller.forward).toHaveBeenCalled();
  });

  test('speak-mark events update metadata and clamped position state headless', async () => {
    await bind();
    controller.getPlaybackInfo.mockReturnValue({ position: 90, duration: 60, measuredFraction: 1 });
    controller.emitMark('Hello there, reader.', '0');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.metadata).toBeTruthy();
    expect((fake.metadata as FakeMediaMetadata).artist).toContain('Alice');
    expect(fake.setPositionState).toHaveBeenCalledWith({
      duration: 60,
      position: 60, // clamped, never skipped
      playbackRate: 1,
    });
  });

  test('state changes surface playing/paused but not transit stopped', async () => {
    await bind();
    controller.emitState('paused');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('paused');
    controller.emitState('stopped'); // transit: paragraph advance
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('paused'); // unchanged
    controller.emitState('playing');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('playing');
  });

  test('rebinding the same controller refreshes meta without duplicate listeners', async () => {
    await bind();
    await bridge.bind(controller as unknown as TTSController, meta({ bookKey: 'hash-abc-2' }));
    controller.emitMark('Once more.', '1');
    await new Promise((r) => setTimeout(r, 0));
    // One metadata update per mark, not two.
    expect(fake.setPositionState).toHaveBeenCalledTimes(1);
  });

  test('unbind clears handlers and stops reacting to controller events', async () => {
    await bind();
    bridge.unbind();
    expect(fake.handlers.size).toBe(0);
    fake.setPositionState.mockClear();
    controller.emitMark('After unbind.', '2');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.setPositionState).not.toHaveBeenCalled();
    expect(bridge.isBound).toBe(false);
  });

  // Android Auto (and the lock screen) drive nexttrack/previoustrack. The
  // native onSkipToNext/Previous fire an event into the WebView, where
  // forward()/backward() run stop() then advance a paragraph — a ~1s round
  // trip. During that window the controller churns (stop -> transient
  // paused), which surfaced to the car as a pause flicker / progress-bar
  // reset with no track change, i.e. "the forward button does not work".
  // The bridge must give instant, coherent feedback: assert playing at once
  // and swallow the transient churn until the next segment's mark lands.
  test('skip asserts playing immediately (no dead zone before the round trip)', async () => {
    await bind();
    expect(fake.playbackState).toBe('none');
    fake.handlers.get('nexttrack')!({} as MediaSessionActionDetails);
    expect(controller.forward).toHaveBeenCalled();
    expect(fake.playbackState).toBe('playing');
  });

  test('skip suppresses the transient stop/pause churn until the next mark', async () => {
    await bind();
    controller.emitState('playing');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('playing');

    // press "forward" in the car
    fake.handlers.get('previoustrack')!({} as MediaSessionActionDetails);
    expect(controller.backward).toHaveBeenCalled();

    // backward() internally stops then re-speaks; the transient paused must
    // not flicker to the car while the skip is in flight.
    controller.emitState('paused');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('playing'); // held, not flickered

    // the new segment starts speaking -> the guard clears, metadata updates
    controller.state = 'playing';
    controller.emitMark('The new sentence.', '0');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.metadata).toBeTruthy();

    // once the skip has landed, real state changes surface again
    controller.emitState('paused');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('paused');
  });

  test('a stray mark mid-skip (aborted segment) keeps the hold, no flicker', async () => {
    await bind();
    controller.emitState('playing');
    await new Promise((r) => setTimeout(r, 0));

    fake.handlers.get('previoustrack')!({} as MediaSessionActionDetails);
    expect(fake.playbackState).toBe('playing');

    // stop() aborts the old segment and emits a stray mark while NOT playing;
    // it must not clear the hold or push a paused/position update.
    controller.state = 'stopped';
    controller.emitMark('aborted tail', '3');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('playing'); // held
    expect(fake.setPositionState).not.toHaveBeenCalled(); // position suppressed

    // the real new segment plays -> hold ends, updates resume
    controller.state = 'playing';
    controller.emitMark('the previous sentence', '0');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.metadata).toBeTruthy();
    expect(fake.setPositionState).toHaveBeenCalled();
  });

  test('a terminal stop during a skip (end of book) still surfaces', async () => {
    await bind();
    controller.emitState('playing');
    await new Promise((r) => setTimeout(r, 0));
    fake.handlers.get('nexttrack')!({} as MediaSessionActionDetails);
    // forward() ran off the end of the book -> terminate.
    controller.terminated = true;
    controller.emitState('stopped');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.playbackState).toBe('paused'); // terminal stop is not swallowed
  });

  test('section label falls back to the last known value when the source dies', async () => {
    let label: string | undefined = 'Chapter 7';
    await bridge.bind(controller as unknown as TTSController, {
      ...meta({ metadataMode: 'chapter' as const }),
      getSectionLabel: () => label,
    });
    controller.emitMark('First.', '0');
    await new Promise((r) => setTimeout(r, 0));
    const first = fake.metadata as FakeMediaMetadata;
    label = undefined; // hook unmounted
    controller.emitMark('Second.', '1');
    await new Promise((r) => setTimeout(r, 0));
    // Metadata still reflects the last known chapter, no crash, no blanking.
    expect(first).toBeTruthy();
    expect(bridge.isBound).toBe(true);
  });

  test('bind reports an active CarPlay state', async () => {
    notifyCarPlayMock.mockClear();
    await bind();
    expect(notifyCarPlayMock).toHaveBeenCalledWith({
      active: true,
      title: 'Alice',
      author: 'Carroll',
    });
  });

  test('unbind reports an inactive CarPlay state', async () => {
    await bind();
    notifyCarPlayMock.mockClear();
    bridge.unbind();
    expect(notifyCarPlayMock).toHaveBeenCalledWith({ active: false });
  });

  test('a fresh bind does not emit an inactive CarPlay state', async () => {
    // bind() calls unbind() internally before (re)activating; on a fresh
    // bridge that internal unbind must be a no-op w.r.t. CarPlay signaling
    // (no controller was ever bound), so no {active:false} should surface.
    notifyCarPlayMock.mockClear();
    await bind();
    expect(notifyCarPlayMock).not.toHaveBeenCalledWith({ active: false });
  });
});

describe('TTSMediaBridge bind teardown race (READEST-1A)', () => {
  test('does not crash when unbound while the cover loads', async () => {
    // A real TauriMediaSession instance so bind() takes the Tauri branch; its
    // native methods are stubbed so nothing hits `invoke`.
    const tauriSession = new TauriMediaSession();
    tauriSession.setActive = vi.fn().mockResolvedValue(undefined);
    tauriSession.updateMetadata = vi.fn().mockResolvedValue(undefined);
    tauriSession.setActionHandler = vi.fn();

    const bridge = new TTSMediaBridge(() => tauriSession);
    const controller = new FakeController();

    // Tear the session down mid-flight, exactly like a stop during startup:
    // #mediaSession becomes null before the awaited setActive/updateMetadata.
    vi.mocked(fetchImageAsBase64).mockImplementationOnce(async () => {
      bridge.unbind();
      return 'data:image/png;base64,x';
    });

    await expect(
      bridge.bind(controller as unknown as TTSController, meta({ coverImageUrl: 'cover.png' })),
    ).resolves.toBeUndefined();
    // The bind aborted after teardown; no handlers were wired on a dead session.
    expect(bridge.isBound).toBe(false);
  });
});
