import { getOSPlatform, getUserLocale } from '@/utils/misc';
import { isTauriAppPlatform } from '@/services/environment';
import { isSameLang } from '@/utils/lang';
import { NativeAudioPlayer } from './NativeAudioPlayer';
import { TTSClient, TTSCapabilities, TTSMessageEvent } from './TTSClient';
import { TTSWordBoundary } from '@/libs/edgeTTS';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { AppService } from '@/types/system';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { findBoundaryIndexAtTime } from './wordHighlight';
import { applyEdgeFade, findSpeechBounds } from './pcm';
import { timeStretch } from './timeStretch';
import {
  calibrateVoiceRate,
  recordMeasuredDuration,
  recordProvisionalDuration,
} from './ttsDuration';
import { CachingProvider } from './providers/cache';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
} from './providers/types';
import { TTSAudioBuffer, WebAudioPlayer, WebAudioPlayerEvent } from './WebAudioPlayer';

// The generic buffered TTS client: one SpeechProvider synthesizes compressed
// audio + word boundaries, and everything engine-independent lives here —
// the scheduler with backpressure, decode/trim/WSOLA (web path), native raw
// playout (iOS), word tracking against the player's media clock, preload,
// and duration bookkeeping. A new engine is just a new SpeechProvider.
//
// Playback pipeline: synthesize MP3 (cached at rate 1.0) -> decode -> trim
// silence -> WSOLA time-stretch to the playback rate -> schedule gaplessly on
// the shared AudioContext. Marks are dispatched when a chunk becomes AUDIBLE
// (player chunk-start events ride source onended, which keeps working with
// the screen off), not when it is fetched — schedule-ahead would otherwise
// run foliate's mark cursor ahead of the voice and break prev/next/resume.

// Natural pause between sentences, replacing Edge's baked-in ~300ms trailing
// silence. Divided by the playback rate so pauses shrink with speed (#2033's
// "gaps don't scale" complaint).
export const DEFAULT_SENTENCE_GAP_SEC = 0.15;
const TICKS_PER_SECOND = 10_000_000;

// How many consecutive unreachable sentences (offline with nothing cached, or
// a persistent service failure) to skip before stopping. A cached chapter
// whose heading is uncached still plays: the heading skips, the cached body
// resets the count. A wholly-uncached run stops instead of racing to the end.
const MAX_CONSECUTIVE_SKIPS = 3;

interface ChunkMeta {
  mark: TTSMark;
  boundaries: TTSWordBoundary[];
  trimStartSec: number;
  trimmedDurationSec: number;
  // The exact synthesis request, for manifest key recording at chunk-start.
  req?: SpeechSynthesisRequest;
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

export class BufferedTTSClient implements TTSClient {
  name: string;
  initialized = false;
  controller?: TTSController;
  appService?: AppService | null;

  protected readonly provider: SpeechProvider;
  protected voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;
  #sentenceGapSec = DEFAULT_SENTENCE_GAP_SEC;

  // iOS plays natively (app-process AVPlayer): audio in the app's own audio
  // session makes Now Playing, pause-slot retention, AirPods routing, and the
  // mute switch behave like a music app — the WebAudio path renders in
  // WebKit's GPU process under a session the app cannot own. Everywhere else
  // the gapless WSOLA WebAudio pipeline stays.
  #player: WebAudioPlayer | NativeAudioPlayer =
    getOSPlatform() === 'ios' && isTauriAppPlatform()
      ? new NativeAudioPlayer()
      : new WebAudioPlayer();
  #activeGeneration: number | null = null;
  #activeQueue: AsyncQueue<SpeakQueueEvent> | null = null;
  #chunkMeta: ChunkMeta[] = [];
  #isPlaying = false;
  #wordTrackingRafId: number | null = null;
  // Run of consecutive unreachable sentences (offline misses / persistent
  // failures) in the current session. Reset by any successful chunk; persists
  // across auto-advanced sections so a wholly-uncached run stops instead of
  // skipping to the end. A user-initiated restart builds a fresh client, so it
  // starts at 0 there too.
  #consecutiveSkips = 0;

  constructor(
    provider: SpeechProvider,
    controller?: TTSController,
    appService?: AppService | null,
  ) {
    this.provider = provider;
    this.name = provider.id;
    this.controller = controller;
    this.appService = appService;
  }

  async init(): Promise<boolean> {
    this.voices = await this.provider.getAllVoices();
    this.initialized = await this.provider.init();
    return this.initialized;
  }

