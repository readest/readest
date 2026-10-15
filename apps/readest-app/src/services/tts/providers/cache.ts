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
import type {
  PrefetchOptions,
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  TTSLane,
} from './types';

export interface TTSCacheEntry {
  audio: ArrayBuffer;
  boundaries: TTSWordBoundary[];
  durationMs?: number;
}

export interface TTSCacheStore {
  // Open the backing store ahead of the first lookup (no-op if it cannot yet).
  open?(): Promise<void>;
  get(key: string): Promise<TTSCacheEntry | null>;
  // Which of these keys are cached, in one lookup (a download checks a whole
  // section at once).
  cachedKeys?(keys: string[]): Promise<Set<string>>;
  // Called with the keys a synced pack brought, once it is imported.
  onImported?(listener: (keys: string[]) => void): void;
  put(
    key: string,
    entry: TTSCacheEntry,
    meta?: { provider?: string; voice?: string },
  ): Promise<void>;
  // Section manifest hooks (see the pack-compaction design): ordered mark
  // labels per section, and the observed synthesis key per sentence ordinal.
  registerSectionMarks?(section: number, marks: string[]): Promise<void>;
  recordMarkKey?(section: number, ordinal: number, key: string): Promise<void>;
  // recordMarkKey for many ordinals of a section at once.
  recordMarkKeys?(section: number, marks: { ordinal: number; key: string }[]): Promise<void>;
  beginDownloadSections?(sections: number[]): Promise<void>;
  completeDownloadSections?(sections: number[]): Promise<void>;
  cancelDownloadSections?(sections: number[]): Promise<void>;
  clearDownloads?(): Promise<void>;
  hasDownloads?(): Promise<boolean>;
  // Force completed sections to compact into packs now (and push if sync is
  // on), rather than waiting for the debounced timer. Used by downloads.
  // Returns the pack count (SqliteTTSCacheStore) or void (BookTTSCacheStore).
  compact?(): Promise<number | void>;
  // Per-section download status + total size, for the podcast UI.
  getSectionStatuses?(): Promise<
    Map<
      number,
      { total: number; recorded: number; packed: boolean; pinned: boolean; active: boolean }
    >
  >;
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

// Recently read or synthesized sentences kept in memory: a store read costs
// hundreds of ms on device, and audio fetched ahead plays from here at the
// paragraph boundary. A few minutes of speech is a few MB.
const RECENT_BYTES = 16 * 1024 * 1024;

export class CachingProvider implements SpeechProvider {
  readonly #inner: SpeechProvider;
  readonly #store: TTSCacheStore;
  // Dedups whole get-or-synthesize flows: the playback scheduler and the
  // preloader routinely race the same sentence.
  readonly #inflight = new Map<string, Promise<SpeechSynthesisResult>>();
  readonly #recent = new Map<string, SpeechSynthesisResult>();
  // The request behind each in-flight key, for #onImported.
  readonly #inflightReqs = new Map<string, SpeechSynthesisRequest>();
  #recentBytes = 0;
  // Present only for a windowed inner provider: callers feature-detect it to
  // choose windowed prefetch over synthesizing preloads.
  readonly prefetch?: SpeechProvider['prefetch'];
  readonly groupVoices?: SpeechProvider['groupVoices'];
  readonly compareVoices?: SpeechProvider['compareVoices'];

