import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent, TTSVoice } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload } from '@/libs/edgeTTS';
import { parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity } from '@/types/view';
import { TTSUtils } from './TTSUtils';

export class EdgeTTSClient implements TTSClient {
  #rate = 1.0;
  #pitch = 1.0;
  #voice: TTSVoice | null = null;
  #currentVoiceLang = '';
  #voices: TTSVoice[] = [];
  #edgeTTS: EdgeSpeechTTS;

  static #audioContext: AudioContext | null;
  #sourceNode: AudioBufferSourceNode | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  #audioBuffer: AudioBuffer | null = null;
  available = true;

  constructor() {
    this.#edgeTTS = new EdgeSpeechTTS();
  }

  async initializeAudioContext() {
    if (!EdgeTTSClient.#audioContext) {
      EdgeTTSClient.#audioContext = new AudioContext();
    }
    if (EdgeTTSClient.#audioContext.state === 'suspended') {
      await EdgeTTSClient.#audioContext.resume();
    }
  }

  async init() {
    this.#voices = EdgeSpeechTTS.voices;
    try {
      await this.initializeAudioContext();
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
    const lang = parseSSMLLang(ssml) || 'en';
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
        this.#audioBuffer = await this.#edgeTTS.createAudio(
          this.getPayload(lang, mark.text, voiceId),
        );
        if (!EdgeTTSClient.#audioContext) {
          EdgeTTSClient.#audioContext = new AudioContext();
        }
        this.#sourceNode = EdgeTTSClient.#audioContext.createBufferSource();
        this.#sourceNode.buffer = this.#audioBuffer;
        this.#sourceNode.connect(EdgeTTSClient.#audioContext.destination);

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        };

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          if (EdgeTTSClient.#audioContext === null || this.#sourceNode === null) {
            throw new Error('Audio context or source node is null');
          }
          this.#sourceNode.onended = (event: Event) => {
            // chunk finished speaking or aborted speaking
            if (signal.aborted || event.type === 'stopped') {
              resolve({
                code: 'error',
                message: 'Aborted',
              });
              return;
            }
            resolve({
              code: 'end',
              message: `Chunk finished: ${mark.name}`,
            });
          };
          if (signal.aborted) {
            resolve({
              code: 'error',
              message: 'Aborted',
            });
            return;
          }
          if (EdgeTTSClient.#audioContext.state === 'suspended') {
            EdgeTTSClient.#audioContext.resume();
          }
          this.#sourceNode.start(0);
          this.#isPlaying = true;
          this.#startedAt = EdgeTTSClient.#audioContext.currentTime;
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
    if (!this.#isPlaying || !EdgeTTSClient.#audioContext) return;
    this.#pausedAt = EdgeTTSClient.#audioContext.currentTime - this.#startedAt;
    await EdgeTTSClient.#audioContext.suspend();
    this.#isPlaying = false;
  }

  async resume() {
    if (this.#isPlaying || !EdgeTTSClient.#audioContext) return;
    await EdgeTTSClient.#audioContext.resume();
    this.#isPlaying = true;
    this.#startedAt = EdgeTTSClient.#audioContext.currentTime - this.#pausedAt;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#isPlaying = false;
    this.#pausedAt = 0;
    this.#startedAt = 0;
    if (this.#sourceNode) {
      try {
        this.#sourceNode.stop();
        if (this.#sourceNode?.onended) {
          this.#sourceNode.onended(new Event('stopped'));
        }
      } catch (err) {
        if (!(err instanceof Error) || err.name !== 'InvalidStateError') {
          console.log('Error stopping source node:', err);
        }
      }
      this.#sourceNode.disconnect();
      this.#sourceNode = null;
    }
    this.#audioBuffer = null;
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
