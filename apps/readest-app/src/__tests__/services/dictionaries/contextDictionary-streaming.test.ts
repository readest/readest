// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import {
  __clearContextCacheForTests,
  lookupInContext,
} from '@/services/dictionaries/contextDictionary';
import type { CustomTranslator } from '@/types/translation';
import { loadSDK } from '@/services/translators/custom/openaiCompatible';

const translator: CustomTranslator = {
  id: 'stream-test',
  type: 'openai-compatible',
  name: 'Local model',
  baseUrl: 'http://localhost:11434/v1',
  model: 'local',
  addedAt: 1,
  updatedAt: 1,
};
const input = { text: 'bank', before: 'river', after: '', targetLang: 'en' };

const responseStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const send = (delta: Record<string, string>, finishReason: string | null = null) => {
    const data = JSON.stringify({
      id: 'test',
      created: 1,
      model: 'local',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
  };
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send,
    fail(error: Error) {
      controller.error(error);
    },
    finish() {
      send({}, 'stop');
      controller.close();
    },
  };
};

// Flush the real SDK's stream pipeline without advancing request timers.
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('context dictionary streaming (#7279)', () => {
  beforeEach(async () => {
    await loadSDK();
    vi.useFakeTimers();
    fetchMock.mockReset();
    __clearContextCacheForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests SSE and publishes a partial JSON entry before generation finishes', async () => {
    const stream = responseStream();
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      if (JSON.parse(String(init.body)).stream) return stream.response;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: '{"definition":"river side"}' },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    const onUpdate = vi.fn();
    const options = {
      onUpdate,
    };
    const pending = lookupInContext(translator, input, new AbortController().signal, options);
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).stream).toBe(true);
    stream.send({ content: '{"headword":"bank","definition":"the river' });
    await settle();
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ definition: 'the river' }));
    stream.send({ content: ' side","examples":[],"synonyms":[]}' });
    stream.finish();
    expect((await pending).definition).toBe('the river side');
  });

  it('keeps an active response alive beyond 60 seconds, including reasoning chunks', async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    const pending = lookupInContext(translator, input, new AbortController().signal);
    const outcome = pending.then(
      (value) => value,
      (error) => error,
    );
    await settle();
    await vi.advanceTimersByTimeAsync(45_000);
    stream.send({ reasoning_content: 'Working out the sense' });
    await settle();
    await vi.advanceTimersByTimeAsync(45_000);
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    stream.send({ content: '{"definition":"river side"}' });
    stream.finish();
    expect(await outcome).toMatchObject({ definition: 'river side' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal.aborted).toBe(false);
  });

  it('streams custom Markdown while withholding an incomplete leading reasoning block', async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    const onUpdate = vi.fn();
    const options = {
      systemPrompt: 'Explain the meaning.',
      onUpdate,
    };
    const pending = lookupInContext(translator, input, new AbortController().signal, options);
    await settle();
    stream.send({ content: '<think>private reasoning' });
    await settle();
    expect(onUpdate).not.toHaveBeenCalled();
    stream.send({ content: '</think>\n**River**' });
    await settle();
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: '**River**' }));
    stream.finish();
    await pending;
  });

  it('times out an idle stream and still cancels when the popup closes', async () => {
    for (const closePopup of [false, true]) {
      const stream = responseStream();
      fetchMock.mockResolvedValueOnce(stream.response);
      const caller = new AbortController();
      const pending = lookupInContext(translator, input, caller.signal);
      const assertion = expect(pending).rejects.toThrow();
      await settle();
      stream.send({ content: '{"definition":"partial' });
      await settle();
      const signal = fetchMock.mock.calls.at(-1)![1].signal as AbortSignal;
      if (closePopup) caller.abort();
      else await vi.advanceTimersByTimeAsync(60_001);
      expect(signal.aborted).toBe(true);
      stream.finish();
      await assertion;
    }
  });

  it('retries without the thinking parameter when the streaming endpoint rejects it', async () => {
    const stream = responseStream();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'reasoning_effort unsupported' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(stream.response);
    const pending = lookupInContext(
      { ...translator, thinking: 'off' },
      input,
      new AbortController().signal,
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).reasoning_effort).toBe('none');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).reasoning_effort).toBeUndefined();
    stream.send({ content: '{"definition":"river side"}' });
    stream.finish();
    expect(await pending).toMatchObject({ definition: 'river side' });
  });

  it('preserves the message of an error sent inside an SSE response', async () => {
    fetchMock.mockResolvedValue(
      new Response('data: {"error":{"message":"Insufficient credits","code":402}}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const pending = lookupInContext(translator, input, new AbortController().signal);
    const outcome = pending.catch((error: unknown) => error);
    await settle();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('Insufficient credits');
  });

  it('surfaces a stream error and does not cache the partial answer', async () => {
    const stream = responseStream();
    fetchMock
      .mockResolvedValueOnce(stream.response)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 401 }),
      );
    const pending = lookupInContext(translator, input, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow();
    await settle();
    stream.send({ content: '{"definition":"partial' });
    await settle();
    stream.fail(new Error('connection lost'));
    await assertion;
    await expect(
      lookupInContext(translator, input, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
