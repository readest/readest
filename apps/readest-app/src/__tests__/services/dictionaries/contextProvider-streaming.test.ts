import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));
vi.mock('@/utils/access', () => ({
  getSignedInToken: () => 'token',
  isCustomTranslatorAllowed: () => true,
}));

import { __clearContextCacheForTests } from '@/services/dictionaries/contextDictionary';
import { contextProvider } from '@/services/dictionaries/providers/contextProvider';
import { loadSDK } from '@/services/translators/custom/openaiCompatible';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';

// The next request answers with an SSE body the test writes chunk by chunk,
// then closes with or without the final chunk that carries `finish_reason`.
const serveStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    // Like a real fetch, aborting the request errors the body.
    init.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const send = (content: string, finishReason: string | null = null) => {
    const data = JSON.stringify({
      id: 'test',
      created: 1,
      model: 'local',
      choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
    });
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
  };
  return {
    send,
    cut: () => controller.close(),
    drop: () => controller.error(new TypeError('network error')),
  };
};

const lookup = (container: HTMLElement) =>
  contextProvider.lookup('bank', {
    lang: 'en',
    signal: new AbortController().signal,
    container,
    selection: { before: 'We walked along the', after: 'until dusk.', targetLang: 'en' },
  });

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('context dictionary card when the stream ends early (#7861)', () => {
  beforeEach(async () => {
    await loadSDK();
    vi.useFakeTimers();
    fetchMock.mockReset();
    __clearContextCacheForTests();
    useCustomTranslatorStore.setState({
      loaded: true,
      translators: [
        {
          id: 'llm',
          type: 'openai-compatible',
          name: 'Gemini',
          baseUrl: 'https://llm.example.com/v1',
          model: 'gemini',
          addedAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useCustomDictionaryStore.setState((state) => ({
      settings: { ...state.settings, contextTranslatorId: 'llm', contextPromptId: undefined },
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      ending: 'closes without a finish reason',
      end: (stream: ReturnType<typeof serveStream>) => stream.cut(),
      reason: 'Response stream ended without a finish reason.',
    },
    {
      ending: 'loses its connection',
      end: (stream: ReturnType<typeof serveStream>) => stream.drop(),
      reason: 'Failed to process successful response',
    },
    {
      ending: 'goes idle past the timeout',
      end: () => vi.advanceTimersByTimeAsync(60_001),
      reason: 'This operation was aborted',
    },
  ])('keeps the partial entry when the stream $ending, marked incomplete and not cached', async ({
    end,
    reason,
  }) => {
    const stream = serveStream();
    const container = document.createElement('div');
    const pending = lookup(container);
    await settle();
    stream.send('{"headword":"bank","definition":"the land beside a river",');
    stream.send('"explanation":"Here it is the river');
    await settle();
    await end(stream);

    expect((await pending).ok).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('bank');
    expect(container.textContent).toContain('the land beside a river');
    expect(container.textContent).toContain('Here it is the river');
    expect(container.lastElementChild?.textContent).toBe(`The answer is incomplete: ${reason}`);
    expect(container.textContent).not.toContain('Context Dictionary failed');

    const retry = serveStream();
    const again = lookup(document.createElement('div'));
    await settle();
    retry.send('{"definition":"the land beside a river"}', 'stop');
    retry.cut();
    await again;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the Markdown a custom prompt streamed before the stream closed', async () => {
    useCustomDictionaryStore.getState().setContextOptions({
      contextPromptId: 'custom',
      contextSystemPrompt: 'Explain the word.',
    });
    const stream = serveStream();
    const container = document.createElement('div');
    const pending = lookup(container);
    await settle();
    stream.send('**Bank**: the land beside a');
    await settle();
    stream.cut();

    expect((await pending).ok).toBe(true);
    expect(container.querySelector('strong')?.textContent).toBe('Bank');
    expect(container.lastElementChild?.textContent).toBe(
      'The answer is incomplete: Response stream ended without a finish reason.',
    );
  });

  it('still reports a failure when the stream ends before any of the entry was shown', async () => {
    const stream = serveStream();
    const container = document.createElement('div');
    const pending = lookup(container);
    await settle();
    stream.send('{"headword":"bank",');
    await settle();
    stream.cut();

    expect((await pending).ok).toBe(true);
    expect(container.textContent).toBe(
      'Context Dictionary failed: Response stream ended without a finish reason.',
    );
  });
});