  // Synthesis requests fail intermittently (network transports); retry a few
  // times before giving up so a single transient failure doesn't stall
  // playback. SpeechSynthesisPermanentError is permanent for a given
  // sentence, so it rethrows immediately for the caller's skip path.
  #synthesizeWithRetry = async (
    lang: string,
    text: string,
    voiceId: string,
    signal: AbortSignal,
    maxAttempts = 3,
  ): Promise<{ data: ArrayBuffer; boundaries: TTSWordBoundary[] } | undefined> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return undefined;
      try {
        // Rate is deliberately absent from the request: the provider
        // synthesizes at rate 1.0 and playout applies the playback rate.
        const { audio, boundaries } = await this.provider.synthesize(
          { lang, text, voice: voiceId, pitch: this.#pitch },
          signal,
        );
        return { data: audio, boundaries };
      } catch (err) {
        if (err instanceof SpeechSynthesisPermanentError) throw err;
        lastError = err;
        console.warn(`TTS synthesis attempt ${attempt}/${maxAttempts} failed`, err);
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
    const preferredVoice = this.voices.find((v) => v.id === preferredVoiceId);
    if (preferredVoice) return preferredVoice.id;

    const availableVoices = (await this.getVoices(lang))[0]?.voices || [];
    const picked = this.provider.pickDefaultVoice?.(availableVoices);
    return (
      picked ||
      availableVoices[0]?.id ||
      this.#currentVoiceId ||
      this.provider.fallbackVoiceId ||
      ''
    );
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
          const located = this.controller?.dispatchSpeakMark(meta.mark);
          if (located && meta.req && this.provider instanceof CachingProvider) {
            // The sentence audibly played: record its cache key against the
            // section manifest so a fully covered section can compact.
            this.provider.recordMark(located.sectionIndex, located.sentenceIndex, meta.req);
          }
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
    // background; the provider's in-flight dedup keeps this from racing
    // duplicate requests against the playback scheduler.
    const maxImmediate = 2;
    for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
      if (signal.aborted) break;
      const mark = marks[i]!;
      const voiceId = await this.getVoiceIdFromLang(mark.language);
      this.#currentVoiceId = voiceId;
      try {
        const audio = await this.#synthesizeWithRetry(mark.language, mark.text, voiceId, signal);
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
            const audio = await this.#synthesizeWithRetry(
              mark.language,
              mark.text,
              voiceId,
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

        const req: SpeechSynthesisRequest = {
          lang: mark.language,
          text: mark.text,
          voice: voiceId,
          pitch: this.#pitch,
        };
        let audio: { data: ArrayBuffer; boundaries: TTSWordBoundary[] } | undefined;
        try {
          audio = await this.#synthesizeWithRetry(mark.language, mark.text, voiceId, signal);
        } catch (error) {
          if (error instanceof SpeechSynthesisPermanentError) {
            // Genuinely unsynthesizable sentence (server returned no audio):
            // skip it and keep going — a few bad sentences must not stop a
            // chapter. These don't count toward the offline stop budget.
            console.warn('No audio data received for:', mark.text);
            queue.push({ kind: 'chunk-skip', markName: mark.name });
            continue;
          }
          // A synthesis error that survived the retries: offline with this
          // sentence uncached, or a persistent service failure. Skip it so
          // cached neighbours still play (a cached section whose heading is
          // uncached must not stop on the heading), but stop after a RUN of
          // unreachable sentences rather than silently skipping to the end of
          // the book. A later cached hit resets the budget below.
          const message = error instanceof Error ? error.message : String(error);
          this.#consecutiveSkips += 1;
          if (this.#consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
            console.warn('TTS stopping after consecutive unreachable sentences:', message);
            queue.push({ kind: 'error', message });
            return;
          }
          console.warn('TTS skipping unreachable sentence:', mark.text, message);
          queue.push({ kind: 'chunk-skip', markName: mark.name });
          continue;
        }
        if (!audio || signal.aborted || this.#activeGeneration !== generation) return;
        this.#consecutiveSkips = 0;
        this.#recordDurations(voiceId, mark.text, audio.boundaries);

        if (this.#player instanceof NativeAudioPlayer) {
          // Native playout: no decode/trim/WSOLA — the raw MP3 goes to the
          // AVPlayer, which time-stretches at the pitch-preserving native
          // rate. Word boundaries stay in original media time, matching the
          // player's media clock, so trimStartSec is 0 by construction.
          const ready = await this.#player.waitUntilReady(generation);
          if (!ready || signal.aborted) return;
          const index = chunkMeta.length;
          const meta: ChunkMeta = {
            mark,
            boundaries: audio.boundaries,
            trimStartSec: 0,
            trimmedDurationSec: 0,
            req,
          };
          // Push before enqueue: the chunk-start event can arrive as soon as
          // the native side starts the item.
          chunkMeta.push(meta);
          try {
            const durationSec = await this.#player.scheduleRawChunk(generation, index, audio.data, {
              gapSec: this.#sentenceGapSec / rate,
            });
            meta.trimmedDurationSec = durationSec;
            this.#recordDurations(voiceId, mark.text, audio.boundaries, durationSec);
          } catch (error) {
            console.warn('Failed to enqueue TTS audio for:', mark.text, error);
            queue.push({ kind: 'chunk-skip', markName: mark.name });
          }
          continue;
        }

        const webPlayer = this.#player;
        let prepared: {
          buffer: TTSAudioBuffer;
          trimStartSec: number;
          trimmedDurationSec: number;
        };
        try {
          prepared = await this.#prepareChunkBuffer(webPlayer, audio.data, rate);
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
          req,
        });
        this.#player.scheduleChunk(generation, prepared.buffer, {
          trimStartSec: prepared.trimStartSec,
          mediaScale: prepared.trimmedDurationSec / prepared.buffer.duration,
          gapSec: this.#sentenceGapSec / rate,
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
    player: WebAudioPlayer,
    data: ArrayBuffer,
    rate: number,
  ): Promise<{ buffer: TTSAudioBuffer; trimStartSec: number; trimmedDurationSec: number }> {
    // decodeAudioData resamples to the context rate (44.1/48kHz on real
    // devices, not the stream's 24kHz) — all math below must use the decoded
    // buffer's sampleRate.
    const decoded = await player.decode(data);
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
    const buffer = await player.createMonoBuffer(samples, sampleRate);
    // Silence-trimmed edges sit on non-zero samples; fade the buffer's own copy
    // so chunk starts/ends don't click against the inter-sentence gap.
    applyEdgeFade(buffer.getChannelData(0), sampleRate);
    return { buffer, trimStartSec: startSample / sampleRate, trimmedDurationSec };
  }

