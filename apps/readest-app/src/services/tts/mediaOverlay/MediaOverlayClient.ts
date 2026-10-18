// Plays the book's own recorded narration in place of synthesized speech.
//
// A TTSClient normally turns SSML into audio. This one turns SSML back into the
// SMIL pars it came from (marks are par ordinals) and plays their clips off a
// single media clock, reporting a boundary as each par becomes audible.
// Everything above it — transport, highlighting, scrubber, media session — is
// unchanged, which is the point.
//
// A block plays as one continuous span rather than clip-by-clip: consecutive
// pars in a paragraph are contiguous audio, and re-seeking between them would
// put an audible seam in the middle of a narrated sentence.
//
// On mobile Tauri the clock is an in-process native player
// (NativeNarrationPlayer). iOS needs it so TTSMediaBridge and narration share
// one playback session; Android needs it so multi-hour local files can stream
// from disk without buffering the whole audiobook through the WebView.
// Desktop and web use a plain HTMLAudioElement.
//
// A source whose recording is split across several files (an Audiobookshelf
// item's tracks) hands over a track list instead, and MultiTrackNarrationClock
// presents those files as one timeline on top of the same per-platform player.

import type { BookDoc } from '@/libs/document';
import { BlobAudioClock, HtmlAudioClock } from '@/services/audiobook/AudiobookClock';
import { getOSPlatform, stubTranslation as _ } from '@/utils/misc';
import { parseSSMLMarks } from '@/utils/ssml';
import type { TTSCapabilities, TTSClient, TTSMessageEvent } from '../TTSClient';
import type { TTSController } from '../TTSController';
import type { TTSGranularity, TTSVoice, TTSVoicesGroup } from '../types';
import type { MediaOverlaySection, NarrationPar } from './MediaOverlaySection';
import {
  MultiTrackNarrationClock,
  type NarrationTrack,
  type NarrationTrackPlayer,
} from './MultiTrackNarrationClock';
import type { NarrationClock } from './NarrationClock';
import { AudioHandover } from './AudioHandover';
import { NativeNarrationPlayer } from './NativeNarrationPlayer';

export const MEDIA_OVERLAY_CLIENT_NAME = 'media-overlay';
export const MEDIA_OVERLAY_VOICE_ID = 'media-overlay';

// Polling backstop for the media clock. 'timeupdate' alone fires only ~4x/sec,
// too coarse for word-level narration; the interval keeps boundaries tight in
// the foreground while 'timeupdate' and 'ended' keep them arriving when timers
// are throttled with the screen off.
const CLOCK_POLL_MS = 50;

type WaitOutcome = 'reached' | 'ended' | 'aborted' | 'error';

// How far the playhead may sit from a clip's start and still count as "already
// rolling into it" rather than needing a seek. Covers the few milliseconds that
// polling overshoots a clip end by, plus pause/resume latency, while staying
// under the length of even a word-level clip.
const CLIP_CONTINUITY_TOLERANCE_SEC = 0.3;

// How long the element may keep playing after a block ends while waiting for the
// next block to claim it. Long enough that a normal handover is never cut short,
// short enough that narration can never be left running unattended.
const HANDOVER_GRACE_MS = 1000;

// Inline of isTauriAppPlatform(): importing @/services/environment pulls the
// app-service graph into unit tests that only need the platform bit.
const isNativeNarrationPlatform = (): boolean =>
  ['android', 'ios'].includes(getOSPlatform()) &&
  process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';

// Container blobs come out of the zip with no MIME type, and a media element
// given a typeless blob URL refuses to decode it ("Format error"), so the type
// has to be supplied from the file name. Covers the formats EPUB Media Overlays
// audio realistically uses.
const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

const audioBlobWithType = (href: string, blob: Blob): Blob => {
  if (blob.type) return blob;
  const ext = href.split('.').pop()?.toLowerCase() ?? '';
  return new Blob([blob], { type: AUDIO_MIME_TYPES[ext] ?? 'audio/mpeg' });
};

