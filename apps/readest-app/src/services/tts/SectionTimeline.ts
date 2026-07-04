// Virtual playback timeline over one section's sentences.
//
// The section is never concatenated into a real audio stream; this table plus
// prefix-summed durations IS the "whole chapter audio" the scrubber and the
// media session expose. Durations are stored at rate 1.0 and resolved
// per-sentence as measured (exact, from the duration store) or estimated
// (per-voice calibration falling back to script defaults); outputs divide by
// the playback rate at read time so rate changes are a pure rescale.
//
// Timeline sentences come from foliate's getSentences enumeration, which uses
// the same walker/filter/granularity as the live TTS instance — ranges are
// document-ordered and 1:1 with the marks playback produces.

import { estimateSentenceSeconds, getMeasuredDuration } from './ttsDuration';

export interface TimelineSentence {
  blockIndex: number;
  markName: string;
  range: Range;
  text: string;
}

export class SectionTimeline {
  #sentences: TimelineSentence[];
  #lang: string;
  #voiceId: string;
  #rate = 1;
  #durations: number[] = [];
  #measured: boolean[] = [];
  #prefix: number[] = [];
  #total = 0;

  constructor(sentences: TimelineSentence[], lang: string, voiceId: string) {
    this.#sentences = sentences;
    this.#lang = lang;
    this.#voiceId = voiceId;
    this.refresh();
  }

  get length(): number {
    return this.#sentences.length;
  }

  setVoice(voiceId: string): void {
    if (voiceId === this.#voiceId) return;
    this.#voiceId = voiceId;
    this.refresh();
  }

  setRate(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) this.#rate = rate;
  }

  // Re-pull measured durations (playback and preload record them continuously)
  // and rebuild the prefix sums.
  refresh(): void {
    const n = this.#sentences.length;
    this.#durations = new Array<number>(n);
    this.#measured = new Array<boolean>(n);
    this.#prefix = new Array<number>(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const sentence = this.#sentences[i]!;
      const measured = getMeasuredDuration(this.#voiceId, sentence.text);
      const duration =
        measured ?? estimateSentenceSeconds(sentence.text, this.#lang, this.#voiceId);
      this.#durations[i] = duration;
      this.#measured[i] = measured !== undefined;
      this.#prefix[i] = sum;
      sum += duration;
    }
    this.#total = sum;
  }

  // Seconds at the current rate.
  getDuration(): number {
    return this.#total / this.#rate;
  }

  // Duration-weighted fraction of the timeline backed by measured (exact)
  // values — the scrubber shows "~" while this is low.
  getMeasuredFraction(): number {
    if (this.#total <= 0) return 0;
    let measuredSum = 0;
    for (let i = 0; i < this.#durations.length; i++) {
      if (this.#measured[i]) measuredSum += this.#durations[i]!;
    }
    return measuredSum / this.#total;
  }

  // Position (seconds at the current rate) of a sentence start plus an offset
  // within it, given in rate-1.0 media seconds.
  positionAt(index: number, withinMediaSec = 0): number {
    if (this.#sentences.length === 0 || index < 0) return 0;
    if (index >= this.#sentences.length) return this.getDuration();
    const clampedWithin = Math.min(Math.max(withinMediaSec, 0), this.#durations[index]!);
    return (this.#prefix[index]! + clampedWithin) / this.#rate;
  }

  // Map seconds (at the current rate) to a sentence, clamping past-the-end
  // seeks to the last sentence so an over-estimated total is never a dead
  // gesture. Null only for an empty timeline.
  sentenceAtTime(seconds: number): { index: number; sentence: TimelineSentence } | null {
    const n = this.#sentences.length;
    if (n === 0) return null;
    const target = Math.max(0, seconds) * this.#rate;
    let low = 0;
    let high = n - 1;
    let index = n - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.#prefix[mid]!;
      if (start <= target) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Binary search finds the last sentence starting at or before the target;
    // past-the-end targets land on the final sentence by construction.
    return { index, sentence: this.#sentences[index]! };
  }

  // Locate the timeline sentence containing (or last starting at or before)
  // the given range. Returns -1 for ranges from another document (stale
  // timeline) or ranges before the first sentence.
  indexOfRange(range: Range): number {
    const n = this.#sentences.length;
    if (n === 0) return -1;
    try {
      let low = 0;
      let high = n - 1;
      let index = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (this.#sentences[mid]!.range.compareBoundaryPoints(Range.START_TO_START, range) <= 0) {
          index = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return index;
    } catch {
      // WrongDocumentError: the section changed under us.
      return -1;
    }
  }
}
