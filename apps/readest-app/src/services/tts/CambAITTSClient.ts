import { TTSClient, TTSMessageEvent } from './TTSClient';
import { CambAISpeechTTS, CambAITTSPayload } from '@/libs/cambAI';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { AppService } from '@/types/system';

export class CambAITTSClient implements TTSClient {
  name = 'camb-ai';
  initialized = false;
  controller?: TTSController;
  appService?: AppService | null;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;

  #cambTTS: CambAISpeechTTS | null = null;
  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  #fadeCompensation: number | null = null;

  constructor(controller?: TTSController, appService?: AppService | null) {
    this.controller = controller;
    this.appService = appService;
  }

  async init() {
    this.#cambTTS = new CambAISpeechTTS();
    try {
      this.#voices = await CambAISpeechTTS.fetchVoices();
      this.initialized = this.#voices.length > 0;
    } catch (err) {
      console.warn('Failed to initialize CAMB AI TTS:', err);
      this.initialized = false;
    }
    return this.initialized;
  }

  getPayload = (lang: string, text: string, voiceId: string): CambAITTSPayload => {
    return {
      text,
      language: this.#toLangLocale(lang),
      voiceId: Number(voiceId),
      rate: this.#rate,
    };
  };

  #toLangLocale(lang: string): string {
    // Convert BCP-47 (en-US) to CAMB format (en-us)
    const normalized = lang.toLowerCase();
    if (normalized.includes('-')) return normalized;
    // Map 2-char codes to common locale
    const defaults: Record<string, string> = {
      en: 'en-us',
      fr: 'fr-fr',
      de: 'de-de',
      es: 'es-es',
      it: 'it-it',
      pt: 'pt-br',
      ja: 'ja-jp',
      ko: 'ko-kr',
      zh: 'zh-cn',
      ar: 'ar-sa',
      hi: 'hi-in',
      ru: 'ru-ru',
    };
    return defaults[normalized] || `${normalized}-${normalized}`;
  }

  getVoiceIdFromLang = async (lang: string) => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    if (preferredVoice) return preferredVoice.id;

    const availableVoices = (await this.getVoices(lang))[0]?.voices || [];
    const defaultVoice: TTSVoice | null = availableVoices[0] || null;
    return defaultVoice?.id || this.#currentVoiceId;
  };

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        const { language: voiceLang } = mark;
        const voiceId = await this.getVoiceIdFromLang(voiceLang);
        this.#currentVoiceId = voiceId;
        await this.#cambTTS
          ?.createAudioUrl(this.getPayload(voiceLang, mark.text, voiceId))
          .catch((err) => {
            console.warn('Error preloading CAMB AI mark', i, err);
          });
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            const mark = marks[i]!;
            try {
              if (signal.aborted) break;
              const { language: voiceLang } = mark;
              const voiceId = await this.getVoiceIdFromLang(voiceLang);
              await this.#cambTTS?.createAudioUrl(this.getPayload(voiceLang, mark.text, voiceId));
            } catch (err) {
              console.warn('Error preloading CAMB AI mark (bg)', i, err);
            }
          }
        })();
      }

      yield {
        code: 'end',
        message: 'Preload finished',
      } as TTSMessageEvent;

      return;
    }

    await this.stopInternal();
    if (!this.#audioElement) {
      this.#audioElement = new Audio();
    }
    const audio = this.#audioElement;
    audio.setAttribute('x-webkit-airplay', 'deny');
    audio.preload = 'auto';

    for (const mark of marks) {
      this.controller?.dispatchSpeakMark(mark);
      let abortHandler: null | (() => void) = null;
      try {
        const { language: voiceLang } = mark;
        const voiceId = await this.getVoiceIdFromLang(voiceLang);
        this.#speakingLang = voiceLang;
        const audioUrl = await this.#cambTTS?.createAudioUrl(
          this.getPayload(voiceLang, mark.text, voiceId),
        );
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            audio.src = '';
          };
          let resolved = false;
          const handleEnded = () => {
            if (resolved) return;
            resolved = true;
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };

          abortHandler = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
          };
          if (signal.aborted) {
            abortHandler();
            return;
          } else {
            signal.addEventListener('abort', abortHandler);
          }
          audio.onended = handleEnded;
          audio.onerror = (e) => {
            cleanUp();
            console.warn('CAMB AI audio playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };
          this.#isPlaying = true;
          audio.src = audioUrl || '';
          if (!this.appService?.isLinuxApp) {
            audio.playbackRate = this.#rate;
          }
          audio
            .play()
            .then(() => {
              if (this.appService?.isLinuxApp) {
                audio.playbackRate = this.#rate;
              }
            })
            .catch((err) => {
              cleanUp();
              console.error('Failed to play CAMB AI audio:', err);
              resolve({ code: 'error', message: 'Playback failed: ' + err.message });
            });
        });
        yield result;
      } catch (error) {
        if (error instanceof Error && error.message === 'No audio data received.') {
          console.warn('No audio data received for:', mark.text);
          yield { code: 'end', message: `Chunk finished: ${mark.name}` } as TTSMessageEvent;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn('CAMB AI TTS error for mark:', mark.text, message);
        yield { code: 'error', message } as TTSMessageEvent;
        break;
      } finally {
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    await this.stopInternal();
  }

  async pause() {
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#pausedAt = this.#audioElement.currentTime - this.#startedAt;
    await this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  #getFadeCompensation() {
    if (this.#fadeCompensation !== null) return this.#fadeCompensation;

    const userAgent = navigator.userAgent;
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    if (isSafari || isIOS) {
      this.#fadeCompensation = 0.2;
    } else {
      this.#fadeCompensation = 0.0;
    }

    return this.#fadeCompensation;
  }

  async resume() {
    if (this.#isPlaying || !this.#audioElement) return true;
    const fadeCompensation = this.#getFadeCompensation();
    this.#audioElement.currentTime = Math.max(0, this.#audioElement.currentTime - fadeCompensation);
    await this.#audioElement.play();
    this.#isPlaying = true;
    this.#startedAt = this.#audioElement.currentTime - this.#pausedAt;
    return true;
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
      this.#audioElement.src = '';
    }
  }

  async setRate(rate: number) {
    this.#rate = rate;
  }

  async setPitch(_pitch: number) {
    // CAMB AI does not support pitch adjustment
  }

  async setVoice(voice: string) {
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

  async getVoices(lang: string) {
    const locale = lang.toLowerCase();
    const voices = await this.getAllVoices();
    const filteredVoices = voices.filter(
      (v) => v.lang.startsWith(locale) || v.lang.split('-')[0] === locale.split('-')[0],
    );

    const voicesGroup: TTSVoicesGroup = {
      id: 'camb-ai',
      name: 'CAMB AI',
      voices: filteredVoices.sort(TTSUtils.sortVoicesFunc),
      disabled: !this.initialized || filteredVoices.length === 0,
    };

    return [voicesGroup];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
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
    this.initialized = false;
    this.#audioElement = null;
    this.#voices = [];
  }
}
