import { getUserLocale } from '@/utils/misc';
import { isSameLang } from '@/utils/lang';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { EdgeSpeechTTS, EdgeTTSPayload, EDGE_TTS_PROTOCOL, TTSWordBoundary } from '@/libs/edgeTTS';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { findBoundaryIndexAtTime } from './wordHighlight';
import { findSpeechBounds } from './pcm';
import { timeStretch } from './timeStretch';
import {
  calibrateVoiceRate,
  recordMeasuredDuration,
  recordProvisionalDuration,
} from './ttsDuration';
import { TTSAudioBuffer, WebAudioPlayer, WebAudioPlayerEvent } from './WebAudioPlayer';

// Playback pipeline: fetch MP3 (cached at rate 1.0) -> decode -> trim silence
// -> WSOLA time-stretch to the playback rate -> schedule gaplessly on the
// shared AudioContext. Marks are dispatched when a chunk becomes AUDIBLE
// (player chunk-start events ride source onended, which keeps working with
// the screen off), not when it is fetched — schedule-ahead would otherwise
// run foliate's mark cursor ahead of the voice and break prev/next/resume.

// Natural pause between sentences, replacing Edge's baked-in ~300ms trailing
// silence. Divided by the playback rate so pauses shrink with speed (#2033's
// "gaps don't scale" complaint).
const INTER_SENTENCE_GAP_SEC = 0.15;
const TICKS_PER_SECOND = 10_000_000;

interface ChunkMeta {
  mark: TTSMark;
  boundaries: TTSWordBoundary[];
  trimStartSec: number;
  trimmedDurationSec: number;
}

type SpeakQueueEvent =
  | { kind: 'chunk-start'; index: number }
  | { kind: 'chunk-skip'; markName: string }
  | { kind: 'session-end' }
  | { kind: 'error'; message: string };

class AsyncQueue<T> {
  #items: T[] = [];
  #resolvers: Array<(item: T) => void> = [];

  push(item: T): void {
    const resolve = this.#resolvers.shift();
    if (resolve) resolve(item);
    else this.#items.push(item);
  }

