// The one place a TTS pause is scaled for the playback rate.
//
// Pauses have to shrink as the voice speeds up or they dominate the reading,
// but dividing by the rate shrinks them faster than the speech itself
// compresses, and sentences run together at 2x (#2033 asked for the opposite:
// gaps that scale at all). The exponent below keeps a gentler curve —
// 0.15s at 1.0x, 0.12s at 1.5x, 0.10s at 2.0x.
//
// Everything downstream treats the result as wall-clock seconds of silence and
// must NOT scale it again: doing it here AND at schedule time gave
// base/rate^1.6, which is 0.60s at 0.5x and 0.085s at 2x (#5750).
const RATE_EXPONENT = 0.6;

export const scaleGapForRate = (baseGapSec: number, rate: number): number => {
  if (!(rate > 0)) return baseGapSec;
  // Two decimals: the gaps are sub-second by design, so rounding to a whole
  // number floors every one of them to 0 and silently removes the pauses along
  // with any way to get them back (#5414).
  return Math.round((baseGapSec / Math.pow(rate, RATE_EXPONENT)) * 100) / 100;
};
