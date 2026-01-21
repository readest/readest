import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload, EDGE_TTS_PROTOCOL } from '@/libs/edgeTTS';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

export class EdgeTTSClient implements TTSClient {
  name = 'edge-tts';
  initialized = false;
  controller?: TTSController;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;

  #edgeTTS: EdgeSpeechTTS | null = null;
  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  #fadeCompensation: number | null = null;

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  async init(protocol: EDGE_TTS_PROTOCOL = 'wss') {
    this.#edgeTTS = new EdgeSpeechTTS(protocol);
    this.#voices = EdgeSpeechTTS.voices;
    try {
      await this.#edgeTTS.create({
        lang: 'en',
        text: 'test',
        voice: 'en-US-AriaNeural',
        rate: 1.0,
        pitch: 1.0,
      });
      this.initialized = true;
    } catch {
      if (protocol === 'wss') {
        if (this.controller?.isAuthenticated) {
          await this.init('https');
        } else {
          this.controller?.dispatchEvent(new CustomEvent('tts-need-auth'));
        }
      } else {
        this.initialized = false;
      }
    }
    return this.initialized;
  }

  getPayload = (lang: string, text: string, voiceId: string) => {
    return { lang, text, voice: voiceId, rate: 1.0, pitch: this.#pitch } as EdgeTTSPayload;
  };

  getVoiceIdFromLang = async (lang: string) => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    if (preferredVoice) return preferredVoice.id;

    const availableVoices = (await this.getVoices(lang))[0]?.voices || [];
    const defaultVoice: TTSVoice | null = availableVoices[0] || null;
    if (defaultVoice?.id === 'en-US-AnaNeural') return 'en-US-AriaNeural'; // avoid using AnaNeural as default
    return defaultVoice?.id || this.#currentVoiceId || 'en-US-AriaNeural';
  };

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      // preload the first 2 marks immediately and the rest in the background
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        const { language: voiceLang } = mark;
        const voiceId = await this.getVoiceIdFromLang(voiceLang);
        this.#currentVoiceId = voiceId;
        await this.#edgeTTS
          ?.createAudioUrl(this.getPayload(voiceLang, mark.text, voiceId))
          .catch((err) => {
            console.warn('Error preloading mark', i, err);
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
              await this.#edgeTTS?.createAudioUrl(this.getPayload(voiceLang, mark.text, voiceId));
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

    await this.stopInternal();
    // Reuse the same Audio element inside the ssml session
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
        const audioUrl = await this.#edgeTTS?.createAudioUrl(
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
          audio.onended = () => {
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };
          audio.onerror = (e) => {
            cleanUp();
            console.warn('Audio playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };
          this.#isPlaying = true;
          audio.src = audioUrl || '';
          audio
            .play()
            .then(() => (audio.playbackRate = this.#rate))
            .catch((err) => {
              cleanUp();
              console.error('Failed to play audio:', err);
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
        console.warn('TTS error for mark:', mark.text, message);
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
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    const filteredVoices = voices.filter(
      (v) => v.lang.startsWith(locale) || (lang === 'en' && ['en-US', 'en-GB'].includes(v.lang)),
    );

    const voicesGroup: TTSVoicesGroup = {
      id: 'edge-tts',
      name: 'Edge TTS',
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
