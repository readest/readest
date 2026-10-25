// A minimal WebSocket client over a raw `cloudflare:sockets` TLS connection.
//
// Cloudflare's own `fetch()` upgrade reaches api.msedgeservices.com in a form
// its edge answers with a plain HTTP 200, while the same handshake written to
// a raw socket from the same Worker gets 101 Switching Protocols. So the Edge
// TTS proxy speaks RFC 6455 itself: it only needs text frames out and text or
// binary messages in.

interface SocketReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
}

interface SocketWriter {
  write(chunk: Uint8Array): Promise<void>;
}

interface WorkersSocket {
  readable: { getReader(): SocketReader };
  writable: { getWriter(): SocketWriter };
  close(): Promise<void>;
}

type Connect = (
  address: { hostname: string; port: number },
  options: { secureTransport: 'on' },
) => WorkersSocket;

export interface WorkersWebSocket {
  accept(): void;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const merged = new Uint8Array(a.byteLength + b.byteLength);
  merged.set(a, 0);
  merged.set(b, a.byteLength);
  return merged;
};

const encodeFrame = (opcode: number, payload: Uint8Array) => {
  const length = payload.byteLength;
  const extended = length < 126 ? 0 : length < 65536 ? 2 : 8;
  const frame = new Uint8Array(2 + extended + 4 + length);
  const view = new DataView(frame.buffer);
  frame[0] = 0x80 | opcode;
  if (extended === 0) {
    frame[1] = 0x80 | length;
  } else if (extended === 2) {
    frame[1] = 0x80 | 126;
    view.setUint16(2, length);
  } else {
    frame[1] = 0x80 | 127;
    view.setBigUint64(2, BigInt(length));
  }
  // Client frames must be masked.
  const mask = crypto.getRandomValues(new Uint8Array(4));
  frame.set(mask, 2 + extended);
  for (let i = 0; i < length; i++) {
    frame[2 + extended + 4 + i] = payload[i]! ^ mask[i % 4]!;
  }
  return frame;
};

const SOCKETS_MODULE = 'cloudflare:sockets';

export const connectWorkersWebSocket = async (
  url: string,
  headers: Record<string, string>,
): Promise<WorkersWebSocket> => {
  // Only workerd has this module. A variable specifier and the ignore
  // comments keep Next's bundlers and tsc from resolving it; the minifier may
  // fold it back into a literal, and the .catch() then makes OpenNext's
  // esbuild leave the import for runtime instead of failing the build.
  const { connect } = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ SOCKETS_MODULE
  ).catch((error) => {
    throw error;
  })) as { connect: Connect };
  const target = new URL(url);
  const socket = connect({ hostname: target.hostname, port: 443 }, { secureTransport: 'on' });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const request = [
    `GET ${target.pathname}${target.search} HTTP/1.1`,
    `Host: ${target.hostname}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  await writer.write(new TextEncoder().encode(`${request.join('\r\n')}\r\n\r\n`));

  let buffer = new Uint8Array(0);
  let headerEnd = -1;
  while (headerEnd < 0) {
    const { value, done } = await reader.read();
    if (done) throw new Error('WebSocket upgrade failed: connection closed');
    buffer = concat(buffer, value!);
    headerEnd = new TextDecoder().decode(buffer).indexOf('\r\n\r\n');
  }
  const statusLine = new TextDecoder().decode(buffer).split('\r\n')[0]!;
  const status = Number(statusLine.split(' ')[1]);
  if (status !== 101) {
    void socket.close().catch(() => {});
    throw new Error(`WebSocket upgrade failed with status ${status}`);
  }
  buffer = buffer.slice(headerEnd + 4);

  const listeners: Record<string, Array<(event?: unknown) => void>> = {};
  const emit = (type: string, event?: unknown) => {
    for (const listener of listeners[type] ?? []) listener(event);
  };
  let closed = false;
  const write = (frame: Uint8Array) => {
    writer.write(frame).catch((error) => {
      if (!closed) emit('error', error);
    });
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    void socket.close().catch(() => {});
    emit('close');
  };

  // Each frame is FIN/opcode, then a 7-bit length with optional 16- or 64-bit
  // extension; server frames are never masked.
  let fragments: Uint8Array | null = null;
  let fragmentOpcode = 0;
  const drainFrames = () => {
    while (buffer.byteLength >= 2) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const fin = (buffer[0]! & 0x80) !== 0;
      const opcode = buffer[0]! & 0x0f;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.byteLength < 4) return;
        length = view.getUint16(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.byteLength < 10) return;
        length = Number(view.getBigUint64(2));
        offset = 10;
      }
      if (buffer.byteLength < offset + length) return;
      const payload = buffer.slice(offset, offset + length);
      buffer = buffer.slice(offset + length);

      if (opcode === 0x8) return finish();
      if (opcode === 0x9) {
        write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode !== 0) fragmentOpcode = opcode;
      fragments = fragments ? concat(fragments, payload) : payload;
      if (!fin) continue;
      const message = fragments;
      fragments = null;
      emit('message', {
        data: fragmentOpcode === 0x1 ? new TextDecoder().decode(message) : message.buffer,
      });
    }
  };

  const pump = async () => {
    try {
      drainFrames();
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = concat(buffer, value!);
        drainFrames();
      }
      finish();
    } catch (error) {
      if (closed) return;
      closed = true;
      void socket.close().catch(() => {});
      emit('error', error);
    }
  };

  return {
    // Frames already received are delivered once the caller has registered
    // its listeners, mirroring the Workers `accept()` contract.
    accept: () => void pump(),
    send: (data) => write(encodeFrame(0x1, new TextEncoder().encode(data))),
    close: () => {
      if (closed) return;
      write(encodeFrame(0x8, new Uint8Array(0)));
      finish();
    },
    addEventListener: (type: string, listener: (event: never) => void) => {
      (listeners[type] ??= []).push(listener as (event?: unknown) => void);
    },
  };
};
