// Gapless chunk scheduler on a persistent Web Audio context.
//
// Sentence buffers are scheduled back-to-back into an always-running
// AudioContext so the OS-level output stream never stops between sentences or
// paragraphs — per-sentence track restarts are what let Bluetooth fade-in /
// noise gates swallow the first word (#3851) and what put audible gaps
// between sentences (#2033). Chunk transitions ride source onended callbacks
// (background-safe when rAF and timers are throttled with the screen off);
// word-highlight polling is the only rAF consumer, and it lives in the client.
//
// The real AudioContext is a MODULE-LEVEL SINGLETON shared by all player
// instances and never closed: a fresh TTSController (and thus client+player)
// is constructed per tts-speak, and WebKit caps live AudioContexts (~4 on
// iOS) — per-player contexts would leak until every new one is born suspended
// and TTS goes silent. Sessions are isolated purely by generation tokens.
//
// This module speaks to the context through structural interfaces so jsdom
// tests can drive a fake clock.
//
// iOS now-playing note: TTS has no HTMLMediaElement (chunks connect straight
// to ctx.destination), so WebKit never publishes a now-playing session for it.
// Routing the graph through a MediaStreamAudioDestinationNode + <audio> was
// tried and reverted: WebKit then published the element's own stream clock,
// fighting setPositionState on the lock screen/CarPlay (jumping timeline) and
// rendering underrun glitches while the context was suspended. iOS instead
// drives MPNowPlayingInfoCenter/MPRemoteCommandCenter natively via the
// native-tts plugin (getMediaSession -> TauriMediaSession).

import type { TTSAudioPlayer } from './TTSAudioPlayer';

export interface TTSAudioBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
  copyToChannel(source: Float32Array, channel: number): void;
}

export interface TTSAudioBufferSourceNode {
  buffer: TTSAudioBuffer | null;
  onended: (() => void) | null;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface TTSAudioContext {
  readonly currentTime: number;
  readonly state: string; // 'running' | 'suspended' | 'interrupted' | 'closed'
  readonly destination: unknown;
  onstatechange: (() => void) | null;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createBufferSource(): TTSAudioBufferSourceNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): TTSAudioBuffer;
  decodeAudioData(data: ArrayBuffer): Promise<TTSAudioBuffer>;
}

export interface ChunkTiming {
  // Leading trim in original (rate-1.0) media time; word boundaries live there.
  trimStartSec: number;
  // originalTrimmedDuration / outputDuration (≈ playback rate).
  mediaScale: number;
  // Silence scheduled after this chunk; the caller rate-scales it.
  gapSec: number;
}

export type WebAudioPlayerEvent =
  | { type: 'chunk-start'; chunkIndex: number }
  | { type: 'session-end' }
  | { type: 'context-error'; message: string };

interface ScheduledChunk {
  index: number;
  source: TTSAudioBufferSourceNode;
  startTime: number;
  duration: number;
  timing: ChunkTiming;
  ended: boolean;
}

interface PlayerSession {
  generation: number;
  onEvent: (event: WebAudioPlayerEvent) => void;
  chunks: ScheduledChunk[];
  nextStartTime: number;
  ended: boolean;
  endedEmitted: boolean;
  waiters: Array<(ready: boolean) => void>;
}

// Small offset so start() never lands in the past between the read of
// currentTime and the schedule call.
const SCHEDULE_SAFETY_SEC = 0.03;
// Screen-off JS throttling must not starve the queue between onended and the
// next schedule, so the pending budget deepens when the page is hidden.
const MAX_PENDING_VISIBLE = 2;
const MAX_PENDING_HIDDEN = 5;
// Bounds decoded PCM at slow rates (0.2x stretches a 30s sentence to 150s).
const MAX_AHEAD_SEC = 60;

let sharedContext: TTSAudioContext | null = null;

const getSharedContext = (): TTSAudioContext => {
  if (!sharedContext) {
    sharedContext = new AudioContext() as unknown as TTSAudioContext;
  }
  return sharedContext;
};

// Warm up (create + resume) the shared context. Call this synchronously in a
// user-gesture handler: speak() itself runs after network awaits, outside
// WebKit's gesture window, where resume() can be rejected by autoplay policy.
export const ensureSharedAudioContext = async (): Promise<void> => {
  if (typeof AudioContext === 'undefined') return;
  try {
    const ctx = getSharedContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
  } catch (err) {
    console.warn('[TTS] audio context warmup failed', err);
  }
};

