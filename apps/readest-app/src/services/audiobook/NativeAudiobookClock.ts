// AVPlayer-backed AudiobookClock for iOS Tauri. WebKit's HTMLMediaElement /
// WebAudio cannot own the app's non-mixable audio session (same constraint
// documented on NativeNarrationPlayer, which this mirrors), so streamed
// Audiobookshelf playback goes through the native-tts plugin's continuous
// playout_control surface in the app process instead.
//
// Unlike NativeNarrationPlayer, there is no blob staging: load() hands the
// plugin the remote track URL (with its `?token=` query) directly as the
// "path" argument, and AVPlayer streams it over HTTP.

import { addPluginListener, invoke, PluginListener } from '@tauri-apps/api/core';
import type { AudiobookClock } from './AudiobookClock';

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

// Matches NativeNarrationPlayer: the JS clock is extrapolated between polls,
// so this only corrects drift and does not need to run at boundary-check rate.
const POLL_INTERVAL_MS = 250;

export class NativeAudiobookClock implements AudiobookClock {
  #nativeSession: Promise<number> | null = null;
  #resolvedSession: number | null = null;
  #listener: PluginListener | null = null;
  #listenerStarted = false;
  #rate = 1;
  #userPaused = true;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #cache = { mediaSec: 0, playing: false, at: 0 };
  #endedListeners = new Set<() => void>();
  #errorListeners = new Set<() => void>();
  #timeupdateListeners = new Set<() => void>();

  get paused(): boolean {
    return this.#userPaused || !this.#cache.playing;
  }

  // Extrapolated media time between native polls (AVPlayer item time).
  get currentTime(): number {
    const elapsed = this.#cache.playing
      ? ((performance.now() - this.#cache.at) / 1000) * this.#rate
      : 0;
    return this.#cache.mediaSec + elapsed;
  }

  set currentTime(seconds: number) {
    void this.seek(seconds);
  }

  get playbackRate(): number {
    return this.#rate;
  }

  set playbackRate(rate: number) {
    void this.setRate(rate);
  }

  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void {
    if (type === 'ended') this.#endedListeners.add(fn);
    else if (type === 'error') this.#errorListeners.add(fn);
    else this.#timeupdateListeners.add(fn);
  }

  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void {
    if (type === 'ended') this.#endedListeners.delete(fn);
    else if (type === 'error') this.#errorListeners.delete(fn);
    else this.#timeupdateListeners.delete(fn);
  }

  // Resolves once the plugin has accepted the load (mirrors
  // NativeNarrationPlayer), not once AVPlayer has buffered enough to play, so
  // AudiobookController's "load resolved => seekable" assumption never blocks
  // on network buffering.
  //
  // Single error signaling: an invoke rejection here (bad args, malformed
  // remote URL) only rejects this promise. The native side never gets far
  // enough to emit an async playout_events 'error' for a load it rejected
  // outright, so a failure is never surfaced both by rejecting load() and by
  // firing the 'error' listeners for the same event. A load the plugin does
  // accept can still fail later (bad host, 404, decode failure) - that
  // surfaces exclusively through the async 'error' native event in
  // #onNativeEvent, once load() has already resolved.
  async load(url: string, startAt: number): Promise<void> {
    await this.#ensureReady();
    const positionMs = Math.max(0, startAt) * 1000;
    await invoke('plugin:native-tts|playout_control', {
      payload: { action: 'load', path: url, positionMs },
    });
    // #rate is the authoritative value: a setRate() call before this load()
    // (e.g. page.tsx carrying a previous episode's rate onto a freshly
    // claimed, not-yet-started controller - see openAudiobook.ts) landed
    // before #ensureReady() ever established the native session, so its own
    // invoke was skipped and only this mirror updated. Replay it now that
    // the session exists, mirroring how HtmlAudioClock.load() re-applies
    // its rate across a src reset.
    if (this.#rate !== 1) {
      await invoke('plugin:native-tts|playout_control', {
        payload: { action: 'set-rate', rate: this.#rate },
      });
    }
    this.#cache = {
      mediaSec: Math.max(0, startAt),
      playing: !this.#userPaused,
      at: performance.now(),
    };
  }

  async seek(seconds: number): Promise<void> {
    if (!this.#nativeSession) return;
    await this.#nativeSession;
    this.#cache = {
      mediaSec: Math.max(0, seconds),
      playing: this.#cache.playing,
      at: performance.now(),
    };
    await invoke('plugin:native-tts|playout_control', {
      payload: { action: 'seek', positionMs: Math.max(0, seconds) * 1000 },
    });
  }

  async play(): Promise<void> {
    this.#userPaused = false;
    await this.#ensureReady();
    await invoke('plugin:native-tts|playout_control', { payload: { action: 'resume' } });
    this.#cache.playing = true;
    this.#cache.at = performance.now();
    this.#startPolling();
  }

  pause(): void {
    const mediaSec = this.currentTime;
    this.#userPaused = true;
    this.#cache = { mediaSec, playing: false, at: performance.now() };
    this.#stopPolling();
    void invoke('plugin:native-tts|playout_control', { payload: { action: 'pause' } }).catch(
      () => {},
    );
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = rate;
    if (!this.#nativeSession) return;
    await invoke('plugin:native-tts|playout_control', {
      payload: { action: 'set-rate', rate },
    });
  }

  destroy(): void {
    this.pause();
    this.#nativeSession = null;
    this.#resolvedSession = null;
    void invoke('plugin:native-tts|playout_control', { payload: { action: 'abort' } }).catch(
      () => {},
    );
    if (this.#listener) {
      const listener = this.#listener;
      this.#listener = null;
      this.#listenerStarted = false;
      void Promise.resolve(listener.unregister()).catch(() => {});
    }
  }

  async #ensureReady(): Promise<void> {
    await this.#ensureListener();
    // Await an in-flight start-session too: returning early would let a
    // concurrent load/seek invoke race ahead of the session it belongs to.
    if (this.#nativeSession) {
      await this.#nativeSession;
      return;
    }
    this.#nativeSession = invoke<{ session: number }>('plugin:native-tts|playout_control', {
      payload: { action: 'start-session' },
    }).then((res) => {
      this.#resolvedSession = res.session;
      return res.session;
    });
    await this.#nativeSession;
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

  #onNativeEvent(event: PlayoutEvent): void {
    if (this.#resolvedSession !== null && event.session !== this.#resolvedSession) return;
    if (event.type === 'ended') {
      this.#cache.playing = false;
      for (const fn of [...this.#endedListeners]) fn();
    } else if (event.type === 'error') {
      // The item failed to load or play after load() already resolved -
      // this is the only channel that can surface it (see load()'s doc).
      this.#cache.playing = false;
      for (const fn of [...this.#errorListeners]) fn();
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
    if (this.#resolvedSession === null || this.#userPaused) return;
    try {
      const pos = await invoke<PlayoutPosition>('plugin:native-tts|playout_position');
      if (pos.session !== this.#resolvedSession) return;
      if (pos.index >= 0) {
        this.#cache = {
          mediaSec: pos.positionMs / 1000,
          playing: pos.playing && !this.#userPaused,
          at: performance.now(),
        };
      } else {
        // No current item: freeze the extrapolated clock on the last known
        // position rather than letting it run away past the end of the file.
        this.#cache.playing = false;
      }
      for (const fn of [...this.#timeupdateListeners]) fn();
    } catch {
      // Transient invoke failures must not kill the poll loop.
    }
  }
}
