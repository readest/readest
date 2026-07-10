import { describe, expect, test } from 'vitest';

import { timeStretch } from '@/services/tts/timeStretch';

const SR = 24000;

const makeSpeechLike = (seconds: number) => {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Multi-sine with slow amplitude modulation, roughly speech-shaped.
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    out[i] =
      env *
      (0.3 * Math.sin(2 * Math.PI * 220 * t) +
        0.2 * Math.sin(2 * Math.PI * 470 * t) +
        0.1 * Math.sin(2 * Math.PI * 910 * t));
  }
  return out;
};

const makeSine = (seconds: number, freq: number) => {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
};

const zeroCrossingsPerSec = (samples: Float32Array) => {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1]! <= 0 !== samples[i]! <= 0) crossings++;
  }
  return crossings / (samples.length / SR);
};

describe('timeStretch', () => {
  test('tempo 1.5 shortens output to ~1/1.5 of input length', () => {
    const input = makeSpeechLike(3);
    const output = timeStretch(input, SR, 1.5);
    const ratio = output.length / input.length;
    expect(ratio).toBeGreaterThan((1 / 1.5) * 0.95);
    expect(ratio).toBeLessThan((1 / 1.5) * 1.05);
  });

  test('tempo 0.75 lengthens output to ~1/0.75 of input length', () => {
    const input = makeSpeechLike(3);
    const output = timeStretch(input, SR, 0.75);
    const ratio = output.length / input.length;
    expect(ratio).toBeGreaterThan((1 / 0.75) * 0.95);
    expect(ratio).toBeLessThan((1 / 0.75) * 1.05);
  });

  test('preserves pitch: zero-crossing rate unchanged at tempo 1.5', () => {
    const input = makeSine(1, 440);
    const output = timeStretch(input, SR, 1.5);
    const inputZps = zeroCrossingsPerSec(input); // ~880
    const outputZps = zeroCrossingsPerSec(output);
    // A resampler would land near 1320; WSOLA must stay near the input rate.
    expect(outputZps).toBeGreaterThan(inputZps * 0.97);
    expect(outputZps).toBeLessThan(inputZps * 1.03);
  });

  test('tempo 1 returns an equal-length copy, not the same reference', () => {
    const input = makeSpeechLike(1);
    const output = timeStretch(input, SR, 1);
    expect(output).not.toBe(input);
    expect(output.length).toBe(input.length);
    expect(output[1234]).toBe(input[1234]);
  });

  test('all-zero input produces finite output (zero-energy correlation guard)', () => {
    const input = new Float32Array(SR); // 1s of digital silence
    const output = timeStretch(input, SR, 1.5);
    expect(output.length).toBeGreaterThan(0);
    expect(output.every((s) => Number.isFinite(s))).toBe(true);
  });

  test('slow tempo 0.2 produces ~5x length with finite samples', () => {
    const input = makeSpeechLike(1);
    const output = timeStretch(input, SR, 0.2);
    const ratio = output.length / input.length;
    expect(ratio).toBeGreaterThan(5 * 0.95);
    expect(ratio).toBeLessThan(5 * 1.05);
    expect(output.every((s) => Number.isFinite(s))).toBe(true);
  });

  test('very short input is returned as a copy (below two frames)', () => {
    const input = makeSine(0.05, 440); // 50ms < 2 x 40ms frames
    const output = timeStretch(input, SR, 2);
    expect(output.length).toBe(input.length);
  });

  test('does not mutate its input (input may be a subarray view)', () => {
    const input = makeSpeechLike(1);
    const snapshot = input.slice();
    timeStretch(input, SR, 1.5);
    expect(input).toEqual(snapshot);
  });
});
