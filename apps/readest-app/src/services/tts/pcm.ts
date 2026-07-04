// Pure PCM helpers for the Web Audio TTS pipeline.
//
// Decoded MP3 "silence" is dithered ringing (roughly 1e-4 to 1e-3 amplitude),
// not zeros, so speech detection uses an amplitude threshold rather than an
// exact-zero test.

export interface SpeechBounds {
  startSec: number;
  endSec: number;
}

// ~-46 dBFS: above decoder dither/ringing, below any audible speech onset.
const DEFAULT_SILENCE_THRESHOLD = 0.005;
// Pads keep a natural attack/release around the detected speech.
const HEAD_PAD_SEC = 0.02;
const TAIL_PAD_SEC = 0.05;

export const findSpeechBounds = (
  samples: Float32Array,
  sampleRate: number,
  threshold = DEFAULT_SILENCE_THRESHOLD,
): SpeechBounds => {
  if (samples.length === 0 || sampleRate <= 0) {
    return { startSec: 0, endSec: 0 };
  }
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > threshold) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    // All silence: play as-is rather than scheduling a zero-length chunk.
    return { startSec: 0, endSec: samples.length / sampleRate };
  }
  let last = first;
  for (let i = samples.length - 1; i >= first; i--) {
    if (Math.abs(samples[i]!) > threshold) {
      last = i;
      break;
    }
  }
  const startSec = Math.max(0, first / sampleRate - HEAD_PAD_SEC);
  const endSec = Math.min(samples.length / sampleRate, (last + 1) / sampleRate + TAIL_PAD_SEC);
  return { startSec, endSec };
};
