import type { AppService } from '@/types/system';
import type { CustomTTSService } from '@/types/customTTS';
import { EdgeSpeechProvider } from './providers/edge';
import {
  CUSTOM_TTS_PROVIDER_ID,
  OpenAICompatibleSpeechProvider,
} from './providers/openaiCompatible';
import { ReadestVoiceProvider } from './providers/readest';
import { MULTILINGUAL_LANG, type TTSVoice, type TTSVoicesGroup } from './types';
import { groupProviderVoices as group } from './voiceGroups';
import { getNativeClient, READEST_TTS_ENGINE } from './voicePreview';
import { WebSpeechClient } from './WebSpeechClient';

// Every voice this device can read with, for choosing a language's default
// voice outside a reading session (Settings opened from the library). Groups
// come in the reading picker's order: custom services, Readest Voice, Edge,
// then the system voices.

export interface VoiceLibrary {
  // Primary language codes with at least one voice, multilingual ones aside.
  languages: string[];
  getVoices(lang: string): Promise<TTSVoicesGroup[]>;
}

export const loadVoiceLibrary = async ({
  appService,
  customServices,
  customAllowed,
}: {
  appService: AppService | null;
  customServices: () => CustomTTSService[];
  customAllowed: boolean;
}): Promise<VoiceLibrary> => {
  const edge = new EdgeSpeechProvider();
  const readest = new ReadestVoiceProvider();
  const custom = new OpenAICompatibleSpeechProvider(customServices, async () => customAllowed);
  const web = new WebSpeechClient();
  const native =
    appService?.isAndroidApp || appService?.isIOSApp || appService?.isLinuxApp
      ? getNativeClient()
      : null;
  const [edgeVoices, readestVoices, customVoices] = await Promise.all([
    edge.getAllVoices(),
    readest.getAllVoices().catch(() => [] as TTSVoice[]),
    custom.getAllVoices().catch(() => [] as TTSVoice[]),
    web.init(),
    native && !native.initialized ? native.init().catch(() => false) : null,
  ]);
  const systemVoices = [
    ...(await web.getAllVoices()),
    ...(native?.initialized ? await native.getAllVoices() : []),
  ];
  const languages = new Set(
    [...customVoices, ...readestVoices, ...edgeVoices, ...systemVoices]
      .map((voice) => voice.lang.split('-')[0]!.toLowerCase())
      .filter((lang) => lang && lang !== MULTILINGUAL_LANG),
  );
  return {
    languages: [...languages],
    getVoices: async (lang) =>
      [
        ...group(custom, CUSTOM_TTS_PROVIDER_ID, customVoices, lang, false),
        ...group(readest, READEST_TTS_ENGINE, readestVoices, lang, false),
        ...group(edge, edge.id, edgeVoices, lang, false),
        ...(native?.initialized ? await native.getVoices(lang) : []),
        ...(await web.getVoices(lang)),
      ].filter((voiceGroup) => voiceGroup.voices.length > 0),
  };
};
