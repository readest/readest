// Plays the book's own recorded narration in place of synthesized speech.
//
// A TTSClient normally turns SSML into audio. This one turns SSML back into the
// SMIL pars it came from (marks are par ordinals) and plays their clips off a
// single HTMLMediaElement, reporting a boundary as each par becomes audible.
// Everything above it — transport, highlighting, scrubber, media session — is
// unchanged, which is the point.
//
// A block plays as one continuous span rather than clip-by-clip: consecutive
// pars in a paragraph are contiguous audio, and re-seeking between them would
// put an audible seam in the middle of a narrated sentence.

import type { BookDoc } from '@/libs/document';
import { stubTranslation as _ } from '@/utils/misc';
import { parseSSMLMarks } from '@/utils/ssml';
import type { TTSCapabilities, TTSClient, TTSMessageEvent } from '../TTSClient';
import type { TTSController } from '../TTSController';
import type { TTSGranularity, TTSVoice, TTSVoicesGroup } from '../types';
import type { MediaOverlaySection, NarrationPar } from './MediaOverlaySection';

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

  #book: BookDoc | null = null;
  #section: MediaOverlaySection | null = null;
  #audio: HTMLAudioElement | null = null;
  #audioHref: string | null = null;
  #objectUrl: string | null = null;
  #audioLoad: { href: string; promise: Promise<HTMLAudioElement> } | null = null;
  #currentPar: NarrationPar | null = null;
  #handoverTimer: ReturnType<typeof setTimeout> | null = null;
  #rate = 1;
  #lang = 'en';

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  async init(): Promise<boolean> {
    this.initialized = typeof Audio !== 'undefined';
    return this.initialized;
  }

  // The book supplies the audio blobs and the narrator's name. Bound once per
  // session, independently of the section, so the voice list can name the
  // narrator before any section has been indexed.
  attachBook(book: BookDoc | null): void {
    this.#book = book;
  }

  // The narration index for the section now playing; rebuilt on every section
  // change, since pars are resolved against that section's document.
  setSection(section: MediaOverlaySection | null): void {
    this.#section = section;
  }

  #narratorName(): string {
    return this.#book?.media?.narrator?.trim() || _('Book narration');
  }

  // Concurrent callers share one load. Playback and the controller's
  // preloadNextSSML(4) all ask for the same chapter file at once; without this
  // each built its own element, and each one's #releaseAudio() revoked the
  // previous URL while it was still loading.
  async #ensureAudio(href: string): Promise<HTMLAudioElement> {
    if (this.#audio && this.#audioHref === href) return this.#audio;
    if (this.#audioLoad?.href === href) return this.#audioLoad.promise;

    const promise = this.#loadAudio(href);
    this.#audioLoad = { href, promise };
    try {
      return await promise;
    } finally {
      if (this.#audioLoad?.promise === promise) this.#audioLoad = null;
    }
  }

  async #loadAudio(href: string): Promise<HTMLAudioElement> {
    if (!this.#book?.loadBlob) throw new Error('Book cannot load narration audio');

    const blob = audioBlobWithType(href, await this.#book.loadBlob(href));
    this.#releaseAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.src = url;
    // Speed changes must not raise the narrator's pitch.
    audio.preservesPitch = true;
    audio.playbackRate = this.#rate;
    this.#audio = audio;
    this.#audioHref = href;
    this.#objectUrl = url;
    return audio;
  }

  // Leave the element playing for the next block to pick up, but never
  // unattended: if nothing claims it — a one-off selection read, a session torn
  // down without stopping — silence it.
  #armHandover(audio: HTMLAudioElement): void {
    this.#cancelHandover();
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
    this.#audio?.pause();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#audio = null;
    this.#audioHref = null;
    this.#objectUrl = null;
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
  #waitUntil(audio: HTMLAudioElement, until: number, signal: AbortSignal): Promise<WaitOutcome> {
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
      // The only fetchable work is the audio file itself; warming it keeps the
      // first play of a section from stalling on a large clip read out of the
      // container. Only when nothing is loaded yet: preloading runs CONCURRENTLY
      // with playback, and loading a different file swaps the element (and
      // revokes its blob URL) out from under the clip being played.
      const href = pars[0]?.audioHref;
      if (href && !this.#audio) await this.#ensureAudio(href).catch(() => undefined);
      return;
    }

    if (!pars.length) {
      yield { code: 'end', message: 'No narration for this block' };
      return;
    }

    for (const run of toRuns(pars)) {
      if (signal.aborted) return;

      let audio: HTMLAudioElement;
      try {
        audio = await this.#ensureAudio(run.audioHref);
      } catch (e) {
        yield { code: 'error', message: e instanceof Error ? e.message : 'Narration unavailable' };
        return;
      }
      if (signal.aborted) return;

      this.#cancelHandover();
      audio.playbackRate = this.#rate;
      // Sequential narration needs no seeking: Media Overlay clips are contiguous
      // and in document order, so the element can simply keep rolling while
      // boundaries are reported as the clock passes each clip. Seeking to
      // clipBegin on every paragraph replayed the milliseconds that clip-end
      // detection had already overshot into the next clip — heard as a stutter on
      // the paragraph's first word ("me me"). Move the playhead only for a real
      // discontinuity: session start, a sentence skip, a scrub, a new audio file.
      const first = run.pars[0]!;
      const alreadyRolling =
        audio.currentTime >= first.clipBegin - CLIP_CONTINUITY_TOLERANCE_SEC &&
        audio.currentTime < first.clipEnd;
      if (!alreadyRolling) audio.currentTime = first.clipBegin;
      try {
        await audio.play();
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
        if (outcome === 'ended') {
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
    if (this.#audio) this.#armHandover(this.#audio);
    yield { code: 'end', message: 'Narration finished' };
  }

  async pause(): Promise<boolean> {
    this.#cancelHandover();
    this.#audio?.pause();
    return true;
  }

  async resume(): Promise<boolean> {
    await this.#audio?.play().catch(() => undefined);
    return true;
  }

  async stop(handover = false): Promise<void> {
    this.#currentPar = null;
    // The element and its blob URL are kept: every paragraph advance calls
    // stop(), and re-fetching the chapter's audio each time would be absurd.
    if (handover && this.#audio && !this.#audio.paused) {
      // Handing over to the next utterance of the same recording: silencing the
      // element here is what the listener hears as a gap between paragraphs.
      this.#armHandover(this.#audio);
      return;
    }
    this.#cancelHandover();
    this.#audio?.pause();
  }

  setPrimaryLang(lang: string): void {
    this.#lang = lang || 'en';
  }

  async setRate(rate: number): Promise<void> {
    this.#rate = rate;
    if (this.#audio) this.#audio.playbackRate = rate;
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
    if (!this.#book) return [];
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
    };
  }

  getChunkPosition(): number | null {
    if (!this.#audio || !this.#currentPar) return null;
    const { clipBegin, clipEnd } = this.#currentPar;
    const position = this.#audio.currentTime - clipBegin;
    return Math.min(Math.max(position, 0), clipEnd - clipBegin);
  }

  getChunkProgress(): number | null {
    if (!this.#audio || !this.#currentPar) return null;
    const { clipBegin, clipEnd } = this.#currentPar;
    const duration = clipEnd - clipBegin;
    if (duration <= 0) return null;
    const elapsed = this.#audio.currentTime - clipBegin;
    return Math.min(Math.max(elapsed / duration, 0), 1);
  }

  getVoiceId(): string {
    return MEDIA_OVERLAY_VOICE_ID;
  }

  getSpeakingLang(): string {
    return this.#lang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.#releaseAudio();
    this.#currentPar = null;
    this.#section = null;
    this.#book = null;
  }
}
