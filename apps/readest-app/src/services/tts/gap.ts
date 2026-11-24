// The default gaps live here, in a module with no imports, because
// services/constants.ts needs them for the default view settings and every
// server API route imports constants.ts: taking them from TTSController or
// BufferedTTSClient loaded the whole TTS engine on each cold Worker start.

// Natural pause between sentences at 1.0x, replacing the silence Edge bakes
// into every utterance: measured at ~0.18s leading and ~0.8s trailing, so ~1s
// of dead air per sentence if it is played as-is (see #5414). The rate scaling
// happens once, before the value reaches BufferedTTSClient (see
// scaleGapForRate); what arrives there is wall-clock seconds of silence. Note
// the native path only cuts the trailing silence, so its audible gap also
// carries the next utterance's ~0.18s of leading silence.
export const DEFAULT_SENTENCE_GAP_SEC = 0.15;

// Silence inserted between paragraphs when auto-advancing during continuous
// playback. Unlike the Edge-only inter-sentence gap, this applies to every
// TTS client: the paragraph-to-paragraph transition (stop -> next -> speak)
// is engine-agnostic, handled entirely in TTSController's #speak()/forward().
// There is no natural pause there otherwise -- the transition is as fast as
// the async stop/init overhead allows, which reads as no pause at all.
export const DEFAULT_PARAGRAPH_GAP_SEC = 0.3;

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

// A question, exclamation or trailing-off ellipsis gets a longer pause than a
// period, the way a narrator lets it land (#6412). The factor applies to the
// already rate-scaled gap, so it shrinks with the rate like the gap itself.
// Closing quotes and brackets are skipped so `"Really?"` still counts.
const EMPHATIC_END_RE = /(?:[?!…‽？！]|\.\.\.)["'”’»›)\]}）」』》\s]*$/u;
const EMPHATIC_GAP_FACTOR = 2;

export const gapAfterSentence = (gapSec: number, text: string): number =>
  EMPHATIC_END_RE.test(text) ? gapSec * EMPHATIC_GAP_FACTOR : gapSec;
