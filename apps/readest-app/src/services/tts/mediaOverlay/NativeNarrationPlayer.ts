// Continuous long-file playout for Media Overlay on mobile Tauri.
//
// Edge TTS already plays through an in-process AVPlayer (NativeAudioPlayer)
// because WebKit HTMLMediaElement / WebAudio cannot own the app's non-mixable
// playback session. Android uses the same interface so local audiobooks stream
// through ExoPlayer rather than being copied into a WebView Blob. This player
// stages container blobs to a temp file, while paired audiobooks can hand the
// native player their existing path directly.

import { addPluginListener, invoke, PluginListener } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { BaseDirectory, remove, writeFile } from '@tauri-apps/plugin-fs';

interface PlayoutPosition {
  session: number;
  index: number;
  positionMs: number;
  playing: boolean;
  path?: string;
}

interface PlayoutEvent {
  type: string;
  session: number;
  index?: number;
  path?: string;
  positionMs?: number;
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

// Android's WebView bridge can expand one binary invoke into a much larger
// transient payload. Bound each write while staging long chapter recordings.
const stageRecording = (name: string, blob: Blob): Promise<void> => {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= blob.size) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 256 * 1024, blob.size);
      const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
      offset = end;
      controller.enqueue(bytes);
    },
  });
  return writeFile(name, stream, { baseDir: BaseDirectory.AppCache });
};

