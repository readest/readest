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
  // Android: the item the playlist ended on, once nothing is current.
  endedIndex?: number;
}

interface FileWindow {
  start: number;
  end: number;
  contentType: string;
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
  // The native playlist by index, as hrefs: the loaded file and any queued
  // after it. #nativeIndex is the item the native player is on. It follows
  // the plugin's rules, which depend only on the order of loads and queues
  // (never on when a file happens to roll over), so the two cannot drift.
  #playlist: string[] = [];
  #nativeIndex = -1;
  // The item index the last position read reported.
  #seenIndex = -1;
  // Counts loads, so a position read that overlapped one is dropped: it may
  // describe the playlist the load replaced.
  #loads = 0;
  // Staged copies of book audio this player wrote, by href.
  #staged = new Map<string, string>();
  #rate = 1;
  #userPaused = true;
  #ended = false;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #cache = { mediaSec: 0, playing: false, at: 0 };
  #endedListeners = new Set<() => void>();
  #errorListeners = new Set<() => void>();

  // The file the native player is on: the one loaded, or the queued one it
  // rolled into by itself.
  get href(): string | null {
    return this.#href;
  }

  get ended(): boolean {
    return this.#ended;
  }

  // Whether `href` is loaded or queued.
  has(href: string): boolean {
    return this.#playlist.includes(href);
  }

  // Whether the native player has already played `href` out and moved on to a
  // file queued after it.
  playedPast(href: string): boolean {
    const index = this.#playlist.indexOf(href);
    return index >= 0 && index < this.#nativeIndex;
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
    // A new session starts with an empty native playlist.
    this.#playlist = [];
    this.#nativeIndex = -1;
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
    await this.#loadResolvedPath(href, path, startSec);
  }

