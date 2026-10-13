import { describe, expect, test } from 'vitest';

import { gapAfterSentence, scaleGapForRate } from '@/services/tts/gap';

describe('scaleGapForRate', () => {
  test('leaves the base gap untouched at 1.0x', () => {
    expect(scaleGapForRate(0.15, 1)).toBe(0.15);
    expect(scaleGapForRate(0.3, 1)).toBe(0.3);
  });

  test('shortens pauses as the voice speeds up, more gently than 1/rate', () => {
    // 1/rate would give 0.10s and 0.075s: fast speech runs the sentences
    // together long before the pause stops being useful.
    expect(scaleGapForRate(0.15, 1.5)).toBe(0.12);
    expect(scaleGapForRate(0.15, 2)).toBe(0.1);
    expect(scaleGapForRate(0.3, 1.5)).toBe(0.24);
    expect(scaleGapForRate(0.3, 2)).toBe(0.2);
  });

  test('lengthens pauses below 1.0x', () => {
    expect(scaleGapForRate(0.15, 0.5)).toBe(0.23);
  });

  test('keeps two decimals so sub-second gaps survive the rounding', () => {
    // Rounding to a whole number floors every gap to 0, silently removing the
    // pauses along with any way to get them back (#5414).
    for (const rate of [0.5, 0.8, 1, 1.25, 1.5, 2, 3]) {
      expect(scaleGapForRate(0.15, rate)).toBeGreaterThan(0);
    }
  });

  test('a non-positive rate falls back to the base gap', () => {
    expect(scaleGapForRate(0.15, 0)).toBe(0.15);
    expect(scaleGapForRate(0.15, -1)).toBe(0.15);
  });
});

describe('gapAfterSentence', () => {
  test('keeps the base gap after a period or no end punctuation', () => {
    expect(gapAfterSentence(0.15, 'It was late.')).toBe(0.15);
    expect(gapAfterSentence(0.15, 'Chapter One')).toBe(0.15);
    expect(gapAfterSentence(0.15, '夜が明けた。')).toBe(0.15);
  });

  test('pauses a beat longer after a question, exclamation or ellipsis', () => {
    expect(gapAfterSentence(0.15, 'Who is there?')).toBe(0.3);
    expect(gapAfterSentence(0.15, 'Run!')).toBe(0.3);
    expect(gapAfterSentence(0.15, 'And then…')).toBe(0.3);
    expect(gapAfterSentence(0.15, 'And then...')).toBe(0.3);
    expect(gapAfterSentence(0.15, '本当に？')).toBe(0.3);
  });

  test('looks past closing quotes, brackets and trailing whitespace', () => {
    expect(gapAfterSentence(0.15, '"Are you sure?" ')).toBe(0.3);
    expect(gapAfterSentence(0.15, '“Stop!”\n')).toBe(0.3);
    expect(gapAfterSentence(0.15, '(Or was it?)')).toBe(0.3);
    expect(gapAfterSentence(0.15, '「行こう！」')).toBe(0.3);
    expect(gapAfterSentence(0.15, '"It was late."')).toBe(0.15);
  });
});