interface ClipRun {
  audioHref: string;
  pars: NarrationPar[];
}

interface LoadedAudio {
  href: string;
  clock: NarrationClock;
  /** Object URL owned by this slot, if the source had to be read as a blob. */
  objectUrl: string | null;
  joined?: boolean;
}

export interface NarrationAudioSource {
  narrator?: string;
  textHighlight?: boolean;
  loadBlob: (href: string) => Promise<Blob>;
  resolveUrl?: (href: string) => Promise<string | null>;
  resolvePath?: (href: string) => Promise<string | null>;
  // A recording split across several streamable files, timed on one global
  // clock. Takes precedence over the single-file resolvers when it returns
  // tracks.
  resolveTracks?: (href: string) => Promise<NarrationTrack[] | null>;
  // Fetches one track's bytes, for a server whose audio a media element cannot
  // load from its URL at all (BookOrbit sends `Cross-Origin-Resource-Policy:
  // same-origin`). The track list then carries paths rather than URLs, and the
  // composite plays them from blobs, one at a time.
  loadTrack?: (path: string) => Promise<Blob>;
}

const seekClock = async (audio: NarrationClock, seconds: number): Promise<void> => {
  // A native or multi-file seek is async (plugin invoke, file switch);
  // assigning currentTime alone can race with play() and start from the
  // previous playhead.
  if (audio.seek) await audio.seek(seconds);
  else audio.currentTime = seconds;
};

const setClockRate = async (audio: NarrationClock, rate: number): Promise<void> => {
  if (audio.setRate) await audio.setRate(rate);
  else audio.playbackRate = rate;
};

// The shared native player as a per-track player: each track loads by URL
// under the same href, so the native session survives file switches.
const nativeTrackPlayer = (player: NativeNarrationPlayer, href: string): NarrationTrackPlayer => ({
  get currentTime() {
    return player.currentTime;
  },
  set currentTime(seconds: number) {
    player.currentTime = seconds;
  },
  get playbackRate() {
    return player.playbackRate;
  },
  set playbackRate(rate: number) {
    player.playbackRate = rate;
  },
  get paused() {
    return player.paused;
  },
  load: (url, startAt) => player.loadPath(href, url, startAt),
  play: () => player.play(),
  pause: () => player.pause(),
  seek: (seconds) => player.seek(seconds),
  setRate: (rate) => player.setRate(rate),
  addEventListener: (type, fn) => player.addEventListener(type, fn),
  removeEventListener: (type, fn) => player.removeEventListener(type, fn),
});

// Consecutive pars sharing an audio file. Normally one run per block; a run
// boundary means the publisher split the paragraph across files.
const toRuns = (pars: NarrationPar[]): ClipRun[] => {
  const runs: ClipRun[] = [];
  for (const par of pars) {
    const last = runs.at(-1);
    if (last && last.audioHref === par.audioHref) last.pars.push(par);
    else runs.push({ audioHref: par.audioHref, pars: [par] });
  }
  return runs;
};

export class MediaOverlayClient implements TTSClient {
  name = MEDIA_OVERLAY_CLIENT_NAME;
  initialized = false;
  controller?: TTSController;

