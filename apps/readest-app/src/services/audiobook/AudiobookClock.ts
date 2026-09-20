// The media clock AudiobookController drives. Kept as a narrow interface so
// tests can substitute a fake instead of a real HTMLAudioElement, and so a
// future native player (mirroring MediaOverlayClient's NativeNarrationPlayer
// split) can slot in without touching the controller.
export interface AudiobookClock {
  currentTime: number; // in-track seconds (get/set where supported; use load+seek otherwise)
  playbackRate: number;
  readonly paused: boolean;
  /** Point the clock at a track URL and position; resolves when seekable. */
  load(url: string, startAt: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
  destroy(): void;
}

export class HtmlAudioClock implements AudiobookClock {
  #audio: HTMLAudioElement;

  constructor() {
    this.#audio = new Audio();
    this.#audio.preload = 'auto';
    // Speed changes must not raise the narrator's pitch (MediaOverlayClient precedent).
    this.#audio.preservesPitch = true;
  }

  get currentTime() {
    return this.#audio.currentTime;
  }

  set currentTime(v: number) {
    this.#audio.currentTime = v;
  }

  get playbackRate() {
    return this.#audio.playbackRate;
  }

  set playbackRate(v: number) {
    this.#audio.playbackRate = v;
  }

  get paused() {
    return this.#audio.paused;
  }

  async load(url: string, startAt: number): Promise<void> {
    const rate = this.#audio.playbackRate;
    this.#audio.src = url;
    this.#audio.load();
    this.#audio.playbackRate = rate; // src reset clears rate on some engines
    if (startAt > 0) this.#audio.currentTime = startAt;
  }

  play() {
    return this.#audio.play();
  }

  pause() {
    this.#audio.pause();
  }

  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void) {
    this.#audio.addEventListener(type, fn);
  }

  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void) {
    this.#audio.removeEventListener(type, fn);
  }

  destroy() {
    this.#audio.pause();
    this.#audio.removeAttribute('src');
    this.#audio.load();
  }
}

/**
 * Plays downloaded tracks (#6256) from blob URLs, taking file paths in load().
 * Chromium under CEF (the Linux runtime) fails every non-zero `Range` read of
 * a custom-scheme URL (Chromium 40739128), so an asset:// track cannot seek
 * there; a blob URL can. The current track's blob is reused for seeks within
 * it and released when the track changes or the clock is destroyed.
 */
export class BlobAudioClock extends HtmlAudioClock {
  #loadBlob: (path: string) => Promise<Blob>;
  #path: string | null = null;
  #url: string | null = null;
  #loadSeq = 0;

  constructor(loadBlob: (path: string) => Promise<Blob>) {
    super();
    this.#loadBlob = loadBlob;
  }

  override async load(path: string, startAt: number): Promise<void> {
    const seq = ++this.#loadSeq;
    if (path !== this.#path || !this.#url) {
      const blob = await this.#loadBlob(path);
      // A newer load (a quick skip) already took over.
      if (seq !== this.#loadSeq) return;
      this.#release();
      this.#path = path;
      this.#url = URL.createObjectURL(blob);
    }
    await super.load(this.#url, startAt);
  }

  override destroy(): void {
    // A load still reading its blob must not resurrect the clock.
    this.#loadSeq++;
    super.destroy();
    this.#release();
  }

  #release(): void {
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#path = null;
    this.#url = null;
  }
}