// Inaudible background keep-alive for direct-speak engines (Android system TTS).
//
// When the screen locks the WebView page becomes hidden, and Chromium throttles
// (and eventually freezes) a hidden page's timers and task queues — which stalls
// the JS-driven per-sentence auto-advance loop that direct-speak engines rely on
// (their audio renders in the external TTS engine, not the WebView). A page that
// is emitting audio is exempt from that throttling: that is precisely why Edge
// TTS keeps reading with the screen off (its speech is audible WebAudio output)
// while system TTS stops after a page. Merely having a running-but-idle context
// does NOT earn the exemption — Chromium keys off actual, non-silent output — so
// we play a continuous 40 Hz tone at ~-62 dBFS: below the reach of phone
// speakers and masked to inaudibility by the speech, but non-silent enough to
// keep the page "audible" and its timers alive. See #4408.
const KEEP_ALIVE_FREQ_HZ = 40;
const KEEP_ALIVE_GAIN = 0.0008;
let keepAliveOsc: OscillatorNode | null = null;
let keepAliveGain: GainNode | null = null;

export const startAudioKeepAlive = (): void => {
  if (typeof AudioContext === 'undefined') return;
  if (keepAliveOsc) return;
  try {
    const ctx = getSharedContext() as unknown as AudioContext;
    // The gesture handler already resumed the shared context; nudge it best-
    // effort in case autoplay policy left it suspended.
    if (ctx.state !== 'running') void ctx.resume();
    const osc = ctx.createOscillator();
    osc.frequency.value = KEEP_ALIVE_FREQ_HZ;
    const gain = ctx.createGain();
    gain.gain.value = KEEP_ALIVE_GAIN;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keepAliveOsc = osc;
    keepAliveGain = gain;
  } catch (err) {
    console.warn('[TTS] audio keep-alive start failed', err);
  }
};

export const stopAudioKeepAlive = (): void => {
  if (!keepAliveOsc && !keepAliveGain) return;
  try {
    keepAliveOsc?.stop();
    keepAliveOsc?.disconnect();
    keepAliveGain?.disconnect();
  } catch (err) {
    console.warn('[TTS] audio keep-alive stop failed', err);
  }
  keepAliveOsc = null;
  keepAliveGain = null;
};

export class WebAudioPlayer implements TTSAudioPlayer {
  #createContext: () => TTSAudioContext;
  #usesSharedContext: boolean;
  #ctx: TTSAudioContext | null = null;
  #generation = 0;
  #session: PlayerSession | null = null;
  #userPaused = false;

  constructor(createContext?: () => TTSAudioContext) {
    this.#createContext = createContext ?? getSharedContext;
    this.#usesSharedContext = !createContext;
  }

  async ensureContext(): Promise<TTSAudioContext> {
    if (!this.#ctx) {
      this.#ctx = this.#createContext();
      this.#ctx.onstatechange = () => this.#handleStateChange();
    }
    if (this.#ctx.state !== 'running' && !this.#userPaused) {
      await this.#ctx.resume();
    }
    return this.#ctx;
  }

  async decode(data: ArrayBuffer): Promise<TTSAudioBuffer> {
    const ctx = await this.ensureContext();
    return ctx.decodeAudioData(data);
  }

  async createMonoBuffer(samples: Float32Array, sampleRate: number): Promise<TTSAudioBuffer> {
    const ctx = await this.ensureContext();
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  startSession(onEvent: (event: WebAudioPlayerEvent) => void): number {
    this.abortSession();
    const generation = ++this.#generation;
    this.#session = {
      generation,
      onEvent,
      chunks: [],
      nextStartTime: 0,
      ended: false,
      endedEmitted: false,
      waiters: [],
    };
    console.log(`[TTS] session ${generation} start`);
    return generation;
  }

  scheduleChunk(generation: number, buffer: TTSAudioBuffer, timing: ChunkTiming): void {
    const session = this.#session;
    const ctx = this.#ctx;
    if (!session || session.generation !== generation || !ctx) return;
    const start = Math.max(session.nextStartTime, ctx.currentTime + SCHEDULE_SAFETY_SEC);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const chunk: ScheduledChunk = {
      index: session.chunks.length,
      source,
      startTime: start,
      duration: buffer.duration,
      timing,
      ended: false,
    };
    source.onended = () => this.#handleChunkEnded(session, chunk);
    session.chunks.push(chunk);
    session.nextStartTime = start + buffer.duration + Math.max(0, timing.gapSec);
    source.start(start);
    console.log(
      `[TTS] schedule ${generation}:${chunk.index} at ${start.toFixed(2)} dur ${buffer.duration.toFixed(2)}`,
    );
    if (chunk.index === 0) {
      session.onEvent({ type: 'chunk-start', chunkIndex: 0 });
    }
  }

