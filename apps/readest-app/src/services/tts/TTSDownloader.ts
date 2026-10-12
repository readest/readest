// Headless pre-synthesis of TTS audio for offline use (design section 10 in
// .agents/plans/2026-07-13-tts-cache-sqlite-packs.md). Given a set of
// sections, it walks each section's sentences through the SAME synthesis
// pipeline as live playback — minus the audio — populating the per-book
// cache and recording the section manifest so the sections compact into
// downloadable packs.
//
// The foliate/document coupling is isolated behind SectionEnumerator (the
// live pipeline: per-block SSML -> proofread preprocess -> parseSSMLMarks ->
// per-mark language/text, ordered and labelled identically to what playback
// produces). CacheWarmer is the client. This module owns only the ordering,
// progress, and cancellation, so it is fully unit-testable with fakes.

export interface DownloadableSentence {
  // Position in the section, 1:1 with the live timeline enumeration.
  ordinal: number;
  // `${blockIndex}:${markName}` — the manifest identity, must match the label
  // ensureTimeline registers during live playback so the fingerprints agree.
  label: string;
  lang: string;
  // The preprocessed sentence text: exactly what live playback synthesizes,
  // so the computed cache key is identical.
  text: string;
}

export interface SectionEnumerator {
  // Enumerate one section's sentences in reading order, or null when the
  // section is unavailable (no document, wrong client). Never throws.
  enumerateSection(sectionIndex: number): Promise<DownloadableSentence[] | null>;
}

export interface CacheWarmer {
  registerSectionManifest(section: number, labels: string[]): void | Promise<void>;
  // Synthesize this sentence into the cache (a hit is a no-op) and record its
  // key against the section manifest at the ordinal. Returns whether audio is
  // now cached for it (false = offline miss / permanent failure).
  warmSentence(
    section: number,
    ordinal: number,
    lang: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<boolean>;
  // Force any newly-completed sections to compact into packs now (and push,
  // if pack sync is on) rather than waiting for the debounced timer.
  compactCache(): Promise<void>;
  // Windowed engines: announce a whole section up front so it synthesizes in
  // a few large requests; warmSentence then picks each sentence up as it
  // arrives. Resolves whether the section was handed off. A fatal failure
  // (e.g. quota) thrown by warmSentence ends the download.
  prefetchSentences?(
    sentences: { lang: string; text: string }[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  // The ordinals of this section's sentences already in the cache, with
  // their marks recorded (in a few queries for the whole section).
  cachedSentences?(section: number, sentences: DownloadableSentence[]): Promise<Set<number>>;
}

export interface SectionDownloadProgress {
  sectionIndex: number;
  total: number;
  // Sentences processed so far in this section (attempted, cached or skipped).
  done: number;
  // Sentences actually synthesized so far (cache misses that succeeded).
  synthesized: number;
}

export interface DownloadResult {
  completed: number[];
  skipped: number[];
  synthesized: number;
}

export class TTSDownloader {
  #enumerator: SectionEnumerator;
  #warmer: CacheWarmer;

  constructor(enumerator: SectionEnumerator, warmer: CacheWarmer) {
    this.#enumerator = enumerator;
    this.#warmer = warmer;
  }

  async download(
    sectionIndexes: number[],
    onProgress?: (progress: SectionDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    const completed: number[] = [];
    const skipped: number[] = [];
    let synthesizedTotal = 0;

    for (const sectionIndex of sectionIndexes) {
      if (signal?.aborted) break;
      const sentences = await this.#enumerator.enumerateSection(sectionIndex);
      if (!sentences) {
        console.warn('[TTS] download section failed to enumerate', sectionIndex);
        skipped.push(sectionIndex);
        continue;
      }

      // The total shows at once; preparing the section can take a while.
      onProgress?.({ sectionIndex, total: sentences.length, done: 0, synthesized: 0 });

      await this.#warmer.registerSectionManifest(
        sectionIndex,
        sentences.map((s) => s.label),
      );

      // Progress counts sentences in the cache. Those already there (an
      // earlier run, listening, a synced pack) count at once and are not
      // synthesized again, so a retry resumes instead of starting over.
      const cached = (await this.#warmer.cachedSentences?.(sectionIndex, sentences)) ?? new Set();
      const missing = sentences.filter((s) => !cached.has(s.ordinal));
      let done = sentences.length - missing.length;
      let synthesized = 0;
      const report = () =>
        onProgress?.({ sectionIndex, total: sentences.length, done, synthesized });
      if (done > 0) report();
      const warm = async (s: DownloadableSentence) => {
        const ok = await this.#warmer.warmSentence(sectionIndex, s.ordinal, s.lang, s.text, signal);
        if (ok) {
          done++;
          synthesized++;
          report();
        }
        return ok;
      };

      const windowed = await this.#warmer.prefetchSentences?.(
        missing.map(({ lang, text }) => ({ lang, text })),
        signal,
      );

      let failed = false;
      let aborted = false;
      if (windowed) {
        // Windows run several at a time and may finish in any order: wait on
        // every sentence at once, so progress moves as soon as any window is
        // done.
        const results = await Promise.all(missing.map(warm));
        aborted = !!signal?.aborted;
        failed = results.includes(false);
      } else {
        for (const s of missing) {
          if (signal?.aborted) {
            aborted = true;
            break;
          }
          if (!(await warm(s))) failed = true;
        }
      }

      // Compact whatever completed. A section left partial by an abort or an
      // offline miss simply will not form a pack until the gap fills on a
      // later run; compacting is still safe and cheap.
      await this.#warmer.compactCache();
      synthesizedTotal += synthesized;
      if (aborted) break;
      if (failed) skipped.push(sectionIndex);
      else completed.push(sectionIndex);
    }

    return { completed, skipped, synthesized: synthesizedTotal };
  }
}
