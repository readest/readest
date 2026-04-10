---
name: Cloudflare Workers WebSocket
description: How to open and read WebSockets from Cloudflare Workers (the Node `ws` package does not work) and the Blob binary-frame gotcha
type: project
originSessionId: ec3d5424-adc2-4fca-836f-df323797489c
---
# Cloudflare Workers WebSocket on readest-app

## Why the Node `ws` package fails

The Node `ws` npm package (used transitively by `isomorphic-ws`) opens WebSockets by calling `http.request({ createConnection })`. The Cloudflare Workers runtime does not implement `options.createConnection`, so any attempt to `new WebSocket(url, { headers })` in a Worker throws:

```
The options.createConnection option is not implemented
```

This applies even with `compatibility_flags = ["nodejs_compat"]`.

## Correct pattern: fetch-based upgrade

On Workers you open a WebSocket by calling `fetch()` with an `Upgrade: websocket` header against the **https://** (not `wss://`) form of the URL. The response has `status === 101` and a non-standard `webSocket` property that must be `accept()`ed before use:

```ts
const upgradeUrl = url.replace(/^wss:\/\//i, 'https://');
const response = (await fetch(upgradeUrl, {
  headers: { ...baseHeaders, Upgrade: 'websocket' },
})) as Response & { webSocket?: WebSocket & { accept(): void } };

if (response.status !== 101 || !response.webSocket) {
  throw new Error(`WebSocket upgrade failed with status ${response.status}`);
}

const ws = response.webSocket;
ws.addEventListener('message', onMessage);
ws.accept();
ws.send(payload);
```

Detect the Workers runtime with `typeof globalThis.WebSocketPair !== 'undefined'` — `WebSocketPair` is a Workers-only global.

## Binary frames arrive as Blob (critical)

Cloudflare Workers deliver WebSocket binary frames as **`Blob`** — not `ArrayBuffer` (browsers) and not `Uint8Array` (Node `ws`). Blob decoding is async via `blob.arrayBuffer()`, so:

1. You must serialize decodes through a promise chain to keep frames in receive order — otherwise parallel awaits can merge bytes out of order.
2. Any terminal text message (e.g. Edge TTS's `Path: turn.end`) arrives **synchronously** and will finalize the stream before the in-flight Blob decodes have flushed. Always `await pendingBinary` in the turn.end handler and the close handler before checking whether data was received.

Example skeleton:

```ts
let pending: Promise<void> = Promise.resolve();
const enqueue = (getBuf: () => Promise<ArrayBufferLike> | ArrayBufferLike) => {
  pending = pending.then(async () => {
    const buf = await getBuf();
    appendBinary(buf);
  });
};

ws.addEventListener('message', (event) => {
  const data = event.data;
  if (data instanceof Blob) enqueue(() => data.arrayBuffer());
  else if (data instanceof ArrayBuffer) enqueue(() => data);
  else if (data instanceof Uint8Array) enqueue(() => data.buffer.slice(
    data.byteOffset, data.byteOffset + data.byteLength,
  ));
  // ... handle text path: turn.end
  //     -> await pending, then resolve
});
```

## Where this is used

`src/libs/edgeTTS.ts` `#fetchEdgeSpeechWs` has three branches: Tauri (plugin-websocket), Cloudflare Workers (fetch upgrade + Blob handling), and browser/Node fallback (`isomorphic-ws`). The route that exercises the CF branch is `src/app/api/tts/edge/route.ts`, hit when the web client falls back from direct `wss://` (which browsers can't set headers on) to the `/api/tts/edge` HTTPS endpoint.