  #source: NarrationAudioSource | null = null;
  #section: MediaOverlaySection | null = null;
  #native = isNativeNarrationPlatform();
  #player: NativeNarrationPlayer | null = null;
  #audio: LoadedAudio | null = null;
  #nextAudio: LoadedAudio | null = null;
  #queuedHandover: AudioHandover | null = null;
  #autoQueue = true;
  #userPaused = false;
  #audioLoad: { href: string; token: number; promise: Promise<LoadedAudio> } | null = null;
  #nextAudioLoad: { href: string; token: number; promise: Promise<LoadedAudio> } | null = null;
  #audioLoadToken = 0;
  #nextAudioToken = 0;
  #currentPar: NarrationPar | null = null;
  // Last par the recording actually rode, kept across the handover that ends
  // every block (unlike #currentPar) so speak() can tell a stalled cursor
  // catching up from a navigation backwards. Cleared with the clock itself.
  #playedPar: NarrationPar | null = null;
  #nextChunkPosition: number | null = null;
  #handoverTimer: ReturnType<typeof setTimeout> | null = null;
  #rate = 1;
  #lang = 'en';

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  async init(): Promise<boolean> {
    if (this.#native) {
      // Re-entering narration after Edge/system must not orphan the existing
      // player (and its staged chapter file / event listener).
      if (!this.#player) this.#player = new NativeNarrationPlayer();
      this.initialized = true;
      return true;
    }
    this.initialized = typeof Audio !== 'undefined';
    return this.initialized;
  }

  // The book supplies the audio blobs and the narrator's name. Bound once per
  // session, independently of the section, so the voice list can name the
  // narrator before any section has been indexed.
  attachBook(book: BookDoc | null): void {
    this.attachSource(
      book?.loadBlob
        ? {
            narrator: book.media?.narrator,
            loadBlob: (href) => book.loadBlob!(href),
          }
        : null,
    );
  }

  // External audiobook files use the same clock and clip machinery as EPUB
  // Media Overlays; only the blob provider and narrator label differ.
  attachSource(source: NarrationAudioSource | null): void {
    this.#source = source;
    this.#nextChunkPosition = null;
  }

  // The narration index for the section now playing; rebuilt on every section
  // change, since pars are resolved against that section's document.
  setSection(section: MediaOverlaySection | null): void {
    this.#section = section;
  }

  #narratorName(): string {
    return this.#source?.narrator?.trim() || _('Book narration');
  }

