import type {
  GlossEntry,
  GlossOccurrence,
  GlossSource,
  VocabularyMarks,
  WordLensSourceLang,
} from './types';
import { isDifficult } from './difficulty';
import {
  baseFormCandidates,
  capForDisplay,
  cleanGloss,
  glossMentionsWord,
  glossesShareMeaning,
} from './gloss';
import { normalizeWordKey } from '@/services/vocabulary/entry';

export interface PlanOptions {
  sourceLang: WordLensSourceLang;
  /** A word is glossed when its rank >= rankCutoff. */
  rankCutoff: number;
  /** Hard cap on occurrences per call (default 2000). Logged when hit. */
  maxOccurrences?: number;
  /** Chinese segmenter; injected for tests. Required for sourceLang 'zh'. */
  cutZh?: (text: string) => string[];
  /**
   * Monolingual pack (source === hint, e.g. en-en): the gloss is a definition
   * formatted at build time, so cleanGloss must preserve it (no sense-split / cut).
   */
  monolingual?: boolean;
  /** Learning words are always hinted, Mastered words never (#6613). */
  vocabulary?: VocabularyMarks;
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

  const marks = opts.vocabulary && expandMarks(opts.vocabulary, source);
  const occurrences: GlossOccurrence[] = [];
  for (const t of tokens) {
    const entry = source.lookup(t.word);
    if (marks) {
      const keys = [normalizeWordKey(t.word), source.lemma?.(t.word)];
      if (keys.some((k) => k && marks.mastered.has(k))) continue;
      const key = keys.find((k) => k && marks.learning.has(k));
      if (key) {
        // A saved hint is the reader's own text: shown as written, only capped.
        const saved = marks.learning.get(key)?.replace(/\s+/g, ' ').trim();
        const packGloss = (entry ?? source.lookup(key))?.gloss ?? '';
        const gloss = saved ? capForDisplay(saved) : cleanGloss(packGloss, opts.monolingual);
        if (gloss) occurrences.push({ start: t.start, end: t.end, word: t.word, gloss });
        if (occurrences.length >= cap) break;
        continue;
      }
    }
    if (!entry || !isDifficult(entry.rank, opts.rankCutoff)) continue;
    // English derivations inherit a known base's lower rank (lazily ⇐ lazy), so
    // they drop below the cutoff and aren't hinted. Gated to English source.
    if (
      opts.sourceLang === 'en' &&
      !isDifficult(effectiveRank(t.word, entry, source), opts.rankCutoff)
    ) {
      continue;
    }
    occurrences.push({
      start: t.start,
      end: t.end,
      word: t.word,
      gloss: cleanGloss(entry.gloss, opts.monolingual),
    });
    if (occurrences.length >= cap) {
      console.warn(`[wordlens] occurrence cap (${cap}) hit; some hints omitted`);
      break;
    }
  }
  return occurrences;
};

// Index the marks by lemma too, so marking `running` covers `run` and `ran`.
// A saved hint is kept; a lemma never overwrites a word's own entry.
const expandMarks = (marks: VocabularyMarks, source: GlossSource): VocabularyMarks => {
  if (!source.lemma) return marks;
  const learning = new Map(marks.learning);
  for (const [k, hint] of marks.learning) {
    const l = source.lemma(k);
    if (l && !learning.has(l)) learning.set(l, hint);
  }
  const mastered = new Set(marks.mastered);
  for (const k of marks.mastered) {
    const l = source.lemma(k);
    if (l) mastered.add(l);
  }
  return { learning, mastered };
};

// Lowest rank among the word itself and any base form that exists in the index
// AND shares meaning with it (transparent derivation). A drifted form like
// `hardly` finds `hard` but their glosses don't overlap, so it keeps its own rank.
const effectiveRank = (word: string, entry: GlossEntry, source: GlossSource): number => {
  let rank = entry.rank;
  for (const base of baseFormCandidates(word)) {
    const b = source.lookup(base);
    if (b && (glossesShareMeaning(entry.gloss, b.gloss) || glossMentionsWord(entry.gloss, base))) {
      rank = Math.min(rank, b.rank);
    }
  }
  return rank;
};
