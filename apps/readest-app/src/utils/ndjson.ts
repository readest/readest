// Newline-delimited JSON from a byte stream, one parsed value per line, as the
// lines arrive. The streaming TextDecoder keeps multi-byte characters intact
// across chunk boundaries. Aborting `signal` cancels the stream, ending a
// read that is waiting for more.
export async function* readNDJSON(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line);
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
