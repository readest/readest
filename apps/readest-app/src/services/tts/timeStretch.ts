// WSOLA (waveform-similarity overlap-add) time-stretch for speech.
//
// Web Audio has no pitch-preserved playback rate (`preservesPitch` exists only
// on media elements), so sentence buffers are stretched here before scheduling.
// Tempo > 1 speeds speech up (shorter output); pitch is preserved because
// whole waveform frames are re-laid at a different spacing instead of being
// resampled.
//
// Parameters follow SoundTouch's speech defaults: 40ms frames, 8ms overlap,
// +/-15ms similarity search. The search maximizes normalized cross-correlation
// between the candidate frame head and the tail of what has been written, and
// the overlap is linearly cross-faded, which keeps phase continuity through
// each splice.

const FRAME_SEC = 0.04;
const OVERLAP_SEC = 0.008;
const SEEK_SEC = 0.015;

export const timeStretch = (
  input: Float32Array,
  sampleRate: number,
  tempo: number,
): Float32Array => {
  const frame = Math.round(FRAME_SEC * sampleRate);
  const overlap = Math.round(OVERLAP_SEC * sampleRate);
  const seek = Math.round(SEEK_SEC * sampleRate);
  if (!(tempo > 0) || tempo === 1 || input.length < 2 * frame) {
    return input.slice();
  }

  const flat = frame - overlap; // samples appended per iteration
  const inputAdvance = flat * tempo; // nominal input advance per iteration
  const out = new Float32Array(Math.ceil(input.length / tempo) + 2 * frame);

  out.set(input.subarray(0, frame), 0);
  let outPos = frame;
  // Nominal input position accumulates independently of the chosen offsets so
  // alignment error never drifts over the sentence.
  let inNominal = 0;

  for (;;) {
    inNominal += inputAdvance;
    const target = Math.round(inNominal);
    const searchMin = Math.max(0, target - seek);
    const searchMax = Math.min(input.length - frame, target + seek);
    if (searchMax < searchMin) break;

    const refStart = outPos - overlap;
    let bestOffset = searchMin;
    let bestCorr = -Infinity;
    for (let off = searchMin; off <= searchMax; off++) {
      let dot = 0;
      let energy = 0;
      for (let i = 0; i < overlap; i++) {
        const a = out[refStart + i]!;
        const b = input[off + i]!;
        dot += a * b;
        energy += b * b;
      }
      // The epsilon guards the zero-energy window (digital silence) so the
      // correlation never divides to NaN.
      const corr = dot / Math.sqrt(energy + 1e-12);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = off;
      }
    }

    for (let i = 0; i < overlap; i++) {
      const t = i / overlap;
      out[refStart + i] = out[refStart + i]! * (1 - t) + input[bestOffset + i]! * t;
    }
    const copyStart = bestOffset + overlap;
    const copyEnd = Math.min(bestOffset + frame, input.length);
    out.set(input.subarray(copyStart, copyEnd), outPos);
    outPos += copyEnd - copyStart;
    if (copyEnd >= input.length) break;
  }

  return out.slice(0, outPos);
};
