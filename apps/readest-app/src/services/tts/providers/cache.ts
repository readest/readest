// Persistent-cache decorator for any SpeechProvider. Content-addressed:
// key = hash(version, provider id, lang, voice, pitch, text) — the playback
// RATE is excluded by construction because providers never see it, which is
// what makes cached audio replayable at any speed.
//
// The store is pluggable (see the design doc: per-book SQLite database with
// section packs). Every store failure degrades to plain synthesis — the
// cache must never be able to break playback.

import { md5 } from 'js-md5';
import type { TTSWordBoundary } from '@/libs/edgeTTS';
import type { TTSVoice } from '../types';
import type { SpeechProvider, SpeechSynthesisRequest, SpeechSynthesisResult } from './types';

export interface TTSCacheEntry {
  audio: ArrayBuffer;
  boundaries: TTSWordBoundary[];
  durationMs?: number;
}

export interface TTSCacheStore {
  get(key: string): Promise<TTSCacheEntry | null>;
  put(
    key: string,
    entry: TTSCacheEntry,
    meta?: { provider?: string; voice?: string },
  ): Promise<void>;
  // Section manifest hooks (see the pack-compaction design): ordered mark
  // labels per section, and the observed synthesis key per sentence ordinal.
  registerSectionMarks?(section: number, marks: string[]): Promise<void>;
  recordMarkKey?(section: number, ordinal: number, key: string): Promise<void>;
  // Force completed sections to compact into packs now (and push if sync is
  // on), rather than waiting for the debounced timer. Used by downloads.
  // Returns the pack count (SqliteTTSCacheStore) or void (BookTTSCacheStore).
  compact?(): Promise<number | void>;
  // Per-section download status + total size, for the podcast UI.
  getSectionStatuses?(): Promise<Map<number, { total: number; recorded: number; packed: boolean }>>;
  // Per-ordinal audio durations (seconds) of a section's cached sentences for
  // one voice, boundary-derived without reading audio. Feeds the timeline's
  // duration hydration so downloaded chapters report a measured timeline.
  getSectionDurations?(section: number, voice: string): Promise<Map<number, number>>;
  totalCacheBytes?(): Promise<number>;
  // Flush and release backing resources (the per-book database handle).
  close?(): Promise<void>;
}

export const computeTTSCacheKey = (providerId: string, req: SpeechSynthesisRequest): string =>
  md5(JSON.stringify(['tts-v1', providerId, req.lang, req.voice, req.pitch, req.text]));

export class CachingProvider implements SpeechProvider {
  readonly #inner: SpeechProvider;
  readonly #store: TTSCacheStore;
  // Dedups whole get-or-synthesize flows: the playback scheduler and the
  // preloader routinely race the same sentence.
  readonly #inflight = new Map<string, Promise<SpeechSynthesisResult>>();

  constructor(inner: SpeechProvider, store: TTSCacheStore) {
    this.#inner = inner;
    this.#store = store;
  }

  get id(): string {
    return this.#inner.id;
  }

  get label(): string {
    return this.#inner.label;
  }

  get fallbackVoiceId(): string | undefined {
    return this.#inner.fallbackVoiceId;
  }

  init(): Promise<boolean> {
    return this.#inner.init();
  }

  getAllVoices(): Promise<TTSVoice[]> {
    return this.#inner.getAllVoices();
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    return this.#inner.pickDefaultVoice?.(voices);
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    if (this.#inner.cacheable === false) {
      return this.#inner.synthesize(req, signal);
    }
    const key = computeTTSCacheKey(this.#inner.id, req);
    const pending = this.#inflight.get(key);
    if (pending) {
      // Joiners get their own buffer: decodeAudioData detaches its input.
      return pending.then((result) => ({ ...result, audio: result.audio.slice(0) }));
    }
    const promise = this.#getOrSynthesize(key, req, signal);
    this.#inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      // Always cleared — a failed slot must not poison the retry path.
      this.#inflight.delete(key);
    }
  }

  async #getOrSynthesize(
    key: string,
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    try {
      const cached = await this.#store.get(key);
      if (cached) {
        return { audio: cached.audio.slice(0), boundaries: cached.boundaries };
      }
    } catch (err) {
      console.warn('TTS cache read failed; synthesizing instead', err);
    }
    const result = await this.#inner.synthesize(req, signal);
    try {
      await this.#store.put(
        key,
        { audio: result.audio, boundaries: result.boundaries },
        { provider: this.#inner.id, voice: req.voice },
      );
    } catch (err) {
      console.warn('TTS cache write failed; continuing uncached', err);
    }
    return result;
  }

  // Ordered sentence labels for a section, from the timeline enumeration.
  registerSectionManifest(section: number, marks: string[]): void {
    void this.#store.registerSectionMarks?.(section, marks).catch((err) => {
      console.warn('TTS cache manifest registration failed', err);
    });
  }

  // The sentence at this ordinal audibly played from this synthesis request;
  // record its cache key so the section can compact once fully covered.
  recordMark(section: number, ordinal: number, req: SpeechSynthesisRequest): void {
    if (this.#inner.cacheable === false) return;
    const key = computeTTSCacheKey(this.#inner.id, req);
    void this.#store.recordMarkKey?.(section, ordinal, key).catch((err) => {
      console.warn('TTS cache mark recording failed', err);
    });
  }

  async compact(): Promise<void> {
    await this.#store.compact?.();
  }

  async getSectionStatuses(): Promise<
    Map<number, { total: number; recorded: number; packed: boolean }>
  > {
    return (await this.#store.getSectionStatuses?.()) ?? new Map();
  }

  async getSectionDurations(section: number, voice: string): Promise<Map<number, number>> {
    try {
      return (await this.#store.getSectionDurations?.(section, voice)) ?? new Map();
    } catch (err) {
      console.warn('TTS cache duration read failed', err);
      return new Map();
    }
  }

  async totalCacheBytes(): Promise<number> {
    return (await this.#store.totalCacheBytes?.()) ?? 0;
  }

  async shutdown(): Promise<void> {
    await this.#inner.shutdown?.();
    try {
      await this.#store.close?.();
    } catch (err) {
      console.warn('TTS cache close failed', err);
    }
  }
}
