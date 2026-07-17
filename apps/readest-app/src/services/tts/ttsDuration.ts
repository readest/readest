// Sentence duration bookkeeping for the TTS section timeline.
//
// Three tiers, best data wins:
//  1. Measured durations (exact, from decoded+trimmed audio; provisional
//     values derive from word-boundary metadata at fetch time and never
//     overwrite a measured value).
//  2. Per-voice chars-per-second calibration: the cumulative ratio of ALL
//     measured chars to ALL measured seconds (persisted in localStorage so a
//     voice starts calibrated next session). A running total, not an EMA:
//     each new sentence moves the estimate less than the last, so the
//     timeline's estimated remainder stabilizes instead of re-pricing on
//     every quirky sentence.
//  3. Per-script defaults for the cold start.
//
// Keys normalize away punctuation and case because the spoken text (mark text
// after SSML preprocessing) and the timeline text (raw range text) differ only
// in punctuation rewrites; the letter/digit content is identical.

import { md5 } from 'js-md5';
import { isCJKLang } from '@/utils/lang';
import { LRUCache } from '@/utils/lru';

const CALIBRATION_STORAGE_KEY = 'readest-tts-voice-cps';
const MIN_CALIBRATION_CHARS = 10;
// Cap the accumulated history at one hour of measured audio: past that the
// totals are rescaled in place, giving a very-long-horizon forgetting factor.
// The ratio stays stable sentence-to-sentence (no visible timeline jumps)
// while a genuinely changed voice can still drift the calibration over time.
const MAX_CALIBRATION_SECS = 3600;
// Weight granted to a legacy EMA-format calibration on migration: a useful
// prior, but real history overtakes it within a minute of listening.
const LEGACY_PRIOR_SECS = 30;
// Fixed per-utterance overhead floor: even a one-word sentence is not
// instantaneous once Edge's attack/release around speech is counted.
const MIN_SENTENCE_SEC = 0.3;

const CJK_DEFAULT_CPS = 4.5;
const LATIN_DEFAULT_CPS = 15;

interface VoiceCalibration {
  chars: number;
  secs: number;
  n: number;
}

const measured = new LRUCache<string, number>(2048);
const provisional = new Set<string>();
// In-memory calibration mirror; localStorage is best-effort persistence.
let calibrations: Record<string, VoiceCalibration> | null = null;

const normalizeText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const durationKey = (voiceId: string, text: string): string =>
  md5(`${voiceId}|${normalizeText(text)}`);

const loadCalibrations = (): Record<string, VoiceCalibration> => {
  if (calibrations) return calibrations;
  calibrations = {};
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<
        string,
        Partial<VoiceCalibration> & { cps?: number }
      >;
      for (const [voiceId, cal] of Object.entries(parsed)) {
        if (
          typeof cal?.chars === 'number' &&
          typeof cal?.secs === 'number' &&
          Number.isFinite(cal.chars) &&
          Number.isFinite(cal.secs) &&
          cal.chars > 0 &&
          cal.secs > 0
        ) {
          calibrations[voiceId] = { chars: cal.chars, secs: cal.secs, n: cal.n || 1 };
        } else if (typeof cal?.cps === 'number' && Number.isFinite(cal.cps) && cal.cps > 0) {
          // Legacy EMA format: carry the old rate over as a small prior.
          calibrations[voiceId] = {
            chars: cal.cps * LEGACY_PRIOR_SECS,
            secs: LEGACY_PRIOR_SECS,
            n: cal.n || 1,
          };
        }
      }
    }
  } catch {
    // localStorage unavailable or corrupt: run with in-memory calibration only.
  }
  return calibrations;
};

const saveCalibrations = () => {
  if (!calibrations) return;
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations));
  } catch {
    // Best-effort persistence only.
  }
};

export const recordMeasuredDuration = (voiceId: string, text: string, seconds: number): void => {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const key = durationKey(voiceId, text);
  measured.set(key, seconds);
  provisional.delete(key);
};

// Word-boundary-derived durations are close but not canonical; keep them only
// until a decode-time measurement lands.
export const recordProvisionalDuration = (voiceId: string, text: string, seconds: number): void => {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const key = durationKey(voiceId, text);
  if (measured.get(key) !== undefined && !provisional.has(key)) return;
  measured.set(key, seconds);
  provisional.add(key);
};

export const getMeasuredDuration = (voiceId: string, text: string): number | undefined =>
  measured.get(durationKey(voiceId, text));

// Bulk provisional hydration from the persistent audio cache: `durations`
// maps a section's sentence ordinals to boundary-derived seconds. Lets a
// downloaded (or previously played) chapter start with a fully measured
// timeline instead of estimates, without decoding any audio. Returns how
// many sentences were applied.
export const hydrateProvisionalDurations = (
  voiceId: string,
  sentences: { text: string }[],
  durations: Map<number, number>,
): number => {
  let applied = 0;
  for (const [ordinal, seconds] of durations) {
    const sentence = sentences[ordinal];
    if (!sentence || !Number.isFinite(seconds) || seconds <= 0) continue;
    recordProvisionalDuration(voiceId, sentence.text, seconds);
    applied += 1;
  }
  return applied;
};

export const calibrateVoiceRate = (voiceId: string, text: string, seconds: number): void => {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const chars = normalizeText(text).length;
  if (chars < MIN_CALIBRATION_CHARS) return;
  const all = loadCalibrations();
  const existing = all[voiceId] ?? { chars: 0, secs: 0, n: 0 };
  existing.chars += chars;
  existing.secs += seconds;
  existing.n += 1;
  // Rescale instead of growing unbounded; the ratio (the estimate) is
  // untouched, only future samples' relative weight changes.
  if (existing.secs > MAX_CALIBRATION_SECS) {
    const scale = MAX_CALIBRATION_SECS / existing.secs;
    existing.chars *= scale;
    existing.secs = MAX_CALIBRATION_SECS;
  }
  all[voiceId] = existing;
  saveCalibrations();
};

export const defaultCharsPerSecond = (lang: string): number =>
  isCJKLang(lang) ? CJK_DEFAULT_CPS : LATIN_DEFAULT_CPS;

export const estimateSentenceSeconds = (text: string, lang: string, voiceId: string): number => {
  const measuredSec = getMeasuredDuration(voiceId, text);
  if (measuredSec !== undefined) return measuredSec;
  const chars = normalizeText(text).length;
  if (chars === 0) return 0;
  const calibrated = loadCalibrations()[voiceId];
  const cps = calibrated ? calibrated.chars / calibrated.secs : defaultCharsPerSecond(lang);
  return Math.max(MIN_SENTENCE_SEC, chars / cps);
};
