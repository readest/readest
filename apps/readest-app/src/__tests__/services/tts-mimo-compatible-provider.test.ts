import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import { OpenAICompatibleSpeechProvider } from '@/services/tts/providers/openaiCompatible';
import type { CustomTTSService } from '@/types/customTTS';

const service = (overrides: Partial<CustomTTSService> = {}): CustomTTSService => ({
  id: 'mimo',
  name: 'Xiaomi MiMo',
  baseUrl: 'https://api.xiaomimimo.com/v1/',
  apiKey: 'sk-test',
  model: 'mimo-v2.5-tts',
  addedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const req = (voice: string, text = '你好，世界。') => ({
  lang: 'zh-CN',
  text,
  voice: `mimo:${voice}`,
  pitch: 1,
});

const response = (bytes: number[]) =>
  Response.json({
    choices: [{ message: { audio: { data: btoa(String.fromCharCode(...bytes)) } } }],
  });

describe('Xiaomi MiMo native TTS compatibility', () => {
  let current: CustomTTSService;
  let provider: OpenAICompatibleSpeechProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    current = service();
    provider = new OpenAICompatibleSpeechProvider(
      () => [current],
      async () => true,
    );
  });

  it('lists the eight MiMo voices without calling the nonexistent /audio/voices', async () => {
    const voices = await provider.getAllVoices();
    expect(voices.map((v) => [v.id, v.lang])).toEqual([
      ['mimo:冰糖', 'zh-CN'],
      ['mimo:茉莉', 'zh-CN'],
      ['mimo:苏打', 'zh-CN'],
      ['mimo:白桦', 'zh-CN'],
      ['mimo:Mia', 'en-US'],
      ['mimo:Chloe', 'en-US'],
      ['mimo:Milo', 'en-US'],
      ['mimo:Dean', 'en-US'],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses MiMo chat completions and decodes the returned MP3 audio', async () => {
    current.instructions = '请温柔地朗读。';
    fetchMock.mockResolvedValue(response([0, 255, 128, 12]));

    const result = await provider.synthesize(req('冰糖'), new AbortController().signal);
    expect([...new Uint8Array(result.audio)]).toEqual([0, 255, 128, 12]);
    expect(result.boundaries).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '请温柔地朗读。' },
        { role: 'assistant', content: '你好，世界。' },
      ],
      audio: { format: 'mp3', voice: '冰糖' },
    });
  });

  it('omits the style message when there are no instructions', async () => {
    fetchMock.mockResolvedValue(response([1, 2, 3]));
    await provider.synthesize(req('Mia', 'Hello.'), new AbortController().signal);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).messages).toEqual([
      { role: 'assistant', content: 'Hello.' },
    ]);
  });

  it('does not change custom OpenAI-style endpoints using the MiMo model name', async () => {
    current.baseUrl = 'https://custom-proxy.example.com/v1';
    fetchMock.mockResolvedValue(new Response(new Uint8Array([7, 8])));
    const result = await provider.synthesize(req('冰糖'), new AbortController().signal);
    expect([...new Uint8Array(result.audio)]).toEqual([7, 8]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://custom-proxy.example.com/v1/audio/speech');
  });

  it('sends every model on the MiMo host to chat completions', async () => {
    current.baseUrl = 'https://api.xiaomimimo.com/v1';
    current.model = 'mimo-v2.6-tts';
    fetchMock.mockResolvedValue(response([1, 2, 3]));
    await provider.synthesize(req('冰糖'), new AbortController().signal);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.xiaomimimo.com/v1/chat/completions');
  });

  it('reaches MiMo chat completions whatever path the base URL carries', async () => {
    for (const baseUrl of [
      'https://api.xiaomimimo.com',
      'https://api.xiaomimimo.com/v1/chat/completions',
      'https://api.xiaomimimo.com/v1/audio/speech',
      'https://api.xiaomimimo.com/v1?client=readest',
    ]) {
      current.baseUrl = baseUrl;
      fetchMock.mockResolvedValueOnce(response([1, 2, 3]));
      await provider.synthesize(req('冰糖'), new AbortController().signal);
      expect(fetchMock.mock.lastCall![0], baseUrl).toBe(
        'https://api.xiaomimimo.com/v1/chat/completions',
      );
    }
  });

  it('reports audio data that decodes to nothing as an error', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ choices: [{ message: { audio: { data: '    ' } } }] }),
    );
    await expect(provider.synthesize(req('冰糖'), new AbortController().signal)).rejects.toThrow(
      'MiMo returned no audio data',
    );
  });

  it('reports a successful response without audio as an error', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: {} }] }));
    await expect(provider.synthesize(req('冰糖'), new AbortController().signal)).rejects.toThrow(
      'MiMo returned no audio data',
    );
  });
});