  constructor(inner: SpeechProvider, store: TTSCacheStore) {
    this.#inner = inner;
    this.#store = store;
    if (inner.prefetch) this.prefetch = this.#prefetch.bind(this);
    if (inner.groupVoices) this.groupVoices = inner.groupVoices.bind(inner);
    if (inner.compareVoices) this.compareVoices = inner.compareVoices.bind(inner);
    store.onImported?.((keys) => this.#onImported(keys));
  }

  get id(): string {
    return this.#inner.id;
  }

  #key(req: SpeechSynthesisRequest): string {
    const scope = this.#inner.cacheScope?.(req);
    return computeTTSCacheKey(scope ? `${this.#inner.id}#${scope}` : this.#inner.id, req);
  }

  get label(): string {
    return this.#inner.label;
  }

  get fallbackVoiceId(): string | undefined {
    return this.#inner.fallbackVoiceId;
  }

  get sameLanguageVoicesOnly(): boolean | undefined {
    return this.#inner.sameLanguageVoicesOnly;
  }

  init(): Promise<boolean> {
    // Opening the per-book database takes about a second on device: overlap it
    // with engine init instead of the first sentence's lookup.
    void this.#store.open?.().catch(() => {});
    return this.#inner.init();
  }

  #remember(key: string, result: SpeechSynthesisResult) {
    const old = this.#recent.get(key);
    if (old) this.#recentBytes -= old.audio.byteLength;
    this.#recent.delete(key);
    this.#recent.set(key, { audio: result.audio.slice(0), boundaries: result.boundaries });
    this.#recentBytes += result.audio.byteLength;
    for (const [oldest, entry] of this.#recent) {
      if (this.#recentBytes <= RECENT_BYTES) break;
      this.#recent.delete(oldest);
      this.#recentBytes -= entry.audio.byteLength;
    }
  }

  getAllVoices(): Promise<TTSVoice[]> {
    return this.#inner.getAllVoices();
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    return this.#inner.pickDefaultVoice?.(voices);
  }

  #prefetch(
    reqs: SpeechSynthesisRequest[],
    lane: TTSLane,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): void {
    if (this.#inner.cacheable === false) {
      this.#inner.prefetch?.(reqs, lane, signal, options);
      return;
    }
    void this.#prefetchUncached(reqs, lane, signal, options);
  }

