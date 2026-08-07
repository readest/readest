// Continuous long-file playout for Media Overlay on iOS Tauri.
//
// Edge TTS already plays through an in-process AVPlayer (NativeAudioPlayer)
// because WebKit HTMLMediaElement / WebAudio cannot own the app's
// non-mixable .playback session — Now Playing, mute switch, and AirPods all
// fight it. Media Overlay used HTMLAudioElement and was interrupted ~0.5s
// after play() when TTSMediaBridge claimed that session. This player routes
// narration through the same native playout AVPlayer via load/seek, staging
// chapter audio to a temp file (100 MB clips cannot cross the plugin as
// base64).

import { addPluginListener, invoke, PluginListener } from '@tauri-apps/api/core';
import { join, tempDir } from '@tauri-apps/api/path';
import { BaseDirectory, remove, writeFile } from '@tauri-apps/plugin-fs';

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

// Matches NativeAudioPlayer: the JS clock is extrapolated between polls, so
// this only corrects drift and does not need to run at the boundary-check rate.
const POLL_INTERVAL_MS = 250;

const hashHref = (href: string): string => {
  let h = 0;
  for (let i = 0; i < href.length; i++) h = (Math.imul(31, h) + href.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};

const fileExtension = (href: string): string => {
  const ext = href.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'mp3';
};

export class NativeNarrationPlayer {
  #nativeSession: Promise<number> | null = null;
  #resolvedSession: number | null = null;
  #listener: PluginListener | null = null;
  #listenerStarted = false;
  #href: string | null = null;
  #stagedPath: string | null = null;
  #stagedHref: string | null = null;
  #rate = 1;
  #userPaused = true;
  #ended = false;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #cache = { mediaSec: 0, playing: false, at: 0 };
  #endedListeners = new Set<() => void>();
  #errorListeners = new Set<() => void>();

  get href(): string | null {
    return this.#href;
  }

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
    // 'timeupdate' is unused: MediaOverlayClient polls currentTime on an interval.
  }

  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void {
    if (type === 'ended') this.#endedListeners.delete(fn);
    else if (type === 'error') this.#errorListeners.delete(fn);
  }

  async ensureReady(): Promise<void> {
    await this.#ensureListener();
    // Await an in-flight start-session too: returning early would let a
    // concurrent load/resume invoke race ahead of the session it belongs to.
    if (this.#nativeSession) {
      await this.#nativeSession;
      return;
    }
    this.#ended = false;
    this.#nativeSession = invoke<{ session: number }>('plugin:native-tts|playout_control', {
      payload: { action: 'start-session' },
    }).then((res) => {
      this.#resolvedSession = res.session;
      return res.session;
    });
    await this.#nativeSession;
    this.#startPolling();
  }

  // Forget the native session id after another engine (Edge) aborted the shared
  // AVPlayer. Keeps the staged chapter file so the next load() is cheap.
  invalidateSession(): void {
    this.#userPaused = true;
    this.#cache.playing = false;
    this.#href = null;
    this.#nativeSession = null;
    this.#resolvedSession = null;
    this.#ended = false;
    this.#stopPolling();
    void invoke('plugin:native-tts|playout_control', { payload: { action: 'pause' } }).catch(
      () => {},
    );
  }

  // Stage the chapter blob once per href, then load (or seek) on the native
  // player. Large MO files stay on disk — never base64 through the plugin.
  async load(href: string, blob: Blob, startSec = 0): Promise<void> {
    await this.ensureReady();
    const path = await this.#stageBlob(href, blob);
    this.#href = href;
    this.#ended = false;
    await invoke('plugin:native-tts|playout_control', {
      payload: {
        action: 'load',
        path,
        positionMs: startSec * 1000,
      },
    });
    this.#cache = {
      mediaSec: startSec,
      playing: !this.#userPaused,
      at: performance.now(),
    };
  }

  async seek(seconds: number): Promise<void> {
    if (!this.#nativeSession) return;
    await this.#nativeSession;
    this.#ended = false;
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
    this.#ended = false;
    await this.ensureReady();
    await invoke('plugin:native-tts|playout_control', { payload: { action: 'resume' } });
    this.#cache.playing = true;
    this.#cache.at = performance.now();
  }

  pause(): void {
    this.#userPaused = true;
    this.#cache.playing = false;
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

  async release(): Promise<void> {
    this.pause();
    this.#href = null;
    this.#stopPolling();
    const path = this.#stagedPath;
    this.#stagedPath = null;
    this.#stagedHref = null;
    if (path) {
      await remove(path).catch(() => undefined);
    }
    this.#nativeSession = null;
    this.#resolvedSession = null;
    await invoke('plugin:native-tts|playout_control', { payload: { action: 'abort' } }).catch(
      () => {},
    );
  }

  async shutdown(): Promise<void> {
    await this.release();
    if (this.#listener) {
      const listener = this.#listener;
      this.#listener = null;
      this.#listenerStarted = false;
      await Promise.resolve(listener.unregister()).catch(() => {});
    }
  }

  async #stageBlob(href: string, blob: Blob): Promise<string> {
    if (this.#stagedHref === href && this.#stagedPath) return this.#stagedPath;
    if (this.#stagedPath) {
      await remove(this.#stagedPath).catch(() => undefined);
    }
    const name = `mo-narration-${hashHref(href)}.${fileExtension(href)}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(name, bytes, { baseDir: BaseDirectory.Temp });
    const path = await join(await tempDir(), name);
    this.#stagedHref = href;
    this.#stagedPath = path;
    return path;
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
      this.#ended = true;
      this.#cache.playing = false;
      for (const fn of [...this.#endedListeners]) fn();
    } else if (event.type === 'error') {
      // The item failed to load or play. Nothing will ever move the clock, so
      // this is the only thing that can unstick a waiting speak().
      this.#ended = true;
      this.#cache.playing = false;
      for (const fn of [...this.#errorListeners]) fn();
    } else if (event.type === 'chunk-start') {
      this.#ended = false;
      this.#cache.playing = !this.#userPaused;
      this.#cache.at = performance.now();
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
    if (this.#resolvedSession === null || this.#ended) return;
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
    } catch {
      // Transient invoke failures must not kill the poll loop.
    }
  }
}
