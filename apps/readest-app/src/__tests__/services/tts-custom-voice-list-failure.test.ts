// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { FoliateView } from '@/types/view';
import type { CustomTTSService } from '@/types/customTTS';

// #7974: a custom service's voice list request timed out when Read Aloud
// started, so the session listed OpenAI's voices for it, read with `alloy`
// instead of the voice the reader chose, and the server rejected it. Real
// controller, custom client and stored voice preferences; only the other
// engines and the network are fake.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));
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

// A self-hosted service with no voices typed in: its list comes from
// GET /audio/voices.
const services: CustomTTSService[] = [
  {
    id: 'home',
    name: 'Home TTS',
    baseUrl: 'http://192.168.1.70:8880/v1',
    model: 'tts-1',
    addedAt: 1,
    updatedAt: 1,
  },
];
const voiceList = () =>
  Response.json({
    voices: [
      { id: 'Bruce', name: 'Bruce', lang: 'de' },
      { id: 'Eva', name: 'Eva', lang: 'de' },
    ],
  });
const timedOut = () => Promise.reject(new DOMException('Aborted', 'AbortError'));

const view = {
  renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
  book: { sections: [] },
  language: { isCJK: false },
  tts: null,
} as unknown as FoliateView;

// A Read Aloud session: a new controller, initialized as the reader starts it.
const startReadAloud = async () => {
  const controller = new TTSController(null, view, true);
  controller.setCustomTTSServices(() => services);
  await controller.init();
  await controller.setLang('de');
  return controller;
};

const customVoiceIds = async (controller: TTSController) =>
  (await controller.getVoices('de'))
    .filter((group) => group.id.startsWith('custom-tts'))
    .flatMap((group) => group.voices.map((voice) => voice.id));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});

describe('a custom service whose voice list request fails', () => {
  it('keeps reading with the chosen voice from the list the service gave last time', async () => {
    fetchMock.mockImplementation(voiceList);
    const first = await startReadAloud();
    await first.setVoice('home:Bruce', 'de');

    fetchMock.mockImplementation(timedOut);
    const next = await startReadAloud();
    expect(await next.ttsCustomClient.getVoiceIdFromLang('de')).toBe('home:Bruce');
    expect(await customVoiceIds(next)).toEqual(['home:Bruce', 'home:Eva']);
  });

  it('asks the service again when the voice list opens, and reads with a voice picked there', async () => {
    fetchMock.mockImplementation(timedOut);
    const controller = await startReadAloud();

    fetchMock.mockImplementation(voiceList);
    expect(await customVoiceIds(controller)).toEqual(['home:Bruce', 'home:Eva']);
    await controller.setVoice('home:Bruce', 'de');
    expect(controller.ttsClient).toBe(controller.ttsCustomClient);
    expect(await controller.ttsCustomClient.getVoiceIdFromLang('de')).toBe('home:Bruce');
  });

  it.each([429, 503])('keeps the saved list when the service answers %i', async (status) => {
    fetchMock.mockImplementation(voiceList);
    const first = await startReadAloud();
    await first.setVoice('home:Bruce', 'de');

    fetchMock.mockImplementation(async () => new Response('busy', { status }));
    const next = await startReadAloud();
    expect(await next.ttsCustomClient.getVoiceIdFromLang('de')).toBe('home:Bruce');
    expect(await customVoiceIds(next)).toEqual(['home:Bruce', 'home:Eva']);
  });

  it('asks a service that was busy as Read Aloud started again when the voice list opens', async () => {
    fetchMock.mockImplementation(async () => new Response('busy', { status: 503 }));
    const controller = await startReadAloud();

    fetchMock.mockImplementation(voiceList);
    expect(await customVoiceIds(controller)).toEqual(['home:Bruce', 'home:Eva']);
  });

  it('does not ask a service that answered again when the voice list opens', async () => {
    fetchMock.mockImplementation(voiceList);
    const controller = await startReadAloud();
    await customVoiceIds(controller);
    await customVoiceIds(controller);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
