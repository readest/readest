// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { FoliateView } from '@/types/view';
import type { CustomTTSService } from '@/types/customTTS';

// #7430: two custom services on one host (Kokoro on :8880, an OpenAI-style
// proxy on :8080). Picking the proxy's voice in the player after a Kokoro
// voice kept sending speech to :8880. Real controller, custom client and
// stored voice preferences; only the other engines and the network are fake.

// The voices are typed into each service, so nothing is fetched.
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => vi.fn() }));
vi.mock('@/utils/access', () => ({
  getSignedInToken: () => 'token',
  isCustomTTSAllowed: () => true,
}));

const otherEngine = (name: string): TTSClient => ({
  name,
  initialized: false,
  init: vi.fn().mockResolvedValue(name === 'edge-tts'),
  shutdown: vi.fn(),
  speak: vi.fn(async function* (): AsyncGenerator<TTSMessageEvent> {}),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  setPrimaryLang: vi.fn(),
  setRate: vi.fn(),
  setPitch: vi.fn(),
  setVoice: vi.fn(),
  getAllVoices: vi.fn().mockResolvedValue([]),
  getVoices: vi.fn().mockResolvedValue([]),
  getGranularities: vi.fn().mockReturnValue(['sentence']),
  getCapabilities: vi.fn(),
  getVoiceId: vi.fn().mockReturnValue(''),
  getSpeakingLang: vi.fn().mockReturnValue('en'),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, otherEngine('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, otherEngine('edge-tts'));
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({ NativeTTSClient: vi.fn() }));
vi.mock('@/services/tts/providers/readest', () => ({
  ReadestVoiceProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      id: 'readest-tts',
      getAllVoices: async () => [],
      init: async () => false,
    });
  }),
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));

import { TTSController } from '@/services/tts/TTSController';
import { speechEndpoint } from '@/services/tts/providers/openaiCompatible';

const service = (id: string, port: number, voices: string): CustomTTSService => ({
  id,
  name: `Service ${id}`,
  baseUrl: `http://192.168.1.70:${port}/v1`,
  model: 'tts-1',
  voices,
  addedAt: 1,
  updatedAt: 1,
});
// Kokoro's voice names carry their language; the proxy's don't (multilingual).
const services = [service('kokoro', 8880, 'af_heart'), service('proxy', 8080, 'alloy')];

const view = {
  renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
  book: { sections: [] },
  language: { isCJK: false },
  tts: null,
} as unknown as FoliateView;

let controller: TTSController;

// The server the next sentence of an English book is sent to: playback
// resolves each sentence's voice this way, and the voice id names its service.
const speechTarget = async () => {
  const voice = await controller.ttsCustomClient.getVoiceIdFromLang('en');
  return speechEndpoint(services.find((s) => voice.startsWith(`${s.id}:`))!);
};

beforeEach(async () => {
  localStorage.clear();
  controller = new TTSController(null, view, true);
  controller.setCustomTTSServices(() => services);
  await controller.init();
  await controller.setLang('en');
});

describe('switching between custom TTS services in the player', () => {
  // The player's voice list passes each voice's own language.
  it('sends speech to the service of the voice picked last, multilingual or not', async () => {
    await controller.setVoice('kokoro:af_heart', 'en-US');
    expect(await speechTarget()).toBe('http://192.168.1.70:8880/v1/audio/speech');
    await controller.setVoice('proxy:alloy', 'mul');
    expect(await speechTarget()).toBe('http://192.168.1.70:8080/v1/audio/speech');
    await controller.setVoice('kokoro:af_heart', 'en-US');
    expect(await speechTarget()).toBe('http://192.168.1.70:8880/v1/audio/speech');
  });

  it('keeps the multilingual voice for the other languages of the book', async () => {
    await controller.setVoice('proxy:alloy', 'mul');
    expect(await controller.ttsCustomClient.getVoiceIdFromLang('ja')).toBe('proxy:alloy');
  });
});
