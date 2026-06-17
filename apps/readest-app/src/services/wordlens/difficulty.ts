import type { WordLensSourceLang } from './types';

// CEFR proficiency levels. The slider picks the reader's level; a word is glossed
// when it's ABOVE that level (rarer than the vocabulary a learner at that level
// typically knows). This maps corpus-FREQUENCY bands to CEFR as an APPROXIMATION —
// true per-word CEFR data is English-only and wouldn't generalize to the zh/es/fr/…
// packs; for zh it's an analogy over the HSK rank scale.
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const WORD_LENS_MIN_LEVEL = 1; // A1
export const WORD_LENS_MAX_LEVEL = CEFR_LEVELS.length; // 6 (C2)

// Level (1=A1 … 6=C2) -> rank cutoff = the vocabulary a learner at that level
// knows. A word is glossed when its rank >= cutoff, so a LOWER level (A1) => LOWER
// cutoff => MORE hints (a beginner needs help with almost everything); a HIGHER
// level (C2) => only the rarest words get a hint. index 0 = level 1 (A1).

// Frequency-rank scale: en + every Latin/space-delimited source (es, fr, de, …).
// Bands ≈ the vocabulary size a learner at each CEFR level commands.
const FREQUENCY: readonly number[] = [1000, 2000, 4000, 8000, 14000, 24000];

// HSK scale for zh (build script ranks by HSK level×3000, non-HSK 30000). A1
// glosses above HSK1; C2 only the rarest. An analogy, not real CEFR.
const HSK: readonly number[] = [6000, 9000, 12000, 15000, 18000, 24000];

const clampLevel = (level: number): number =>
  Math.min(WORD_LENS_MAX_LEVEL, Math.max(WORD_LENS_MIN_LEVEL, Math.round(level)));

export const getRankCutoff = (lang: WordLensSourceLang, level: number): number =>
  (lang === 'zh' ? HSK : FREQUENCY)[clampLevel(level) - 1]!;

/** CEFR label ('A1'…'C2') for a 1..6 slider level. */
export const cefrLabel = (level: number): CefrLevel => CEFR_LEVELS[clampLevel(level) - 1]!;

export const isDifficult = (rank: number, cutoff: number): boolean => rank >= cutoff;

// Sources we can tokenize: zh (via jieba) + Latin/space-delimited languages
// (tokenized by the planner's regex). CJK languages lacking a segmenter
// (ja/ko) and Thai need a tier-3 segmenter and are blocked until then.
const UNSUPPORTED = new Set(['ja', 'ko', 'th']);

export const canTokenizeSource = (source: string): boolean =>
  !UNSUPPORTED.has(source.toLowerCase().split('-')[0]!);
