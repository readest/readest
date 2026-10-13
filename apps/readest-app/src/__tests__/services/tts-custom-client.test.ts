import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => vi.fn() }));

// Enter the BufferedTTSClient <-> constants import cycle where the app does.
import '@/services/environment';
import { BufferedTTSClient } from '@/services/tts/BufferedTTSClient';
import { CachingProvider } from '@/services/tts/providers/cache';
import { OpenAICompatibleSpeechProvider } from '@/services/tts/providers/openaiCompatible';
import type { CustomTTSService } from '@/types/customTTS';

const service = (id: string, voices: string[]): CustomTTSService => ({
  id,
  name: `Service ${id}`,
  baseUrl: 'https://tts.example.com/v1',
  model: 'tts-1',
  voices,
  addedAt: 1,
  updatedAt: 1,
});

describe('BufferedTTSClient over custom TTS services', () => {
  it('offers one voice group per service for any book language', async () => {
    const services = [service('a', ['nova', 'onyx']), service('b', ['af_bella'])];
    const provider = new OpenAICompatibleSpeechProvider(
      () => services,
      async () => true,
    );
    const store = { get: async () => null, put: async () => {} };
    const client = new BufferedTTSClient(new CachingProvider(provider, store));
    expect(await client.init()).toBe(true);
    expect(client.name).toBe('custom-tts');
    for (const lang of ['en', 'ja', 'de']) {
      const groups = await client.getVoices(lang);
      expect(groups.map((g) => [g.id, g.name, g.voices.map((v) => v.id), g.disabled])).toEqual([
        ['custom-tts:a', 'Service a', ['a:nova', 'a:onyx'], false],
        ['custom-tts:b', 'Service b', ['b:af_bella'], false],
      ]);
    }
    expect(await client.getVoiceIdFromLang('ja')).toBe('a:nova');
  });

  it('is unavailable without premium', async () => {
    const provider = new OpenAICompatibleSpeechProvider(
      () => [service('a', ['nova'])],
      async () => false,
    );
    const client = new BufferedTTSClient(provider);
    expect(await client.init()).toBe(false);
    expect((await client.getVoices('en'))[0]!.disabled).toBe(true);
  });
});
