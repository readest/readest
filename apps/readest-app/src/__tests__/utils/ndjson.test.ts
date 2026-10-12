import { describe, expect, it, vi } from 'vitest';
import { readNDJSON } from '@/utils/ndjson';

const streamOf = (chunks: (string | Uint8Array)[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? encoder.encode(c) : c);
      controller.close();
    },
  });
};

const collect = async (body: ReadableStream<Uint8Array>) => {
  const out: unknown[] = [];
  for await (const v of readNDJSON(body)) out.push(v);
  return out;
};

describe('readNDJSON', () => {
  it('parses lines split across chunks', async () => {
    expect(await collect(streamOf(['{"a":', '1}\n{"b"', ':2}\n']))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"text":"你好"}\n');
    // Split inside the 3-byte encoding of 你.
    const cut = bytes.indexOf(0xe4) + 1;
    expect(await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))).toEqual([
      { text: '你好' },
    ]);
  });

  it('parses a final line without a trailing newline and skips blank lines', async () => {
    expect(await collect(streamOf(['{"a":1}\n\n  \n{"done":true}']))).toEqual([
      { a: 1 },
      { done: true },
    ]);
  });

  it('throws on invalid JSON', async () => {
    await expect(collect(streamOf(['{"a":1}\nnot json\n']))).rejects.toThrow();
  });

  it('releases the reader when the consumer stops early', async () => {
    const body = streamOf(['{"a":1}\n{"b":2}\n']);
    for await (const _ of readNDJSON(body)) break;
    expect(body.locked).toBe(false);
  });

  it('reads nothing from a stream whose signal already aborted', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const seen: unknown[] = [];
    for await (const line of readNDJSON(body, AbortSignal.abort())) seen.push(line);
    expect(seen).toEqual([]);
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels the stream when the signal aborts, even mid-read', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\n'));
      },
      cancel,
    });
    const abort = new AbortController();
    const seen: unknown[] = [];
    const reading = (async () => {
      for await (const line of readNDJSON(body, abort.signal)) seen.push(line);
    })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await reading;
    expect(seen).toEqual([{ a: 1 }]);
    expect(cancel).toHaveBeenCalled();
  });
});
