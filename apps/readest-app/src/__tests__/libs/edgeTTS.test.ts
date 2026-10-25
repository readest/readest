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

// The Workers path opens its socket through cloudflare:sockets; its frame
// handling has its own tests in workersWebSocket.test.ts.
vi.mock('@/libs/workersWebSocket', () => ({ connectWorkersWebSocket: vi.fn() }));

type GlobalWithWsPair = typeof globalThis & { WebSocketPair?: unknown };

const mockWorkersSocket = async (socket: unknown) => {
  const { connectWorkersWebSocket } = await import('@/libs/workersWebSocket');
  return vi.mocked(connectWorkersWebSocket).mockResolvedValue(socket as never);
};

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

  test('opens a raw socket instead of a fetch() upgrade and returns audio Response', async () => {
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

    // Cloudflare's fetch() upgrade gets a plain HTTP 200 from
    // api.msedgeservices.com; the same handshake over a raw socket upgrades.
    const fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const connectSpy = await mockWorkersSocket(mockSocket);

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

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledOnce();
    const [calledUrl, headers] = connectSpy.mock.calls[0]!;
    // speech.platform.bing.com now rejects the handshake with 403 in many
    // regions; Edge Read Aloud moved to api.msedgeservices.com, which takes
    // the client token as Ocp-Apim-Subscription-Key.
    expect(calledUrl).toContain('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?');
    expect(calledUrl).toContain('Ocp-Apim-Subscription-Key=');
    expect(calledUrl).not.toContain('TrustedClientToken=');
    expect(headers['User-Agent']).toContain('Edg/');

    // The socket must be accepted before use, and both
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

    await mockWorkersSocket(mockSocket);

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

  test('rejects when the socket upgrade fails', async () => {
    const { connectWorkersWebSocket } = await import('@/libs/workersWebSocket');
    vi.mocked(connectWorkersWebSocket).mockRejectedValue(
      new Error('WebSocket upgrade failed with status 403'),
    );

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
    ).rejects.toThrow('WebSocket upgrade failed with status 403');
  });

  test('captures word boundaries from audio.metadata frames', async () => {
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

    const audioFrame = () => {
      const headerText = 'X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n';
      const headerBytes = new TextEncoder().encode(headerText);
      const audioBody = new Uint8Array([0xaa, 0xbb]);
      const frame = new Uint8Array(2 + headerBytes.byteLength + audioBody.byteLength);
      new DataView(frame.buffer).setInt16(0, headerBytes.byteLength);
      frame.set(headerBytes, 2);
      frame.set(audioBody, 2 + headerBytes.byteLength);
      return frame.buffer;
    };
    const metadataFrame = (text: string, offset: number) =>
      'X-RequestId:1\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n' +
      JSON.stringify({
        Metadata: [
          { Type: 'WordBoundary', Data: { Offset: offset, Duration: 1000, text: { Text: text } } },
        ],
      });

    let sendCount = 0;
    mockSocket.send.mockImplementation(() => {
      sendCount++;
      if (sendCount === 2) {
        queueMicrotask(() => {
          for (const cb of listeners['message'] ?? [])
            cb({ data: metadataFrame('Hello', 1000000) });
          for (const cb of listeners['message'] ?? []) cb({ data: audioFrame() });
          for (const cb of listeners['message'] ?? [])
            cb({ data: metadataFrame('brave', 6000000) });
          for (const cb of listeners['message'] ?? [])
            cb({ data: 'X-RequestId:1\r\nPath:turn.end\r\n\r\n' });
        });
      }
    });

    await mockWorkersSocket(mockSocket);

    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');
    const { boundaries } = await tts.createWithBoundaries({
      lang: 'en-US',
      text: 'Hello brave',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });
    expect(boundaries).toEqual([
      { offset: 1000000, duration: 1000, text: 'Hello' },
      { offset: 6000000, duration: 1000, text: 'brave' },
    ]);
  });
});

describe('EdgeSpeechTTS outside Cloudflare Workers', () => {
  test('does not load the Workers socket module', async () => {
    // node.readest.com (Vercel) and the clients never take the Workers path,
    // so loading edgeTTS must not evaluate the cloudflare:sockets client.
    vi.resetModules();
    vi.doMock('@/libs/workersWebSocket', () => {
      throw new Error('workersWebSocket loaded outside Workers');
    });
    try {
      await expect(import('@/libs/edgeTTS')).resolves.toHaveProperty('EdgeSpeechTTS');
    } finally {
      vi.doUnmock('@/libs/workersWebSocket');
      vi.resetModules();
    }
  });
});

describe('EdgeSpeechTTS.voices', () => {
  test('a multilingual or expressive voice is named without the suffix, which becomes its variant', async () => {
    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const byId = (id: string) => EdgeSpeechTTS.voices.find((v) => v.id === id)!;
    expect(byId('en-US-AndrewMultilingualNeural')).toEqual({
      id: 'en-US-AndrewMultilingualNeural',
      name: 'Andrew',
      lang: 'en-US',
      variant: 'multilingual',
    });
    expect(byId('en-IN-NeerjaExpressiveNeural')).toMatchObject({
      name: 'Neerja',
      variant: 'expressive',
    });
    expect(byId('en-US-AndrewNeural')).toEqual({
      id: 'en-US-AndrewNeural',
      name: 'Andrew',
      lang: 'en-US',
    });
  });
});

describe('parseAudioMetadataBody', () => {
  test('extracts WordBoundary entries from an audio.metadata body', async () => {
    const { parseAudioMetadataBody } = await import('@/libs/edgeTTS');
    const body = JSON.stringify({
      Metadata: [
        {
          Type: 'WordBoundary',
          Data: {
            Offset: 1000000,
            Duration: 4250000,
            text: { Text: 'Dr.', Length: 3, BoundaryType: 'WordBoundary' },
          },
        },
      ],
    });
    expect(parseAudioMetadataBody(body)).toEqual([
      { offset: 1000000, duration: 4250000, text: 'Dr.' },
    ]);
  });

  test('ignores non-WordBoundary metadata entries', async () => {
    const { parseAudioMetadataBody } = await import('@/libs/edgeTTS');
    const body = JSON.stringify({
      Metadata: [
        { Type: 'SessionEnd', Data: { Offset: 99 } },
        {
          Type: 'WordBoundary',
          Data: { Offset: 5000000, Duration: 1000000, text: { Text: 'hello' } },
        },
      ],
    });
    expect(parseAudioMetadataBody(body)).toEqual([
      { offset: 5000000, duration: 1000000, text: 'hello' },
    ]);
  });

  test('returns an empty list for malformed or empty bodies', async () => {
    const { parseAudioMetadataBody } = await import('@/libs/edgeTTS');
    expect(parseAudioMetadataBody('not json')).toEqual([]);
    expect(parseAudioMetadataBody('{}')).toEqual([]);
    expect(
      parseAudioMetadataBody(JSON.stringify({ Metadata: [{ Type: 'WordBoundary' }] })),
    ).toEqual([]);
  });
});

describe('generateSecMsGec', () => {
  test('matches a v2 token captured from Edge (rany2/edge-tts#492)', async () => {
    const { generateSecMsGec } = await import('@/libs/edgeTTS');
    // 2026-10-13T10:40:00Z, start of a 5-minute window
    expect(await generateSecMsGec(1791888000 * 1000)).toBe(
      '492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876',
    );
  });
});
