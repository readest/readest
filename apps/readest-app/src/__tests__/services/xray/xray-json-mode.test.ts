// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import { lookupInContext } from '@/services/dictionaries/contextDictionary';
import { createOpenAICompatibleTranslator } from '@/services/translators/custom/openaiCompatible';
import { extractXRay } from '@/services/xray/extract';
import type { CustomTranslator } from '@/types/translation';

const answer = (content: string) => async (_url: string, init: RequestInit) => {
  if (!JSON.parse(init.body as string).stream) {
    return new Response(
      JSON.stringify({
        id: 'x',
        created: 0,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
  const chunk = JSON.stringify({
    id: 'x',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
  });
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
};

// LM Studio takes a JSON schema but not a JSON object.
const lmStudio = (content: string) => async (url: string, init: RequestInit) =>
  JSON.parse(init.body as string).response_format?.type === 'json_object'
    ? new Response(
        JSON.stringify({ error: "'response_format.type' must be 'json_schema' or 'text'" }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    : answer(content)(url, init);

const bodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

const config = (extra: Partial<CustomTranslator> = {}): CustomTranslator => ({
  id: 't',
  type: 'openai-compatible',
  name: 'LLM',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: `model-${Math.random()}`,
  addedAt: 0,
  updatedAt: 0,
  ...extra,
});

const passages = [{ position: 0, text: 'Soon Anna met Boris.', cfiAt: () => '' }];
const input = { bookTitle: 'Sea', bookAuthor: 'A', sourceLang: 'en', targetLang: 'de' };
const reply = JSON.stringify({
  entities: [{ name: 'Anna', type: 'character', quotes: [{ passage: 0, text: 'Anna' }] }],
});
const xray = (translator: CustomTranslator) =>
  extractXRay(translator, passages, [], input, new AbortController().signal);

describe('X-Ray JSON mode', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(answer(reply));
  });

  it('asks the server for a JSON object', async () => {
    await xray(config());
    expect(bodies()[0]).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('asks without it once the server rejects it, and stops sending it', async () => {
    fetchMock.mockImplementation(lmStudio(reply));
    const translator = config();
    expect((await xray(translator)).entities.map((e) => e.name)).toEqual(['Anna']);
    await xray(translator);
    expect(bodies().map((b) => 'response_format' in b)).toEqual([true, false, false]);
  });

  it('still turns thinking off on a server that rejects JSON mode', async () => {
    fetchMock.mockImplementation(lmStudio(reply));
    const translator = config({ thinking: 'off' });
    await xray(translator);
    await xray(translator);
    expect(bodies().map((b) => ['response_format' in b, 'reasoning_effort' in b])).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [false, true],
    ]);
  });

  it('leaves translation and the AI context dictionary as they were', async () => {
    fetchMock.mockImplementation(answer(JSON.stringify({ headword: 'bank', definition: 'shore' })));
    const translator = config();
    await createOpenAICompatibleTranslator(translator).translate(['Hello'], 'en', 'fr');
    await lookupInContext(
      translator,
      { text: 'bank', before: 'along the', after: 'until dusk.', targetLang: 'fr' },
      new AbortController().signal,
    );
    expect(bodies()).toHaveLength(2);
    for (const body of bodies()) expect(body).not.toHaveProperty('response_format');
  });
});
