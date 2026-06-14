import type { GlossOccurrence, GlossSource, WordWiseSourceLang } from './types';
import { isDifficult } from './difficulty';

export interface PlanOptions {
  sourceLang: WordWiseSourceLang;
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
    occurrences.push({ start: t.start, end: t.end, word: t.word, gloss: entry.gloss });
    if (occurrences.length >= cap) {
      console.warn(`[wordwise] occurrence cap (${cap}) hit; some hints omitted`);
      break;
    }
  }
  return occurrences;
};