  // Queue a file to play after `after`, the file now playing, without JS
  // (Android only): the WebView can be suspended under screen lock while the
  // native player runs.
  async queue(href: string, blob: Blob, after: string): Promise<void> {
    if (this.#playlist.includes(href)) return;
    await this.ensureReady();
    const path = await this.#stageBlob(href, blob);
    await this.#queueResolvedPath(href, path, after);
  }

  async queuePath(href: string, path: string, after: string, bytes?: FileWindow): Promise<void> {
    if (this.#playlist.includes(href)) return;
    await this.ensureReady();
    await this.#queueResolvedPath(href, path, after, bytes);
  }

  async #queueResolvedPath(
    href: string,
    path: string,
    after: string,
    bytes?: FileWindow,
  ): Promise<void> {
    // Checked with nothing awaited before the command: another file loaded
    // while this one resolved means it no longer follows what is playing.
    if (this.#href !== after || this.#playlist.includes(href)) return;
    await invoke('plugin:native-tts|playout_control', {
      payload: { action: 'queue', path, ...bytes },
    });
    if (this.#playlist.includes(href)) return;
    // The plugin keeps only the file this one follows.
    this.#playlist = [...this.#playlist.slice(-1), href];
    this.#nativeIndex = 0;
    await this.#pruneStaged();
  }

  // Paired audiobooks already live as ordinary files under Books/<hash>.
  // Hand AVPlayer that path directly: copying a multi-hour M4B through a Blob
  // and a second temp file would double I/O and briefly hold the whole book in
  // memory. The caller owns the path, so release() must never delete it.
  // `bytes` is a range [start, end) of the file to play as the whole
  // track: a stored audio entry inside the book's zip. AVPlayer needs its
  // `contentType`, since the file's own extension names the book.
  async loadPath(href: string, path: string, startSec = 0, bytes?: FileWindow): Promise<void> {
    await this.ensureReady();
    // Record the path only once the player took it, so a failed load leaves
    // load() free to stage a copy of the same href.
    await this.#loadResolvedPath(href, path, startSec, bytes);
  }

  async #loadResolvedPath(
    href: string,
    path: string,
    startSec: number,
    bytes?: FileWindow,
  ): Promise<void> {
    this.#href = href;
    this.#ended = false;
    this.#loads++;
    await invoke('plugin:native-tts|playout_control', {
      payload: {
        action: 'load',
        path,
        positionMs: startSec * 1000,
        ...bytes,
      },
    });
    // A file already in the playlist is jumped to and the ones before it are
    // dropped; anything else replaces the playlist.
    const index = this.#playlist.indexOf(href);
    this.#playlist = index >= 0 ? this.#playlist.slice(index) : [href];
    this.#nativeIndex = 0;
    this.#seenIndex = 0;
    this.#loads++;
    await this.#pruneStaged();
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

  async release(): Promise<void> {
    this.pause();
    this.#href = null;
    this.#stopPolling();
    this.#playlist = [];
    this.#nativeIndex = -1;
    await this.#pruneStaged();
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
    // Only copies this player wrote; a path from loadPath() is the caller's
    // file (possibly the whole book) and is never staged or removed.
    const staged = this.#staged.get(href);
    if (staged) return staged;
    const name = `mo-narration-${hashHref(href)}.${fileExtension(href)}`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // App cache, not Temp: older Android versions resolve Temp to the
    // unwritable /data/local/tmp.
    await writeFile(name, bytes, { baseDir: BaseDirectory.AppCache });
    const path = await join(await appCacheDir(), name);
    this.#staged.set(href, path);
    return path;
  }

  // Remove staged copies that are no longer in the native playlist.
  async #pruneStaged(): Promise<void> {
    const keep = new Set(this.#playlist);
    for (const [href, path] of [...this.#staged]) {
      if (keep.has(href)) continue;
      this.#staged.delete(href);
      await remove(path).catch(() => undefined);
    }
  }

  // The native player rolled from the file JS was waiting on into the queued
  // one. Whatever waits on the old file's clips is done with it.
  #rollTo(index: number): void {
    this.#nativeIndex = index;
    this.#href = this.#playlist[index] ?? null;
    for (const fn of [...this.#endedListeners]) fn();
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
      // A late event can belong to a file played before the one loaded since:
      // end only if the player is still at an end.
      void this.sync()
        .then((pos) => {
          if (pos && pos.index < 0) this.#finishEnded();
        })
        .catch(() => undefined);
    } else if (event.type === 'item-ended') {
      // Indices restart whenever a queue drops played files, so a late event
      // can name an item of the new playlist. Confirm with the position.
      void this.sync().catch(() => undefined);
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

  #finishEnded(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#cache.playing = false;
    for (const fn of [...this.#endedListeners]) fn();
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
      await this.sync();
    } catch {
      // Transient invoke failures must not kill the poll loop.
    }
  }

  // Read where the native player really is. Events sent while the WebView was
  // suspended can arrive late or not at all, so this is what reconciles a
  // rollover or an end of file it missed.
  // Returns the position it applied, or null when it was dropped.
  async sync(): Promise<PlayoutPosition | null> {
    if (this.#resolvedSession === null) return null;
    const loads = this.#loads;
    const pos = await invoke<PlayoutPosition>('plugin:native-tts|playout_position');
    if (pos.session !== this.#resolvedSession || loads !== this.#loads) return null;
    const seenIndex = this.#seenIndex;
    this.#seenIndex = pos.index;
    // Where the player is, or the item it ended on: either may be past the
    // file JS last knew of.
    const reached = pos.index >= 0 ? pos.index : (pos.endedIndex ?? -1);
    if (reached > this.#nativeIndex && reached < this.#playlist.length) {
      this.#rollTo(reached);
    }
    if (pos.index >= 0) {
      this.#cache = {
        mediaSec: pos.positionMs / 1000,
        playing: pos.playing && !this.#userPaused,
        at: performance.now(),
      };
    } else if (seenIndex >= 0) {
      // The file played out since the last read, maybe while the WebView was
      // suspended and its `ended` event was lost. Hold the clock at the end.
      this.#cache = { mediaSec: pos.positionMs / 1000, playing: false, at: performance.now() };
      if (!this.#userPaused) this.#finishEnded();
    } else {
      this.#cache.playing = false;
    }
    return pos;
  }
}