  async #prefetchUncached(
    reqs: SpeechSynthesisRequest[],
    lane: TTSLane,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): Promise<void> {
    const uncached: SpeechSynthesisRequest[] = [];
    const toFill: SpeechSynthesisRequest[] = [];
    // A caller that needs no cached audio back (a download) checks the whole
    // batch in one lookup instead of reading each sentence.
    const cachedKeys =
      this.#store.cachedKeys && !options?.onDelivered
        ? await this.#store
            .cachedKeys(reqs.map((req) => this.#key(req)))
            .catch(() => new Set<string>()) // Unreadable store: treat as uncached.
        : null;
    for (const req of reqs) {
      const key = this.#key(req);
      // Already being filled: still forwarded, so the provider can raise a
      // preload's priority once its paragraph starts.
      if (this.#inflight.has(key)) {
        uncached.push(req);
        continue;
      }
      if (cachedKeys) {
        if (this.#recent.has(key) || cachedKeys.has(key)) continue;
      } else {
        try {
          const cached = this.#recent.get(key) ?? (await this.#store.get(key));
          if (cached) {
            this.#remember(key, cached);
            options?.onDelivered?.(req, { audio: cached.audio, boundaries: cached.boundaries });
            continue;
          }
        } catch {
          // Unreadable store: treat as uncached.
        }
      }
      uncached.push(req);
      toFill.push(req);
    }
    if (signal.aborted || uncached.length === 0) return;
    this.#inner.prefetch?.(uncached, lane, signal, options);
    // Persist every sentence as it arrives, even one playback never asks for
    // (stop, seek): it was synthesized and paid for, so keep it.
    for (const req of toFill) {
      this.synthesize(req, signal, options).catch(() => {});
    }
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): Promise<SpeechSynthesisResult> {
    if (this.#inner.cacheable === false) {
      return this.#inner.synthesize(req, signal, options);
    }
    const key = this.#key(req);
    const pending = this.#inflight.get(key);
    if (pending) {
      // Joiners get their own buffer: decodeAudioData detaches its input.
      return pending.then((result) => ({ ...result, audio: result.audio.slice(0) }));
    }
    const promise = this.#getOrSynthesize(key, req, signal, options);
    this.#inflight.set(key, promise);
    this.#inflightReqs.set(key, req);
    try {
      return await promise;
    } finally {
      // Always cleared — a failed slot must not poison the retry path.
      this.#inflight.delete(key);
      this.#inflightReqs.delete(key);
    }
  }

  async #getOrSynthesize(
    key: string,
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): Promise<SpeechSynthesisResult> {
    const recent = this.#recent.get(key);
    if (recent) return this.#served(req, recent);
    try {
      const cached = await this.#store.get(key);
      if (cached) {
        this.#remember(key, cached);
        return this.#served(req, cached);
      }
    } catch (err) {
      console.warn('TTS cache read failed; synthesizing instead', err);
    }
    const result = await this.#inner.synthesize(req, signal, options);
    this.#remember(key, result);
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

  // A synced pack arrived after these sentences' own lookups missed: the
  // provider need not synthesize the ones still in flight.
  #onImported(keys: string[]): void {
    for (const key of keys) {
      const req = this.#inflightReqs.get(key);
      if (!req) continue;
      void this.#store
        .get(key)
        .then((cached) => {
          if (cached) this.#served(req, cached);
        })
        .catch(() => {});
    }
  }

  // A sentence served from the cache may still be pending in the provider
  // (prefetched before a synced pack brought it): it need not synthesize it.
  #served(req: SpeechSynthesisRequest, cached: SpeechSynthesisResult): SpeechSynthesisResult {
    this.#inner.fulfill?.(req, { audio: cached.audio.slice(0), boundaries: cached.boundaries });
    return { audio: cached.audio.slice(0), boundaries: cached.boundaries };
  }

  // A download's sentences already stored, with their marks recorded, for a
  // whole section in a few queries. Only stored audio counts: what is only
  // in memory cannot pack.
  async cachedSentences(
    section: number,
    sentences: { ordinal: number; req: SpeechSynthesisRequest }[],
  ): Promise<Set<number>> {
    if (this.#inner.cacheable === false || !this.#store.cachedKeys || !this.#store.recordMarkKeys) {
      return new Set();
    }
    const keyed = sentences.map(({ ordinal, req }) => ({
      ordinal,
      key: this.#key(req),
    }));
    try {
      const stored = await this.#store.cachedKeys(keyed.map(({ key }) => key));
      const hits = keyed.filter(({ key }) => stored.has(key));
      if (hits.length) await this.#store.recordMarkKeys(section, hits);
      return new Set(hits.map(({ ordinal }) => ordinal));
    } catch {
      // Unreadable store: synthesize as if nothing were cached.
      return new Set();
    }
  }

  // Ordered sentence labels for a section, from the timeline enumeration.
  async registerSectionManifest(section: number, marks: string[]): Promise<void> {
    await this.#store.registerSectionMarks?.(section, marks).catch((err) => {
      console.warn('TTS cache manifest registration failed', err);
    });
  }

  // The sentence at this ordinal audibly played from this synthesis request;
  // record its cache key so the section can compact once fully covered.
  async recordMark(section: number, ordinal: number, req: SpeechSynthesisRequest): Promise<void> {
    if (this.#inner.cacheable === false) return;
    const key = this.#key(req);
    await this.#store.recordMarkKey?.(section, ordinal, key).catch((err) => {
      console.warn('TTS cache mark recording failed', err);
    });
  }

  async beginDownloadSections(sections: number[]): Promise<void> {
    await this.#store.beginDownloadSections?.(sections);
  }

  async completeDownloadSections(sections: number[]): Promise<void> {
    await this.#store.completeDownloadSections?.(sections);
  }

  async cancelDownloadSections(sections: number[]): Promise<void> {
    await this.#store.cancelDownloadSections?.(sections);
  }

  async clearDownloads(): Promise<void> {
    await this.#store.clearDownloads?.();
    // Audio kept in memory would be served without reaching the store again,
    // so a re-downloaded section could never pack.
    this.#recent.clear();
    this.#recentBytes = 0;
  }

  async compact(): Promise<void> {
    await this.#store.compact?.();
  }

  async getSectionStatuses(): Promise<
    Map<
      number,
      { total: number; recorded: number; packed: boolean; pinned: boolean; active: boolean }
    >
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
