// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppService } from '@/types/system';

const nativeClient = vi.hoisted(() => ({
  initialized: false,
  init: vi.fn(async () => {
    nativeClient.initialized = true;
    return true;
  }),
  getAllVoices: vi.fn(async () => [{ id: 'espeak-de', name: 'German', lang: 'de' }]),
  getVoices: vi.fn(async () => [
    {
      id: 'native-tts',
      name: 'System TTS',
      engine: 'native-tts',
      voices: [{ id: 'espeak-de', name: 'German', lang: 'de' }],
    },
  ]),
}));

vi.mock('@/services/tts/voicePreview', () => ({
  READEST_TTS_ENGINE: 'readest-tts',
  getNativeClient: () => nativeClient,
}));
vi.mock('@/services/tts/providers/edge', () => ({
  EdgeSpeechProvider: class {
    id = 'edge-tts';
    label = 'Edge TTS';
    getAllVoices = async () => [];
  },
}));
vi.mock('@/services/tts/providers/readest', () => ({
  ReadestVoiceProvider: class {
    label = 'Readest Voice';
    getAllVoices = async () => [];
  },
}));
vi.mock('@/services/tts/providers/openaiCompatible', () => ({
  CUSTOM_TTS_PROVIDER_ID: 'custom-tts',
  OpenAICompatibleSpeechProvider: class {
    label = 'Custom TTS';
    getAllVoices = async () => [];
  },
}));
vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: class {
    init = async () => true;
    getAllVoices = async () => [];
    getVoices = async () => [];
  },
}));

import { loadVoiceLibrary } from '@/services/tts/voiceLibrary';

const load = (platform: Partial<AppService>) =>
  loadVoiceLibrary({
    appService: platform as AppService,
    customServices: () => [],
    customAllowed: false,
  });

describe('loadVoiceLibrary', () => {
  beforeEach(() => {
    nativeClient.initialized = false;
    vi.clearAllMocks();
  });

  test.each([
    ['Android', { isAndroidApp: true }],
    ['iOS', { isIOSApp: true }],
    ['Linux', { isLinuxApp: true }],
  ])('offers the system voices on %s', async (_platform, appService) => {
    const library = await load(appService);
    expect(library.languages).toEqual(['de']);
    expect((await library.getVoices('de')).map((group) => group.id)).toEqual(['native-tts']);
  });

  test('leaves the native engine alone where reading has none', async () => {
    const library = await load({ isMacOSApp: true });
    expect(nativeClient.init).not.toHaveBeenCalled();
    expect(library.languages).toEqual([]);
    expect(await library.getVoices('de')).toEqual([]);
  });
});
