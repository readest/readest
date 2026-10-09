import { describe, expect, it } from 'vitest';
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
});
