import type { VocabularyEntry, VocabularyOccurrence } from './types';

export const MAX_OCCURRENCES = 20;

// Anything that isn't a letter, mark or number at either end: quotes,
// brackets, commas, CJK punctuation.
const EDGE_PUNCT = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;

export const normalizeWordKey = (word: string): string =>
  word.replace(/[’‘]/g, "'").replace(EDGE_PUNCT, '').toLowerCase();

export const entryId = (lang: string, key: string): string => `${lang}:${key}`;

const SENTENCE_END = /[.!?。！？…]/;

/** The sentence around `word`, given the text right before and after it. */
export const extractSentence = (before: string, word: string, after: string): string => {
  let start = before.length;
  while (start > 0 && !SENTENCE_END.test(before[start - 1]!)) start--;
  let end = 0;
  while (end < after.length && !SENTENCE_END.test(after[end]!)) end++;
  // Keep the terminator (and any run of them, "?!").
  while (end < after.length && SENTENCE_END.test(after[end]!)) end++;
  return `${before.slice(start)}${word}${after.slice(0, end)}`.replace(/\s+/g, ' ').trim();
};

const occurrenceKey = (o: VocabularyOccurrence) =>
  `${o.bookHash ?? ''}|${o.cfi ?? ''}|${o.sentence}`;

const normalizeOccurrences = (list: VocabularyOccurrence[]): VocabularyOccurrence[] => {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => b.at - a.at)
    .filter((o) => {
      const k = occurrenceKey(o);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_OCCURRENCES);
};

export const addOccurrence = (
  entry: VocabularyEntry,
  occurrence: VocabularyOccurrence,
): VocabularyEntry => ({
  ...entry,
  occurrences: normalizeOccurrences([occurrence, ...entry.occurrences]),
});

/**
 * Merge two copies of one entry. The side changed last wins the state, hint
 * and tombstone; sentences are unioned. A delete drops every sentence from
 * before it, so a word looked up again after a delete comes back with only
 * the new sentences.
 */
export const mergeEntries = (a: VocabularyEntry, b: VocabularyEntry): VocabularyEntry => {
  const [winner, loser] =
    a.modifiedAt > b.modifiedAt || (a.modifiedAt === b.modifiedAt && !!a.deletedAt)
      ? [a, b]
      : [b, a];
  const { dirty: _dirty, ...base } = winner;
  if (winner.deletedAt) return { ...base, occurrences: [] };
  const deletedAt = loser.deletedAt ?? 0;
  const occurrences = normalizeOccurrences(
    [...winner.occurrences, ...loser.occurrences].filter((o) => o.at > deletedAt),
  );
  return {
    ...base,
    createdAt: Math.min(a.createdAt, b.createdAt),
    deletedAt: null,
    occurrences,
  };
};
