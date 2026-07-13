// Native (app-process) audio playout for Edge TTS on iOS.
//
// WebAudio renders in WebKit's GPU process under an audio session the app
// cannot own, which made every system media behavior a fight: the Now Playing
// card, pause-slot retention, AirPods routing, and the mute switch. Playing
// the Edge MP3 utterances with an in-process AVPlayer (via the native-tts
// plugin) puts the audio in the app's own non-mixable .playback session, so
// all of them behave like any music app.
//
// The native side is a dumb player: enqueue/play/pause/rate/position. All
// orchestration stays here and in EdgeTTSClient — word boundaries and the
// section timeline read the player's media clock, which (like the WebAudio
// path's rate-1.0 media time) is unaffected by the playback rate because
// AVPlayer.currentTime reports item time, not wall time.

import { addPluginListener, invoke, PluginListener } from '@tauri-apps/api/core';
import type { WebAudioPlayerEvent } from './WebAudioPlayer';

interface PlayoutPosition {
  session: number;
  index: number;
  positionMs: number;
  playing: boolean;
}

interface PlayoutEvent {
  type: string;
  session: number;
  index?: number;
}

interface NativePlayerSession {
  generation: number;
  nativeSession: Promise<number>;
  resolvedNativeSession: number | null;
  onEvent: (event: WebAudioPlayerEvent) => void;
  scheduled: number;
  currentIndex: number;
  waiters: Array<(ready: boolean) => void>;
}

// Unplayed utterances buffered natively ahead of the playhead.
const MAX_PENDING = 3;
// Cache refresh cadence for the media clock; getPlaybackPosition extrapolates
// between polls, so word highlighting stays smooth at rAF granularity.
const POLL_INTERVAL_MS = 250;

const toBase64 = (data: ArrayBuffer): string => {
  const bytes = new Uint8Array(data);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};

export class NativeAudioPlayer {
  #generation = 0;
  #session: NativePlayerSession | null = null;
  #listener: PluginListener | null = null;
  #listenerStarted = false;
  #userPaused = false;
  #rate = 1;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #cache = { index: -1, mediaSec: 0, playing: false, at: 0 };

  // Interface parity with WebAudioPlayer.ensureContext (no context to warm).
  async ensureContext(): Promise<void> {
    await this.#ensureListener();
  }

