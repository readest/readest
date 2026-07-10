import { describe, expect, test } from 'vitest';
import { textWalker } from 'foliate-js/text-walker.js';
import { getSentences } from 'foliate-js/tts.js';

import { SectionTimeline, type TimelineSentence } from '@/services/tts/SectionTimeline';
import { recordMeasuredDuration } from '@/services/tts/ttsDuration';

// Note: foliate's segmenter merges sentences ending in short (<=3 letter)
// words as suspected abbreviations, so every fixture sentence ends long.
const SENTENCE_A0 = 'The quick brown fox jumps over the lazy hound.';
const SENTENCE_A1 = 'A second sentence follows the first one closely.';
const SENTENCE_B0 = 'Another paragraph starts a new block of text.';
const SENTENCE_B1 = 'It also carries a couple of sentences inside.';

const makeDoc = (): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(
    `<!DOCTYPE html><html lang="en"><body>` +
      `<p>${SENTENCE_A0} ${SENTENCE_A1}</p>` +
      `<p>${SENTENCE_B0} ${SENTENCE_B1}</p>` +
      `</body></html>`,
    'text/html',
  );
};

const enumerate = (doc: Document): TimelineSentence[] => {
  const sentences: TimelineSentence[] = [];
  for (const { blockIndex, markName, range } of getSentences(doc, textWalker, null, 'sentence')) {
    sentences.push({ blockIndex, markName, range, text: range.toString() });
  }
  return sentences;
};

describe('SectionTimeline', () => {
  test('enumerates sentences via foliate getSentences with block-scoped marks', () => {
    const sentences = enumerate(makeDoc());
    expect(sentences).toHaveLength(4);
    expect(sentences[0]!.blockIndex).toBe(0);
    expect(sentences[2]!.blockIndex).toBe(1);
    // Mark names restart per block, matching foliate's per-block mark naming.
    expect(sentences[0]!.markName).toBe(sentences[2]!.markName);
    expect(sentences[0]!.text.trim()).toBe(SENTENCE_A0);
    expect(sentences[3]!.text.trim()).toBe(SENTENCE_B1);
  });

  test('mixes measured and estimated durations after refresh', () => {
    const voice = 'timeline-voice-mixed';
    const sentences = enumerate(makeDoc());
    const timeline = new SectionTimeline(sentences, 'en', voice);
    const estimatedTotal = timeline.getDuration();
    expect(estimatedTotal).toBeGreaterThan(0);

    recordMeasuredDuration(voice, SENTENCE_A0, 10);
    timeline.refresh();
    const mixedTotal = timeline.getDuration();
    // Sentence A0's estimate (~3s at 15cps) was replaced by the 10s measured value.
    expect(mixedTotal).toBeGreaterThan(estimatedTotal + 5);
    expect(timeline.getMeasuredFraction()).toBeGreaterThan(0);
    expect(timeline.getMeasuredFraction()).toBeLessThan(1);
  });

  test('positionAt sums prior durations plus the within-sentence offset', () => {
    const voice = 'timeline-voice-position';
    const sentences = enumerate(makeDoc());
    recordMeasuredDuration(voice, SENTENCE_A0, 4);
    recordMeasuredDuration(voice, SENTENCE_A1, 6);
    const timeline = new SectionTimeline(sentences, 'en', voice);
    expect(timeline.positionAt(0, 1.5)).toBeCloseTo(1.5, 5);
    expect(timeline.positionAt(1, 2)).toBeCloseTo(4 + 2, 5);
    // Clamps out-of-range indexes.
    expect(timeline.positionAt(-1, 0)).toBe(0);
    expect(timeline.positionAt(99, 0)).toBeCloseTo(timeline.getDuration(), 5);
  });

  test('rate rescales duration and position without touching stored data', () => {
    const voice = 'timeline-voice-rate';
    const sentences = enumerate(makeDoc());
    recordMeasuredDuration(voice, SENTENCE_A0, 4);
    const timeline = new SectionTimeline(sentences, 'en', voice);
    const at1 = timeline.getDuration();
    timeline.setRate(2);
    expect(timeline.getDuration()).toBeCloseTo(at1 / 2, 5);
    expect(timeline.positionAt(1, 0)).toBeCloseTo(4 / 2, 5);
    timeline.setRate(0.5);
    expect(timeline.getDuration()).toBeCloseTo(at1 * 2, 5);
  });

  test('sentenceAtTime maps seconds to the sentence, clamping past the end', () => {
    const voice = 'timeline-voice-seek';
    const sentences = enumerate(makeDoc());
    for (const [text, dur] of [
      [SENTENCE_A0, 4],
      [SENTENCE_A1, 6],
      [SENTENCE_B0, 5],
      [SENTENCE_B1, 5],
    ] as const) {
      recordMeasuredDuration(voice, text, dur);
    }
    const timeline = new SectionTimeline(sentences, 'en', voice);
    expect(timeline.sentenceAtTime(0)?.index).toBe(0);
    expect(timeline.sentenceAtTime(4.5)?.index).toBe(1);
    expect(timeline.sentenceAtTime(11)?.index).toBe(2);
    // Past the (possibly over-estimated) end: clamp to the last sentence so a
    // lock-screen scrub past the real end is not a dead gesture.
    expect(timeline.sentenceAtTime(999)?.index).toBe(3);
    expect(timeline.sentenceAtTime(-1)?.index).toBe(0);
    // Rate applies: at 2x, 5.5 real seconds is 11 media seconds = sentence 2.
    timeline.setRate(2);
    expect(timeline.sentenceAtTime(5.5)?.index).toBe(2);
  });

  test('sentenceAtTime returns null for an empty timeline', () => {
    const timeline = new SectionTimeline([], 'en', 'timeline-voice-empty');
    expect(timeline.sentenceAtTime(0)).toBeNull();
    expect(timeline.getDuration()).toBe(0);
  });

  test('indexOfRange finds exact ranges, sub-ranges, and rejects foreign docs', () => {
    const doc = makeDoc();
    const sentences = enumerate(doc);
    const timeline = new SectionTimeline(sentences, 'en', 'timeline-voice-range');
    expect(timeline.indexOfRange(sentences[2]!.range)).toBe(2);

    // A collapsed range inside sentence 3 still resolves to sentence 3.
    const sub = sentences[3]!.range.cloneRange();
    sub.collapse(false);
    expect(timeline.indexOfRange(sub)).toBe(3);

    const foreign = makeDoc().createRange();
    expect(timeline.indexOfRange(foreign)).toBe(-1);
  });

  test('setVoice re-estimates unmeasured entries under the new voice', () => {
    const voiceA = 'timeline-voice-a';
    const voiceB = 'timeline-voice-b';
    const sentences = enumerate(makeDoc());
    recordMeasuredDuration(voiceA, SENTENCE_A0, 20);
    const timeline = new SectionTimeline(sentences, 'en', voiceA);
    const withMeasured = timeline.getDuration();
    timeline.setVoice(voiceB);
    // Voice B has no measured data: everything estimates again.
    expect(timeline.getDuration()).toBeLessThan(withMeasured);
    expect(timeline.getMeasuredFraction()).toBe(0);
  });
});
