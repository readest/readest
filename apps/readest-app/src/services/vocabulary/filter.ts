import type { VocabularyEntry, VocabularyState } from './types';

export interface VocabularyFilter {
  state?: VocabularyState;
  bookHash?: string;
  query?: string;
}

/** When the word was last looked up (or created, for a word never looked up). */
export const lastSeen = (e: VocabularyEntry) => e.occurrences[0]?.at ?? e.createdAt;

/** Live entries matching the filter, most recently looked up first. */
export const filterEntries = (
  entries: VocabularyEntry[],
  { state, bookHash, query }: VocabularyFilter,
): VocabularyEntry[] => {
  const q = query?.trim().toLowerCase();
  return entries
    .filter(
      (e) =>
        !e.deletedAt &&
        (!state || e.state === state) &&
        (!bookHash || e.occurrences.some((o) => o.bookHash === bookHash)) &&
        (!q || e.word.toLowerCase().includes(q) || !!e.hint?.toLowerCase().includes(q)),
    )
    .sort((a, b) => lastSeen(b) - lastSeen(a));
};

/** Books that have captured words, for the book filter. */
export const listBooks = (entries: VocabularyEntry[]): { hash: string; title: string }[] => {
  const books = new Map<string, string>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    for (const o of e.occurrences) {
      if (o.bookHash && !books.has(o.bookHash)) books.set(o.bookHash, o.bookTitle || o.bookHash);
    }
  }
  return [...books]
    .map(([hash, title]) => ({ hash, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
};
