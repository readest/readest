import { describe, test, expect, vi, beforeEach } from 'vitest';

// Controllable WebSocket fake for the browser (isomorphic-ws) transport.
const wsState = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string;
    binaryType: string;
    listeners: Record<string, Array<(event: unknown) => void>>;
    sent: unknown[];
    emit: (type: string, event?: unknown) => void;
  }>,
}));

vi.mock('isomorphic-ws', () => ({
  default: class MockWebSocket {
    url: string;
    opts?: unknown;
    binaryType = '';
    listeners: Record<string, Array<(event: unknown) => void>> = {};
    sent: unknown[] = [];
    constructor(url: string, opts?: unknown) {
      this.url = url;
      this.opts = opts;
      wsState.instances.push(this);
    }
    addEventListener(type: string, cb: (event: unknown) => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    close() {}
    emit(type: string, event?: unknown) {
      for (const cb of this.listeners[type] ?? []) cb(event);
    }
  },
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'http://localhost/api',
  isTauriAppPlatform: () => false,
}));

vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  createSupabaseClient: () => ({}),
  createSupabaseAdminClient: () => ({}),
}));

// Controllable stub for the authenticated HTTPS proxy fetch.
const httpState = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  body: new Uint8Array([1, 2, 3]),
}));
vi.mock('@/utils/fetch', () => ({
  fetchWithAuth: vi.fn(
    async () => new Response(httpState.body, { status: 200, headers: httpState.headers }),
  ),
}));

const makeBinaryAudioFrame = (audio: Uint8Array) => {
  const header = new TextEncoder().encode('Path:audio\r\n');
  const buf = new ArrayBuffer(2 + header.length + audio.length);
  new DataView(buf).setInt16(0, header.length);
  new Uint8Array(buf).set(header, 2);
  new Uint8Array(buf).set(audio, 2 + header.length);
  return buf;
};

const makeMetadataFrame = (text: string, offset: number, duration: number) =>
  'X-RequestId:abc\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n' +
  JSON.stringify({
    Metadata: [
      {
        Type: 'WordBoundary',
        Data: { Offset: offset, Duration: duration, text: { Text: text, Length: text.length } },
      },
    ],
  });

describe('EdgeSpeechTTS.createAudioData word boundaries (browser WebSocket path)', () => {
  beforeEach(() => {
    wsState.instances.length = 0;
    (URL as unknown as { createObjectURL?: (blob: Blob) => string }).createObjectURL = vi.fn(
      () => 'blob:mock-object-url',
    );
  });

  test('captures word boundaries from audio.metadata frames and caches them', async () => {
    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');
    const payload = {
      lang: 'en',
      text: 'Hello brave world',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    };

    const promise = tts.createAudioData(payload);
    await vi.waitFor(() => expect(wsState.instances.length).toBe(1));
    const ws = wsState.instances[0]!;
    // In a browser (jsdom has `window`), the WebSocket constructor must be
    // called WITHOUT an options argument: native WebSocket treats a second
    // argument as subprotocols and throws SyntaxError on an options object.
    expect((ws as unknown as { opts?: unknown }).opts).toBeUndefined();
    ws.emit('open');
    ws.emit('message', { data: makeMetadataFrame('Hello', 1000000, 4000000) });
    ws.emit('message', { data: makeBinaryAudioFrame(new Uint8Array([1, 2, 3, 4])) });
    ws.emit('message', { data: makeMetadataFrame('brave', 6000000, 4000000) });
    ws.emit('message', { data: 'Path:turn.end\r\n\r\n' });

    const { data, boundaries } = await promise;
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(boundaries).toEqual([
      { offset: 1000000, duration: 4000000, text: 'Hello' },
      { offset: 6000000, duration: 4000000, text: 'brave' },
    ]);

    // A second call for the same payload is served from the cache: no new
    // WebSocket connection, same boundaries.
    const cached = await tts.createAudioData(payload);
    expect(wsState.instances.length).toBe(1);
    expect(new Uint8Array(cached.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(cached.boundaries).toEqual(boundaries);
  });

  test('resolves with empty boundaries when no metadata frames arrive', async () => {
    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('wss');

    const promise = tts.createAudioData({
      lang: 'en',
      text: 'No metadata here',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });
    await vi.waitFor(() => expect(wsState.instances.length).toBe(1));
    const ws = wsState.instances[0]!;
    ws.emit('open');
    ws.emit('message', { data: makeBinaryAudioFrame(new Uint8Array([9, 9])) });
    ws.emit('message', { data: 'Path:turn.end\r\n\r\n' });

    const { boundaries } = await promise;
    expect(boundaries).toEqual([]);
  });
});

describe('word-boundary header (de)serialization', () => {
  test('round-trips boundaries, ASCII-safe for HTTP headers, incl. non-ASCII text', async () => {
    const { serializeWordBoundaries, parseWordBoundariesHeader } = await import('@/libs/edgeTTS');
    const boundaries = [
      { offset: 1000000, duration: 4000000, text: 'Hello' },
      { offset: 6000000, duration: 4000000, text: 'café—世界' },
    ];
    const header = serializeWordBoundaries(boundaries);
    // HTTP header values must be ASCII; non-ASCII text would corrupt the header.
    expect([...header].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(parseWordBoundariesHeader(header)).toEqual(boundaries);
  });

  test('parse returns [] for null, malformed, or non-boundary payloads', async () => {
    const { parseWordBoundariesHeader } = await import('@/libs/edgeTTS');
    expect(parseWordBoundariesHeader(null)).toEqual([]);
    expect(parseWordBoundariesHeader('not-json')).toEqual([]);
    expect(parseWordBoundariesHeader(encodeURIComponent(JSON.stringify({ x: 1 })))).toEqual([]);
    expect(parseWordBoundariesHeader(encodeURIComponent(JSON.stringify([{ text: 'x' }])))).toEqual(
      [],
    );
  });
});

describe('EdgeSpeechTTS.createAudioData over the HTTPS proxy (word boundaries via header)', () => {
  beforeEach(() => {
    httpState.headers = {};
    httpState.body = new Uint8Array([1, 2, 3]);
    (URL as unknown as { createObjectURL?: (blob: Blob) => string }).createObjectURL = vi.fn(
      () => 'blob:mock-object-url',
    );
  });

  test('parses word boundaries from the X-TTS-Word-Boundaries response header', async () => {
    const { EdgeSpeechTTS, serializeWordBoundaries, WORD_BOUNDARIES_HEADER } = await import(
      '@/libs/edgeTTS'
    );
    const boundaries = [
      { offset: 1000000, duration: 4000000, text: 'Hello' },
      { offset: 6000000, duration: 4000000, text: 'world' },
    ];
    httpState.headers = { [WORD_BOUNDARIES_HEADER]: serializeWordBoundaries(boundaries) };

    const tts = new EdgeSpeechTTS('https');
    const result = await tts.createAudioData({
      lang: 'en',
      text: 'Hello world https',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });
    expect(result.boundaries).toEqual(boundaries);
  });

  test('returns empty boundaries when the proxy omits the header', async () => {
    const { EdgeSpeechTTS } = await import('@/libs/edgeTTS');
    const tts = new EdgeSpeechTTS('https');
    const result = await tts.createAudioData({
      lang: 'en',
      text: 'No header https',
      voice: 'en-US-AriaNeural',
      rate: 1.0,
      pitch: 1.0,
    });
    expect(result.boundaries).toEqual([]);
  });
});
