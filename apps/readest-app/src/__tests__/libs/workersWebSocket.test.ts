import { describe, test, expect, vi, beforeEach } from 'vitest';

// A fake cloudflare:sockets TLS socket: the test queues what the server
// sends and inspects what the client wrote.
const server = vi.hoisted(() => {
  const state = {
    written: [] as Uint8Array[],
    incoming: [] as Uint8Array[],
    waiting: null as ((chunk: { value?: Uint8Array; done: boolean }) => void) | null,
    closed: false,
    push(chunk: Uint8Array | string) {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      if (state.waiting) {
        const resolve = state.waiting;
        state.waiting = null;
        resolve({ value: bytes, done: false });
      } else {
        state.incoming.push(bytes);
      }
    },
    connect: vi.fn(() => ({
      readable: {
        getReader: () => ({
          read: () =>
            new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => {
              const next = state.incoming.shift();
              if (next) resolve({ value: next, done: false });
              else state.waiting = resolve;
            }),
        }),
      },
      writable: {
        getWriter: () => ({
          write: async (chunk: Uint8Array) => {
            state.written.push(chunk);
          },
        }),
      },
      close: async () => {
        state.closed = true;
      },
    })),
  };
  return state;
});

vi.mock('cloudflare:sockets', () => ({ connect: server.connect }));

const URL_ = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?ConnectionId=1';
const UPGRADED = 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n';

const serverFrame = (opcode: number, payload: Uint8Array | string, fin = true) => {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const extended = bytes.byteLength < 126 ? 0 : 2;
  const frame = new Uint8Array(2 + extended + bytes.byteLength);
  frame[0] = (fin ? 0x80 : 0) | opcode;
  if (extended) {
    frame[1] = 126;
    new DataView(frame.buffer).setUint16(2, bytes.byteLength);
  } else {
    frame[1] = bytes.byteLength;
  }
  frame.set(bytes, 2 + extended);
  return frame;
};

// Decodes one masked client frame into its opcode and unmasked payload.
const clientFrame = (frame: Uint8Array) => {
  const view = new DataView(frame.buffer, frame.byteOffset);
  expect(frame[1]! & 0x80).toBe(0x80);
  let length = frame[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = view.getUint16(2);
    offset = 4;
  }
  const mask = frame.slice(offset, offset + 4);
  const payload = frame.slice(offset + 4, offset + 4 + length).map((b, i) => b ^ mask[i % 4]!);
  return { opcode: frame[0]! & 0x0f, payload };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('connectWorkersWebSocket', () => {
  beforeEach(() => {
    server.written = [];
    server.incoming = [];
    server.waiting = null;
    server.closed = false;
    server.connect.mockClear();
  });

  test('upgrades over a raw TLS socket and delivers text and binary messages', async () => {
    const { connectWorkersWebSocket } = await import('@/libs/workersWebSocket');
    // The 101 and the first frame can arrive in the same read.
    server.push(
      new Uint8Array([
        ...new TextEncoder().encode(UPGRADED),
        ...serverFrame(0x1, 'Path:turn.start\r\n\r\n{}'),
      ]),
    );
    const ws = await connectWorkersWebSocket(URL_, { 'User-Agent': 'Edg/143' });

    expect(server.connect).toHaveBeenCalledWith(
      { hostname: 'api.msedgeservices.com', port: 443 },
      { secureTransport: 'on' },
    );
    const request = new TextDecoder().decode(server.written[0]);
    expect(request).toMatch(
      /^GET \/tts\/cognitiveservices\/websocket\/v1\?ConnectionId=1 HTTP\/1\.1\r\n/,
    );
    expect(request).toContain('Host: api.msedgeservices.com\r\n');
    expect(request).toContain('Upgrade: websocket\r\n');
    expect(request).toContain('Connection: Upgrade\r\n');
    expect(request).toMatch(/Sec-WebSocket-Key: [A-Za-z0-9+/]{22}==\r\n/);
    expect(request).toContain('User-Agent: Edg/143\r\n');
    expect(request.endsWith('\r\n\r\n')).toBe(true);

    const messages: unknown[] = [];
    let closed = false;
    ws.addEventListener('message', (event) => messages.push(event.data));
    ws.addEventListener('close', () => (closed = true));
    ws.accept();

    // A 200-byte binary frame (16-bit length) split across two reads.
    const audio = new Uint8Array(200).map((_, i) => i);
    const binary = serverFrame(0x2, audio);
    server.push(binary.slice(0, 50));
    await flush();
    server.push(binary.slice(50));
    await flush();
    // A text message fragmented into two frames.
    server.push(serverFrame(0x1, 'Path:turn', false));
    server.push(serverFrame(0x0, '.end\r\n\r\n'));
    await flush();
    // A ping is answered with a pong carrying the same payload.
    server.push(serverFrame(0x9, 'hi'));
    await flush();
    server.push(serverFrame(0x8, new Uint8Array(0)));
    await flush();

    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe('Path:turn.start\r\n\r\n{}');
    expect(new Uint8Array(messages[1] as ArrayBuffer)).toEqual(audio);
    expect(messages[2]).toBe('Path:turn.end\r\n\r\n');
    const pong = clientFrame(server.written[1]!);
    expect(pong.opcode).toBe(0xa);
    expect(new TextDecoder().decode(pong.payload)).toBe('hi');
    expect(closed).toBe(true);
    expect(server.closed).toBe(true);
  });

  test('sends text as masked frames', async () => {
    const { connectWorkersWebSocket } = await import('@/libs/workersWebSocket');
    server.push(UPGRADED);
    const ws = await connectWorkersWebSocket(URL_, {});
    ws.accept();

    const ssml = `<speak>${'x'.repeat(300)}</speak>`;
    ws.send('short');
    ws.send(ssml);
    await flush();

    const short = clientFrame(server.written[1]!);
    expect(short.opcode).toBe(0x1);
    expect(new TextDecoder().decode(short.payload)).toBe('short');
    const long = clientFrame(server.written[2]!);
    expect(long.opcode).toBe(0x1);
    expect(new TextDecoder().decode(long.payload)).toBe(ssml);
  });

  test('rejects a handshake the server answers without 101', async () => {
    const { connectWorkersWebSocket } = await import('@/libs/workersWebSocket');
    server.push('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');

    await expect(connectWorkersWebSocket(URL_, {})).rejects.toThrow(
      'WebSocket upgrade failed with status 200',
    );
    expect(server.closed).toBe(true);
  });
});