export class NativeNarrationPlayer {
  #nativeSession: Promise<number> | null = null;
  #resolvedSession: number | null = null;
  #listener: PluginListener | null = null;
  #listenerStarted = false;
  #href: string | null = null;
  #stagedPath: string | null = null;
  #stagedHref: string | null = null;
  #ownsStagedPath = false;
  #prepared: {
    href: string;
    path: string | null;
    owned: boolean;
    promise: Promise<string>;
    boundary: number | null;
    end: number;
    started: boolean;
    cache: { mediaSec: number; playing: boolean; at: number };
  } | null = null;
  #prepareId = 0;
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
    const cache = this.#prepared?.started ? this.#prepared.cache : this.#cache;
    return this.#userPaused || !cache.playing;
  }

  // Extrapolated media time between native polls (AVPlayer item time).
  get currentTime(): number {
    if (this.#prepared?.started) return this.#prepared.boundary!;
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
  }

  // Forget the native session id after another engine (Edge) aborted the shared
  // AVPlayer. Keeps the staged chapter file so the next load() is cheap.
  invalidateSession(): void {
    this.#discardPrepared();
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
    this.#discardPrepared();
    await this.ensureReady();
    const path = await this.#stageBlob(href, blob);
    await this.#loadResolvedPath(href, path, startSec);
  }

  // Extract and write one upcoming member without touching the live native
  // session. Loading it through AVPlayer here would interrupt the current file.
  async preload(href: string, loadBlob: () => Promise<Blob | string>): Promise<void> {
    if (this.#stagedHref === href || this.#prepared) return;
    const entry = {
      href,
      path: null as string | null,
      owned: true,
      promise: Promise.resolve(''),
      boundary: null as number | null,
      end: 0,
      started: false,
      cache: { mediaSec: 0, playing: false, at: 0 },
    };
    this.#prepared = entry;
    const name = `mo-narration-${hashHref(href)}-next-${++this.#prepareId}.${fileExtension(href)}`;
    entry.promise = (async () => {
      const blob = await loadBlob();
      if (typeof blob === 'string') {
        entry.owned = false;
        entry.path = blob;
        return blob;
      }
      const path = await join(await appCacheDir(), name);
      await stageRecording(name, blob);
      if (this.#prepared !== entry) {
        await remove(path).catch(() => undefined);
        throw new Error('Narration preparation cancelled');
      }
      entry.path = path;
      return path;
    })();
    try {
      await entry.promise;
    } catch {
      if (this.#prepared === entry) this.#prepared = null;
    }
  }

  get queued(): boolean {
    return this.#prepared?.boundary !== null && !!this.#prepared;
  }
  get queuedStarted(): boolean {
    return !!this.#prepared?.started;
  }

  async queuePrepared(at: number, start: number, end: number): Promise<void> {
    const entry = this.#prepared;
    if (!entry || entry.boundary !== null) return;
    const path = await entry.promise.catch(() => null);
    if (!path || this.#prepared !== entry) return;
    entry.boundary = at;
    entry.end = end;
    entry.cache = { mediaSec: start, playing: false, at: performance.now() };
    try {
      await invoke('plugin:native-tts|playout_control', {
        payload: {
          action: 'queue-next',
          path,
          atMs: at * 1000,
          positionMs: start * 1000,
          endMs: end * 1000,
        },
      });
    } catch {
      entry.boundary = null;
    }
  }

  async loadPrepared(href: string, startSec = 0): Promise<boolean> {
    const entry = this.#prepared;
    if (entry?.href !== href) return false;
    const path = await entry.promise.catch(() => null);
    if (!path || this.#prepared !== entry) return false;
    this.#prepared = null;
    if (entry.started) {
      const previous = this.#stagedPath;
      const owned = this.#ownsStagedPath;
      this.#href = href;
      this.#stagedHref = href;
      this.#stagedPath = path;
      this.#ownsStagedPath = entry.owned;
      this.#cache = entry.cache;
      if (owned && previous && previous !== path) await remove(previous).catch(() => undefined);
      return true;
    }
    // Foreground navigation before the queued boundary is a real seek.
    await this.loadPath(href, path, startSec);
    this.#ownsStagedPath = entry.owned;
    return true;
  }

  cancelQueued(): void {
    this.#discardPrepared();
    void invoke('plugin:native-tts|playout_control', { payload: { action: 'cancel-next' } }).catch(
      () => {},
    );
  }

  #discardPrepared(): void {
    const entry = this.#prepared;
    this.#prepared = null;
    if (entry?.path && entry.owned) void remove(entry.path).catch(() => undefined);
  }

  // Paired audiobooks already live as ordinary files under Books/<hash>.
  // Hand AVPlayer that path directly: copying a multi-hour M4B through a Blob
  // and a second temp file would double I/O and briefly hold the whole book in
  // memory. The caller owns the path, so release() must never delete it.
  async loadPath(href: string, path: string, startSec = 0): Promise<void> {
    await this.ensureReady();
    if (this.#ownsStagedPath && this.#stagedPath && this.#stagedPath !== path) {
      await remove(this.#stagedPath).catch(() => undefined);
    }
    this.#stagedHref = href;
    this.#stagedPath = path;
    this.#ownsStagedPath = false;
    await this.#loadResolvedPath(href, path, startSec);
  }

  async #loadResolvedPath(href: string, path: string, startSec: number): Promise<void> {
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
    const restoreCurrent = this.#prepared?.started && this.#href && this.#stagedPath;
    this.cancelQueued();
    if (restoreCurrent) {
      await this.#loadResolvedPath(this.#href!, this.#stagedPath!, seconds);
      return;
    }
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
    const cache = this.#prepared?.started ? this.#prepared.cache : this.#cache;
    cache.playing = true;
    cache.at = performance.now();
    this.#startPolling();
  }

  pause(): void {
    const mediaSec = this.currentTime;
    if (this.#prepared?.started) {
      const cache = this.#prepared.cache;
      cache.mediaSec += cache.playing ? ((performance.now() - cache.at) / 1000) * this.#rate : 0;
      cache.playing = false;
      cache.at = performance.now();
    }
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

  async release(): Promise<void> {
    this.#discardPrepared();
    this.pause();
    this.#href = null;
    this.#stopPolling();
    const path = this.#stagedPath;
    const ownsPath = this.#ownsStagedPath;
    this.#stagedPath = null;
    this.#stagedHref = null;
    this.#ownsStagedPath = false;
    if (path && ownsPath) {
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
    if (this.#stagedPath && this.#ownsStagedPath) {
      await remove(this.#stagedPath).catch(() => undefined);
    }
    const name = `mo-narration-${hashHref(href)}.${fileExtension(href)}`;
    // App cache, not Temp: older Android versions resolve Temp to the
    // unwritable /data/local/tmp.
    await stageRecording(name, blob);
    const path = await join(await appCacheDir(), name);
    this.#stagedHref = href;
    this.#stagedPath = path;
    this.#ownsStagedPath = true;
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

  #recordTransition(path: string, seconds: number, playing: boolean): void {
    const entry = this.#prepared;
    if (!entry || entry.path !== path || entry.boundary === null) return;
    entry.started = true;
    entry.cache = {
      mediaSec: seconds,
      playing: playing && !this.#userPaused,
      at: performance.now(),
    };
    this.#ended = false;
  }

  #onNativeEvent(event: PlayoutEvent): void {
    if (this.#resolvedSession !== null && event.session !== this.#resolvedSession) return;
    if (event.type === 'segment-start' && event.path) {
      this.#recordTransition(event.path, (event.positionMs ?? 0) / 1000, true);
    } else if (event.type === 'ended') {
      if (this.#prepared?.started)
        this.#prepared.cache = {
          mediaSec: this.#prepared.end,
          playing: false,
          at: performance.now(),
        };
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
    if (this.#resolvedSession === null || this.#ended || this.#userPaused) return;
    try {
      const pos = await invoke<PlayoutPosition>('plugin:native-tts|playout_position');
      if (pos.session !== this.#resolvedSession) return;
      if (pos.path && pos.path === this.#prepared?.path) {
        this.#recordTransition(pos.path, pos.positionMs / 1000, pos.playing);
      } else if (pos.index >= 0) {
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
