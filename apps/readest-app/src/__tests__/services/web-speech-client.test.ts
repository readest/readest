// @vitest-environment happy-dom
import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest';

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

// A platform with no speech voices reports an empty list and never fires
// 'voiceschanged'. init() used to await that event forever, which wedged
// TTSController.init() and so took down every other engine with it —
// including recorded narration, which needs no system voice.
describe('WebSpeechClient init with no voices available', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves instead of hanging when voiceschanged never fires', async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        onvoiceschanged: null,
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        speak: vi.fn(),
      },
      configurable: true,
    });
    const client = new WebSpeechClient();

    const init = client.init();
    let settled = false;
    void init.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(init).resolves.toBe(true);
    expect(await client.getAllVoices()).toEqual([]);
  });

  test('a late voiceschanged still populates the list, and only once', async () => {
    const synth: Record<string, unknown> = {
      getVoices: () => [],
      onvoiceschanged: null,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      speak: vi.fn(),
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    const client = new WebSpeechClient();
    const init = client.init();

    await vi.advanceTimersByTimeAsync(100);
    synth['getVoices'] = () => voices;
    (synth['onvoiceschanged'] as () => void)();
    await expect(init).resolves.toBe(true);
    expect((await client.getAllVoices()).length).toBe(voices.length);

    // The timeout must not re-run population after the event already did.
    await vi.advanceTimersByTimeAsync(5000);
    expect((await client.getAllVoices()).length).toBe(voices.length);
  });
});

// Chrome on Android reports voice locales with an underscore (en_US).
describe('WebSpeechClient Android locale voices', () => {
  const androidVoices = [
    makeVoice('Japanese Japan', 'ja_JP'),
    makeVoice('English United Kingdom', 'en_GB'),
    makeVoice('English United States', 'en_US'),
  ];
  let client: WebSpeechClient;

  beforeEach(async () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => androidVoices,
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

  test('offers Android voices for a book in a language without a region', async () => {
    const groups = await client.getVoices('ja');

    expect(groups[0]!.disabled).toBe(false);
    expect(groups[0]!.voices.map((voice) => voice.name)).toEqual(['Japanese Japan']);
    expect(await client.getWebSpeechVoiceFromLang('ja')).toBe(androidVoices[0]);
  });

  test("puts the Android voice of the book's region first", async () => {
    const groups = await client.getVoices('en-US');

    expect(groups[0]!.voices.map((voice) => voice.name)).toEqual([
      'English United States',
      'English United Kingdom',
    ]);
    expect(await client.getWebSpeechVoiceFromLang('en-US')).toBe(androidVoices[2]);
  });
});
