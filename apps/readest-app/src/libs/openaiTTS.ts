import {LRUCache} from '@/utils/lru';
import {md5} from 'js-md5';

export interface OpenAITTSPayload {
  model: string;
  text: string;
  voice: string;
  speed?: number;
  lang_code?: string;
}

// name is like "alloy"
// id is like "af_alloy"
// lang is like "a" for english, "e" for spanish
export interface OpenAITTSVoice {
  name: string;
  id: string;
  lang: string;
}

const hashPayload = (payload: OpenAITTSPayload): string => {
  const base = JSON.stringify(payload);
  return md5(base);
};

export class OpenAISpeechTTS {
  private baseURL: string;
  // TODO: add type to cache
  static audioCache = new LRUCache<string, ArrayBuffer>(200);
  static voicesCache: OpenAITTSVoice[] = [];
  static modelsCache: string[] = [];

  constructor(baseURL: string = 'http://localhost:8880') {
    this.baseURL = baseURL;
  }

  async init(): Promise<boolean> {
    try {
      // First check if the service is accessible by trying to fetch models
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error('Health check timeout after 5 seconds'));
      }, 5000);  // 5 second timeout for health check

      const response = await fetch(`${this.baseURL}/v1/models`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`OpenAI TTS service not accessible at ${this.baseURL}: ${
            response.status} ${response.statusText}`);
        return false;
      }

      // If health check passes, fetch voices and models
      await Promise.all([
        this.#fetchVoices(),
        this.#fetchModels(),
      ]);

      console.log(
          `OpenAI TTS service initialized successfully at ${this.baseURL}`);
      return true;
    } catch (error) {
      console.warn(
          `Failed to initialize OpenAI TTS service at ${this.baseURL}:`, error);
      return false;
    }
  }

  async create(payload: OpenAITTSPayload): Promise<Response> {
    return this.#fetchOpenAISpeech(payload);
  }

  async createAudio(payload: OpenAITTSPayload): Promise<Blob> {
    const cacheKey = hashPayload(payload);
    if (OpenAISpeechTTS.audioCache.has(cacheKey)) {
      return new Blob(
          [OpenAISpeechTTS.audioCache.get(cacheKey)!], {type: 'audio/mpeg'});
    }

    try {
      const response = await this.create(payload);
      const arrayBuffer = await response.arrayBuffer();
      OpenAISpeechTTS.audioCache.set(cacheKey, arrayBuffer);

      const contentType = 'audio/mpeg';  // default to mp3
      return new Blob([arrayBuffer], {type: contentType});
    } catch (error) {
      console.error('Failed to create audio with OpenAI TTS:', error);
      throw new Error(`OpenAI TTS audio generation failed: ${
          error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getVoices(): Promise<OpenAITTSVoice[]> {
    if (OpenAISpeechTTS.voicesCache.length === 0) {
      await this.#fetchVoices();
    }
    return OpenAISpeechTTS.voicesCache;
  }

  async getModels(): Promise<string[]> {
    if (OpenAISpeechTTS.modelsCache.length === 0) {
      await this.#fetchModels();
    }
    return OpenAISpeechTTS.modelsCache;
  }

  // Helper method to infer language from voice ID
  #inferLanguageFromVoiceId(voiceId: string): string{return voiceId[0] ?? 'e'}

  #langMap: Record<string, string> = {
    a: 'en-US',  // American English
    b: 'en-GB',  // British English
    e: 'es-ES',  // Spanish (Spain)
    f: 'fr-FR',  // French (France)
    h: 'hi-IN',  // Hindi (India)
    i: 'it-IT',  // Italian
    p: 'pt-BR',  // Portuguese (Brazilian)
    j: 'ja-JP',  // Japanese
    z: 'zh-CN',  // Mandarin Chinese (Simplified, China)
  };

  #getVoiceProperName(voice: string): string {
    const fullLang = this.#langMap[voice[0] ?? 'a'] ?? 'Unknown Language';
    const name = voice.replace(/^[a-z]+_/, '').replace(/_/g, ' ');
    return `${name} (${fullLang})`;
  };

  async #fetchVoices(): Promise<OpenAITTSVoice[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error('Fetch voices timeout after 5 seconds'));
      }, 5000);  // 5 second timeout

      const response = await fetch(`${this.baseURL}/v1/audio/voices`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch voices: ${response.status} ${
            response.statusText}`);
      }

      const data = await response.json();

      const voices: OpenAITTSVoice[] = [];
      if (data.voices && Array.isArray(data.voices)) {
        for (const voice of data.voices) {
          if (typeof voice === 'string') {
            // Handle simple string array format like ["af_heart", "af_sarah",
            // ...]
            voices.push({
              name: this.#getVoiceProperName(voice),
              id: voice,
              lang: this.#inferLanguageFromVoiceId(voice),
            });
          }
        }
      }

      OpenAISpeechTTS.voicesCache = voices;
      return voices;
    } catch (error) {
      console.warn('Failed to fetch voices from OpenAI TTS service:', error);
      return [];
    }
  }

  async #fetchModels(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error('Fetch models timeout after 5 seconds'));
      }, 5000);  // 5 second timeout

      const response = await fetch(`${this.baseURL}/v1/models`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${
            response.statusText}`);
      }

      const data = await response.json();

      const models: string[] = [];
      if (data.data && Array.isArray(data.data)) {
        for (const model of data.data) {
          models.push(model.id);
        }
      }

      // set default models if none found
      OpenAISpeechTTS.modelsCache = models.length > 0 ? models : ['kokoro'];
      return OpenAISpeechTTS.modelsCache;
    } catch (error) {
      console.warn('Failed to fetch models from OpenAI TTS service:', error);
      // Return default model if fetch fails
      OpenAISpeechTTS.modelsCache = ['kokoro'];
      return OpenAISpeechTTS.modelsCache;
    }
  }

  async #fetchOpenAISpeech(payload: OpenAITTSPayload): Promise<Response> {
    const requestBody = {
      model: payload.model || 'kokoro',
      input: payload.text,
      voice: payload.voice,
      response_format: 'mp3',
      speed: payload.speed || 1.0,
      lang_code: payload.lang_code || 'a',
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error('Request timeout after 30 seconds'));
    }, 30000);  // 30 second timeout

    try {
      const response = await fetch(`${this.baseURL}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/*',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`OpenAI TTS API error: ${response.status} ${
            response.statusText} - ${errorText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle specific abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
            'OpenAI TTS request was aborted (likely due to timeout)');
      }

      throw error;
    }
  }
}
