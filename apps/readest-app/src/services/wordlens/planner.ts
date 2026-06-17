import type { GlossEntry, GlossOccurrence, GlossSource, WordLensSourceLang } from './types';
import { isDifficult } from './difficulty';
import { baseFormCandidates, cleanGloss, glossesShareMeaning } from './gloss';

export interface PlanOptions {
  sourceLang: WordLensSourceLang;
  /** A word is glossed when its rank >= rankCutoff. */
  rankCutoff: number;
  /** Hard cap on occurrences per call (default 2000). Logged when hit. */
  maxOccurrences?: number;
  /** Chinese segmenter; injected for tests. Required for sourceLang 'zh'. */
  cutZh?: (text: string) => string[];
}

// A foliate "section" is usually a whole chapter, so this is a per-chapter bound:
// high enough to fully gloss a normal chapter, low enough to protect against a
// pathological single-section book (e.g. a whole novel in one HTML file).
const DEFAULT_CAP = 2000;

interface Token {
  word: string;
  start: number;
  end: number;
}

// Latin/English: Unicode letters with internal apostrophes/hyphens, offsets kept.
const tokenizeLatin = (text: string): Token[] => {
  const re = /[\p{L}][\p{L}\p{M}’'-]*/gu;
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
};

// Chinese: jieba segments cover the text in order; walk a cursor to recover
// offsets. Segments that aren't found at/after the cursor (whitespace it
// dropped, etc.) are skipped without stalling.
const tokenizeChinese = (text: string, cutZh: (t: string) => string[]): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const seg of cutZh(text)) {
    if (!seg) continue;
    const at = text.indexOf(seg, cursor);
    if (at === -1) continue;
    tokens.push({ word: seg, start: at, end: at + seg.length });
    cursor = at + seg.length;
  }
  return tokens;
};

export const planGlosses = (
  text: string,
  source: GlossSource,
  opts: PlanOptions,
): GlossOccurrence[] => {
  if (!text) return [];
  const cap = opts.maxOccurrences ?? DEFAULT_CAP;
  const tokens =
    opts.sourceLang === 'zh'
      ? opts.cutZh
        ? tokenizeChinese(text, opts.cutZh)
        : []
      : tokenizeLatin(text);

  const occurrences: GlossOccurrence[] = [];
  for (const t of tokens) {
    const entry = source.lookup(t.word);
    if (!entry || !isDifficult(entry.rank, opts.rankCutoff)) continue;
    // English derivations inherit a known base's lower rank (lazily ⇐ lazy), so
    // they drop below the cutoff and aren't hinted. Gated to English source.
    if (
      opts.sourceLang === 'en' &&
      !isDifficult(effectiveRank(t.word, entry, source), opts.rankCutoff)
    ) {
      continue;
    }
    occurrences.push({ start: t.start, end: t.end, word: t.word, gloss: cleanGloss(entry.gloss) });
    if (occurrences.length >= cap) {
      console.warn(`[wordlens] occurrence cap (${cap}) hit; some hints omitted`);
      break;
    }
  }
  return occurrences;
};

// Lowest rank among the word itself and any base form that exists in the index
// AND shares meaning with it (transparent derivation). A drifted form like
// `hardly` finds `hard` but their glosses don't overlap, so it keeps its own rank.
const effectiveRank = (word: string, entry: GlossEntry, source: GlossSource): number => {
  let rank = entry.rank;
  for (const base of baseFormCandidates(word)) {
    const b = source.lookup(base);
    if (b && glossesShareMeaning(entry.gloss, b.gloss)) rank = Math.min(rank, b.rank);
  }
  return rank;
};
