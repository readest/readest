import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  calibrateVoiceRate,
  defaultCharsPerSecond,
  estimateSentenceSeconds,
  getMeasuredDuration,
  recordMeasuredDuration,
  recordProvisionalDuration,
} from '@/services/tts/ttsDuration';

const VOICE = 'en-US-AriaNeural';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('measured duration store', () => {
  test('records and retrieves a duration by voice and text', () => {
    recordMeasuredDuration(VOICE, 'The quick brown fox jumps.', 2.4);
    expect(getMeasuredDuration(VOICE, 'The quick brown fox jumps.')).toBe(2.4);
  });

  test('punctuation and case variants hit the same key', () => {
    recordMeasuredDuration(VOICE, 'Hello—world! Again…', 1.7);
    expect(getMeasuredDuration(VOICE, 'hello world again')).toBe(1.7);
    expect(getMeasuredDuration(VOICE, 'Hello, world; AGAIN')).toBe(1.7);
  });

  test('different voices do not share durations', () => {
    recordMeasuredDuration(VOICE, 'Shared sentence text here.', 2.0);
    expect(getMeasuredDuration('fr-FR-DeniseNeural', 'Shared sentence text here.')).toBeUndefined();
  });

  test('provisional never overwrites measured; measured overwrites provisional', () => {
    recordProvisionalDuration(VOICE, 'A provisional sentence sample.', 3.0);
    expect(getMeasuredDuration(VOICE, 'A provisional sentence sample.')).toBe(3.0);
    recordMeasuredDuration(VOICE, 'A provisional sentence sample.', 2.5);
    expect(getMeasuredDuration(VOICE, 'A provisional sentence sample.')).toBe(2.5);
    recordProvisionalDuration(VOICE, 'A provisional sentence sample.', 9.9);
    expect(getMeasuredDuration(VOICE, 'A provisional sentence sample.')).toBe(2.5);
  });
});

describe('defaultCharsPerSecond', () => {
  test('CJK languages are far denser per character than Latin', () => {
    expect(defaultCharsPerSecond('zh-CN')).toBeLessThan(defaultCharsPerSecond('en-US'));
    expect(defaultCharsPerSecond('ja')).toBeLessThan(defaultCharsPerSecond('fr'));
    expect(defaultCharsPerSecond('ko')).toBeLessThan(defaultCharsPerSecond('de-DE'));
  });
});

describe('estimateSentenceSeconds', () => {
  test('uses the measured duration when available', () => {
    recordMeasuredDuration(VOICE, 'A measured sentence for estimates.', 4.2);
    expect(estimateSentenceSeconds('A measured sentence for estimates.', 'en', VOICE)).toBe(4.2);
  });

  test('falls back to the script default without calibration', () => {
    const text = 'x'.repeat(150);
    const est = estimateSentenceSeconds(text, 'en', 'uncalibrated-voice');
    expect(est).toBeCloseTo(150 / defaultCharsPerSecond('en'), 3);
  });

  test('prefers the calibrated per-voice rate over the default', () => {
    const voice = 'calibration-voice';
    // Voice speaks 20 normalized chars per second.
    calibrateVoiceRate(voice, 'a'.repeat(40), 2);
    calibrateVoiceRate(voice, 'b'.repeat(60), 3);
    const est = estimateSentenceSeconds('c'.repeat(100), 'en', voice);
    expect(est).toBeGreaterThan(100 / 25);
    expect(est).toBeLessThan(100 / 15);
  });

  test('calibration converges toward the observed rate', () => {
    const voice = 'converging-voice';
    for (let i = 0; i < 20; i++) {
      calibrateVoiceRate(voice, 'a'.repeat(50), 5); // 10 cps observed
    }
    const est = estimateSentenceSeconds('d'.repeat(100), 'en', voice);
    expect(est).toBeGreaterThan(100 / 12);
    expect(est).toBeLessThan(100 / 8);
  });

  test('short texts are skipped for calibration', () => {
    const voice = 'short-skip-voice';
    calibrateVoiceRate(voice, 'hi', 60); // absurd sample must be ignored
    const est = estimateSentenceSeconds('e'.repeat(150), 'en', voice);
    expect(est).toBeCloseTo(150 / defaultCharsPerSecond('en'), 3);
  });

  test('empty text estimates zero', () => {
    expect(estimateSentenceSeconds('', 'en', VOICE)).toBe(0);
  });
});

describe('calibration stability (cumulative history)', () => {
  test('a single outlier barely moves a well-established calibration', () => {
    const voice = 'stable-voice';
    for (let i = 0; i < 100; i++) {
      calibrateVoiceRate(voice, 'a'.repeat(50), 5); // 10 cps, 500s of history
    }
    const before = estimateSentenceSeconds('z'.repeat(100), 'en', voice);
    calibrateVoiceRate(voice, 'b'.repeat(90), 3); // 30 cps outlier sentence
    const after = estimateSentenceSeconds('z'.repeat(100), 'en', voice);
    // The whole point of cumulative smoothing: one weird sentence must not
    // re-price the chapter. (The old EMA moved this by ~28%.)
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });

  test('history is duration-weighted, not sample-weighted', () => {
    const voice = 'weighted-voice';
    calibrateVoiceRate(voice, 'a'.repeat(40), 2); // 20 cps for 2s
    calibrateVoiceRate(voice, 'b'.repeat(90), 9); // 10 cps for 9s
    // Cumulative ratio: 130 chars / 11 s, NOT the sample mean of 20 and 10.
    const est = estimateSentenceSeconds('c'.repeat(100), 'en', voice);
    expect(est).toBeCloseTo(100 / (130 / 11), 1);
  });

  test('legacy {cps,n} storage format is migrated as a prior', async () => {
    localStorage.setItem(
      'readest-tts-voice-cps',
      JSON.stringify({ 'legacy-voice': { cps: 20, n: 5 } }),
    );
    vi.resetModules();
    const fresh = await import('@/services/tts/ttsDuration');
    const est = fresh.estimateSentenceSeconds('d'.repeat(100), 'en', 'legacy-voice');
    expect(est).toBeCloseTo(5, 1); // 100 chars at the legacy 20 cps
  });
});

describe('persistence', () => {
  test('per-voice calibration survives a module reload via localStorage', async () => {
    calibrateVoiceRate('persisted-voice', 'a'.repeat(50), 5);
    vi.resetModules();
    const fresh = await import('@/services/tts/ttsDuration');
    const est = fresh.estimateSentenceSeconds('f'.repeat(100), 'en', 'persisted-voice');
    expect(est).toBeGreaterThan(100 / 16);
  });

  test('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      clear: () => {},
    });
    expect(() => calibrateVoiceRate('blocked-voice', 'a'.repeat(50), 5)).not.toThrow();
    expect(() => estimateSentenceSeconds('g'.repeat(100), 'en', 'blocked-voice')).not.toThrow();
  });
});
