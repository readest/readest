import { Book, BookConfig, BookNote } from '@/types/book';
import { RemoteBookConfig } from './wire';

/**
 * Declarative merge policies for the file-sync engine. Each function is
 * pure (no I/O) and independently unit-tested with algebraic laws so the
 * convergence guarantees are explicit rather than implied by the
 * orchestration code:
 *   - notes      → element-set CRDT (union by id, per-note updatedAt,
 *                  deletedAt tombstones).
 *   - config     → last-writer-wins on `config.updatedAt` for scalars,
 *                  notes merged via the CRDT regardless of scalar winner.
 *   - book meta  → last-writer-wins on `book.updatedAt` over a fixed field
 *                  subset; device-local / on-disk fields always preserved.
 *
 * State-based CRDT semantics make this safe over a lossy single-file
 * transport: every replica holds full state and re-merges, so a blind PUT
 * of a merged superset converges even when intermediate writes are lost.
 */

/**
 * Per-note merge: pick the locally-stored copy or the remote copy of each
 * note based on `updatedAt` / `deletedAt`. Mirrors `processNewNote` in
 * `useNotesSync.ts` so users get the same semantics regardless of which
 * sync backend produced the row.
 *
 * A note is keyed by `id`. When the same id exists on both sides we keep
 * whichever side has the larger updatedAt; ties go to the side whose
 * `deletedAt` is more recent (which usually means the deletion came after
 * the creation/edit).
 */
export const mergeNotes = (local: BookNote[], remote: BookNote[]): BookNote[] => {
  const byId = new Map<string, BookNote>();
  for (const n of local) byId.set(n.id, n);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    const lUpdated = l.updatedAt ?? 0;
    const rUpdated = r.updatedAt ?? 0;
    const lDeleted = l.deletedAt ?? 0;
    const rDeleted = r.deletedAt ?? 0;
    if (rUpdated > lUpdated || rDeleted > lDeleted) {
      byId.set(r.id, { ...l, ...r });
    } else {
      byId.set(r.id, { ...r, ...l });
    }
  }
  return Array.from(byId.values());
};

/**
 * Merge a remote config envelope into the local BookConfig.
 *
 * Scalars use a per-config `updatedAt` LWW (same as the native cloud sync
 * in `useProgressSync.applyRemoteProgress`); booknotes always merge via the
 * element-set CRDT regardless of which side won the scalar race. Null /
 * undefined remote fields are dropped before the spread so a server can
 * never inject keys the wire envelope isn't supposed to carry (viewSettings,
 * searchConfig, RSVP) — those never appear in `remote.config` because
 * `buildRemotePayload` strips them on push.
 *
 * Returns both the merged config (with `booknotes` populated) and the merged
 * notes separately so callers can drive a live view off the note set.
 */
