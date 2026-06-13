import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload, EDGE_TTS_PROTOCOL, TTSWordBoundary } from '@/libs/edgeTTS';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { findBoundaryIndexAtTime } from './wordHighlight';

export class EdgeTTSClient implements TTSClient {
  name = 'edge-tts';
  initialized = false;
  controller?: TTSController;
  appService?: AppService | null;

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
  #wordTrackingRafId: number | null = null;

  constructor(controller?: TTSController, appService?: AppService | null) {
    this.controller = controller;
    this.appService = appService;
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

  // Edge TTS websocket requests fail intermittently; retry the preload a few times
  // before giving up so a single transient failure doesn't stall playback.
  #createAudioUrlWithRetry = async (
    payload: EdgeTTSPayload,
    signal: AbortSignal,
    maxAttempts = 3,
  ): Promise<string | undefined> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return undefined;
      try {
        return await this.#edgeTTS?.createAudioUrl(payload);
      } catch (err) {
        lastError = err;
        console.warn(`Edge TTS preload attempt ${attempt}/${maxAttempts} failed`, err);
        if (attempt < maxAttempts && !signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }
    throw lastError;
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
        try {
          await this.#createAudioUrlWithRetry(
            this.getPayload(voiceLang, mark.text, voiceId),
            signal,
          );
        } catch (err) {
          console.warn('Error preloading mark', i, err);
        }
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            const mark = marks[i]!;
            try {
              if (signal.aborted) break;
              const { language: voiceLang } = mark;
              const voiceId = await this.getVoiceIdFromLang(voiceLang);
              await this.#createAudioUrlWithRetry(
                this.getPayload(voiceLang, mark.text, voiceId),
                signal,
              );
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
        const audioResult = await this.#edgeTTS?.createAudio(
          this.getPayload(voiceLang, mark.text, voiceId),
        );
        const audioUrl = audioResult?.url;
        const boundaries = audioResult?.boundaries ?? [];
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
            this.#stopWordTracking();
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
            console.warn('Audio playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };
          this.#isPlaying = true;
          audio.src = audioUrl || '';
          this.#startWordTracking(audio, boundaries);
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

  // Follow playback time against the word-boundary metadata of the current
  // chunk and tell the controller which word is being spoken so it can
  // highlight it. Word offsets are in media time, so audio.playbackRate and
  // pause/resume (including the resume rewind on iOS) are handled naturally
  // by polling audio.currentTime.
  #startWordTracking(audio: HTMLAudioElement, boundaries: TTSWordBoundary[]) {
    this.#stopWordTracking();
    const controller = this.controller;
    if (!controller) return;
    // Always hand the words to the controller — with boundaries it highlights
    // word-by-word; with none it draws the sentence highlight that was
    // suppressed at mark dispatch (see TTSController.prepareSpeakWords).
    controller.prepareSpeakWords(boundaries.map((boundary) => boundary.text));
    if (!boundaries.length) return;
    let lastIndex = -1;
    const tick = () => {
      const index = findBoundaryIndexAtTime(boundaries, audio.currentTime);
      if (index !== lastIndex && index >= 0) {
        lastIndex = index;
        controller.dispatchSpeakWord(index);
      }
      this.#wordTrackingRafId = requestAnimationFrame(tick);
    };
    this.#wordTrackingRafId = requestAnimationFrame(tick);
  }

  #stopWordTracking() {
    if (this.#wordTrackingRafId !== null) {
      cancelAnimationFrame(this.#wordTrackingRafId);
      this.#wordTrackingRafId = null;
    }
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
    this.#stopWordTracking();
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
    // Match by primary language so the voice set stays the same across a book
    // whose sections mix region variants (e.g. en-US front matter and en-GB
    // body text); the requested locale's voices sort first. See #4033.
    const filteredVoices = voices.filter((v) => isSameLang(v.lang, lang));

    const voicesGroup: TTSVoicesGroup = {
      id: 'edge-tts',
      name: 'Edge TTS',
      voices: filteredVoices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
      disabled: !this.initialized || filteredVoices.length === 0,
    };

    return [voicesGroup];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  supportsWordBoundaries(): boolean {
    return true;
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
