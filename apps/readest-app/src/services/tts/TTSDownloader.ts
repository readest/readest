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
  registerSectionManifest(section: number, labels: string[]): void;
  // Synthesize this sentence into the cache (a hit is a no-op) and record its
  // key against the section manifest at the ordinal. Returns whether audio is
  // now cached for it (false = offline miss / permanent failure).
  warmSentence(section: number, ordinal: number, lang: string, text: string): Promise<boolean>;
  // Force any newly-completed sections to compact into packs now (and push,
  // if pack sync is on) rather than waiting for the debounced timer.
  compactCache(): Promise<void>;
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
        skipped.push(sectionIndex);
        continue;
      }

      this.#warmer.registerSectionManifest(
        sectionIndex,
        sentences.map((s) => s.label),
      );

      let synthesized = 0;
      let aborted = false;
      for (let done = 0; done < sentences.length; done++) {
        if (signal?.aborted) {
          aborted = true;
          break;
        }
        const s = sentences[done]!;
        const ok = await this.#warmer.warmSentence(sectionIndex, s.ordinal, s.lang, s.text);
        if (ok) synthesized++;
        onProgress?.({
          sectionIndex,
          total: sentences.length,
          done: done + 1,
          synthesized,
        });
      }

      // Compact whatever completed. A section left partial by an abort or an
      // offline miss simply will not form a pack until the gap fills on a
      // later run; compacting is still safe and cheap.
      await this.#warmer.compactCache();
      synthesizedTotal += synthesized;
      if (aborted) break;
      completed.push(sectionIndex);
    }

    return { completed, skipped, synthesized: synthesizedTotal };
  }
}
