import { describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

// Enter the BufferedTTSClient <-> constants import cycle where the app does.
import '@/services/environment';
import { BufferedTTSClient } from '@/services/tts/BufferedTTSClient';
import { CachingProvider } from '@/services/tts/providers/cache';
import { OpenAICompatibleSpeechProvider } from '@/services/tts/providers/openaiCompatible';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { MULTILINGUAL_LANG } from '@/services/tts/types';
import type { CustomTTSService } from '@/types/customTTS';

const VOICES: Record<string, string[]> = { a: ['nova', 'onyx'], b: ['af_bella', 'zf_xiaobei'] };

const service = (id: string): CustomTTSService => ({
  id,
  name: `Service ${id}`,
  baseUrl: `https://${id}.example.com/v1`,
  model: 'tts-1',
  addedAt: 1,
  updatedAt: 1,
});

fetchMock.mockImplementation(async (url: string) => {
  const host = new URL(url).hostname.split('.')[0]!;
  return Response.json({ voices: VOICES[host] });
});

describe('BufferedTTSClient over custom TTS services', () => {
  it("offers each service's voices for the book language, and its multilingual ones", async () => {
    const services = [service('a'), service('b')];
    const provider = new OpenAICompatibleSpeechProvider(
      () => services,
      async () => true,
    );
    const store = { get: async () => null, put: async () => {} };
    const client = new BufferedTTSClient(new CachingProvider(provider, store));
    expect(await client.init()).toBe(true);
    expect(client.name).toBe('custom-tts');
    const ids = async (lang: string) =>
      (await client.getVoices(lang)).map((g) => [g.id, g.voices.map((v) => v.id), g.disabled]);
    expect(await ids('en')).toEqual([
      ['custom-tts:a', ['a:nova', 'a:onyx'], false],
      ['custom-tts:b', ['b:af_bella'], false],
    ]);
    expect(await ids('zh-CN')).toEqual([
      ['custom-tts:a', ['a:nova', 'a:onyx'], false],
      ['custom-tts:b', ['b:zf_xiaobei'], false],
    ]);
    expect(await ids('de')).toEqual([
      ['custom-tts:a', ['a:nova', 'a:onyx'], false],
      ['custom-tts:b', [], false],
    ]);
    expect(await client.getVoiceIdFromLang('zh')).toBe('a:nova');
  });

  it('falls back to a voice of any service that reads the book language', async () => {
    // Service b lists first but has no German voice; service a's read any language.
    const provider = new OpenAICompatibleSpeechProvider(
      () => [service('b'), service('a')],
      async () => true,
    );
    const client = new BufferedTTSClient(provider);
    await client.init();
    expect(await client.getVoiceIdFromLang('de')).toBe('a:nova');
  });

  it('reads every language with the chosen multilingual voice', async () => {
    const provider = new OpenAICompatibleSpeechProvider(
      () => [service('a'), service('b')],
      async () => true,
    );
    const client = new BufferedTTSClient(provider);
    await client.init();
    const onyx = (await client.getAllVoices()).find((v) => v.id === 'a:onyx')!;
    expect(onyx.lang).toBe(MULTILINGUAL_LANG);
    // What the voice picker does: remember the voice under its own language.
    TTSUtils.setPreferredVoice(client.name, onyx.lang, onyx.id);
    for (const lang of ['en', 'ja', 'es']) {
      expect(await client.getVoiceIdFromLang(lang)).toBe('a:onyx');
    }
  });

  it('is unavailable without premium', async () => {
    const provider = new OpenAICompatibleSpeechProvider(
      () => [service('a')],
      async () => false,
    );
    const client = new BufferedTTSClient(provider);
    expect(await client.init()).toBe(false);
    expect((await client.getVoices('en'))[0]!.disabled).toBe(true);
  });
});
