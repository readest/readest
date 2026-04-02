import { md5 } from 'js-md5';
import { LRUCache } from '@/utils/lru';
import { fetchWithAuth } from '@/utils/fetch';
import { getNodeAPIBaseUrl } from '@/services/environment';
import { TTSVoice } from '@/services/tts/types';

export type CambAISpeechModel = 'mars-flash' | 'mars-pro' | 'mars-instruct';

export interface CambAITTSPayload {
  text: string;
  language: string;
  voiceId: number;
  rate: number;
  model?: CambAISpeechModel;
}

interface CambAIVoiceResponse {
  id: number;
  voice_name: string;
  gender: number | null;
  age: number | null;
  language: number | null;
  description: string | null;
  is_published: boolean | null;
}

interface CambAILanguageResponse {
  id: number;
  language: string;
  short_name: string;
}

const hashPayload = (payload: CambAITTSPayload): string => {
  const base = JSON.stringify(payload);
  return md5(base);
};

export class CambAISpeechTTS {
  private static audioCache = new LRUCache<string, Blob>(200);
  private static audioUrlCache = new LRUCache<string, string>(200, (_, url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
  private static languageMap: Map<number, string> | null = null;
  private static voicesCache: TTSVoice[] | null = null;

  static voices: TTSVoice[] = [];

  private async fetchViaProxy(payload: CambAITTSPayload): Promise<Response> {
    const url = getNodeAPIBaseUrl() + '/tts/camb';
    const response = await fetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        language: payload.language,
        voice_id: payload.voiceId,
        rate: payload.rate,
        speech_model: payload.model || 'mars-flash',
      }),
    });
    if (!response.ok) {
      throw new Error(`CAMB AI TTS request failed: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  async create(payload: CambAITTSPayload): Promise<Response> {
    return this.fetchViaProxy(payload);
  }

  async createAudioUrl(payload: CambAITTSPayload): Promise<string> {
    const cacheKey = hashPayload(payload);
    if (CambAISpeechTTS.audioUrlCache.has(cacheKey)) {
      return CambAISpeechTTS.audioUrlCache.get(cacheKey)!;
    }
    const res = await this.create(payload);
    const arrayBuffer = await res.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    const objectUrl = URL.createObjectURL(blob);
    CambAISpeechTTS.audioCache.set(cacheKey, blob);
    CambAISpeechTTS.audioUrlCache.set(cacheKey, objectUrl);
    return objectUrl;
  }

  static async fetchLanguageMap(): Promise<Map<number, string>> {
    if (CambAISpeechTTS.languageMap) return CambAISpeechTTS.languageMap;

    const url = getNodeAPIBaseUrl() + '/tts/camb?action=languages';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CAMB AI languages: ${response.status}`);
    }
    const data = (await response.json()) as { languages: CambAILanguageResponse[] };
    const map = new Map<number, string>();
    for (const lang of data.languages) {
      map.set(lang.id, lang.short_name.toLowerCase());
    }
    CambAISpeechTTS.languageMap = map;
    return map;
  }

  static async fetchVoices(): Promise<TTSVoice[]> {
    if (CambAISpeechTTS.voicesCache) return CambAISpeechTTS.voicesCache;

    const url = getNodeAPIBaseUrl() + '/tts/camb?action=voices';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CAMB AI voices: ${response.status}`);
    }
    const raw = await response.json();
    // CAMB API may return a raw array or { voices: [...] }
    const voiceList: CambAIVoiceResponse[] = Array.isArray(raw) ? raw : (raw.voices ?? []);
    const languageMap = await CambAISpeechTTS.fetchLanguageMap();

    const voices: TTSVoice[] = voiceList
      .filter((v): v is CambAIVoiceResponse & { language: number } => v.language !== null)
      .map((v) => ({
        id: String(v.id),
        name: v.voice_name,
        lang: languageMap.get(v.language) || 'en-us',
      }));

    CambAISpeechTTS.voicesCache = voices;
    CambAISpeechTTS.voices = voices;
    return voices;
  }
}
