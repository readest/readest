// Sentence duration bookkeeping for the TTS section timeline.
//
// Three tiers, best data wins:
//  1. Measured durations (exact, from decoded+trimmed audio; provisional
//     values derive from word-boundary metadata at fetch time and never
//     overwrite a measured value).
//  2. Per-voice chars-per-second calibration (EMA over measured sentences,
//     persisted in localStorage so a voice starts calibrated next session).
//  3. Per-script defaults for the cold start.
//
// Keys normalize away punctuation and case because the spoken text (mark text
// after SSML preprocessing) and the timeline text (raw range text) differ only
// in punctuation rewrites; the letter/digit content is identical.

import { md5 } from 'js-md5';
import { isCJKLang } from '@/utils/lang';
import { LRUCache } from '@/utils/lru';

const CALIBRATION_STORAGE_KEY = 'readest-tts-voice-cps';
const EMA_ALPHA = 0.2;
const MIN_CALIBRATION_CHARS = 10;
// Fixed per-utterance overhead floor: even a one-word sentence is not
// instantaneous once Edge's attack/release around speech is counted.
const MIN_SENTENCE_SEC = 0.3;

const CJK_DEFAULT_CPS = 4.5;
const LATIN_DEFAULT_CPS = 15;

interface VoiceCalibration {
  cps: number;
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
      const parsed = JSON.parse(raw) as Record<string, VoiceCalibration>;
      for (const [voiceId, cal] of Object.entries(parsed)) {
        if (typeof cal?.cps === 'number' && Number.isFinite(cal.cps) && cal.cps > 0) {
          calibrations[voiceId] = { cps: cal.cps, n: cal.n || 1 };
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

export const calibrateVoiceRate = (voiceId: string, text: string, seconds: number): void => {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const chars = normalizeText(text).length;
  if (chars < MIN_CALIBRATION_CHARS) return;
  const cps = chars / seconds;
  const all = loadCalibrations();
  const existing = all[voiceId];
  if (existing) {
    existing.cps = existing.cps * (1 - EMA_ALPHA) + cps * EMA_ALPHA;
    existing.n += 1;
  } else {
    all[voiceId] = { cps, n: 1 };
  }
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
  const cps = calibrated?.cps ?? defaultCharsPerSecond(lang);
  return Math.max(MIN_SENTENCE_SEC, chars / cps);
};
