import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent, TTSVoice } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload } from '@/libs/edgeTTS';
import { parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity } from '@/types/view';
import { TTSUtils } from './TTSUtils';

export class EdgeTTSClient implements TTSClient {
  #primaryLang = 'en';
  #rate = 1.0;
  #pitch = 1.0;
  #voice: TTSVoice | null = null;
  #currentVoiceLang = '';
  #voices: TTSVoice[] = [];
  #edgeTTS: EdgeSpeechTTS;

  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  available = true;

  constructor() {
    this.#edgeTTS = new EdgeSpeechTTS();
  }

  async init() {
    this.#voices = EdgeSpeechTTS.voices;
    try {
      await this.#edgeTTS.create({
        lang: 'en',
        text: 'test',
        voice: 'en-US-AriaNeural',
        rate: 1.0,
        pitch: 1.0,
      });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  getPayload = (lang: string, text: string, voiceId: string) => {
    return { lang, text, voice: voiceId, rate: this.#rate, pitch: this.#pitch } as EdgeTTSPayload;
  };

  async *speak(
    ssml: string,
    signal: AbortSignal,
    preload = false,
  ): AsyncGenerator<TTSMessageEvent> {
    const { marks } = parseSSMLMarks(ssml);
    let lang = parseSSMLLang(ssml) || 'en';
    if (lang === 'en' && this.#primaryLang && this.#primaryLang !== 'en') {
      lang = this.#primaryLang;
    }
    let voiceId = 'en-US-AriaNeural';
    if (!this.#voice || this.#currentVoiceLang !== lang) {
      const preferredVoiceId = TTSUtils.getPreferredVoice('edge-tts', lang);
      const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
      this.#voice = preferredVoice ? preferredVoice : (await this.getVoices(lang))[0] || null;
      this.#currentVoiceLang = lang;
    }
    if (this.#voice) {
      voiceId = this.#voice.id;
    }

    if (preload) {
      // preload the first 2 marks immediately and the rest in the background
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        const mark = marks[i]!;
        await this.#edgeTTS.createAudio(this.getPayload(lang, mark.text, voiceId)).catch((err) => {
          console.warn('Error preloading mark', i, err);
        });
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            const mark = marks[i]!;
            try {
              await this.#edgeTTS.createAudio(this.getPayload(lang, mark.text, voiceId));
            } catch (err) {
              console.warn('Error preloading mark (bg)', i, err);
            }
          }
        })();
      }

      yield {
        code: 'end',
        message: 'Preload finished',
      };

      return;
    } else {
      await this.stopInternal();
    }

    for (const mark of marks) {
      if (signal.aborted) {
        yield {
          code: 'error',
          message: 'Aborted',
        };
        break;
      }
      try {
        const blob = await this.#edgeTTS.createAudio(this.getPayload(lang, mark.text, voiceId));
        const url = URL.createObjectURL(blob);
        this.#audioElement = new Audio(url);
        const audio = this.#audioElement;
        audio.setAttribute('x-webkit-airplay', 'deny');
        audio.preload = 'auto';

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        };

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
        if (error instanceof Error && error.message === 'No audio data received.') {
          console.warn('No audio data received for:', mark.text);
          yield {
            code: 'end',
            message: `Chunk finished: ${mark.name}`,
          };
          continue;
        }
        console.log('Error:', error);
        yield {
          code: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
        break;
      }

      await this.stopInternal();
    }
  }

  async pause() {
    if (!this.#isPlaying || !this.#audioElement) return;
    this.#pausedAt = this.#audioElement.currentTime - this.#startedAt;
    await this.#audioElement.pause();
    this.#isPlaying = false;
  }

  async resume() {
    if (this.#isPlaying || !this.#audioElement) return;
    await this.#audioElement.play();
    this.#isPlaying = true;
    this.#startedAt = this.#audioElement.currentTime - this.#pausedAt;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
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

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  async setRate(rate: number) {
    // The Edge TTS API uses rate in [0.5 .. 2.0].
    this.#rate = rate;
  }

  async setPitch(pitch: number) {
    // The Edge TTS API uses pitch in [0.5 .. 1.5].
    this.#pitch = pitch;
  }

  async setVoice(voice: string) {
    const selectedVoice = this.#voices.find((v) => v.id === voice);
    if (selectedVoice) {
      this.#voice = selectedVoice;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#voices.forEach((voice) => {
      voice.disabled = !this.available;
    });
    return this.#voices;
  }

  async getVoices(lang: string): Promise<TTSVoice[]> {
    if (this.#currentVoiceLang) {
      lang = this.#currentVoiceLang;
    }
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    return voices.filter((v) => v.lang.startsWith(locale));
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#voice?.id || '';
  }
}
