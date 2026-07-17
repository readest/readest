import { describe, expect, test } from 'vitest';
import {
  getMeasuredDuration,
  hydrateProvisionalDurations,
  recordMeasuredDuration,
} from '@/services/tts/ttsDuration';
import { SectionTimeline, TimelineSentence } from '@/services/tts/SectionTimeline';

const makeSentences = (texts: string[]): TimelineSentence[] =>
  texts.map((text, i) => ({
    blockIndex: i,
    markName: `m${i}`,
    range: document.createRange(),
    text,
  }));

describe('hydrateProvisionalDurations', () => {
  test('cached section durations mark the whole timeline as measured', () => {
    const voice = 'hydrate-voice-a';
    const sentences = makeSentences([
      'First sentence of the chapter.',
      'A second sentence follows it.',
      'And a third one closes things.',
    ]);
    const timeline = new SectionTimeline(sentences, 'en', voice);
    // Nothing measured yet: a downloaded-but-unplayed chapter starts here.
    expect(timeline.getMeasuredFraction()).toBe(0);
    const applied = hydrateProvisionalDurations(
      voice,
      sentences,
      new Map([
        [0, 2.5],
        [1, 3.1],
        [2, 1.4],
      ]),
    );
    expect(applied).toBe(3);
    timeline.refresh();
    expect(timeline.getMeasuredFraction()).toBe(1);
    expect(timeline.getDuration()).toBeCloseTo(7.0, 5);
  });

  test('unknown ordinals are skipped and decode-time measurements win', () => {
    const voice = 'hydrate-voice-b';
    const sentences = makeSentences(['Alpha beta gamma delta epsilon.']);
    recordMeasuredDuration(voice, sentences[0]!.text, 9.9);
    const applied = hydrateProvisionalDurations(
      voice,
      sentences,
      new Map([
        [0, 1.0],
        [7, 2.0],
      ]),
    );
    expect(applied).toBe(1);
    // The boundary-derived hydration is provisional; the decoded 9.9s stays.
    expect(getMeasuredDuration(voice, sentences[0]!.text)).toBe(9.9);
  });
});