  // Poll the audio clock (visual concern only, so rAF throttling with the
  // screen off is fine) and tell the controller which word is being spoken.
  // The player reports original (rate-1.0) media time, so the boundary
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

  protected async stopInternal() {
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
    // Web path: applied client-side via WSOLA time-stretch at schedule time;
    // takes effect on the next speak() session (the controller restarts
    // playback on rate changes). Native path: applied live by the AVPlayer.
    this.#rate = rate;
    if (this.#player instanceof NativeAudioPlayer) {
      await this.#player.setRate(rate);
    }
  }

  async setPitch(pitch: number) {
    // Passed through to the provider per synthesis request (Edge accepts
    // pitch in [0.5 .. 1.5]).
    this.#pitch = pitch;
  }

  async setVoice(voice: string) {
    const selectedVoice = this.voices.find((v) => v.id === voice);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  setSentenceGap(sec: number): void {
    this.#sentenceGapSec = sec;
  }

  registerSectionManifest(section: number, marks: string[]): void {
    if (this.provider instanceof CachingProvider) {
      this.provider.registerSectionManifest(section, marks);
    }
  }

  // Per-ordinal cached durations for the section under the current voice,
  // consumed by the timeline's hydration pass.
  async getSectionDurations(section: number): Promise<Map<number, number>> {
    if (!(this.provider instanceof CachingProvider)) return new Map();
    return this.provider.getSectionDurations(section, this.#currentVoiceId);
  }

  // ── Headless pre-synthesis (TTSDownloader CacheWarmer) ─────────────────

  // Whether this client has a persistent cache to download into.
  canDownload(): boolean {
    return this.provider instanceof CachingProvider;
  }

  // Synthesize one sentence into the cache (a hit is a no-op) and record its
  // key against the section manifest. Resolves the voice exactly as live
  // playback does, so the computed key matches. Returns whether audio is now
  // cached for it.
  async warmSentence(
    section: number,
    ordinal: number,
    lang: string,
    text: string,
  ): Promise<boolean> {
    if (!(this.provider instanceof CachingProvider)) return false;
    const voiceId = await this.getVoiceIdFromLang(lang);
    const req = { lang, text, voice: voiceId, pitch: this.#pitch };
    try {
      await this.provider.synthesize(req, new AbortController().signal);
    } catch {
      // Offline / permanent failure: leave the ordinal unrecorded so the
      // section stays incomplete and can be retried later.
      return false;
    }
    this.provider.recordMark(section, ordinal, req);
    return true;
  }

  async compactCache(): Promise<void> {
    if (this.provider instanceof CachingProvider) await this.provider.compact();
  }

  async getSectionCacheStatuses(): Promise<
    Map<number, { total: number; recorded: number; packed: boolean }>
  > {
    if (!(this.provider instanceof CachingProvider)) return new Map();
    return this.provider.getSectionStatuses();
  }

  async getCacheBytes(): Promise<number> {
    if (!(this.provider instanceof CachingProvider)) return 0;
    return this.provider.totalCacheBytes();
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.voices.forEach((voice) => {
      voice.disabled = !this.initialized;
    });
    return this.voices;
  }

  async getVoices(lang: string) {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    // Match by primary language so the voice set stays the same across a book
    // whose sections mix region variants (e.g. en-US front matter and en-GB
    // body text); the requested locale's voices sort first. See #4033.
    const filteredVoices = voices.filter((v) => isSameLang(v.lang, lang));

    const voicesGroup: TTSVoicesGroup = {
      id: this.name,
      name: this.provider.label,
      voices: filteredVoices.sort(TTSUtils.sortVoicesPreferLocaleFunc(locale)),
      disabled: !this.initialized || filteredVoices.length === 0,
    };

    return [voicesGroup];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  getCapabilities(): TTSCapabilities {
    return {
      wordBoundaries: true,
      mediaClock: true,
      gapControl: true,
      // The native player time-stretches live; the web path bakes the rate
      // into the scheduled buffers, so it needs a session restart.
      liveRateChange: this.#player instanceof NativeAudioPlayer,
    };
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
    await this.provider.shutdown?.();
    this.initialized = false;
    this.voices = [];
  }
}