  next(): Promise<T> {
    const item = this.#items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.#resolvers.push(resolve));
  }
}

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
  #player = new WebAudioPlayer();
  #activeGeneration: number | null = null;
  #activeQueue: AsyncQueue<SpeakQueueEvent> | null = null;
  #chunkMeta: ChunkMeta[] = [];
  #isPlaying = false;
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
    // Rate stays 1.0 so the MP3 cache is rate-independent; the playback rate
    // is applied client-side via time-stretch.
    return { lang, text, voice: voiceId, rate: 1.0, pitch: this.#pitch } as EdgeTTSPayload;
  };

  // Edge TTS websocket requests fail intermittently; retry a few times before
  // giving up so a single transient failure doesn't stall playback. The
  // "No audio data received." failure is permanent for a given sentence, so it
  // rethrows immediately for the caller's skip path.
  #createAudioDataWithRetry = async (
    payload: EdgeTTSPayload,
    signal: AbortSignal,
    maxAttempts = 3,
  ): Promise<{ data: ArrayBuffer; boundaries: TTSWordBoundary[] } | undefined> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return undefined;
      try {
        return await this.#edgeTTS?.createAudioData(payload);
      } catch (err) {
        if (err instanceof Error && err.message === 'No audio data received.') throw err;
        lastError = err;
        console.warn(`Edge TTS fetch attempt ${attempt}/${maxAttempts} failed`, err);
        if (attempt < maxAttempts && !signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }
    throw lastError;
  };

  #recordDurations = (
    voiceId: string,
    text: string,
    boundaries: TTSWordBoundary[],
    trimmedDurationSec?: number,
  ) => {
    if (trimmedDurationSec !== undefined) {
      // Canonical: decode-time trimmed duration; also feeds the per-voice
      // speaking-rate calibration used by timeline estimates.
      recordMeasuredDuration(voiceId, text, trimmedDurationSec);
      calibrateVoiceRate(voiceId, text, trimmedDurationSec);
      return;
    }
    const last = boundaries[boundaries.length - 1];
    if (last) {
      recordProvisionalDuration(voiceId, text, (last.offset + last.duration) / TICKS_PER_SECOND);
    }
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
      yield* this.#preload(marks, signal);
      return;
    }

    await this.stopInternal();

    const queue = new AsyncQueue<SpeakQueueEvent>();
    const chunkMeta: ChunkMeta[] = [];
    this.#activeQueue = queue;
    this.#chunkMeta = chunkMeta;

    // startSession before ensureContext: starting a session declares playback
    // intent, clearing any lingering user-pause so the context may resume.
    const generation = this.#player.startSession((event: WebAudioPlayerEvent) => {
      if (event.type === 'chunk-start') {
        queue.push({ kind: 'chunk-start', index: event.chunkIndex });
      } else if (event.type === 'session-end') {
        queue.push({ kind: 'session-end' });
      } else {
        queue.push({ kind: 'error', message: event.message });
      }
    });
    this.#activeGeneration = generation;
    await this.#player.ensureContext();
    this.#isPlaying = true;

    this.#runScheduler(marks, signal, generation, queue, chunkMeta);

    let abortHandler: (() => void) | null = null;
    try {
      if (signal.aborted) {
        yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
        return;
      }
      abortHandler = () => queue.push({ kind: 'error', message: 'Aborted' });
      signal.addEventListener('abort', abortHandler);

      for (;;) {
        const event = await queue.next();
        if (event.kind === 'chunk-start') {
          const meta = chunkMeta[event.index];
          if (!meta) continue;
          this.controller?.dispatchSpeakMark(meta.mark);
          this.#startWordTracking(generation, event.index, meta);
          yield {
            code: 'boundary',
            message: `Start chunk: ${meta.mark.name}`,
            mark: meta.mark.name,
          } as TTSMessageEvent;
        } else if (event.kind === 'chunk-skip') {
          yield {
            code: 'end',
            message: `Chunk skipped: ${event.markName}`,
          } as TTSMessageEvent;
        } else if (event.kind === 'session-end') {
          yield { code: 'end', message: 'Speak finished' } as TTSMessageEvent;
          return;
        } else {
          yield { code: 'error', message: event.message } as TTSMessageEvent;
          return;
        }
      }
    } finally {
      // The controller aborts the signal after every successful paragraph; a
      // lingering listener would push a stale 'Aborted' into a dead queue.
      if (abortHandler) signal.removeEventListener('abort', abortHandler);
      this.#stopWordTracking();
      this.#isPlaying = false;
      if (this.#activeGeneration === generation) {
        this.#activeGeneration = null;
        this.#activeQueue = null;
        this.#player.abortSession();
      }
    }
  }

  async *#preload(marks: TTSMark[], signal: AbortSignal) {
    // Fetch the first couple of marks immediately and the rest in the
    // background; the in-flight dedup in EdgeSpeechTTS keeps this from racing
    // duplicate requests against the playback scheduler.
    const maxImmediate = 2;
    for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
      if (signal.aborted) break;
      const mark = marks[i]!;
      const voiceId = await this.getVoiceIdFromLang(mark.language);
      this.#currentVoiceId = voiceId;
      try {
        const audio = await this.#createAudioDataWithRetry(
          this.getPayload(mark.language, mark.text, voiceId),
          signal,
        );
        if (audio) this.#recordDurations(voiceId, mark.text, audio.boundaries);
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
            const voiceId = await this.getVoiceIdFromLang(mark.language);
            const audio = await this.#createAudioDataWithRetry(
              this.getPayload(mark.language, mark.text, voiceId),
              signal,
            );
            if (audio) this.#recordDurations(voiceId, mark.text, audio.boundaries);
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
  }

  // Detached scheduler: fetches, prepares, and schedules chunks ahead of the
  // playhead under the player's backpressure. Never throws; failures surface
  // through the event queue.
  async #runScheduler(
    marks: TTSMark[],
    signal: AbortSignal,
    generation: number,
    queue: AsyncQueue<SpeakQueueEvent>,
    chunkMeta: ChunkMeta[],
  ): Promise<void> {
    const rate = this.#rate;
    try {
      for (const mark of marks) {
        if (signal.aborted || this.#activeGeneration !== generation) return;
        // Voices resolve per mark: mixed-language sections speak (and record
        // durations under) the voice actually used for each sentence.
        const voiceId = await this.getVoiceIdFromLang(mark.language);
        this.#speakingLang = mark.language;
        this.#currentVoiceId = voiceId;
        const payload = this.getPayload(mark.language, mark.text, voiceId);

        let audio: { data: ArrayBuffer; boundaries: TTSWordBoundary[] } | undefined;
        try {
          audio = await this.#createAudioDataWithRetry(payload, signal);
        } catch (error) {
          if (error instanceof Error && error.message === 'No audio data received.') {
            console.warn('No audio data received for:', mark.text);
            queue.push({ kind: 'chunk-skip', markName: mark.name });
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.warn('TTS error for mark:', mark.text, message);
          queue.push({ kind: 'error', message });
          return;
        }
        if (!audio || signal.aborted || this.#activeGeneration !== generation) return;
        this.#recordDurations(voiceId, mark.text, audio.boundaries);

        let prepared: {
          buffer: TTSAudioBuffer;
          trimStartSec: number;
          trimmedDurationSec: number;
        };
        try {
          prepared = await this.#prepareChunkBuffer(audio.data, rate);
        } catch (error) {
          // Malformed MP3 must not dead-end the session: same UX as no-audio.
          console.warn('Failed to decode TTS audio for:', mark.text, error);
          queue.push({ kind: 'chunk-skip', markName: mark.name });
          continue;
        }
        this.#recordDurations(voiceId, mark.text, audio.boundaries, prepared.trimmedDurationSec);

        const ready = await this.#player.waitUntilReady(generation);
        if (!ready || signal.aborted) return;
        chunkMeta.push({
          mark,
          boundaries: audio.boundaries,
          trimStartSec: prepared.trimStartSec,
          trimmedDurationSec: prepared.trimmedDurationSec,
        });
        this.#player.scheduleChunk(generation, prepared.buffer, {
          trimStartSec: prepared.trimStartSec,
          mediaScale: prepared.trimmedDurationSec / prepared.buffer.duration,
          gapSec: INTER_SENTENCE_GAP_SEC / rate,
        });
      }
      if (!signal.aborted && this.#activeGeneration === generation) {
        // Fires session-end synchronously when every mark was skipped or the
        // last chunk already ended, so the session always terminates.
        this.#player.endSession(generation);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queue.push({ kind: 'error', message });
    }
  }

  async #prepareChunkBuffer(
    data: ArrayBuffer,
    rate: number,
  ): Promise<{ buffer: TTSAudioBuffer; trimStartSec: number; trimmedDurationSec: number }> {
    // decodeAudioData resamples to the context rate (44.1/48kHz on real
    // devices, not the stream's 24kHz) — all math below must use the decoded
    // buffer's sampleRate.
    const decoded = await this.#player.decode(data);
    const sampleRate = decoded.sampleRate;
    const channel = decoded.getChannelData(0);
    const bounds = findSpeechBounds(channel, sampleRate);
    const startSample = Math.floor(bounds.startSec * sampleRate);
    const endSample = Math.min(channel.length, Math.ceil(bounds.endSec * sampleRate));
    // A subarray is a view; timeStretch never writes its input and
    // createMonoBuffer copies, so no mutation can reach the decoded buffer.
    const trimmed = channel.subarray(startSample, endSample);
    const trimmedDurationSec = trimmed.length / sampleRate;
    const samples = rate !== 1 ? timeStretch(trimmed, sampleRate, rate) : trimmed;
    const buffer = await this.#player.createMonoBuffer(samples, sampleRate);
    return { buffer, trimStartSec: startSample / sampleRate, trimmedDurationSec };
  }

  // Poll the audio clock (visual concern only, so rAF throttling with the
  // screen off is fine) and tell the controller which word is being spoken.
  // The player reports original (rate-1.0) media time, so Edge's boundary
  // ticks need no rescaling for trim or rate.
  #startWordTracking(generation: number, chunkIndex: number, meta: ChunkMeta): void {
    this.#stopWordTracking();
    const controller = this.controller;
    if (!controller) return;
    // Always hand the words to the controller — with boundaries it highlights
    // word-by-word; with none it draws the sentence highlight that was
    // suppressed at mark dispatch (see TTSController.prepareSpeakWords).
    controller.prepareSpeakWords(meta.boundaries.map((boundary) => boundary.text));
    if (!meta.boundaries.length) return;
    let lastIndex = -1;
    const tick = () => {
      const pos = this.#player.getPlaybackPosition(generation);
      // Guard the one-frame window around a transition where this tick still
      // holds the previous chunk's boundaries.
      if (pos && pos.chunkIndex === chunkIndex) {
        const index = findBoundaryIndexAtTime(meta.boundaries, pos.mediaTimeSec);
        if (index !== lastIndex && index >= 0) {
          lastIndex = index;
          controller.dispatchSpeakWord(index);
        }
      }
      this.#wordTrackingRafId = requestAnimationFrame(tick);
    };
    this.#wordTrackingRafId = requestAnimationFrame(tick);
  }

  #stopWordTracking(): void {
    if (this.#wordTrackingRafId !== null) {
      cancelAnimationFrame(this.#wordTrackingRafId);
      this.#wordTrackingRafId = null;
    }
  }

  async pause() {
    if (!this.#isPlaying) return true;
    await this.#player.pauseContext();
    return true;
  }

  async resume() {
    // Throws when the context refuses to run again (iOS post-interruption);
    // the controller's catch stops playback visibly instead of showing
    // "playing" over silence.
    await this.#player.resumeContext();
    return true;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#stopWordTracking();
    this.#isPlaying = false;
    if (this.#activeGeneration !== null) {
      this.#activeGeneration = null;
      // Unblock a generator awaiting the queue; without this a stop() outside
      // the abort path would leave the consumer parked forever.
      this.#activeQueue?.push({ kind: 'error', message: 'Aborted' });
      this.#activeQueue = null;
      this.#player.abortSession();
    }
  }

  getChunkPosition(): number | null {
    const generation = this.#activeGeneration;
    if (generation === null) return null;
    const pos = this.#player.getPlaybackPosition(generation);
    if (!pos) return null;
    const meta = this.#chunkMeta[pos.chunkIndex];
    if (!meta) return null;
    // Trim-relative and clamped: the section timeline sums TRIMMED durations,
    // while the player reports untrimmed media time (kept that way for word
    // boundaries).
    return Math.min(Math.max(pos.mediaTimeSec - meta.trimStartSec, 0), meta.trimmedDurationSec);
  }

  async setRate(rate: number) {
    // Applied client-side via WSOLA time-stretch at schedule time; takes
    // effect on the next speak() session (the controller restarts playback on
    // rate changes).
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
    await this.stopInternal();
    await this.#player.shutdown();
    this.initialized = false;
    this.#voices = [];
  }
}
