// One narration clock over a recording split into several media files.
//
// Audiobookshelf items carry a track list (per-file startOffset/duration) with
// chapters timed on the global timeline, and chapters routinely span files.
// MediaOverlayClient only wants "a clock for this href", so this presents the
// tracks as one continuous timeline: seeks land on the right file at the right
// offset, a file running out rolls into the next one, and only the last
// file's end surfaces as `ended`.

import type { NarrationClock } from './NarrationClock';

export interface NarrationTrack {
  url: string;
  startOffset: number; // global seconds at which this track starts
  duration: number; // seconds
}

// The per-track player the composite drives: HtmlAudioClock on the web, or the
// client's NativeNarrationPlayer wrapped so load() streams a URL.
export interface NarrationTrackPlayer extends NarrationClock {
  load(url: string, startAt: number): Promise<void>;
}

type ClockEvent = 'ended' | 'error' | 'timeupdate';

export class MultiTrackNarrationClock implements NarrationClock {
  readonly duration: number;

  #tracks: NarrationTrack[];
  #player: NarrationTrackPlayer;
  #index = -1;
  // Global position the clock reports while no track is loaded or a load is
  // still in flight, so a seek is visible before the media is ready.
  #target = 0;
  #pending: Promise<void> | null = null;
  #rate = 1;
  #userPaused = true;
  #listeners: Record<ClockEvent, Set<() => void>> = {
    ended: new Set(),
    error: new Set(),
    timeupdate: new Set(),
  };
  #onTrackEnded = () => this.#advance();
  #onTrackError = () => this.#emit('error');
  #onTimeUpdate = () => this.#emit('timeupdate');

  constructor(tracks: NarrationTrack[], player: NarrationTrackPlayer) {
    this.#tracks = [...tracks].sort((a, b) => a.startOffset - b.startOffset);
    this.#player = player;
    // Global endpoint, not the sum: a gap or overlap between offsets makes them
    // differ, and #locate clamps against this. Matches buildAbsPairingSource.
    this.duration = Math.max(...this.#tracks.map((track) => track.startOffset + track.duration));
    player.addEventListener('ended', this.#onTrackEnded);
    player.addEventListener('error', this.#onTrackError);
    player.addEventListener('timeupdate', this.#onTimeUpdate);
  }

  get currentTime(): number {
    const track = this.#tracks[this.#index];
    if (!track || this.#pending) return this.#target;
    const offset = Math.min(Math.max(this.#player.currentTime, 0), track.duration);
    return track.startOffset + offset;
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

  get paused(): boolean {
    return this.#userPaused;
  }

  addEventListener(type: ClockEvent, fn: () => void): void {
    this.#listeners[type].add(fn);
  }

  removeEventListener(type: ClockEvent, fn: () => void): void {
    this.#listeners[type].delete(fn);
  }

  async seek(seconds: number): Promise<void> {
    const { index, offset } = this.#locate(seconds);
    if (index !== this.#index) {
      await this.#load(index, offset);
      return;
    }
    // #load sets the playhead to its own startAt when it settles; a seek issued
    // for the same track while that load is in flight would be overwritten, so
    // wait it out first (then re-derive, in case another seek switched tracks).
    if (this.#pending) {
      await this.#pending;
      if (this.#locate(seconds).index !== this.#index) return this.seek(seconds);
    }
    this.#target = this.#tracks[index]!.startOffset + offset;
    if (this.#player.seek) await this.#player.seek(offset);
    else this.#player.currentTime = offset;
  }

  async play(): Promise<void> {
    this.#userPaused = false;
    if (this.#index < 0) {
      const { index, offset } = this.#locate(this.#target);
      await this.#load(index, offset);
      return;
    }
    if (this.#pending) await this.#pending;
    await this.#player.play();
  }

  pause(): void {
    this.#userPaused = true;
    this.#player.pause();
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = rate;
    if (this.#player.setRate) await this.#player.setRate(rate);
    else this.#player.playbackRate = rate;
  }

  destroy(): void {
    this.pause();
    this.#player.removeEventListener('ended', this.#onTrackEnded);
    this.#player.removeEventListener('error', this.#onTrackError);
    this.#player.removeEventListener('timeupdate', this.#onTimeUpdate);
    this.#player.destroy?.();
  }

  #locate(globalSec: number): { index: number; offset: number } {
    const clamped = Math.max(0, Math.min(globalSec, this.duration));
    let index = 0;
    for (let i = 1; i < this.#tracks.length; i += 1) {
      if (this.#tracks[i]!.startOffset <= clamped) index = i;
    }
    const track = this.#tracks[index]!;
    const offset = Math.max(0, Math.min(clamped - track.startOffset, track.duration));
    return { index, offset };
  }

  async #load(index: number, offset: number): Promise<void> {
    const track = this.#tracks[index]!;
    this.#index = index;
    this.#target = track.startOffset + offset;
    const pending = (async () => {
      await this.#player.load(track.url, offset);
      // A later seek may have moved on to another track while this one was
      // loading; it owns the player now.
      if (this.#index !== index) return;
      await this.setRate(this.#rate);
      if (!this.#userPaused) await this.#player.play();
    })();
    this.#pending = pending;
    try {
      await pending;
    } finally {
      if (this.#pending === pending) this.#pending = null;
    }
  }

  #advance(): void {
    if (this.#index < this.#tracks.length - 1) {
      void this.#load(this.#index + 1, 0);
      return;
    }
    this.#userPaused = true;
    this.#emit('ended');
  }

  #emit(type: ClockEvent): void {
    for (const fn of [...this.#listeners[type]]) fn();
  }
}
