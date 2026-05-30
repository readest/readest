import type { ImportedDictionary } from './types';

/**
 * Resolve which existing (non-deleted) entries the incoming bundle should
 * replace. Match by contentId first (stable per file content; survives
 * user-driven renames), fall back to name when either side lacks contentId
 * (legacy bundles imported before the contentId field existed).
 *
 * Returns all matching existing entries — multiple are possible when the
 * user previously imported the same file more than once.
 */
export const findExistingDictionaryMatches = (
  incoming: ImportedDictionary,
  existing: ImportedDictionary[],
): ImportedDictionary[] => {
  const live = existing.filter((d) => !d.deletedAt);

  if (incoming.contentId) {
    const byContent = live.filter((d) => d.contentId === incoming.contentId);
    if (byContent.length > 0) return byContent;
    // contentId is set on the incoming side but no existing entry has it.
    // Fall through to name match for legacy entries (contentId-less) that
    // could correspond to the same file under a previous import.
  }

  return live.filter((d) => !d.contentId && d.name === incoming.name);
};

/**
 * When re-importing a file that matches an existing entry, keep the user's
 * label. The match was by content (or by legacy name), so the parsed name
 * on `incoming` is whatever the bundle's metadata says — but the user may
 * have customized the label since their original import. Preserving their
 * choice avoids surprising them when re-import is conceptually a content
 * refresh, not a label reset.
 *
 * If `matches` is empty, returns `incoming` (with a fresh object identity).
 * If multiple matches exist (the user previously imported the same file
 * more than once and now we're collapsing them), the first match's name
 * wins — arbitrary but deterministic.
 */
export const preserveUserCustomName = (
  incoming: ImportedDictionary,
  matches: ImportedDictionary[],
): ImportedDictionary => {
  if (matches.length === 0) return { ...incoming };
  return { ...incoming, name: matches[0]!.name };
};

/**
 * Preserve durable local state when a live dictionary is re-imported.
 *
 * The fresh import owns parsed/file-backed fields (`id`, `bundleDir`,
 * `files`, `contentId`, `kind`, `lang`, unsupported status). The existing
 * live entry owns user/local continuity fields: display name, original
 * import time, and any sticky reincarnation token.
 */
export const preserveLiveDictionaryState = (
  incoming: ImportedDictionary,
  matches: ImportedDictionary[],
): ImportedDictionary => {
  if (matches.length === 0) return { ...incoming };
  const first = matches[0]!;
  return {
    ...incoming,
    name: first.name,
    addedAt: first.addedAt,
    ...(first.reincarnation ? { reincarnation: first.reincarnation } : {}),
  };
};

/**
 * Explicitly re-importing the same content is enough user intent to mint
 * a revival token when the local live entry does not already have one.
 *
 * This covers stale-local cases: another device may have tombstoned the
 * server row, while this device still has a live cache entry. The live
 * replacement path would otherwise publish `reincarnation = null`, and
 * remove-wins would keep the remote row hidden forever.
 */
export const shouldMintReincarnationForLiveReimport = (
  incoming: ImportedDictionary,
  matches: ImportedDictionary[],
): boolean => {
  if (!incoming.contentId || matches.length === 0) return false;
  const first = matches[0]!;
  return first.contentId === incoming.contentId && !first.reincarnation;
};

/**
 * Find soft-deleted (tombstoned) existing entries that share the
 * incoming bundle's contentId. Used by the importer to detect
 * re-import-after-delete and mint a reincarnation token. Returns []
 * if the incoming dict has no contentId (legacy bundles can't
 * reincarnate; they get a fresh import path).
 */
export const findTombstonedDictionaryMatches = (
  incoming: ImportedDictionary,
  existing: ImportedDictionary[],
): ImportedDictionary[] => {
  if (!incoming.contentId) return [];
  return existing.filter((d) => d.deletedAt && d.contentId && d.contentId === incoming.contentId);
};
