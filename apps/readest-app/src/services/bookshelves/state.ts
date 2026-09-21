import { bookshelfReplicaSchema } from './replica';
import type { BookshelfDefinition, BookshelfState } from '@/types/bookshelf';
import type { LibraryCoverFitType, SystemSettings } from '@/types/settings';
import type { Hlc, ReplicaRow } from '@/types/replica';
import { hlcMax, hlcPack, mergeFields } from '@/libs/crdt';
import {
  bookshelfSchema,
  defaultBookshelves,
  isBuiltinBookshelf,
  BUILTIN_BOOKSHELF_IDS,
  BUILTIN_BOOKSHELF_POSITIONS,
  DEFAULT_BOOKSHELF_ID,
  RECENT_BOOKSHELF_ID,
} from './definitions';
import { stubTranslation as _ } from '@/utils/misc';

export const mergeBookshelfRows = (a: ReplicaRow, b: ReplicaRow): ReplicaRow => ({
  ...b,
  fields_jsonb: mergeFields(a.fields_jsonb, b.fields_jsonb),
  deleted_at_ts: isBuiltinBookshelf(a.replica_id) ? null : hlcMax(a.deleted_at_ts, b.deleted_at_ts),
  updated_at_ts: hlcMax(a.updated_at_ts, b.updated_at_ts)!,
  reincarnation: null,
  manifest_jsonb: null,
});
export const mergeBookshelfStates = (a?: BookshelfState, b?: BookshelfState): BookshelfState => {
  const rows: Record<string, ReplicaRow> = {};
  for (const [id, row] of [...Object.entries(a?.rows || {}), ...Object.entries(b?.rows || {})]) {
    if (!bookshelfReplicaSchema.safeParse(row).success || row.replica_id !== id) continue;
    rows[id] = Object.hasOwn(rows, id) ? mergeBookshelfRows(rows[id]!, row) : row;
  }
  return {
    rows,
    ...((a?.legacySettingsMigrated || b?.legacySettingsMigrated) && {
      legacySettingsMigrated: true,
    }),
  };
};
const positionOf = (state: BookshelfState | undefined, id: string) => {
  const value = state?.rows[id]?.fields_jsonb['position']?.v;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : (BUILTIN_BOOKSHELF_POSITIONS[id] ?? 1024);
};
/**
 * No position fits between these two: they tie after concurrent insertions, or
 * repeated moves into one gap have used up every representable midpoint.
 */
const crowded = (lo: number, position: number) => {
  const mid = (lo + position) / 2;
  return mid === lo || mid === position;
};
export const readBookshelves = (settings: Partial<SystemSettings>): BookshelfDefinition[] => {
  const definitions = new Map(defaultBookshelves(settings).map((s) => [s.id, s]));
  for (const [id, row] of Object.entries(settings.bookshelves?.rows || {})) {
    if (!bookshelfReplicaSchema.safeParse(row).success || row.replica_id !== id) continue;
    if (row.deleted_at_ts && !isBuiltinBookshelf(id)) {
      definitions.delete(id);
      continue;
    }
    const parsed = bookshelfSchema.safeParse(row.fields_jsonb['definition']?.v);
    if (parsed.success && parsed.data.id === id)
      definitions.set(id, {
        ...parsed.data,
        hideCovers: parsed.data.hideCovers ?? settings.libraryHideCovers ?? false,
        coverFit: parsed.data.coverFit ?? settings.libraryCoverFit ?? 'crop',
        skeuomorphicCovers:
          parsed.data.skeuomorphicCovers ?? settings.librarySkeuomorphicCovers ?? false,
      });
  }
  return [...definitions.values()].sort((a, b) => {
    return (
      positionOf(settings.bookshelves, a.id) - positionOf(settings.bookshelves, b.id) ||
      a.id.localeCompare(b.id)
    );
  });
};

export interface BookshelfCoverSettings {
  hideCovers: boolean;
  coverFit: LibraryCoverFitType;
  skeuomorphicCovers: boolean;
}
let coverCache: { inputs: unknown[]; covers: BookshelfCoverSettings } | null = null;
/**
 * Cover appearance for surfaces outside any shelf (book details, the cover
 * viewer, the reader sidebar): the Default shelf owns it, since the legacy
 * library preferences no longer have any UI. Parses that one row only and
 * memoizes on it, because a card renders this once per visible cover.
 */
export const readDefaultBookshelfCovers = (
  settings: Partial<SystemSettings>,
): BookshelfCoverSettings => {
  const row = settings.bookshelves?.rows[DEFAULT_BOOKSHELF_ID];
  const inputs = [
    row,
    settings.libraryHideCovers,
    settings.libraryCoverFit,
    settings.librarySkeuomorphicCovers,
  ];
  if (coverCache && inputs.every((value, index) => value === coverCache!.inputs[index]))
    return coverCache.covers;
  const parsed = row && bookshelfReplicaSchema.safeParse(row).success ? row : undefined;
  const definition = bookshelfSchema.safeParse(parsed?.fields_jsonb['definition']?.v);
  const shelf = definition.success ? definition.data : undefined;
  const covers: BookshelfCoverSettings = {
    hideCovers: shelf?.hideCovers ?? settings.libraryHideCovers ?? false,
    coverFit: shelf?.coverFit ?? settings.libraryCoverFit ?? 'crop',
    skeuomorphicCovers: shelf?.skeuomorphicCovers ?? settings.librarySkeuomorphicCovers ?? false,
  };
  coverCache = { inputs, covers };
  return covers;
};

