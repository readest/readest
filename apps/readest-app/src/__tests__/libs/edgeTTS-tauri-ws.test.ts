// #5230: on the Tauri transport, an Edge-side close (or a plugin read error)
// before `turn.end` must reject the synthesis promise. The old listener only
// handled Text/Binary messages, so the promise never settled, the retry/skip
// machinery never ran, and the static in-flight map poisoned that sentence
// until app restart — playback stuck "playing" with no audio.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const connectMock = vi.fn();

vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: {
    connect: (...args: unknown[]) => connectMock(...args),
  },
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'http://api.test',
  isTauriAppPlatform: () => true,
}));

vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: vi.fn(),
}));

import { EdgeSpeechTTS, type EdgeTTSPayload } from '@/libs/edgeTTS';

type FakeMessage = unknown;

class FakeTauriWs {
  listeners: Array<(msg: FakeMessage) => void> = [];
  sent: unknown[] = [];
  disconnected = false;

  addListener(cb: (msg: FakeMessage) => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  async send(message: unknown) {
    this.sent.push(message);
  }

  async disconnect() {
    this.disconnected = true;
  }

  emit(msg: FakeMessage) {
    for (const listener of [...this.listeners]) listener(msg);
  }
}

const makePayload = (text: string): EdgeTTSPayload => ({
  lang: 'en',
  text,
  voice: 'en-US-AriaNeural',
  rate: 1.0,
  pitch: 1.0,
});

const flushMicrotasks = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

// The transport awaits a dynamic import and crypto.subtle.digest, which can
// resolve on macrotasks — a pure microtask drain is not enough to reach the
// socket writes.
const flushTasks = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// Resolves to 'pending' when `p` has not settled by the end of the current
// microtask drain — the pre-fix hang manifests as 'pending', not a timeout.
const settleState = (p: Promise<unknown>) =>
  Promise.race([
    p.then(
      () => 'resolved',
      () => 'rejected',
    ),
    flushMicrotasks().then(() => 'pending'),
  ]);

describe('EdgeSpeechTTS Tauri WebSocket transport (#5230)', () => {
  let ws: FakeTauriWs;

  beforeEach(() => {
    ws = new FakeTauriWs();
    connectMock.mockReset();
    connectMock.mockResolvedValue(ws);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Wraps the request promise in an object: returning it bare from an async
  // helper would make `await startRequest(...)` adopt it — hanging the test
  // whenever the promise (correctly or not) never settles.
  const startRequest = async (text: string) => {
    const tts = new EdgeSpeechTTS('wss');
    const promise = tts.createAudioData(makePayload(text));
    // Swallow rejection so an unawaited failure can't nuke the test run.
    promise.catch(() => {});
    await flushTasks();
    expect(ws.sent.length).toBe(2); // config + ssml content sent
    return { promise };
  };

  test('rejects when the server closes before turn.end', async () => {
    const { promise } = await startRequest('close before turn.end');
    ws.emit({ type: 'Close', data: { code: 1006, reason: '' } });
    expect(await settleState(promise)).toBe('rejected');
    await expect(promise).rejects.toThrow(/closed/i);
  });

  test('rejects when the plugin reports a read error (plain string message)', async () => {
    const { promise } = await startRequest('read error sentence');
    // tauri-plugin-websocket serializes read errors as a bare string with no
    // `type` field (see the plugin's `impl Serialize for Error`).
    ws.emit('Connection reset without closing handshake');
    expect(await settleState(promise)).toBe('rejected');
    await expect(promise).rejects.toThrow(/Connection reset/);
  });

  test('rejects after prolonged silence (half-open socket)', async () => {
    vi.useFakeTimers();
    const { promise } = await startRequest('half-open socket sentence');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await settleState(promise)).toBe('rejected');
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  test('still resolves audio and boundaries on a normal turn.end flow', async () => {
    const { promise } = await startRequest('happy path sentence');
    // Binary frame: 2-byte big-endian header length (0) + audio payload.
    ws.emit({ type: 'Binary', data: [0, 0, 9, 8, 7, 6] });
    ws.emit({
      type: 'Text',
      data: 'Path: audio.metadata\r\n\r\n{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":2000000,"text":{"Text":"happy"}}}]}',
    });
    ws.emit({ type: 'Text', data: 'Path: turn.end\r\n\r\n' });
    const { data, boundaries } = await promise;
    expect(new Uint8Array(data)).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(boundaries).toEqual([{ offset: 1000000, duration: 2000000, text: 'happy' }]);
    expect(ws.disconnected).toBe(true);
  });

  test('ping/pong keep-alive frames do not settle the request', async () => {
    const { promise } = await startRequest('ping does not settle');
    ws.emit({ type: 'Ping', data: [] });
    ws.emit({ type: 'Pong', data: [] });
    expect(await settleState(promise)).toBe('pending');
    ws.emit({ type: 'Text', data: 'Path: turn.end\r\n\r\n' });
    // turn.end with zero audio bytes stays the permanent no-audio error.
    await expect(promise).rejects.toThrow('No audio data received.');
  });
});
