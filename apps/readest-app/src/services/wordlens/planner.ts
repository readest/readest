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
  /** Whether a [start, end) span can be drawn as one hint; phrases that can't are dropped. */
  canRender?: (start: number, end: number) => boolean;
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

const tokenize = (text: string, opts: PlanOptions): Token[] =>
  opts.sourceLang === 'zh'
    ? opts.cutZh
      ? tokenizeChinese(text, opts.cutZh)
      : []
    : tokenizeLatin(text);

// A saved hint is the reader's own text: shown as written, only capped.
const learningGloss = (
  hint: string | undefined,
  entry: GlossEntry | null | undefined,
  opts: PlanOptions,
): string => {
  const saved = hint?.replace(/\s+/g, ' ').trim();
  return saved ? capForDisplay(saved) : cleanGloss(entry?.gloss ?? '', opts.monolingual);
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Learning entries of two or more words ("matter is decreed") never match a
// single token, so find them in the text itself (#7325): any whitespace between
// the words, either apostrophe. Outside Chinese a match must start and end on
// the text's own token edges, so `ice cream` skips `ice cream-maker`. A phrase
// the page can't draw (split by inline markup) is dropped so its words keep
// their own hints. Overlapping matches keep the earlier, then the longer.
const planPhrases = (
  text: string,
  tokens: Token[],
  marks: VocabularyMarks,
  source: GlossSource,
  opts: PlanOptions,
): GlossOccurrence[] => {
  const found: GlossOccurrence[] = [];
  const aligned = opts.sourceLang !== 'zh';
  const starts = new Set(tokens.map((t) => t.start));
  const ends = new Set(tokens.map((t) => t.end));
  for (const [key, hint] of marks.learning) {
    if (tokenize(key, opts).length < 2) continue;
    const gloss = learningGloss(hint, source.lookup(key), opts);
    if (!gloss) continue;
    const words = key.trim().split(/\s+/).map(escapeRegExp);
    const re = new RegExp(words.join('\\s+').replace(/'/g, "['’‘]"), 'giu');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      const ok =
        (!aligned || (starts.has(start) && ends.has(end))) &&
        (!opts.canRender || opts.canRender(start, end));
      if (ok) found.push({ start, end, word: m[0], gloss });
      // A rejected match may hide an overlapping one: retry one character on.
      else re.lastIndex = start + 1;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  let lastEnd = -1;
  return found.filter((o) => {
    if (o.start < lastEnd) return false;
    lastEnd = o.end;
    return true;
  });
};

export const planGlosses = (
  text: string,
  source: GlossSource,
  opts: PlanOptions,
): GlossOccurrence[] => {
  if (!text) return [];
  const cap = opts.maxOccurrences ?? DEFAULT_CAP;
  const tokens = tokenize(text, opts);

  const marks = opts.vocabulary && expandMarks(opts.vocabulary, source);
  const phrases = marks ? planPhrases(text, tokens, marks, source, opts) : [];
  const occurrences: GlossOccurrence[] = [];
  let p = 0;
  for (const t of tokens) {
    if (occurrences.length >= cap) break;
    // A word inside a hinted phrase is covered by the phrase's hint.
    while (p < phrases.length && phrases[p]!.end <= t.start) p++;
    if (p < phrases.length && phrases[p]!.start < t.end) continue;
    const entry = source.lookup(t.word);
    if (marks) {
      const keys = [normalizeWordKey(t.word), source.lemma?.(t.word)];
      if (keys.some((k) => k && marks.mastered.has(k))) continue;
      const key = keys.find((k) => k && marks.learning.has(k));
      if (key) {
        const gloss = learningGloss(marks.learning.get(key), entry ?? source.lookup(key), opts);
        if (gloss) occurrences.push({ start: t.start, end: t.end, word: t.word, gloss });
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
  if (!phrases.length) return occurrences;
  // Keep the earliest hints in text order when the cap is hit.
  return [...phrases, ...occurrences].sort((a, b) => a.start - b.start).slice(0, cap);
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