export const mergeBookConfig = (
  local: BookConfig,
  remote: RemoteBookConfig,
): { config: BookConfig; notes: BookNote[] } => {
  const remoteConfigUpdated = remote.config.updatedAt ?? remote.updatedAt;
  const localConfigUpdated = local.updatedAt ?? 0;
  const filteredRemote = Object.fromEntries(
    Object.entries(remote.config).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<BookConfig>;
  const merged: BookConfig =
    remoteConfigUpdated >= localConfigUpdated
      ? ({ ...local, ...filteredRemote } as BookConfig)
      : ({ ...filteredRemote, ...local } as BookConfig);
  const notes = mergeNotes(local.booknotes ?? [], remote.booknotes ?? []);
  merged.booknotes = notes;
  return { config: merged, notes };
};

/**
 * Overlay the user-facing metadata of `remote` onto `local`, preserving every
 * device-local / file-system field: `filePath`, `sourceTitle` (which names the
 * on-disk file), `coverImageUrl` (a device-local blob URL the caller
 * regenerates), `hash`, `format`, `createdAt`, etc.
 *
 * Two independent merge clocks, mirroring the native cloud sync:
 *   - The metadata field subset applies only when `remote.updatedAt` is
 *     strictly newer (whole-subset LWW). Group membership (`groupId` /
 *     `groupName`) and `tags` travel with it — without them a re-group or
 *     re-tag of an already-synced book bumps `updatedAt`, wins LWW, yet the
 *     change is dropped by the overlay and never propagates (#4942).
 *     Assigning the raw remote values (not `?? local`) lets removals
 *     (undefined) clear on peers too.
 *   - `readingStatus` merges on its own `readingStatusUpdatedAt` clock
 *     (field-level LWW, the client-side mirror of the native server merge,
 *     #4634). This survives the asymmetric race where this device edited
 *     metadata AFTER a peer changed the status: whole-book LWW alone would
 *     silently drop the status change.
 *
 * `progress` rides the row's `updatedAt` clock like the rest of the subset, so
 * a peer's reading position reaches the shelf without opening the book (#5067).
 * The bookshelf renders `book.progress`, and only `saveConfig` ever wrote it —
 * so before this the percentage stayed stale until the user opened the book,
 * even though the row itself re-sorted to the front on the remote `updatedAt`.
 * This is the same field the native cloud sync carries on its `books` row.
 * Unlike tags / groups it falls back to the local value when the remote row has
 * none: absent progress means "that peer never opened the book", not "the user
 * cleared it" (there is no clear-progress gesture), and a raw assignment would
 * let a rename on an unread peer wipe a real percentage.
 *
 * The metadata subset mirrors `getBookWithUpdatedMetadata` in `utils/book.ts`,
 * the local side of the same operation. The cover image is replicated
 * separately as cover.png bytes (see the reconciliation pass in the engine),
 * so it is intentionally absent here.
 */
export const mergeBookMetadata = (local: Book, remote: Book): Book => {
  const remoteMetaNewer = (remote.updatedAt ?? 0) > (local.updatedAt ?? 0);
  const merged: Book = remoteMetaNewer
    ? {
        ...local,
        title: remote.title,
        author: remote.author,
        metadata: remote.metadata ?? local.metadata,
        primaryLanguage: remote.primaryLanguage ?? local.primaryLanguage,
        groupId: remote.groupId,
        groupName: remote.groupName,
        tags: remote.tags,
        progress: remote.progress ?? local.progress,
        updatedAt: remote.updatedAt,
      }
    : { ...local };
  if ((remote.readingStatusUpdatedAt ?? 0) > (local.readingStatusUpdatedAt ?? 0)) {
    merged.readingStatus = remote.readingStatus;
    merged.readingStatusUpdatedAt = remote.readingStatusUpdatedAt;
  }
  return merged;
};

/**
 * LWW predicate for the library-index metadata reconciliation: true when the
 * remote indexed copy is strictly newer than the local one and neither side
 * is tombstoned. A strict `>` keeps the pass a no-op when timestamps match so
 * we never re-apply identical metadata or bounce updates between devices.
 */
export const isRemoteBookMetadataNewer = (local: Book, remote: Book): boolean =>
  !remote.deletedAt && !local.deletedAt && (remote.updatedAt ?? 0) > (local.updatedAt ?? 0);

/**
 * Reconciliation trigger: apply `mergeBookMetadata` when the remote copy is
 * newer on EITHER clock — book metadata (`updatedAt`) or reading status
 * (`readingStatusUpdatedAt`). Checking only `updatedAt` would skip the
 * status-only-newer case entirely, so a peer's Finished mark could never
 * reach a device that edited the book's metadata afterwards.
 */
export const shouldApplyRemoteBookMetadata = (local: Book, remote: Book): boolean =>
  !remote.deletedAt &&
  !local.deletedAt &&
  ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ||
    (remote.readingStatusUpdatedAt ?? 0) > (local.readingStatusUpdatedAt ?? 0));
