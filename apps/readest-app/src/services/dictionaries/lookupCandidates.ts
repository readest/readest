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
 * Try the original spelling and its NFC/NFD equivalents with case variants
 * before language-aware lemmas, then repeat with Latin diacritics removed.
 * Probing both Unicode forms handles composed/decomposed dictionary keys
 * without changing the on-disk sort order required by binary-search readers.
 * Folding is only a fallback: `café` must win over `cafe`. Marks in other
 * scripts (e.g. Indic vowels and Japanese voicing) retain their meaning.
 * Returns `[]` for a blank input.
 */
export const buildLookupCandidates = (word: string, lang?: string | null): string[] => {
  const trimmed = word.trim();
  if (!trimmed) return [];
  const candidates = new Set<string>();
  const addVariants = (spelling: string) => {
    const lower = spelling.toLowerCase();
    const variants = [
      spelling,
      lower,
      spelling.charAt(0).toUpperCase() + lower.slice(1),
      spelling.toUpperCase(),
    ];
    for (const variant of variants) candidates.add(variant);
    for (const form of ['NFC', 'NFD'] as const) {
      for (const variant of variants) candidates.add(variant.normalize(form));
    }
    for (const lemma of getLemmaCandidates(lower.normalize('NFC'), lang)) {
      candidates.add(lemma);
      candidates.add(lemma.normalize('NFD'));
    }
  };
  addVariants(trimmed);
  const folded = trimmed
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC');
  if (folded !== trimmed.normalize('NFC')) addVariants(folded);
  return [...candidates];
};
