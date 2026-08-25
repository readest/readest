// The streaming audiobook playback engine. Implements the PlaybackSource seam
// (src/services/playback/playbackSource.ts) so ttsMediaBridge and
// TTSSessionManager — written against TTSController — drive audiobook
// playback unchanged: same events, same state machine, same 'stopped'-is-
// transit invariant.
//
// A clock (AudiobookClock) owns the actual media element; this controller
// only ever talks to it through that narrow interface, which is what lets
// tests substitute a fake clock instead of a real HTMLAudioElement.

import { AudiobookTimeline } from './AudiobookTimeline';
import type { AudiobookClock } from './AudiobookClock';
import type {
  PlaybackInfo,
  PlaybackSource,
  PlaybackState,
} from '@/services/playback/playbackSource';
import type { ABSChapter, ABSTrack } from '@/types/audiobookshelf';
import type { TTSMark } from '@/services/tts/types';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';
import { SKIP_BACKWARD_SEC, SKIP_FORWARD_SEC } from '@/services/playback/playbackSource';

// How often 'tts-speak-mark' is re-emitted while playing, so the lock-screen
// position stays honest even when the rate isn't 1 (mirrors the TTS bridge's
// need for a fresh mark to update its position state).
const TICK_INTERVAL_MS = 15_000;

// One automatic resume after a transient clock error (dropped stream, rotated
// token, network blip), fired this long after the error hit while playing.
const ERROR_RETRY_MS = 3_000;

// A repeat error within this long of the previous one counts as the same
// still-broken episode and does not re-arm the auto-retry, so a persistently
// broken stream doesn't retry (and toast) forever. A stream that recovers and
// plays for at least this long before dropping again gets a fresh retry.
const ERROR_RECOVERY_MS = 30_000;

export interface AudiobookSource {
  itemId: string;
  /**
   * Podcast episode id when this source plays a single episode; undefined
   * for whole-audiobook playback. Carried here (not just passed to the
   * syncer) so a live session's episode can be read back off its controller
   * via getEpisodeId() - openAudiobookSession's reuse check needs that to
   * tell "same episode, reuse" from "different episode, replace" apart.
   */
  episodeId?: string;
  title: string;
  author: string;
  tracks: ABSTrack[];
  chapters: ABSChapter[];
  /** Resolve a track contentUrl to a playable absolute URL (adds ?token=). */
  resolveUrl: (contentPath: string) => string;
  /** Global seconds to resume from. */
  startAt: number;
}

export interface AudiobookProgressHooks {
  onPlay?: () => void;
  onPause?: (positionSec: number) => void;
  onTick?: (positionSec: number) => void; // ~ every 15s while playing
  onSeek?: (positionSec: number) => void;
  onEnd?: (positionSec: number) => void; // shutdown / natural end
}

export class AudiobookController extends EventTarget implements PlaybackSource {
  readonly kind = 'audiobook' as const;
  readonly isViewAttached = false;
  // Standing preference: pause at the end of the current chapter instead of
  // rolling into the next one. Sticky across chapter boundaries until the
  // caller flips it back off.
  stopAtChapterEnd = false;

  #source: AudiobookSource;
  #clock: AudiobookClock;
  #hooks: AudiobookProgressHooks | undefined;
  #timeline: AudiobookTimeline;
  // Tracks/chapters sorted the same way AudiobookTimeline sorts them
  // internally, so the array indices locate()/chapterAt() hand back line up.
  #tracks: ABSTrack[];
  #chapters: ABSChapter[];
  #trackIndex = 0;
  #state: PlaybackState = 'stopped';
  #terminated = false;
  #started = false;
  // Position to resume from after a transient clock error; also doubles as
  // the "did the last start() follow an error" flag (non-null = yes).
  #errorResumeAt: number | null = null;
  // Wall-clock time of the last clock 'error', used to gate auto-retry re-arm.
  #lastErrorAt: number | null = null;
  #lastChapter: ABSChapter | null = null;
  #tickTimer: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

