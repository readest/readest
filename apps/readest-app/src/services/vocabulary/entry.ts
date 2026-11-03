import type { VocabularyEntry, VocabularyOccurrence } from './types';

export const MAX_OCCURRENCES = 20;

// Anything that isn't a letter, mark or number at either end: quotes,
// brackets, commas, CJK punctuation.
const EDGE_PUNCT = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;

export const normalizeWordKey = (word: string): string =>
  word.replace(/[’‘]/g, "'").replace(EDGE_PUNCT, '').toLowerCase();

export const entryId = (lang: string, key: string): string => `${lang}:${key}`;

/** Base language code a book tag files its words under (`en-US` → `en`), `und` if unknown. */
export const vocabularyLang = (tag?: string | null): string =>
  (typeof tag === 'string' && tag.toLowerCase().split('-')[0]) || 'und';

const SENTENCE_END = /[.!?。！？…]/;

export const MAX_SENTENCE_LEN = 300;

const collapse = (s: string) => s.replace(/\s+/g, ' ');

/**
 * The sentence around `word`, given the text right before and after it. A very
 * long sentence (or a block with no terminators) is cut to a window around the
 * word so one lookup can't bloat its synced row.
 */
export const extractSentence = (before: string, word: string, after: string): string => {
  let start = before.length;
  while (start > 0 && !SENTENCE_END.test(before[start - 1]!)) start--;
  let end = 0;
  while (end < after.length && !SENTENCE_END.test(after[end]!)) end++;
  // Keep the terminator (and any run of them, "?!").
  while (end < after.length && SENTENCE_END.test(after[end]!)) end++;
  let pre = collapse(before.slice(start)).trimStart();
  let post = collapse(after.slice(0, end)).trimEnd();
  const w = collapse(word);
  const half = Math.max(0, Math.floor((MAX_SENTENCE_LEN - w.length) / 2));
  if (pre.length > half) pre = `…${pre.slice(-half).trimStart()}`;
  if (post.length > half) post = `${post.slice(0, half).trimEnd()}…`;
  return `${pre}${w}${post}`.trim();
};

// The same sentence in the same book is one occurrence; its CFI can shift
// (Word Lens hint markup), so it isn't part of the identity.
const occurrenceKey = (o: VocabularyOccurrence) => `${o.bookHash ?? ''}|${o.sentence}`;

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

// Newer edit wins. A tie (same ms on two devices) must pick the same side on
// every device and on the server, whatever the argument order: a delete
// first, then the larger state/hint.
const tieKey = (e: VocabularyEntry) => `${e.deletedAt ? 1 : 0}|${e.state}|${e.hint ?? ''}`;
const aWins = (a: VocabularyEntry, b: VocabularyEntry) =>
  a.modifiedAt !== b.modifiedAt ? a.modifiedAt > b.modifiedAt : tieKey(a) >= tieKey(b);

/**
 * Merge two copies of one entry. The side changed last wins the state, hint
 * and tombstone; sentences are unioned. A delete drops every sentence from
 * before it, so a word looked up again after a delete comes back with only
 * the new sentences.
 */
export const mergeEntries = (a: VocabularyEntry, b: VocabularyEntry): VocabularyEntry => {
  const [winner, loser] = aWins(a, b) ? [a, b] : [b, a];
  const { dirty: _dirty, ...base } = winner;
  if (winner.deletedAt) {
    // Lookups don't move modifiedAt, so a device that missed the delete can
    // hold sentences from after it: those bring the word back, unmarked.
    const after = loser.occurrences.filter((o) => o.at > winner.deletedAt!);
    if (!after.length) return { ...base, occurrences: [] };
    const { hint: _hint, ...alive } = base;
    return {
      ...alive,
      state: 'none',
      deletedAt: null,
      occurrences: normalizeOccurrences(after),
    };
  }
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