/** Freeze legacy library preferences once without replacing existing shelf edits. */
export const migrateBookshelfSettings = (settings: SystemSettings): boolean => {
  if (settings.bookshelves?.legacySettingsMigrated) return false;
  const current = mergeBookshelfStates(settings.bookshelves);
  const migrated: BookshelfState = { rows: {}, legacySettingsMigrated: true };
  const deviceId = settings.replicaDeviceId || 'local';
  // These are initial defaults, not user edits. A real edit from another device
  // must win even if it arrives after this device upgrades.
  const timestamp = hlcPack(0, 0, deviceId);
  for (const shelf of defaultBookshelves(settings)) {
    if (current.rows[shelf.id]?.fields_jsonb['definition']) continue;
    const definition: BookshelfDefinition = {
      ...shelf,
      hideCovers: settings.libraryHideCovers,
      coverFit: settings.libraryCoverFit,
      skeuomorphicCovers: settings.librarySkeuomorphicCovers,
      ...(shelf.id === RECENT_BOOKSHELF_ID && { enabled: settings.libraryRecentShelfEnabled }),
    };
    migrated.rows[shelf.id] = {
      user_id: '',
      kind: 'bookshelf',
      replica_id: shelf.id,
      fields_jsonb: { definition: { v: definition, t: timestamp, s: deviceId } },
      updated_at_ts: timestamp,
      deleted_at_ts: null,
      reincarnation: null,
      manifest_jsonb: null,
      schema_version: 1,
    };
  }
  settings.bookshelves = mergeBookshelfStates(migrated, current);
  return true;
};
interface DraftClock {
  userId: string;
  deviceId: string;
  next: () => Hlc;
}
/** Only edited definitions and actual moves are applied to the latest state. */
export const applyBookshelfDraft = (
  state: BookshelfState,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
  clock: DraftClock,
  settings: Partial<SystemSettings> = {},
): { state: BookshelfState; operations: ReplicaRow[] } => {
  if (new Set(draft.map((s) => s.id)).size !== draft.length)
    throw new Error(_('Duplicate bookshelf.'));
  for (const s of draft) bookshelfSchema.parse(s);
  for (const id of BUILTIN_BOOKSHELF_IDS)
    if (!draft.some((s) => s.id === id))
      throw new Error(_('Built-in bookshelves cannot be deleted.'));
  if (!draft.some((s) => s.enabled)) throw new Error(_('Keep at least one bookshelf enabled.'));
  const operations: ReplicaRow[] = [];
  let next = state;
  const write = (id: string, fields: Record<string, unknown>, deleted = false) => {
    const t = clock.next();
    const row: ReplicaRow = {
      user_id: clock.userId,
      kind: 'bookshelf',
      replica_id: id,
      fields_jsonb: Object.fromEntries(
        Object.entries(fields).map(([key, v]) => [key, { v, t, s: clock.deviceId }]),
      ),
      deleted_at_ts: deleted ? t : null,
      updated_at_ts: t,
      reincarnation: null,
      manifest_jsonb: null,
      schema_version: 1,
    };
    operations.push(row);
    next = mergeBookshelfStates(next, { rows: { [id]: row } });
  };
  for (const shelf of base) if (!draft.some((s) => s.id === shelf.id)) write(shelf.id, {}, true);
  for (const shelf of draft) {
    if (next.rows[shelf.id]?.deleted_at_ts) continue;
    const original = base.find((s) => s.id === shelf.id);
    if (JSON.stringify(original) !== JSON.stringify(shelf)) write(shelf.id, { definition: shelf });
  }
  // Reconstruct the user's moves against the opening order. Untouched shelves,
  // including ones arriving remotely while the dialog is open, keep their stamps.
  const simulated = base.filter((s) => draft.some((d) => d.id === s.id)).map((s) => s.id);
  for (let i = 0; i < draft.length; i++) {
    const id = draft[i]!.id;
    if (next.rows[id]?.deleted_at_ts || simulated[i] === id) continue;
    const old = simulated.indexOf(id);
    if (old >= 0) simulated.splice(old, 1);
    simulated.splice(i, 0, id);
    const ordered = readBookshelves({ ...settings, bookshelves: next }).filter((s) => s.id !== id);
    const previousId = draft
      .slice(0, i)
      .reverse()
      .find((s) => ordered.some((current) => current.id === s.id))?.id;
    const previousIndex = previousId ? ordered.findIndex((s) => s.id === previousId) : -1;
    const previous = ordered[previousIndex];
    const following = ordered[previousIndex + 1];
    const lo = previous ? positionOf(next, previous.id) : undefined;
    const hi = following ? positionOf(next, following.id) : undefined;
    // Nothing fits after the predecessor. Make a gap there without changing
    // the surrounding order.
    if (lo !== undefined && hi !== undefined && crowded(lo, hi)) {
      const rest = ordered.slice(previousIndex + 1);
      const tied = rest.filter((s) => crowded(lo, positionOf(next, s.id)));
      const upper = rest.find((s) => !crowded(lo, positionOf(next, s.id)));
      const step = ((upper ? positionOf(next, upper.id) : lo + 1024) - lo) / (tied.length + 2);
      tied.forEach((s, index) => write(s.id, { position: lo + step * (index + 2) }));
      write(id, { position: lo + step });
      continue;
    }
    write(id, {
      position: lo === undefined ? (hi ?? 0) - 1024 : hi === undefined ? lo + 1024 : (lo + hi) / 2,
    });
  }
  if (!readBookshelves({ ...settings, bookshelves: next }).some((s) => s.enabled))
    throw new Error(_('Keep at least one bookshelf enabled.'));
  return { state: next, operations };
};