  #onEnded = (): void => {
    if (this.#terminated) return;
    const lastIndex = this.#tracks.length - 1;
    if (this.#trackIndex >= lastIndex) {
      this.#finish('ended');
      return;
    }
    const track = this.#tracks[this.#trackIndex + 1];
    if (!track) {
      this.#finish('ended');
      return;
    }
    this.#trackIndex += 1;
    void this.#clock
      .load(this.#source.resolveUrl(track.contentUrl), 0)
      .then(() => {
        // A pause() (or another 'error') landing between load() and its
        // resolution must not resume playback out from under it: the bridge's
        // directional pause handler only acts when state is 'playing', so
        // resuming here regardless would strand the lock-screen pause button
        // as a no-op over live audio.
        if (this.#terminated || this.#state !== 'playing') return;
        void this.#clock.play();
      })
      .catch(() => this.#onError());
  };

  #onError = (): void => {
    if (this.#terminated) return;
    const pos = this.#position();
    const wasPlaying = this.#state === 'playing';
    const now = Date.now();
    const recovered = this.#lastErrorAt === null || now - this.#lastErrorAt >= ERROR_RECOVERY_MS;
    this.#lastErrorAt = now;
    this.#errorResumeAt = pos;
    this.#stopTicking();
    this.#clock.pause();
    this.#setState('paused');
    this.#hooks?.onPause?.(pos);
    eventDispatcher.dispatch('toast', {
      message: _('Playback interrupted, tap play to retry'),
      type: 'error',
    });
    if (wasPlaying && recovered && !this.#retryTimer) {
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null;
        void this.start();
      }, ERROR_RETRY_MS);
    }
  };

  #onTimeUpdate = (): void => {
    if (this.#terminated) return;
    const chapter = this.#timeline.chapterAt(this.#position());
    if (chapter === this.#lastChapter) return;
    this.#emitMark();
    if (this.stopAtChapterEnd) {
      void this.pause();
    }
  };

  constructor(source: AudiobookSource, clock: AudiobookClock, hooks?: AudiobookProgressHooks) {
    super();
    this.#source = source;
    this.#clock = clock;
    this.#hooks = hooks;
    this.#tracks = [...source.tracks].sort((a, b) => a.startOffset - b.startOffset);
    this.#chapters = [...source.chapters].sort((a, b) => a.start - b.start);
    this.#timeline = new AudiobookTimeline(source.tracks, source.chapters);
    this.#clock.addEventListener('ended', this.#onEnded);
    this.#clock.addEventListener('error', this.#onError);
    this.#clock.addEventListener('timeupdate', this.#onTimeUpdate);
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get terminated(): boolean {
    return this.#terminated;
  }

  get rate(): number {
    return this.#clock.playbackRate;
  }

  async start(): Promise<void> {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    if (!this.#started) {
      this.#started = true;
      try {
        await this.#loadGlobal(this.#source.startAt);
      } catch {
        // Unrecoverable setup failure (e.g. the initial resolveUrl/load
        // rejects) — unlike a transient clock 'error' mid-playback, there is
        // no position to resume from, so the session ends.
        this.#finish('error');
        return;
      }
    } else if (this.#errorResumeAt !== null) {
      // Resuming after a transient error: reload so resolveUrl runs again
      // (covers a rotated auth token) at the position the error caught us at.
      const resumeAt = this.#errorResumeAt;
      this.#errorResumeAt = null;
      await this.#loadGlobal(resumeAt);
    }
    try {
      await this.#clock.play();
    } catch {
      // Chrome's autoplay policy rejects play() outright without ever firing
      // an element 'error' event, so #onError never runs: an unhandled
      // rejection escaped and the UI kept showing "playing" over silence.
      // Land in 'paused' instead — the play button comes back and the user's
      // tap is a gesture the policy accepts.
      this.#setState('paused');
      return;
    }
    this.#setState('playing');
    this.#startTicking();
    this.#emitMark();
    this.#hooks?.onPlay?.();
  }

  async pause(): Promise<void> {
    const pos = this.#position();
    this.#stopTicking();
    this.#clock.pause();
    this.#setState('paused');
    this.#hooks?.onPause?.(pos);
  }

  async forward(byMark?: boolean): Promise<void> {
    if (byMark) {
      await this.seekToTime(this.#position() + SKIP_FORWARD_SEC);
      return;
    }
    const next = this.#timeline.nextChapterStart(this.#position());
    if (next === null) return;
    await this.seekToTime(next);
  }

  async backward(byMark?: boolean): Promise<void> {
    if (byMark) {
      await this.seekToTime(this.#position() - SKIP_BACKWARD_SEC);
      return;
    }
    await this.seekToTime(this.#timeline.prevChapterStart(this.#position()));
  }

  async setRate(rate: number): Promise<void> {
    this.#clock.playbackRate = rate;
  }

  async seekToTime(seconds: number): Promise<void> {
    const clamped = Math.max(0, Math.min(seconds, this.#timeline.duration));
    const { trackIndex, offset } = this.#timeline.locate(clamped);
    if (trackIndex === this.#trackIndex) {
      this.#clock.currentTime = offset;
    } else {
      await this.#loadGlobal(clamped);
    }
    if (this.#state === 'playing') {
      await this.#clock.play();
    }
    this.#emitMark();
    this.#hooks?.onSeek?.(this.#position());
  }

  async ensureTimeline(): Promise<AudiobookTimeline> {
    return this.#timeline;
  }

  supportsPlaybackInfo(): boolean {
    return true;
  }

  getPlaybackInfo(): PlaybackInfo | null {
    return {
      position: this.#position(),
      duration: this.#timeline.duration,
      measuredFraction: 1,
    };
  }

  getCurrentChapter(): ABSChapter | null {
    return this.#timeline.chapterAt(this.#position());
  }

  getChapters(): ABSChapter[] {
    return this.#chapters;
  }

  /** Podcast episode id this session is playing, if any. See AudiobookSource.episodeId. */
  getEpisodeId(): string | undefined {
    return this.#source.episodeId;
  }

  /**
   * The source title: an episode title when playing a single podcast
   * episode, the book title otherwise (see openAudiobookSession, which sets
   * AudiobookSource.title accordingly). Lets the player route show the
   * right heading without threading episode data through separately.
   */
  getTitle(): string {
    return this.#source.title;
  }

  async seekToChapter(index: number): Promise<void> {
    const chapter = this.#chapters[index];
    if (!chapter) return;
    await this.seekToTime(chapter.start);
  }

  detachView(): void {
    // Audiobook playback has no attached view to detach.
  }

  async shutdown(): Promise<void> {
    if (!this.#terminated) {
      this.#hooks?.onEnd?.(this.#position());
    }
    this.#terminated = true;
    this.#stopTicking();
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#clock.removeEventListener('ended', this.#onEnded);
    this.#clock.removeEventListener('error', this.#onError);
    this.#clock.removeEventListener('timeupdate', this.#onTimeUpdate);
    this.#clock.destroy();
  }

  #position(): number {
    return this.#timeline.toGlobal(this.#trackIndex, this.#clock.currentTime);
  }

  async #loadGlobal(sec: number): Promise<void> {
    const { trackIndex, offset } = this.#timeline.locate(sec);
    const track = this.#tracks[trackIndex];
    if (!track) return;
    this.#trackIndex = trackIndex;
    // A load means the clock now holds a real position, whether it came from
    // start() or a seek before start() was ever called. Marking #started here
    // (not just in start()) lets a pre-start seekToTime() survive: without
    // it, the next start() would see #started still false and reload
    // source.startAt over the seek.
    this.#started = true;
    await this.#clock.load(this.#source.resolveUrl(track.contentUrl), offset);
  }

  #setState(next: PlaybackState): void {
    if (this.#state === next) return;
    this.#state = next;
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('tts-state-change', { detail: { state: next } }));
    });
  }

  #emitMark(): void {
    const chapter = this.#timeline.chapterAt(this.#position());
    const index = chapter ? this.#chapters.indexOf(chapter) : -1;
    const mark: TTSMark = {
      offset: 0,
      name: `chapter-${index}`,
      text: chapter?.title ?? this.#source.title,
      language: '',
    };
    this.#lastChapter = chapter;
    this.dispatchEvent(new CustomEvent('tts-speak-mark', { detail: mark }));
  }

  #startTicking(): void {
    if (this.#tickTimer) return;
    this.#tickTimer = setInterval(() => {
      const pos = this.#position();
      this.#hooks?.onTick?.(pos);
      this.#emitMark();
    }, TICK_INTERVAL_MS);
  }

  #stopTicking(): void {
    if (this.#tickTimer) {
      clearInterval(this.#tickTimer);
      this.#tickTimer = null;
    }
  }

  #finish(reason: 'ended' | 'error'): void {
    if (this.#terminated) return;
    this.#stopTicking();
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#clock.pause();
    this.#setState('stopped');
    this.#terminated = true;
    this.#hooks?.onEnd?.(this.#timeline.duration);
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('tts-session-ended', { detail: { reason } }));
    });
  }
}

// Kind is the only discriminator on a live PlaybackSource, never `instanceof`
// (mirrors asTTSController in TTSSessionManager.ts) - narrows a session's
// controller for the player route and NowPlayingBar's tap-through routing.
export const asAudiobookController = (
  source: PlaybackSource | null | undefined,
): AudiobookController | null =>
  source && source.kind === 'audiobook' ? (source as AudiobookController) : null;