  endSession(generation: number): void {
    const session = this.#session;
    if (!session || session.generation !== generation) return;
    session.ended = true;
    // Fires synchronously when nothing is unfinished: a session whose marks
    // were all skipped (zero chunks) or whose last onended beat endSession
    // must still end, or auto-advance dead-ends with controls stuck playing.
    this.#maybeEmitSessionEnd(session);
  }

  abortSession(): void {
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    for (const chunk of session.chunks) {
      chunk.source.onended = null;
      try {
        chunk.source.stop();
      } catch {
        // Sources that never started or already ended throw; irrelevant here.
      }
      try {
        chunk.source.disconnect();
      } catch {
        // Ignore repeated disconnects.
      }
    }
    const waiters = session.waiters;
    session.waiters = [];
    for (const waiter of waiters) waiter(false);
    console.log(`[TTS] session ${session.generation} abort`);
  }

  async waitUntilReady(generation: number): Promise<boolean> {
    for (;;) {
      const session = this.#session;
      if (!session || session.generation !== generation) return false;
      if (this.#isReadyForMore(session)) return true;
      const ready = await new Promise<boolean>((resolve) => {
        session.waiters.push(resolve);
      });
      if (!ready) return false;
    }
  }

  async pauseContext(): Promise<void> {
    this.#userPaused = true;
    if (this.#ctx && this.#ctx.state === 'running') {
      await this.#ctx.suspend();
    }
  }

  async resumeContext(): Promise<void> {
    this.#userPaused = false;
    const ctx = this.#ctx;
    if (!ctx) return;
    await ctx.resume();
    if (ctx.state !== 'running') {
      // iOS can refuse to leave 'interrupted' (e.g. right after a phone
      // call); fail loudly so the controller stops visibly instead of
      // showing "playing" over silence.
      throw new Error(`AudioContext failed to resume (state: ${ctx.state})`);
    }
  }

  isUserPaused(): boolean {
    return this.#userPaused;
  }

  getPlaybackPosition(generation: number): { chunkIndex: number; mediaTimeSec: number } | null {
    const session = this.#session;
    const ctx = this.#ctx;
    if (!session || session.generation !== generation || !ctx) return null;
    const first = session.chunks[0];
    if (!first) return null;
    const t = ctx.currentTime;
    let active = first;
    for (const chunk of session.chunks) {
      if (chunk.startTime <= t) active = chunk;
      else break;
    }
    const within = Math.min(Math.max(t - active.startTime, 0), active.duration);
    return {
      chunkIndex: active.index,
      mediaTimeSec: active.timing.trimStartSec + within * active.timing.mediaScale,
    };
  }

  async shutdown(): Promise<void> {
    this.abortSession();
    if (this.#ctx && !this.#usesSharedContext) {
      // Test-injected contexts are owned by this player; the shared context
      // stays alive for the whole page (see module comment).
      await this.#ctx.close().catch(() => {});
    }
    this.#ctx = null;
  }

  #isReadyForMore(session: PlayerSession): boolean {
    const unfinished = session.chunks.reduce((n, c) => n + (c.ended ? 0 : 1), 0);
    const limit =
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? MAX_PENDING_HIDDEN
        : MAX_PENDING_VISIBLE;
    if (unfinished >= limit) return false;
    if (this.#ctx && session.chunks.length > 0) {
      const aheadSec = session.nextStartTime - this.#ctx.currentTime;
      if (aheadSec >= MAX_AHEAD_SEC) return false;
    }
    return true;
  }

  #handleChunkEnded(session: PlayerSession, chunk: ScheduledChunk): void {
    if (this.#session !== session) return;
    chunk.ended = true;
    const waiters = session.waiters;
    session.waiters = [];
    for (const waiter of waiters) waiter(true);
    const next = session.chunks[chunk.index + 1];
    if (next) {
      session.onEvent({ type: 'chunk-start', chunkIndex: next.index });
    }
    this.#maybeEmitSessionEnd(session);
  }

  #maybeEmitSessionEnd(session: PlayerSession): void {
    if (!session.ended || session.endedEmitted) return;
    if (session.chunks.some((c) => !c.ended)) return;
    session.endedEmitted = true;
    session.onEvent({ type: 'session-end' });
  }

  #handleStateChange(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    if (ctx.state === 'running' || this.#userPaused) return;
    if (!this.#session) return;
    // Unexpected suspension (iOS 'interrupted', route change) during live
    // playback: try to keep going. If the OS refuses, the next user action
    // surfaces the failure through resumeContext().
    console.log(`[TTS] audio context ${ctx.state}; attempting auto-resume`);
    ctx.resume().catch((err) => {
      console.warn('[TTS] audio context auto-resume failed', err);
      this.#session?.onEvent({
        type: 'context-error',
        message: `AudioContext ${ctx.state}`,
      });
    });
  }
}
