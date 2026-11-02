import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import { createOpenAICompatibleTranslator } from '@/services/translators/custom/openaiCompatible';
import type { CustomTranslator } from '@/types/translation';

const reply = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const badRequest = () =>
  new Response(JSON.stringify({ error: { message: "Unsupported value: 'none'" } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

const bodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

const translator = (baseUrl: string, extra: Partial<CustomTranslator> = {}) =>
  createOpenAICompatibleTranslator({
    id: 't',
    type: 'openai-compatible',
    name: 'LLM',
    baseUrl,
    model: `model-${Math.random()}`,
    addedAt: 0,
    updatedAt: 0,
    ...extra,
  });

describe('custom translator thinking off', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply('Bonjour'));
  });

  it.each([
    ['https://api.openai.com/v1', { reasoning_effort: 'none' }],
    ['http://127.0.0.1:11434/v1', { reasoning_effort: 'none' }],
    ['https://generativelanguage.googleapis.com/v1beta/openai', { reasoning_effort: 'none' }],
    ['https://openrouter.ai/api/v1', { reasoning: { effort: 'none' } }],
    ['https://api.deepseek.com/v1', { thinking: { type: 'disabled' } }],
    ['https://open.bigmodel.cn/api/paas/v4', { thinking: { type: 'disabled' } }],
    ['https://ark.cn-beijing.volces.com/api/v3', { thinking: { type: 'disabled' } }],
    ['https://api.siliconflow.cn/v1', { enable_thinking: false }],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', { enable_thinking: false }],
  ])('sends the parameter %s understands', async (baseUrl, expected) => {
    await translator(baseUrl, { thinking: 'off' }).translate(['Hello'], 'en', 'fr');
    expect(bodies()[0]).toMatchObject(expected);
  });

  it('sends no thinking parameter by default', async () => {
    await translator('https://api.siliconflow.cn/v1').translate(['Hello'], 'en', 'fr');
    const [body] = bodies();
    for (const key of ['reasoning_effort', 'reasoning', 'thinking', 'enable_thinking']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('retries without the parameter when the model rejects it, then stops sending it', async () => {
    fetchMock.mockImplementationOnce(async () => badRequest());
    const t = translator('https://api.openai.com/v1', { model: 'gpt-4.1-mini', thinking: 'off' });
    expect(await t.translate(['Hello'], 'en', 'fr')).toEqual(['Bonjour']);
    expect(await t.translate(['World'], 'en', 'fr')).toEqual(['Bonjour']);
    expect(bodies().map((b) => 'reasoning_effort' in b)).toEqual([true, false, false]);
  });

  it('reports a 400 that is not about the parameter', async () => {
    fetchMock.mockImplementation(async () => badRequest());
    const t = translator('https://api.openai.com/v1', { thinking: 'off' });
    await expect(t.translate(['Hello'], 'en', 'fr')).rejects.toThrow(/Unsupported value/);
  });
});
