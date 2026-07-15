import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
}));

import { WebSpeechClient } from '@/services/tts/WebSpeechClient';

const makeVoice = (name: string, lang: string) =>
  ({
    name,
    lang,
    voiceURI: `${lang}.${name}`,
    localService: true,
    default: false,
  }) as SpeechSynthesisVoice;

const voices = [
  makeVoice('Aria', 'en-US'),
  makeVoice('Ana', 'en-US'),
  makeVoice('Sonia', 'en-GB'),
  makeVoice('Denise', 'fr-FR'),
];

describe('WebSpeechClient getVoices', () => {
  let client: WebSpeechClient;

  beforeEach(async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => voices,
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        speak: vi.fn(),
      },
      configurable: true,
    });
    client = new WebSpeechClient();
    await client.init();
  });

  // #4033: the voice set must not change between parts of a single book that
  // mix region variants of the same language
  test('returns the same English voice set for any region variant', async () => {
    const names = async (lang: string) =>
      (await client.getVoices(lang))[0]!.voices.map((v) => v.name).sort();
    const us = await names('en-US');
    const gb = await names('en-GB');
    const en = await names('en');
    expect(gb).toEqual(us);
    expect(en).toEqual(us);
    expect(us).toEqual(['Ana', 'Aria', 'Sonia']);
  });

  test('lists voices of the requested locale first', async () => {
    const gb = await client.getVoices('en-GB');
    expect(gb[0]!.voices[0]!.name).toBe('Sonia');
  });

  test('does not include voices from other languages', async () => {
    const fr = await client.getVoices('fr-FR');
    expect(fr[0]!.voices.map((v) => v.name)).toEqual(['Denise']);
    const en = await client.getVoices('en-US');
    expect(en[0]!.voices.map((v) => v.name)).not.toContain('Denise');
  });

  test('does not support word boundaries (sentence highlight only)', () => {
    expect(client.getCapabilities().wordBoundaries).toBe(false);
  });
});
