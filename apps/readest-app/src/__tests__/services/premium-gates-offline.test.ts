// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { FoliateView } from '@/types/view';

// #7827: after an hour offline the SDK's access token has expired and its
// refresh can't reach the server, so getSession() reports no session. The app
// still shows the user signed in with its stored token, and the translator
// popup gates on that token's plan. Context Dictionary, vocabulary AI hints
// and Custom TTS saw a free user instead. Real access gates; only the SDK,
// the LLM call and the other TTS engines are fake.

const mocks = vi.hoisted(() => ({ lookupInContext: vi.fn() }));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: new Error('Failed to fetch') }),
    },
  },
}));
vi.mock('@/services/dictionaries/contextDictionary', () => ({
  lookupInContext: mocks.lookupInContext,
}));
vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => vi.fn(async () => new Response('[]')),
}));

const otherEngine = (name: string): TTSClient => ({
  name,
  initialized: false,
  init: vi.fn().mockResolvedValue(false),
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

import { contextProvider } from '@/services/dictionaries/providers/contextProvider';
import { canAskAIForHint } from '@/services/vocabulary/hintSources';
import { TTSController } from '@/services/tts/TTSController';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
// What AuthContext keeps in localStorage: the last access token, long expired.
const storedToken = (plan: string) =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({
    plan,
    exp: Math.floor(Date.now() / 1000) - 2 * 3600,
  })}.sig`;

const lookupBank = () =>
  contextProvider.lookup('bank', {
    lang: 'en',
    signal: new AbortController().signal,
    container: document.createElement('div'),
    selection: { before: 'along the', after: 'until dusk.', bookTitle: 'River', targetLang: 'fr' },
  });

const customTTSReady = () => {
  const view = {
    renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
    book: { sections: [] },
    language: { isCJK: false },
    tts: null,
  } as unknown as FoliateView;
  const controller = new TTSController(null, view, true);
  controller.setCustomTTSServices(() => [
    {
      id: 'kokoro',
      name: 'Kokoro',
      baseUrl: 'http://192.168.1.70:8880/v1',
      model: 'tts-1',
      voices: 'af_heart',
      addedAt: 1,
      updatedAt: 1,
    },
  ]);
  return controller.ttsCustomClient.init();
};

beforeEach(() => {
  localStorage.clear();
  mocks.lookupInContext.mockReset().mockResolvedValue(null);
  useCustomTranslatorStore.setState({
    translators: [
      {
        id: 'llm',
        type: 'openai-compatible',
        name: 'LLM',
        baseUrl: 'http://192.168.1.70:11434/v1',
        model: 'gemma3',
        addedAt: 1,
        updatedAt: 1,
      },
    ],
    loaded: true,
  });
  useCustomDictionaryStore.setState((state) => ({
    settings: { ...state.settings, contextTranslatorId: 'llm' },
  }));
});

describe('premium gates of user-configured endpoints while the session cannot refresh', () => {
  it('keeps the Context Dictionary for the signed-in premium account', async () => {
    localStorage.setItem('token', storedToken('pro'));
    await lookupBank();
    expect(mocks.lookupInContext).toHaveBeenCalled();
  });

  it('keeps vocabulary AI hints for the signed-in premium account', async () => {
    localStorage.setItem('token', storedToken('pro'));
    expect(await canAskAIForHint()).toBe(true);
  });

  it('keeps Custom TTS for the signed-in premium account', async () => {
    localStorage.setItem('token', storedToken('pro'));
    expect(await customTTSReady()).toBe(true);
  });

  it('keeps them closed for a free account', async () => {
    localStorage.setItem('token', storedToken('free'));
    expect(await lookupBank()).toEqual({ ok: false, reason: 'unsupported' });
    expect(mocks.lookupInContext).not.toHaveBeenCalled();
    expect(await canAskAIForHint()).toBe(false);
    expect(await customTTSReady()).toBe(false);
  });

  it('keeps them closed once signed out', async () => {
    expect(await lookupBank()).toEqual({ ok: false, reason: 'unsupported' });
    expect(await canAskAIForHint()).toBe(false);
    expect(await customTTSReady()).toBe(false);
  });
});
