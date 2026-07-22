import { getLemmaCandidates } from './lemmatize';

/**
 * Ordered, de-duplicated query variants for a dictionary lookup.
 *
 * A double-click selection in the reader can carry leading/trailing
 * whitespace, and most imported dictionaries store headwords lowercased, so
 * an exact match on the raw selection often misses — e.g. `Hello` or
 * `world ` fail to resolve `hello`/`world`. The DICT/StarDict/slob readers
 * already compare case-insensitively, but case-sensitive formats (mdict) do
 * not. Callers try each candidate in order and keep the first hit.
 *
 * Variants, in priority order: the trimmed selection as-is, all-lowercase,
 * title-case, all-uppercase (for acronym headwords), then language-aware
 * lemma candidates (`ran → run`, `mice → mouse`). The lemmas sit at the tail
 * so an exact/case match always wins; they are only reached once the lookup
 * loop exhausts the exact forms with empty results. Returns `[]` for a blank
 * input.
 */
export const buildLookupCandidates = (word: string, lang?: string | null): string[] => {
  const trimmed = word.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const title = trimmed.charAt(0).toUpperCase() + lower.slice(1);
  const upper = trimmed.toUpperCase();
  const lemmas = getLemmaCandidates(lower, lang);
  return [...new Set([trimmed, lower, title, upper, ...lemmas])];
};