  // A current clock and one standby clock are deliberately separate. Loading a
  // different EPUB audio member into the current element is what used to make
  // Readest wait at every Storyteller split: the old file was released first,
  // then the next file was fetched. The standby slot lets that fetch happen
  // while the current narration is still audible.
  async #ensureAudio(href: string): Promise<NarrationClock> {
    if (this.#audio?.href === href) return this.#audio.clock;

    if (this.#nextAudio?.href === href) {
      return this.#activateAudio(this.#nextAudio).clock;
    }

    const nextLoad = this.#nextAudioLoad;
    if (nextLoad?.href === href) {
      const loaded = await nextLoad.promise.catch(() => null);
      if (loaded) {
        if (this.#audio?.href === href) return this.#audio.clock;
        if (this.#nextAudio === loaded) return this.#activateAudio(loaded).clock;
        // The preloader owns disposal until the standby is adopted.
        throw new Error('Narration preload superseded');
      }
      // A failed speculative read is retried by the foreground load below.
      if (this.#nextAudioLoad?.token === nextLoad.token) this.#nextAudioLoad = null;
    }

    // A user navigation to a different member supersedes the old standby.
    // The in-flight read cannot be cancelled by every EPUB source, so its
    // completion is token-checked and the resulting clock is disposed.
    this.#discardNextAudio();
    const activeLoad = this.#audioLoad;
    if (activeLoad?.href === href) {
      const loaded = await activeLoad.promise;
      if (this.#audio?.href === href) return this.#audio.clock;
      if (this.#audioLoad?.token !== activeLoad.token) {
        this.#disposeAudio(loaded);
        throw new Error('Narration load superseded');
      }
      return this.#activateAudio(loaded).clock;
    }

    const promise = this.#loadAudio(href);
    const token = ++this.#audioLoadToken;
    this.#audioLoad = { href, token, promise };
    try {
      const loaded = await promise;
      if (this.#audioLoad?.token !== token) {
        this.#disposeAudio(loaded);
        throw new Error('Narration load superseded');
      }
      return this.#activateAudio(loaded).clock;
    } finally {
      if (this.#audioLoad?.promise === promise) this.#audioLoad = null;
    }
  }

  async #loadAudio(href: string): Promise<LoadedAudio> {
    const source = this.#source;
    if (!source) throw new Error('Book cannot load narration audio');

    const tracks = await source.resolveTracks?.(href).catch(() => null);
    if (tracks?.length) {
      let player: NarrationTrackPlayer;
      if (this.#native && this.#player) {
        // NativeNarrationPlayer owns one playout session; replacing its
        // current item must wait until the handover.
        this.#cancelHandover();
        player = nativeTrackPlayer(this.#player, href);
      } else {
        // A source with a blob loader may still resolve real URLs (BookOrbit
        // does when the media proxy is up), and those stream and seek, so the
        // blob clock is only for the tracks that are not URLs.
        const loadTrack = source.loadTrack;
        const streamable = tracks.every((track) => /^https?:\/\//.test(track.url));
        player = loadTrack && !streamable ? new BlobAudioClock(loadTrack) : new HtmlAudioClock();
      }
      const clock = new MultiTrackNarrationClock(tracks, player);
      await clock.setRate(this.#rate);
      return { href, clock, objectUrl: null };
    }

    if (this.#native && this.#player) {
      const path = await source.resolvePath?.(href).catch(() => null);
      // Keep any prior native session's file until the new one is staged; load()
      // replaces the AVPlayer item. Do not call #releaseAudio (that aborts).
      this.#cancelHandover();
      const joined = this.#player.queuedStarted;
      if (path) {
        await this.#player.loadPath(href, path, 0);
      } else if (!(await this.#player.loadPrepared(href, 0))) {
        const blob = audioBlobWithType(href, await source.loadBlob(href));
        await this.#player.load(href, blob, 0);
      }
      this.#player.playbackRate = this.#rate;
      if (!joined) this.#player.pause();
      return { href, clock: this.#player, objectUrl: null, joined };
    }

    const directUrl = await source.resolveUrl?.(href).catch(() => null);
    let url = directUrl ?? null;
    let objectUrl: string | null = null;
    if (!url) {
      const blob = audioBlobWithType(href, await source.loadBlob(href));
      url = URL.createObjectURL(blob);
      objectUrl = url;
    }
    const clock = new HtmlAudioClock();
    try {
      await clock.load(url, 0);
      clock.playbackRate = this.#rate;
      return { href, clock, objectUrl };
    } catch (error) {
      clock.destroy();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  #activateAudio(loaded: LoadedAudio): LoadedAudio {
    if (this.#audio === loaded) return loaded;
    this.#cancelHandover();
    const previous = this.#audio;
    this.#audio = loaded;
    if (this.#nextAudio === loaded) {
      loaded.joined = this.#queuedHandover?.started;
      this.#queuedHandover?.cancel();
      this.#queuedHandover = null;
      this.#nextAudio = null;
    }
    if (previous && previous !== loaded && previous.clock !== loaded.clock)
      this.#disposeAudio(previous);
    return loaded;
  }

  #disposeAudio(loaded: LoadedAudio): void {
    loaded.clock.pause();
    loaded.clock.destroy?.();
    if (loaded.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
  }

  #discardNextAudio(): void {
    this.#queuedHandover?.cancel();
    this.#queuedHandover = null;
    this.#nextAudioToken += 1;
    if (this.#nextAudio) this.#disposeAudio(this.#nextAudio);
    this.#nextAudio = null;
    this.#nextAudioLoad = null;
  }

  // Warm one future member. TTSController calls speak(..., preload) for the
  // next several paragraphs; only the first different member is kept, so this
  // does not download the entire book ahead of the listener.
  async #preloadAudio(href: string): Promise<void> {
    if (this.#audio?.href === href || this.#nextAudio || this.#nextAudioLoad) return;
    if (!this.#audio) {
      await this.#ensureAudio(href).catch(() => undefined);
      return;
    }
    // Mobile has one shared native player. Prepare the EPUB member on disk,
    // without replacing its current item or changing the live session.
    if (this.#native) {
      const source = this.#source;
      if (source && !source.resolvePath && !source.resolveTracks) {
        await this.#player?.preload(href, () => source.loadBlob(href));
      }
      return;
    }

    const token = ++this.#nextAudioToken;
    const promise = this.#loadAudio(href);
    this.#nextAudioLoad = { href, token, promise };
    try {
      const loaded = await promise;
      if (this.#nextAudioLoad?.token === token) {
        this.#nextAudio = loaded;
        this.#nextAudioLoad = null;
      } else {
        this.#disposeAudio(loaded);
      }
    } catch {
      if (this.#nextAudioLoad?.token === token) this.#nextAudioLoad = null;
    }
  }

  // Preparation and queuing share the same reading-order boundaries on every
  // platform. Only the clock adapter decides how its player queues the member.
  async #preparePars(pars: NarrationPar[], crossSection = false, autoQueue = true): Promise<void> {
    const target = pars.find((par) => par.audioHref !== this.#audio?.href);
    if (!target) return;
    await this.#preloadAudio(target.audioHref);
    if (!autoQueue || !this.#autoQueue || !this.#audio || target.audioHref === this.#audio.href)
      return;
    const all = this.#section?.pars ?? [];
    const index = all.indexOf(target);
    const outgoing = crossSection ? all.at(-1) : all[index - 1];
    if (!outgoing || outgoing.audioHref !== this.#audio.href) return;
    const following = crossSection ? pars : all.slice(index);
    let end = target.clipEnd;
    for (const par of following) {
      if (par.audioHref !== target.audioHref) break;
      end = par.clipEnd;
    }
    if (this.#native) {
      await this.#player?.queuePrepared(outgoing.clipEnd, target.clipBegin, end);
    } else if (this.#nextAudio?.href === target.audioHref && !this.#queuedHandover) {
      this.#queuedHandover = new AudioHandover(
        this.#audio.clock,
        this.#nextAudio.clock,
        outgoing.clipEnd,
        target.clipBegin,
        () => !this.#userPaused,
      );
    }
  }

  setAutoQueue(enabled: boolean): void {
    this.#autoQueue = enabled;
    if (!enabled) {
      this.#queuedHandover?.cancel();
      this.#queuedHandover = null;
      this.#player?.cancelQueued();
    }
  }

  async preloadSection(section: MediaOverlaySection | null, autoQueue = true): Promise<void> {
    if (section) await this.#preparePars(section.pars, true, autoQueue);
  }

  // Leave the element playing for the next block to pick up, but never
  // unattended: if nothing claims it — a one-off selection read, a session torn
  // down without stopping — silence it.
  #armHandover(audio: NarrationClock): void {
    this.#cancelHandover();
    // Prime the audio before yielding control to chapter/page navigation, even
    // when the utterance's 50 ms poll wins over the queue's 10 ms backstop.
    this.#queuedHandover?.advance();
    if (this.#queuedHandover || this.#player?.queued) return;
    this.#handoverTimer = setTimeout(() => {
      this.#handoverTimer = null;
      audio.pause();
    }, HANDOVER_GRACE_MS);
  }

  #cancelHandover(): void {
    if (this.#handoverTimer === null) return;
    clearTimeout(this.#handoverTimer);
    this.#handoverTimer = null;
  }

  #releaseAudio(): void {
    this.#cancelHandover();
    this.#discardNextAudio();
    this.#audioLoadToken += 1;
    if (this.#audio) this.#disposeAudio(this.#audio);
    this.#audio = null;
    this.#audioLoad = null;
    this.#playedPar = null;
    if (this.#native && this.#player) {
      void this.#player.release();
    }
  }

  // Drop the cached clock without tearing the client down. Needed when another
  // TTS engine takes the shared iOS playout AVPlayer (Edge abort): otherwise
  // speak() reuses a dead session and plays silence after switching back.
  invalidatePlayback(): void {
    this.#cancelHandover();
    // #cancelHandover just killed the timer that would have silenced a rolling
    // element, and the reference is dropped below — silence it here or the
    // recording plays on under the engine that took over.
    this.#discardNextAudio();
    this.#audioLoadToken += 1;
    const active = this.#audio;
    if (active) this.#disposeAudio(active);
    this.#currentPar = null;
    this.#playedPar = null;
    this.#audioLoad = null;
    this.#audio = null;
    if (this.#native && this.#player) {
      this.#player.invalidateSession();
    }
  }

  // Resolve the marks the controller is asking for back to narration units.
  // Marks with no par (dropped as unhighlightable, or filtered out of the SSML)
  // are skipped rather than stalling playback.
  #parsFor(ssml: string): NarrationPar[] {
    const section = this.#section;
    if (!section) return [];
    const { marks } = parseSSMLMarks(ssml, this.#lang);
    const pars: NarrationPar[] = [];
    for (const mark of marks) {
      const par = section.parByMark(mark.name);
      if (par && par !== pars.at(-1)) pars.push(par);
    }
    return pars;
  }

  // Resolve once the clock reaches `until`, or once playback ends, fails, or is
  // aborted. Listeners are registered synchronously so no tick can be missed.
  #waitUntil(audio: NarrationClock, until: number, signal: AbortSignal): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve) => {
      let done = false;
      const finish = (outcome: WaitOutcome) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        audio.removeEventListener('timeupdate', check);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      const check = () => {
        if (signal.aborted) return finish('aborted');
        if (audio.currentTime >= until) finish('reached');
      };
      const onEnded = () => finish('ended');
      const onError = () => finish('error');
      const onAbort = () => finish('aborted');

      const timer = setInterval(check, CLOCK_POLL_MS);
      audio.addEventListener('timeupdate', check);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      signal.addEventListener('abort', onAbort);
      check();
    });
  }

  async *speak(
    ssml: string,
    signal: AbortSignal,
    preload = false,
  ): AsyncGenerator<TTSMessageEvent> {
    const pars = this.#parsFor(ssml);

    if (preload) {
      // Warm the next split member in a standby clock. It is important that
      // this is allowed while another member is playing: putting the new src
      // on the active element is the gap we are fixing.
      await this.#preparePars(pars);
      return;
    }

    if (!pars.length) {
      yield { code: 'end', message: 'No narration for this block' };
      return;
    }

    this.#userPaused = false;
    const runs = toRuns(pars);
    const requestedStart = this.#nextChunkPosition;
    this.#nextChunkPosition = null;
    for (const [runIndex, run] of runs.entries()) {
      if (signal.aborted) return;

      let audio: NarrationClock;
      try {
        audio = await this.#ensureAudio(run.audioHref);
      } catch (e) {
        yield { code: 'error', message: e instanceof Error ? e.message : 'Narration unavailable' };
        return;
      }
      if (signal.aborted) return;

      this.#cancelHandover();
      const followingRun = runs[runIndex + 1];
      if (followingRun) void this.#preparePars(followingRun.pars);
      await setClockRate(audio, this.#rate);
      // Sequential narration needs no seeking: Media Overlay clips are contiguous
      // and in document order, so the element can simply keep rolling while
      // boundaries are reported as the clock passes each clip. Seeking to
      // clipBegin on every paragraph replayed the milliseconds that clip-end
      // detection had already overshot into the next clip — heard as a stutter on
      // the paragraph's first word ("me me"). Move the playhead only for a real
      // discontinuity: session start, a sentence skip, a scrub, a new audio file.
      const first = run.pars[0]!;
      const requestedPosition =
        runIndex === 0 && requestedStart !== null
          ? first.clipBegin + Math.min(Math.max(requestedStart, 0), first.clipEnd - first.clipBegin)
          : null;
      const playhead = audio.currentTime;
      const alreadyRolling =
        playhead >= first.clipBegin - CLIP_CONTINUITY_TOLERANCE_SEC && playhead < first.clipEnd;
      // ...and the recording can be further along still. The native mobile
      // player runs in-process rather than in the WebView, so it keeps playing
      // while the WebView's main thread is stalled or its timers throttled (a
      // page-turn relayout, a section preload, the screen off) and the block
      // cursor — advanced by a JS poll of this clock — falls a paragraph or
      // more behind. Seeking back to clipBegin then replays audio the listener
      // has already heard. The recording is the master clock: leave it rolling
      // and let the marks catch up as the clip loop walks the passed pars.
      // Only clips strictly after the last one played count, so a deliberate
      // backward navigation — and a replay of the par just heard — still seeks.
      const ranPastWhileStalled =
        playhead >= first.clipEnd &&
        this.#playedPar?.audioHref === first.audioHref &&
        first.clipBegin > this.#playedPar.clipBegin;
      const joinedQueue = this.#audio?.joined;
      if (this.#audio) this.#audio.joined = false;
      if (requestedPosition !== null || !(joinedQueue || alreadyRolling || ranPastWhileStalled)) {
        await seekClock(audio, requestedPosition ?? first.clipBegin);
      }
      try {
        if (!joinedQueue || audio.paused) await audio.play();
      } catch (e) {
        // An autoplay rejection is terminal for this attempt; the session's
        // gesture-time unblockAudio() is what normally prevents it.
        yield { code: 'error', message: e instanceof Error ? e.message : 'Playback blocked' };
        return;
      }

      for (const par of run.pars) {
        if (signal.aborted) {
          audio.pause();
          return;
        }
        this.#currentPar = par;
        this.#playedPar = par;
        this.controller?.dispatchSpeakMark({
          offset: 0,
          name: par.markName,
          text: par.text,
          language: this.#lang,
        });
        yield { code: 'boundary', mark: par.markName, message: 'narration' };

        const outcome = await this.#waitUntil(audio, par.clipEnd, signal);
        if (outcome === 'aborted') {
          audio.pause();
          return;
        }
        if (outcome === 'error') {
          yield { code: 'error', message: 'Narration playback failed' };
          return;
        }
        // The file ran out: nothing left of this block to play.
        if (outcome === 'ended' && !this.#queuedHandover?.started && !this.#player?.queuedStarted) {
          audio.pause();
          yield { code: 'end', message: 'Narration finished' };
          return;
        }
      }
    }

    // The block's clips are done, but the recording continues into the next
    // paragraph, so the element keeps playing and the next block joins it in
    // progress. Pausing here — and again in the controller's pre-speak stop —
    // was putting a gap at every paragraph boundary, which on Android also costs
    // a buffer flush. The watchdog covers the case where no next block comes.
    if (this.#audio) this.#armHandover(this.#audio.clock);
    yield { code: 'end', message: 'Narration finished' };
  }

  async pause(): Promise<boolean> {
    this.#userPaused = true;
    this.#cancelHandover();
    this.#audio?.clock.pause();
    if (this.#queuedHandover?.started) this.#nextAudio?.clock.pause();
    return true;
  }

  async resume(): Promise<boolean> {
    this.#userPaused = false;
    const clock = this.#queuedHandover?.started ? this.#nextAudio?.clock : this.#audio?.clock;
    await clock?.play().catch(() => undefined);
    return true;
  }

  async stop(handover = false): Promise<void> {
    if (!handover) this.#userPaused = true;
    this.#currentPar = null;
    // The element and its blob URL are kept: every paragraph advance calls
    // stop(), and re-fetching the chapter's audio each time would be absurd.
    if (
      handover &&
      this.#audio &&
      (!this.#audio.clock.paused || this.#queuedHandover || this.#player?.queued)
    ) {
      // Handing over to the next utterance of the same recording: silencing the
      // element here is what the listener hears as a gap between paragraphs.
      this.#armHandover(this.#audio.clock);
      return;
    }
    this.#cancelHandover();
    this.#audio?.clock.pause();
    if (this.#queuedHandover?.started) this.#nextAudio?.clock.pause();
    this.#discardNextAudio();
    if (this.#player?.queuedStarted) this.#audio = null;
    this.#player?.cancelQueued();
  }

  setPrimaryLang(lang: string): void {
    this.#lang = lang || 'en';
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = rate;
    // Await the native set-rate invoke: assigning playbackRate alone was
    // fire-and-forget, so stop→setRate→start (and live changes) raced play()
    // and left AVPlayer at the previous rate until the next voice switch.
    if (this.#audio) {
      await setClockRate(this.#audio.clock, rate);
    } else if (this.#native && this.#player) {
      await this.#player.setRate(rate);
    }
  }

  async setPitch(_pitch: number): Promise<void> {
    // A recording has the narrator's pitch; nothing to set.
  }

  async setVoice(_voice: string): Promise<void> {
    // The narration is the voice.
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return this.#voices();
  }

  async getVoices(_lang: string): Promise<TTSVoicesGroup[]> {
    return [
      {
        id: 'media-overlay',
        name: _('Narration'),
        voices: this.#voices(),
      },
    ];
  }

  #voices(): TTSVoice[] {
    if (!this.#source) return [];
    return [{ id: MEDIA_OVERLAY_VOICE_ID, name: this.#narratorName(), lang: this.#lang }];
  }

  getGranularities(): TTSGranularity[] {
    // The recording's own sync granularity decides the unit; nothing to choose.
    return ['sentence'];
  }

  getCapabilities(): TTSCapabilities {
    return {
      // Media Overlays time whole elements. When the publisher marked words,
      // those elements ARE words and the sentence highlight is a word
      // highlight; interpolating within a clip would only invent drift.
      wordBoundaries: false,
      mediaClock: true,
      gapControl: false,
      liveRateChange: true,
      continuousTimeline: true,
      textHighlight: this.#source?.textHighlight !== false,
    };
  }

  setNextChunkPosition(seconds: number): void {
    this.#nextChunkPosition = Number.isFinite(seconds) ? Math.max(seconds, 0) : null;
  }

  getChunkPosition(): number | null {
    if (!this.#audio || !this.#currentPar) return null;
    const { clipBegin, clipEnd } = this.#currentPar;
    const position = this.#audio.clock.currentTime - clipBegin;
    return Math.min(Math.max(position, 0), clipEnd - clipBegin);
  }

  getChunkProgress(): number | null {
    if (!this.#audio || !this.#currentPar) return null;
    const { clipBegin, clipEnd } = this.#currentPar;
    const duration = clipEnd - clipBegin;
    if (duration <= 0) return null;
    const elapsed = this.#audio.clock.currentTime - clipBegin;
    return Math.min(Math.max(elapsed / duration, 0), 1);
  }

  async seekToChunkPosition(seconds: number): Promise<boolean> {
    const audio = this.#audio?.clock;
    const par = this.#currentPar;
    if (!audio || !par) return false;
    const within = Math.min(Math.max(seconds, 0), par.clipEnd - par.clipBegin);
    await seekClock(audio, par.clipBegin + within);
    return true;
  }

  getVoiceId(): string {
    return MEDIA_OVERLAY_VOICE_ID;
  }

  getSpeakingLang(): string {
    return this.#lang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    const player = this.#player;
    this.#player = null;
    this.#releaseAudio();
    if (player) await player.shutdown();
    this.#currentPar = null;
    this.#section = null;
    this.#source = null;
  }
}
