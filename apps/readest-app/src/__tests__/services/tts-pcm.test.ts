import { describe, expect, test } from 'vitest';

import { findSpeechBounds } from '@/services/tts/pcm';

const SR = 24000;

const makeSignal = (
  leadingSilenceSec: number,
  speechSec: number,
  trailingSilenceSec: number,
  noiseFloor = 0,
) => {
  const total = Math.round((leadingSilenceSec + speechSec + trailingSilenceSec) * SR);
  const samples = new Float32Array(total);
  const speechStart = Math.round(leadingSilenceSec * SR);
  const speechEnd = speechStart + Math.round(speechSec * SR);
  for (let i = 0; i < total; i++) {
    if (i >= speechStart && i < speechEnd) {
      samples[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
    } else if (noiseFloor > 0) {
      // Deterministic pseudo-noise below the detection threshold, emulating
      // MP3 decoder dither/ringing in "silent" passages.
      samples[i] = noiseFloor * Math.sin((2 * Math.PI * 1731 * i) / SR + i * 0.7);
    }
  }
  return samples;
};

describe('findSpeechBounds', () => {
  test('trims leading and trailing silence with head/tail pads', () => {
    const samples = makeSignal(0.5, 1.0, 0.8);
    const { startSec, endSec } = findSpeechBounds(samples, SR);
    expect(startSec).toBeGreaterThan(0.47 - 1e-6);
    expect(startSec).toBeLessThan(0.53);
    expect(endSec).toBeGreaterThan(1.44);
    expect(endSec).toBeLessThan(1.56 + 1e-6);
    expect(endSec).toBeGreaterThan(startSec);
  });

  test('ignores a realistic decoder noise floor in silent passages', () => {
    const samples = makeSignal(0.5, 1.0, 0.8, 0.0008);
    const { startSec, endSec } = findSpeechBounds(samples, SR);
    expect(startSec).toBeGreaterThan(0.4);
    expect(startSec).toBeLessThan(0.53);
    expect(endSec).toBeGreaterThan(1.44);
    expect(endSec).toBeLessThan(1.6);
  });

  test('all-silence input returns the full range', () => {
    const samples = new Float32Array(SR); // 1s of zeros
    const { startSec, endSec } = findSpeechBounds(samples, SR);
    expect(startSec).toBe(0);
    expect(endSec).toBeCloseTo(1, 5);
  });

  test('empty input returns zero bounds', () => {
    const { startSec, endSec } = findSpeechBounds(new Float32Array(0), SR);
    expect(startSec).toBe(0);
    expect(endSec).toBe(0);
  });

  test('speech reaching the buffer edges clamps to the buffer', () => {
    const samples = makeSignal(0, 0.5, 0);
    const { startSec, endSec } = findSpeechBounds(samples, SR);
    expect(startSec).toBe(0);
    expect(endSec).toBeCloseTo(0.5, 2);
  });
});
