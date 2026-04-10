import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock isomorphic-ws so that if the legacy (non-fetch) path is hit on
// Cloudflare Workers, the test fails loudly instead of attempting a real
// WebSocket connection.
vi.mock('isomorphic-ws', () => ({
  default: class {
    constructor() {
      throw new Error('isomorphic-ws should not be used on Cloudflare Workers');
    }
  },
}));

// Stub the Supabase client so importing edgeTTS.ts (transitively via
// @/utils/fetch -> @/utils/access) does not instantiate a real GoTrueClient.
// Each `vi.resetModules()` would otherwise create another client and Supabase
// logs "Multiple GoTrueClient instances detected" to stderr.
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  createSupabaseClient: () => ({}),
  createSupabaseAdminClient: () => ({}),
}));

type GlobalWithWsPair = typeof globalThis & { WebSocketPair?: unknown };

describe('EdgeSpeechTTS on Cloudflare Workers', () => {
  let originalWebSocketPair: unknown;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    // Simulate Cloudflare Workers by defining WebSocketPair on globalThis.
    originalWebSocketPair = (globalThis as GlobalWithWsPair).WebSocketPair;
    (globalThis as GlobalWithWsPair).WebSocketPair = function WebSocketPair() {};
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWebSocketPair === undefined) {
      delete (globalThis as GlobalWithWsPair).WebSocketPair;
    } else {
      (globalThis as GlobalWithWsPair).WebSocketPair = originalWebSocketPair;
    }
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
  });

  test('uses fetch-based WebSocket upgrade and returns audio Response', async () => {
    // Build a mock WebSocket that records listeners and emits a frame
    // containing valid audio after both speech.config and ssml are sent.
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    const mockSocket = {
      accept: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
        (listeners[type] ??= []).push(cb);
      }),
      removeEventListener: vi.fn(),
    };

    // Simulate server responses once both config + ssml messages are sent.
    let sendCount = 0;
    mockSocket.send.mockImplementation(() => {
      sendCount++;
      if (sendCount === 2) {
        // Binary audio frame: [2-byte big-endian header length][header text][audio body]
        const headerText = 'X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n';
        const headerBytes = new TextEncoder().encode(headerText);
        const audioBody = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
        const frame = new Uint8Array(2 + headerBytes.byteLength + audioBody.byteLength);
        new DataView(frame.buffer).setInt16(0, headerBytes.byteLength);
        frame.set(headerBytes, 2);
        frame.set(audioBody, 2 + headerBytes.byteLength);

        // Dispatch on a microtask so the send() call returns first.
        queueMicrotask(() => {
          for (const cb of listeners['message'] ?? []) {
            cb({ data: frame.buffer });
          }
          for (const cb of listeners['message'] ?? []) {
            cb({ data: 'X-RequestId:1\r\nPath: turn.end\r\n\r\n' });
          }
        });
      }
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      status: 101,
      webSocket: mockSocket,
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Import AFTER the mocks and globals are set up.
    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');
    const response = await tts.create({
      lang: 'en-US',
      text: 'hello',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });

    expect(response).toBeInstanceOf(Response);
    const buffer = await response.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));

    // fetch should be called once with an https URL and an Upgrade header.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0]!;
    const calledUrl = call[0] as string | URL;
    const calledInit = call[1] as RequestInit;
    expect(String(calledUrl)).toContain('https://speech.platform.bing.com/');
    expect(String(calledUrl)).not.toContain('wss://');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['Upgrade']).toBe('websocket');

    // The WebSocket returned by fetch must be accepted before use, and both
    // the speech.config and ssml messages must be sent.
    expect(mockSocket.accept).toHaveBeenCalledOnce();
    expect(mockSocket.send).toHaveBeenCalledTimes(2);
    // Socket is closed once turn.end is received.
    expect(mockSocket.close).toHaveBeenCalledOnce();
  });

  test('decodes Blob binary frames (Cloudflare Workers shape)', async () => {
    // On real Cloudflare Workers, WebSocket binary frames arrive as Blob
    // instances rather than ArrayBuffer. This test guards that code path
    // by having the mock socket emit Blob messages.
    const listeners: Record<string, Array<(event: unknown) => void>> = {};
    const mockSocket = {
      accept: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
        (listeners[type] ??= []).push(cb);
      }),
      removeEventListener: vi.fn(),
    };

    const buildFrame = (body: Uint8Array) => {
      const headerText = 'X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n';
      const headerBytes = new TextEncoder().encode(headerText);
      const frame = new Uint8Array(2 + headerBytes.byteLength + body.byteLength);
      new DataView(frame.buffer).setInt16(0, headerBytes.byteLength);
      frame.set(headerBytes, 2);
      frame.set(body, 2 + headerBytes.byteLength);
      return new Blob([frame]);
    };

    let sendCount = 0;
    mockSocket.send.mockImplementation(() => {
      sendCount++;
      if (sendCount === 2) {
        queueMicrotask(() => {
          // Two binary Blob frames...
          for (const cb of listeners['message'] ?? []) {
            cb({ data: buildFrame(new Uint8Array([0x01, 0x02, 0x03])) });
          }
          for (const cb of listeners['message'] ?? []) {
            cb({ data: buildFrame(new Uint8Array([0x04, 0x05])) });
          }
          // ...then turn.end text message (fires before blob.arrayBuffer() resolves).
          for (const cb of listeners['message'] ?? []) {
            cb({ data: 'X-RequestId:1\r\nPath:turn.end\r\n\r\n' });
          }
        });
      }
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      status: 101,
      webSocket: mockSocket,
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');
    const response = await tts.create({
      lang: 'en-US',
      text: 'hello',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });

    // Both Blob frames should be decoded in receive order before the
    // turn.end message finalizes the audio payload.
    const buffer = await response.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]));
    expect(mockSocket.close).toHaveBeenCalled();
  });

  test('rejects when fetch upgrade returns non-101 status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 403,
      webSocket: undefined,
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');
    await expect(
      tts.create({
        lang: 'en-US',
        text: 'hello',
        voice: 'en-US-AriaNeural',
        rate: 1.0,
        pitch: 1.0,
      }),
    ).rejects.toThrow();
  });
});
