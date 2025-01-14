import { getUserLocale } from '@/utils/misc';
import { TTSClient, TTSMessageEvent, TTSVoice } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload } from '@/libs/edgeTTS';
import { parseSSMLLang, parseSSMLMarks } from '@/utils/ssml';
import { TTSGranularity } from '@/types/view';

export class EdgeTTSClient implements TTSClient {
  #rate = 1.0;
  #pitch = 1.0;
  #voice: TTSVoice | null = null;
  #voices: TTSVoice[] = [];
  #edgeTTS: EdgeSpeechTTS;

  #audioContext: AudioContext | null = null;
  #sourceNode: AudioBufferSourceNode | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;
  #audioBuffer: AudioBuffer | null = null;
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
    const lang = parseSSMLLang(ssml) || 'en';

    let voiceId = 'en-US-AriaNeural';
    if (!this.#voice) {
      const voices = await this.getVoices(lang);
      this.#voice = voices[0] ? voices[0] : this.#voices.find((v) => v.id === voiceId) || null;
    }
    if (this.#voice) {
      voiceId = this.#voice.id;
    }

    if (preload) {
      for (const mark of marks) {
        await this.#edgeTTS.createAudio(this.getPayload(lang, mark.text, voiceId)).catch((err) => {
          console.warn('Error preloading:', err);
        });
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
        this.#audioContext = new AudioContext();
        this.#sourceNode = this.#audioContext.createBufferSource();
        this.#sourceNode.buffer = this.#audioBuffer;
        this.#sourceNode.connect(this.#audioContext.destination);

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        };

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          if (this.#audioContext === null || this.#sourceNode === null) {
            throw new Error('Audio context or source node is null');
          }
          this.#sourceNode.onended = () => {
            this.#isPlaying = false;
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
          this.#sourceNode.start(0);
          this.#isPlaying = true;
          this.#startedAt = this.#audioContext.currentTime;
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
    if (!this.#isPlaying || !this.#audioContext || !this.#sourceNode) return;
    this.#pausedAt = this.#audioContext.currentTime - this.#startedAt;
    await this.#audioContext.suspend();
    this.#isPlaying = false;
  }

  async resume() {
    if (this.#isPlaying || !this.#audioContext || !this.#sourceNode) return;
    await this.#audioContext.resume();
    this.#isPlaying = true;
    this.#startedAt = this.#audioContext.currentTime - this.#pausedAt;
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
      } catch (err) {
        if (!(err instanceof Error) || err.name !== 'InvalidStateError') {
          console.log('Error stopping source node:', err);
        }
      }
      this.#sourceNode.disconnect();
      this.#sourceNode = null;
    }
    if (this.#audioContext) {
      await this.#audioContext.close();
      this.#audioContext = null;
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
