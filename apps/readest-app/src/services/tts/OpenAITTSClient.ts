import {OpenAISpeechTTS, OpenAITTSPayload} from '@/libs/openaiTTS';
import {getUserLocale} from '@/utils/misc';
import {parseSSMLMarks} from '@/utils/ssml';

import {TTSClient, TTSMessageEvent} from './TTSClient';
import {TTSController} from './TTSController';
import {TTSUtils} from './TTSUtils';
import {TTSGranularity, TTSVoice, TTSVoicesGroup} from './types';

export class OpenAITTSClient implements TTSClient {
  name = 'openai-tts';
  initialized = false;
  controller?: TTSController;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  // openAI does not support pitch adjustment
  // #pitch = 1.0;
  #model = 'kokoro';
  #openaiTTS: OpenAISpeechTTS;
  #audioElement: HTMLAudioElement|null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;

  constructor(controller?: TTSController, baseURL?: string) {
    this.controller = controller;
    this.#openaiTTS = new OpenAISpeechTTS(baseURL);
  }

  async init() {
    const success = await this.#openaiTTS.init();
    if (success) {
      this.#voices = await this.#openaiTTS.getVoices();
      this.#currentVoiceId = this.#voices[0]?.id || 'af_heart';

      console.log('OpenAI TTS client initialized successfully');
      this.initialized = true;
    } else {
      console.error('Failed to initialize OpenAI TTS client');
      this.initialized = false
    }

    return this.initialized;
  }

  async shutdown(): Promise<void> {
    await this.stopInternal();
  }

  async *
      speak(ssml: string, signal: AbortSignal, preload = false):
          AsyncIterable<TTSMessageEvent> {
    const {marks} = parseSSMLMarks(ssml, this.#primaryLang);
    const voiceId = this.#currentVoiceId

    if (preload) {
      // Preload the first 2 marks immediately and the rest in the background
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        const mark = marks[i]!;
        const {language: voiceLang} = mark;
        const lang = await this.#getVoiceLangCode(voiceId);
        this.#speakingLang = voiceLang;

        await this.#openaiTTS
            .createAudio(this.#getPayload(mark.text, voiceId, lang))
            .catch((err) => {
              console.warn('Error preloading mark', i, err);
            });
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            const mark = marks[i]!;
            try {
              const lang = await this.#getVoiceLangCode(voiceId);
              await this.#openaiTTS.createAudio(
                  this.#getPayload(mark.text, voiceId, lang));
            } catch (err) {
              console.warn('Error preloading mark (bg)', i, err);
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
    else {
      await this.stopInternal();
    }

    for (const mark of marks) {
      if (signal.aborted) {
        yield {
          code: 'error',
          message: 'Aborted',
        } as TTSMessageEvent;
        break;
      }
      try {
        const lang = await this.#getVoiceLangCode(voiceId);
        const blob = await this.#openaiTTS.createAudio(
            this.#getPayload(mark.text, voiceId, lang),
        );
        const url = URL.createObjectURL(blob);
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
              resolve({code: 'error', message: 'Aborted'});
            } else {
              resolve({code: 'end', message: `Chunk finished: ${mark.name}`});
            }
          };
          audio.onerror = (e) => {
            cleanUp();
            console.warn('Audio playback error:', e);
            resolve({code: 'error', message: 'Audio playback error'});
          };
          if (signal.aborted) {
            cleanUp();
            resolve({code: 'error', message: 'Aborted'});
            return;
          }
          this.#isPlaying = true;
          audio.play().catch((err) => {
            cleanUp();
            console.error('Failed to play audio:', err);
            resolve(
                {code: 'error', message: 'Playback failed: ' + err.message});
          });
        });

        this.#isPlaying = false;

        if (result.code === 'error') {
          yield result;
          break;
        }

        yield result;
      } catch (error) {
        yield {
          code: 'error',
          message: `TTS error: ${error}`,
        } as TTSMessageEvent;
        break;
      }
    }

    yield {
      code: 'end',
      message: 'All chunks finished',
    } as TTSMessageEvent;
  }

  async pause(): Promise<boolean> {
    if (this.#audioElement && this.#isPlaying) {
      this.#audioElement.pause();
      this.#pausedAt = Date.now() - this.#startedAt;
      this.#isPlaying = false;
      return true;
    }
    return false;
  }

  async resume(): Promise<boolean> {
    if (this.#audioElement && !this.#isPlaying) {
      try {
        await this.#audioElement.play();
        this.#startedAt = Date.now() - this.#pausedAt;
        this.#isPlaying = true;
        return true;
      } catch (error) {
        console.error('Resume error:', error);
        return false;
      }
    }
    return false;
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.src = '';
      this.#audioElement = null;
    }
    this.#isPlaying = false;
    this.#pausedAt = 0;
    this.#startedAt = 0;
  }

  setPrimaryLang(lang: string): void {
    this.#primaryLang = lang;
  }

  async setRate(rate: number): Promise<void> {
    // OpenAI compatible API uses 'speed' parameter (0.25 to 4.0)
    this.#rate = Math.max(0.25, Math.min(4.0, rate));
  }

  async setPitch(pitch: number): Promise<void> {
    // OpenAI TTS doesn't support pitch adjustment
    void pitch;
  }

  async setVoice(voice: string): Promise<void> {
    this.#currentVoiceId = voice;
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return this.#voices;
  }

  async getVoices(lang: string): Promise<TTSVoicesGroup[]> {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    const filteredVoices = voices.filter(
        (v) => v.name.includes(locale) ||
            (lang === 'en' && ['en-US', 'en-GB'].includes(v.lang)),
    );

    const voicesGroup: TTSVoicesGroup = {
      id: `openai-tts`,
      name: `OpenAI Compatible TTS`,
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

  /////////////////////////////////////////////////////////////////
  // Additional methods specific to OpenAI TTS                   //
  /////////////////////////////////////////////////////////////////

  async setModel(model: string): Promise<void> {
    const availableModels = await this.#openaiTTS.getModels();
    if (availableModels.includes(model)) {
      this.#model = model;
    }
  }

  #getPayload =
      (text: string, voiceId: string, lang: string): OpenAITTSPayload => {
        return {
          model: this.#model,
          text: text,
          voice: voiceId,
          speed: this.#rate,
          lang_code: lang,
        };
      };

  #getVoiceLangCode = async(lang: string): Promise<string> => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    const defaultVoice = preferredVoice ?
        preferredVoice :
        (await this.getVoices(lang))[0]?.voices[0] || null;

    return defaultVoice?.lang || 'a';
  };

  async getModels(): Promise<string[]> {
    return await this.#openaiTTS.getModels();
  }

  getCurrentModel(): string {
    return this.#model;
  }
}