  async #ensureListener(): Promise<void> {
    if (this.#listenerStarted) return;
    this.#listenerStarted = true;
    try {
      this.#listener = await addPluginListener('native-tts', 'playout_events', (event: unknown) =>
        this.#onNativeEvent(event as PlayoutEvent),
      );
    } catch (err) {
      this.#listenerStarted = false;
      throw err;
    }
  }

  startSession(onEvent: (event: WebAudioPlayerEvent) => void): number {
    this.abortSession();
    const generation = ++this.#generation;
    const session: NativePlayerSession = {
      generation,
      nativeSession: invoke<{ session: number }>('plugin:native-tts|playout_control', {
        payload: { action: 'start-session' },
      }).then((res) => {
        session.resolvedNativeSession = res.session;
        return res.session;
      }),
      resolvedNativeSession: null,
      onEvent,
      scheduled: 0,
      currentIndex: -1,
      waiters: [],
    };
    this.#session = session;
    this.#userPaused = false;
    this.#cache = { index: -1, mediaSec: 0, playing: true, at: performance.now() };
    this.#startPolling();
    console.log(`[TTS] native playout session ${generation} start`);
    return generation;
  }

  // Enqueue the raw utterance MP3; resolves with its duration in seconds.
  // The index must match the caller's chunkMeta index — it is echoed back in
  // chunk-start events.
  async scheduleRawChunk(
    generation: number,
    index: number,
    data: ArrayBuffer,
    opts: { gapSec: number },
  ): Promise<number> {
    const session = this.#session;
    if (!session || session.generation !== generation) return 0;
    const nativeSession = await session.nativeSession;
    if (this.#session !== session) return 0;
    session.scheduled = Math.max(session.scheduled, index + 1);
    const res = await invoke<{ durationMs: number }>('plugin:native-tts|playout_enqueue', {
      payload: {
        session: nativeSession,
        index,
        data: toBase64(data),
        gapMs: opts.gapSec * 1000,
      },
    });
    return (res.durationMs ?? 0) / 1000;
  }

  endSession(generation: number): void {
    const session = this.#session;
    if (!session || session.generation !== generation) return;
    void session.nativeSession.then(() => {
      if (this.#session !== session) return;
      return invoke('plugin:native-tts|playout_control', {
        payload: { action: 'end-session' },
      });
    });
  }

  abortSession(): void {
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    for (const waiter of session.waiters) waiter(false);
    session.waiters = [];
    this.#stopPolling();
    void invoke('plugin:native-tts|playout_control', { payload: { action: 'abort' } }).catch(
      () => {},
    );
  }

  async waitUntilReady(generation: number): Promise<boolean> {
    const session = this.#session;
    if (!session || session.generation !== generation) return false;
    if (session.scheduled - (session.currentIndex + 1) < MAX_PENDING) return true;
    return new Promise((resolve) => session.waiters.push(resolve));
  }

  async pauseContext(): Promise<void> {
    this.#userPaused = true;
    this.#cache.playing = false;
    await invoke('plugin:native-tts|playout_control', { payload: { action: 'pause' } });
  }

  async resumeContext(): Promise<void> {
    this.#userPaused = false;
    await invoke('plugin:native-tts|playout_control', { payload: { action: 'resume' } });
    this.#cache.playing = true;
    this.#cache.at = performance.now();
  }

  isUserPaused(): boolean {
    return this.#userPaused;
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = rate;
    await invoke('plugin:native-tts|playout_control', {
      payload: { action: 'set-rate', rate },
    });
  }

  // Original media time of the playing chunk, extrapolated from the last poll
  // (AVPlayer media time advances at rate× per wall second).
  getPlaybackPosition(generation: number): { chunkIndex: number; mediaTimeSec: number } | null {
    const session = this.#session;
    if (!session || session.generation !== generation) return null;
    const cache = this.#cache;
    if (cache.index < 0) return null;
    const elapsed = cache.playing ? ((performance.now() - cache.at) / 1000) * this.#rate : 0;
    return { chunkIndex: cache.index, mediaTimeSec: cache.mediaSec + elapsed };
  }

  async shutdown(): Promise<void> {
    this.abortSession();
    this.#stopPolling();
    if (this.#listener) {
      const listener = this.#listener;
      this.#listener = null;
      this.#listenerStarted = false;
      await Promise.resolve(listener.unregister()).catch(() => {});
    }
  }

  #onNativeEvent(event: PlayoutEvent): void {
    const session = this.#session;
    if (!session) return;
    // Events for a previous native session can trail an abort/restart.
    if (session.resolvedNativeSession !== null && event.session !== session.resolvedNativeSession) {
      return;
    }
    if (event.type === 'chunk-start' && typeof event.index === 'number') {
      session.currentIndex = event.index;
      this.#cache = {
        index: event.index,
        mediaSec: 0,
        playing: !this.#userPaused,
        at: performance.now(),
      };
      if (session.scheduled - (session.currentIndex + 1) < MAX_PENDING) {
        const waiters = session.waiters;
        session.waiters = [];
        for (const waiter of waiters) waiter(true);
      }
      session.onEvent({ type: 'chunk-start', chunkIndex: event.index });
    } else if (event.type === 'session-end') {
      session.onEvent({ type: 'session-end' });
    }
  }

  #startPolling(): void {
    this.#stopPolling();
    this.#pollTimer = setInterval(() => {
      void this.#poll();
    }, POLL_INTERVAL_MS);
  }

  #stopPolling(): void {
    if (this.#pollTimer !== null) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  async #poll(): Promise<void> {
    const session = this.#session;
    if (!session || session.resolvedNativeSession === null) return;
    try {
      const pos = await invoke<PlayoutPosition>('plugin:native-tts|playout_position');
      if (this.#session !== session || pos.session !== session.resolvedNativeSession) return;
      if (pos.index >= 0) {
        this.#cache = {
          index: pos.index,
          mediaSec: pos.positionMs / 1000,
          playing: pos.playing,
          at: performance.now(),
        };
      } else {
        // Between items (inter-sentence gap): freeze the clock on the last
        // known chunk position.
        this.#cache.playing = false;
      }
    } catch {
      // Transient invoke failures must not kill the poll loop.
    }
  }
}
