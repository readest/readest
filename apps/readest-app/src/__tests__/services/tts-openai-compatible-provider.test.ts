import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import {
  customVoiceId,
  OpenAICompatibleSpeechProvider,
  OPENAI_TTS_VOICES,
} from '@/services/tts/providers/openaiCompatible';
import {
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
} from '@/services/tts/providers/types';
import type { CustomTTSService } from '@/types/customTTS';

const service = (overrides: Partial<CustomTTSService> = {}): CustomTTSService => ({
  id: 's1',
  name: 'My TTS',
  baseUrl: 'https://tts.example.com/v1/',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini-tts',
  addedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const audioResponse = (bytes = [1, 2, 3]) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

const req = (voice: string, text = 'Hello there.') => ({ lang: 'en', text, voice, pitch: 1 });

describe('OpenAICompatibleSpeechProvider', () => {
  let services: CustomTTSService[];
  let allowed: boolean;
  let provider: OpenAICompatibleSpeechProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    services = [service()];
    allowed = true;
    provider = new OpenAICompatibleSpeechProvider(
      () => services,
      async () => allowed,
    );
  });

  it('lists the voices each service reports, namespaced by service id', async () => {
    services = [
      service(),
      service({ id: 's2', baseUrl: 'http://kokoro.lan:8880/v1', apiKey: undefined }),
      service({ id: 's3', baseUrl: 'https://api.openai.com/v1' }),
    ];
    fetchMock.mockImplementation(async (url: string) => {
      // Kokoro-FastAPI style objects, plain names, and no listing at all.
      if (url.startsWith('https://tts.example.com/')) {
        return Response.json({ voices: [{ id: 'af_heart', name: 'af_heart' }, { id: 'am_adam' }] });
      }
      if (url.startsWith('http://kokoro.lan:8880/')) return Response.json({ voices: ['nova'] });
      return new Response('Not found', { status: 404 });
    });
    const voices = await provider.getAllVoices();
    expect(voices.map((v) => v.id)).toEqual([
      's1:af_heart',
      's1:am_adam',
      's2:nova',
      ...OPENAI_TTS_VOICES.map((v) => `s3:${v}`),
    ]);
    expect(voices[0]!.name).toBe('af_heart');
    const [url, init] = fetchMock.mock.calls.find(([u]) => u.includes('tts.example.com'))!;
    expect(url).toBe('https://tts.example.com/v1/audio/voices');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });

  it("tells a Kokoro voice's language from its name; others read any language", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ voices: ['af_heart', 'bm_george', 'zf_xiaobei', 'jm_kumo', 'nova'] }),
    );
    const voices = await provider.getAllVoices();
    expect(voices.map((v) => [v.name, v.lang])).toEqual([
      ['af_heart', 'en-US'],
      ['bm_george', 'en-GB'],
      ['zf_xiaobei', 'zh-CN'],
      ['jm_kumo', 'ja-JP'],
      ['nova', 'mul'],
    ]);
  });

  it('falls back to the standard OpenAI voices when the listing fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const voices = await provider.getAllVoices();
    expect(voices.map((v) => v.name)).toEqual(OPENAI_TTS_VOICES);
  });

  it('queries no service without premium', async () => {
    allowed = false;
    expect(await provider.getAllVoices()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable without premium or without services', async () => {
    expect(await provider.init()).toBe(true);
    allowed = false;
    expect(await provider.init()).toBe(false);
    allowed = true;
    services = [];
    expect(await provider.init()).toBe(false);
  });

  it('posts an OpenAI speech request to the service the voice belongs to', async () => {
    services = [service({ instructions: 'Calm narrator.' })];
    fetchMock.mockResolvedValue(audioResponse([7, 8]));
    const result = await provider.synthesize(
      req(customVoiceId('s1', 'kokoro:af_bella')),
      new AbortController().signal,
    );
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([7, 8]));
    expect(result.boundaries).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://tts.example.com/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'Hello there.',
      voice: 'kokoro:af_bella',
      response_format: 'mp3',
      instructions: 'Calm narrator.',
    });
  });

  it('sends no Authorization header without a key', async () => {
    services = [service({ apiKey: undefined })];
    fetchMock.mockResolvedValue(audioResponse());
    await provider.synthesize(req('s1:nova'), new AbortController().signal);
    expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty('Authorization');
  });

  it('skips a voice whose service no longer exists', async () => {
    await expect(
      provider.synthesize(req('gone:nova'), new AbortController().signal),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ends the session on auth and endpoint errors', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"bad key"}', { status: 401 }));
    const err = await provider
      .synthesize(req('s1:nova'), new AbortController().signal)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SpeechSynthesisFatalError);
    expect(err.message).toContain('401');
    expect(err.message).toContain('bad key');
  });

  it('skips a sentence the service rejects, retries rate limits and server errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad input', { status: 400 }));
    await expect(
      provider.synthesize(req('s1:nova'), new AbortController().signal),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    for (const status of [429, 500]) {
      fetchMock.mockResolvedValueOnce(new Response('busy', { status }));
      const err = await provider
        .synthesize(req('s1:nova'), new AbortController().signal)
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SpeechSynthesisPermanentError);
      expect(err).not.toBeInstanceOf(SpeechSynthesisFatalError);
    }
  });

  it('aborts the request with the caller signal and detaches once done', async () => {
    const outer = new AbortController();
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, init) => {
      requestSignal = init.signal;
      return Promise.resolve(audioResponse());
    });
    await provider.synthesize(req('s1:nova'), outer.signal);
    outer.abort();
    // A stop after the reply must not abort the finished request (tauriFetch
    // would raise an unhandled "resource id is invalid").
    expect(requestSignal!.aborted).toBe(false);

    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const live = new AbortController();
    const pending = provider.synthesize(req('s1:nova'), live.signal);
    live.abort();
    await expect(pending).rejects.toThrow('Aborted');
  });

  it('scopes the audio cache to the settings that change the audio', () => {
    const scope = () => provider.cacheScope(req('s1:nova'));
    const before = scope();
    services = [service({ model: 'tts-1' })];
    expect(scope()).not.toBe(before);
    const model = scope();
    services = [service({ model: 'tts-1', instructions: 'Whisper.' })];
    expect(scope()).not.toBe(model);
    const instructions = scope();
    services = [service({ model: 'tts-1', instructions: 'Whisper.', apiKey: 'other' })];
    expect(scope()).toBe(instructions);
  });
});
