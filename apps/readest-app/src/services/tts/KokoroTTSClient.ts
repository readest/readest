import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

interface KokoroVoiceResponse {
  voices: string[];
}

interface KokoroSpeechRequest {
  model: string;
  voice: string;
  input: string;
  response_format?: string;
  speed?: number;
}

export class KokoroTTSClient implements TTSClient {
  name = 'kokoro-tts';
  initialized = false;
  controller?: TTSController;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;
  #serverUrl = 'http://localhost:8880';

  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;

  constructor(controller?: TTSController) {
    this.controller = controller;
    this.#serverUrl = this.initializeServerUrl();
  }

  private initializeServerUrl(): string {
    // Get server URL from environment or localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('kokoro-tts-server-url');
      if (stored) return stored;
    }
    return process.env['NEXT_PUBLIC_KOKORO_TTS_URL'] || 'http://localhost:8880';
  }

  private setServerUrl(url: string): void {
    this.#serverUrl = url;
    if (typeof window !== 'undefined') {
      localStorage.setItem('kokoro-tts-server-url', url);
    }
  }

  async init(): Promise<boolean> {
    try {
      // Test connection by fetching available voices
      const response = await fetch(`${this.#serverUrl}/v1/audio/voices`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        console.warn(`KOKORO TTS server not available at ${this.#serverUrl}`);
        this.initialized = false;
        return false;
      }

      const voicesData: KokoroVoiceResponse = await response.json();
      
      // Convert KOKORO voice names to TTSVoice format
      this.#voices = voicesData.voices.map((voiceName) => ({
        id: voiceName,
        name: this.formatVoiceName(voiceName),
        lang: this.inferLanguageFromVoice(voiceName),
        disabled: false,
      }));

      this.initialized = true;
      console.log(`KOKORO TTS initialized with ${this.#voices.length} voices`);
      return true;
    } catch (error) {
      console.warn('Failed to initialize KOKORO TTS:', error);
      this.initialized = false;
      return false;
    }
  }

  private formatVoiceName(voiceName: string): string {
    // Convert voice names like "af_bella" to "Bella (AF)"
    const parts = voiceName.split('_');
    if (parts.length >= 2) {
      const prefix = parts[0]?.toUpperCase() || '';
      const name = parts.slice(1).map(part => 
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      ).join(' ');
      return `${name} (${prefix})`;
    }
    return voiceName.charAt(0).toUpperCase() + voiceName.slice(1).toLowerCase();
  }

  private inferLanguageFromVoice(voiceName: string): string {
    // Infer language from voice name patterns
    const lowerName = voiceName.toLowerCase();
    
    if (lowerName.includes('jp_') || lowerName.includes('japanese')) {
      return 'ja';
    }
    if (lowerName.includes('zh_') || lowerName.includes('chinese')) {
      return 'zh';
    }
    if (lowerName.includes('ko_') || lowerName.includes('korean')) {
      return 'ko';
    }
    
    // Default to English for most voices
    return 'en';
  }

  private async makeKokoroRequest(request: KokoroSpeechRequest): Promise<Response> {
    const response = await fetch(`${this.#serverUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`KOKORO TTS request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  private getVoiceIdFromLang = async (lang: string): Promise<string> => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    
    if (preferredVoice) {
      return preferredVoice.id;
    }

    // Find a voice that matches the language
    const langVoices = this.#voices.filter(v => v.lang === lang);
    if (langVoices.length > 0) {
      return langVoices[0]!.id;
    }

    // Fallback to current voice or first available voice
    return this.#currentVoiceId || this.#voices[0]?.id || 'af_bella';
  };

  async *speak(ssml: string, signal: AbortSignal, preload = false): AsyncIterable<TTSMessageEvent> {
    if (!ssml) {
      yield { code: 'error', message: 'Empty SSML input' };
      return;
    }

    const { marks } = parseSSMLMarks(ssml);
    if (!marks || marks.length === 0) {
      yield { code: 'error', message: 'No valid marks found in SSML' };
      return;
    }

    let defaultLang = parseSSMLLang(ssml) || 'en';
    
    if (defaultLang === 'en' && this.#primaryLang && this.#primaryLang !== 'en') {
      defaultLang = this.#primaryLang;
    }

    if (preload) {
      // For preloading, we'll just validate the request without generating audio
      try {
        const voiceId = await this.getVoiceIdFromLang(defaultLang);
        const testRequest: KokoroSpeechRequest = {
          model: 'kokoro',
          voice: voiceId,
          input: marks[0]?.text || 'test',
          response_format: 'mp3',
          speed: this.#rate,
        };

        // Make a small test request to validate connectivity
        await this.makeKokoroRequest(testRequest);
        
        yield {
          code: 'end',
          message: 'Preload validation completed',
        } as TTSMessageEvent;
      } catch (error) {
        yield {
          code: 'error',
          message: `Preload failed: ${error instanceof Error ? error.message : String(error)}`,
        } as TTSMessageEvent;
      }
      return;
    }

    await this.stopInternal();

    for (const mark of marks) {
      if (signal.aborted) {
        yield {
          code: 'error',
          message: 'Aborted',
        } as TTSMessageEvent;
        break;
      }

      try {
        const { language } = mark;
        const voiceLang = language || defaultLang;
        const voiceId = await this.getVoiceIdFromLang(voiceLang);
        this.#speakingLang = voiceLang;

        const request: KokoroSpeechRequest = {
          model: 'kokoro',
          voice: voiceId,
          input: mark.text,
          response_format: 'mp3',
          speed: this.#rate,
        };

        const response = await this.makeKokoroRequest(request);
        const audioBlob = await response.blob();
        const url = URL.createObjectURL(audioBlob);
        
        this.#audioElement = new Audio(url);
        const audio = this.#audioElement;
        audio.setAttribute('x-webkit-airplay', 'deny');
        audio.preload = 'auto';

        this.controller?.dispatchSpeakMark(mark);

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.src = '';
            URL.revokeObjectURL(url);
          };

          audio.onended = () => {
            cleanUp();
            if (signal.aborted) {
              resolve({ code: 'error', message: 'Aborted' });
            } else {
              resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
            }
          };

          audio.onerror = (e) => {
            cleanUp();
            console.warn('Audio playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };

          if (signal.aborted) {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
            return;
          }

          this.#isPlaying = true;
          audio.play().catch((err) => {
            cleanUp();
            console.error('Failed to play audio:', err);
            resolve({ code: 'error', message: 'Playback failed: ' + err.message });
          });
        });

        yield result;
      } catch (error) {
        console.error('KOKORO TTS error:', error);
        yield {
          code: 'error',
          message: error instanceof Error ? error.message : String(error),
        } as TTSMessageEvent;
        break;
      }

      await this.stopInternal();
    }
  }

  async pause(): Promise<boolean> {
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#pausedAt = this.#audioElement.currentTime - this.#startedAt;
    await this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  async resume(): Promise<boolean> {
    if (this.#isPlaying || !this.#audioElement) return true;
    await this.#audioElement.play();
    this.#isPlaying = true;
    this.#startedAt = this.#audioElement.currentTime - this.#pausedAt;
    return true;
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    this.#isPlaying = false;
    this.#pausedAt = 0;
    this.#startedAt = 0;
    
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.currentTime = 0;
      
      if (this.#audioElement?.onended) {
        this.#audioElement.onended(new Event('stopped'));
      }
      
      if (this.#audioElement.src?.startsWith('blob:')) {
        URL.revokeObjectURL(this.#audioElement.src);
      }
      
      this.#audioElement.src = '';
      this.#audioElement = null;
    }
  }

  setPrimaryLang(lang: string): void {
    this.#primaryLang = lang;
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = Math.max(0.1, Math.min(3.0, rate)); // Clamp between 0.1 and 3.0
  }

  async setPitch(pitch: number): Promise<void> {
    this.#pitch = Math.max(0.5, Math.min(2.0, pitch)); // Clamp between 0.5 and 2.0
  }

  async setVoice(voice: string): Promise<void> {
    const selectedVoice = this.#voices.find((v) => v.id === voice);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#voices.forEach((voice) => {
      voice.disabled = !this.initialized;
    });
    return this.#voices;
  }

  async getVoices(lang: string): Promise<TTSVoicesGroup[]> {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    
    const filteredVoices = voices.filter((v) => {
      if (lang === 'en') {
        return v.lang === 'en' || v.lang.startsWith('en-');
      }
      return v.lang === lang || v.lang.startsWith(lang);
    });

    const voicesGroup: TTSVoicesGroup = {
      id: 'kokoro-tts',
      name: 'KOKORO TTS',
      voices: filteredVoices.sort(TTSUtils.sortVoicesFunc),
      disabled: !this.initialized || filteredVoices.length === 0,
    };

    return [voicesGroup];
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }

  async shutdown(): Promise<void> {
    await this.stopInternal();
    this.initialized = false;
    this.#voices = [];
  }

  // Additional methods for KOKORO-specific functionality
  public updateServerUrl(url: string): void {
    this.setServerUrl(url);
  }

  public getCurrentServerUrl(): string {
    return this.#serverUrl;
  }

  public async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.#serverUrl}/v1/audio/voices`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
