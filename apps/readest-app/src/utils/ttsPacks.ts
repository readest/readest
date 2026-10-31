/**
 * The downloaded read-aloud packs each sync destination holds for a book, by
 * destination id ('readest', 'webdav', …), as pack names: `<section>-<keys>.mp3`.
 * Synced in the book's config so a device learns what to pull and push without
 * listing a destination; an empty list means "listed, nothing there".
 */
export type TTSPacks = Record<string, string[]>;

const namesOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];

/**
 * Union per destination. The lists only grow by merging, never by a newer
 * config replacing an older one, so packs two devices add at once both stay.
 */
export const mergeTTSPacks = (
  a: TTSPacks | null | undefined,
  b: TTSPacks | null | undefined,
): TTSPacks | undefined => {
  if (!a && !b) return undefined;
  const merged: TTSPacks = {};
  for (const side of [a, b]) {
    if (!side || typeof side !== 'object') continue;
    for (const [dest, names] of Object.entries(side)) {
      if (!Array.isArray(names)) continue;
      merged[dest] = [...new Set([...(merged[dest] ?? []), ...namesOf(names)])];
    }
  }
  return merged;
};
