import { Book, BookConfig, BookNote } from '@/types/book';
import { resolveReferencePageCount } from '@/utils/progress';
import { bookGroupDiffers, pickFresherGroup } from '@/utils/book';
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
  // The reference page count is the one viewSettings key that crosses devices
  // (issue #5716) — it describes the book's print edition, not the screen. It
  // arrives as its own envelope key, so apply it to viewSettings by hand
  // rather than through the scalar spread above, which would replace the whole
  // local view settings object.
  // Strict `>`, unlike the scalar spread above: an equal timestamp keeps the
  // local count. The cloud path resolves the tie the same way, and both have to
  // agree or the two backends would pick different winners for the same pair of
  // configs. A tie is the ordinary steady state here — a remote-wins merge
  // copies remote.updatedAt onto the local config, so every later pull of an
  // unchanged remote ties.
  const mergedPageCount = resolveReferencePageCount(
    local.viewSettings?.referencePageCount,
    remote.referencePageCount,
    remoteConfigUpdated > localConfigUpdated,
  );
  // `> 0` keeps a config that never had a count free of an invented `0` key:
  // the resolver can only return a positive value when one of the two sides
  // actually carried one. An unset key and a 0 both mean "no count", so the
  // comparison normalizes the local side too.
  if (mergedPageCount > 0 && mergedPageCount !== (local.viewSettings?.referencePageCount ?? 0)) {
    merged.viewSettings = { ...merged.viewSettings, referencePageCount: mergedPageCount };
  }
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
 *     strictly newer (whole-subset LWW). `tags` travels with it — without that
 *     a re-tag of an already-synced book bumps `updatedAt`, wins LWW, yet the
 *     change is dropped by the overlay and never propagates (#4942). Assigning
 *     the raw remote value (not `?? local`) lets removals clear on peers too.
 *   - Group membership (`groupId` / `groupName`) used to ride that same clock,
 *     and that is what erased users' groups fleet-wide (#5911): `updatedAt` is
 *     stamped by an UPLOAD as well as by an edit, so a peer holding a
 *     never-grouped copy could win the row and clear the group. It now merges
 *     on its own `groupUpdatedAt` clock via `pickFresherGroup`, which also
 *     refuses to let an unstamped ungrouped row clear a group. A stamped
 *     removal still propagates — that is the #4942 contract, now on the right
 *     clock.
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
        tags: remote.tags,
        progress: remote.progress ?? local.progress,
        updatedAt: remote.updatedAt,
        metadataUpdatedAt: remote.metadataUpdatedAt,
      }
    : { ...local };
  if ((remote.readingStatusUpdatedAt ?? 0) > (local.readingStatusUpdatedAt ?? 0)) {
    merged.readingStatus = remote.readingStatus;
    merged.readingStatusUpdatedAt = remote.readingStatusUpdatedAt;
  }
  // The metadata group (title, author, tags, metadata) additionally merges on
  // its own metadataUpdatedAt clock — the client-side mirror of the native
  // server merge (issue #5438, same shape as the readingStatus clause above).
  // The row's updatedAt is dominated by page-turn progress, so without this a
  // device that read the book after a peer's metadata edit keeps (and
  // re-publishes) its stale copy. An unstamped-vs-unstamped tie keeps the
  // row-level result above (legacy behavior). Group membership and progress
  // stay on the row clock (#4942, #5067).
  const localMetaMs = local.metadataUpdatedAt ?? 0;
  const remoteMetaMs = remote.metadataUpdatedAt ?? 0;
  if (localMetaMs !== remoteMetaMs) {
    const winner = remoteMetaMs > localMetaMs ? remote : local;
    merged.title = winner.title;
    merged.author = winner.author;
    merged.tags = winner.tags;
    merged.metadata = winner.metadata ?? merged.metadata;
    merged.primaryLanguage = winner.primaryLanguage ?? merged.primaryLanguage;
    merged.metadataUpdatedAt = winner.metadataUpdatedAt;
  }
  // Group membership on its own clock (#5911), resolved after both row-level
  // branches so it is applied whichever side won the row.
  const group = pickFresherGroup(local, remote, remoteMetaNewer);
  merged.groupId = group.groupId;
  merged.groupName = group.groupName;
  merged.groupUpdatedAt = group.groupUpdatedAt;
  // An absent `metadata` blob means "this side never had one" — a cloud-shelf
  // row, a discovery row, an old client — never "the user cleared it": nothing
  // in the app empties book.metadata. So it never wins, on any clock. Without
  // this a metadata-less peer erased every book's description across the fleet
  // (#5912).
  merged.metadata = merged.metadata ?? remote.metadata ?? local.metadata;
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
 * True when the remote copy is newer on ANY clock — book row (`updatedAt`),
 * reading status (`readingStatusUpdatedAt`), or the metadata group
 * (`metadataUpdatedAt`, #5438). Checking only `updatedAt` would skip the
 * field-only-newer cases entirely, so a peer's Finished mark or metadata edit
 * could never reach a device that touched the book row afterwards.
 *
 * This is also what tells the engine the remote BYTES may have moved, so it is
 * the gate for re-pulling the cover and the config — the repair cases below
 * change only index fields and must not cost a download each.
 */
export const isRemoteBookClockNewer = (local: Book, remote: Book): boolean =>
  (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ||
  (remote.readingStatusUpdatedAt ?? 0) > (local.readingStatusUpdatedAt ?? 0) ||
  (remote.metadataUpdatedAt ?? 0) > (local.metadataUpdatedAt ?? 0);

export const shouldApplyRemoteBookMetadata = (local: Book, remote: Book): boolean =>
  !remote.deletedAt && !local.deletedAt && isRemoteBookClockNewer(local, remote);

/**
 * FULL SYNC ONLY. Fields the remote index holds that this device is missing
 * outright, with no clock saying so — the repair half of the reconciliation
 * trigger, and the pass that gets a device's own shelf back after #5911 / #5912
 * emptied it.
 *
 * Both cases are "an absent value must never win", and neither can loop:
 * applying the merge makes the local row equal the resolution, after which this
 * is false again.
 *
 *  - A group the resolution says this device should be showing but isn't.
 *    `pickFresherGroup` is asked with `remoteRowWins: false` on purpose:
 *    whenever the remote genuinely wins the row, {@link isRemoteBookClockNewer}
 *    has already returned true, so the only question left here is the tie — and
 *    on a tie the merge itself resolves the same way.
 *  - A description this device does not have and the peer does.
 *
 * Never on the incremental path. It is true for an entire library at once on
 * the first run after the fix, and every hit costs a local library write
 * (`updateBookMetadata` -> `saveLibraryBooks` rewrites the WHOLE library file
 * plus its backup), so an incremental run would go quadratic in bytes written.
 * Incremental sync is O(changed) by contract; drift repair is Full Sync's job,
 * exactly as it is for `uploadedHashes` / `emptyDirs` and row-vs-filesystem
 * split-brain. Stopping the DAMAGE needs none of this — that is
 * {@link resolvePublishedBook}, which is free.
 */
export const isRemoteBookMissingLocally = (local: Book, remote: Book): boolean =>
  !remote.deletedAt &&
  !local.deletedAt &&
  (bookGroupDiffers(local, pickFresherGroup(local, remote, false)) ||
    (!local.metadata && !!remote.metadata));

/**
 * The row to PUBLISH into library.json for a book this device also holds,
 * resolved against the remote index entry.
 *
 * The index re-push rebuilds library.json from the LOCAL rows, so a device
 * whose row merely TIED the row clock republished its ungrouped, description-
 * less copy over the peer's good one — and every other device then pulled the
 * emptied row. That propagation is the whole of #5911 / #5912, and it is fixed
 * here rather than by reconciling local state: this is pure in-memory work over
 * a map the push already walks, so it costs no request and no library write and
 * keeps an incremental sync O(changed).
 *
 * Deliberately NOT a `mergeBookMetadata` call. This device's row still wins the
 * row on its own clock; the only claim made here is the narrow one that
 * publishing must never DELETE what the remote already had.
 */
export const resolvePublishedBook = (local: Book, remote: Book | undefined): Book => {
  if (!remote || remote.deletedAt || local.deletedAt) return local;
  const group = pickFresherGroup(local, remote, (remote.updatedAt ?? 0) > (local.updatedAt ?? 0));
  // The metadata group resolves on its own `metadataUpdatedAt` clock here too,
  // and as a GROUP (title / author / tags / blob move together) exactly as
  // `mergeBookMetadata` resolves it — otherwise the published row would pair
  // one device's title with another's description.
  //
  // Under 'silent' the reconcile pass has already applied this to the local row
  // before the push, so this is a no-op. Under 'send' it is the only thing
  // standing between a peer's newer description and a stale local blob: that
  // strategy applies nothing from the remote, so the reconcile never runs.
  // Publishing over it anyway would erase what a peer contributed, which is the
  // invariant #5900 established for send runs and the index.
  const remoteMetaNewer = (remote.metadataUpdatedAt ?? 0) > (local.metadataUpdatedAt ?? 0);
  const meta = remoteMetaNewer ? remote : local;
  // Never delete a blob the remote has, whichever side won the clock.
  const metadata = meta.metadata ?? local.metadata ?? remote.metadata;
  if (
    group.groupId === local.groupId &&
    group.groupName === local.groupName &&
    group.groupUpdatedAt === local.groupUpdatedAt &&
    !remoteMetaNewer &&
    metadata === local.metadata
  ) {
    return local;
  }
  return {
    ...local,
    ...group,
    ...(remoteMetaNewer
      ? {
          title: remote.title,
          author: remote.author,
          tags: remote.tags,
          primaryLanguage: remote.primaryLanguage ?? local.primaryLanguage,
          metadataUpdatedAt: remote.metadataUpdatedAt,
        }
      : {}),
    metadata,
  };
};
