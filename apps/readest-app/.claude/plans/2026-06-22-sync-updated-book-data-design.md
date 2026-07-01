# Sync Updated Book Data (Cover + File) — Design

**Issue:** [#4544 — Customized Book Cover Not Synced](https://github.com/readest/readest/issues/4544)
**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan

## Problem

A user changed a book's cover via Readest's metadata editor on macOS. The new
cover appeared on the Mac but never propagated to their iPad or other devices.
More generally, Readest cannot re-sync a book's **cover** after the book has
been uploaded — the cover is uploaded once at first sync and downloaded once per
peer, with no way to detect or propagate a later change.

### Root cause (verified)

1. A cover lives in cloud storage at `books/<hash>/cover.png`, uploaded **once**
   by `cloudService.uploadBook()` (which stamps `book.uploadedAt`).
   — `src/services/cloudService.ts:195-200,216-218`
2. Peers download the cover **once**, gated one-shot on
   `!book.deletedAt && book.uploadedAt && !book.coverDownloadedAt`. Once
   `coverDownloadedAt` is set it never refetches.
   — `src/app/library/hooks/useBooksSync.ts:119-128`
3. Editing the cover (`handleUpdateMetadata` → `appService.updateCoverImage`)
   writes the new `cover.png` **locally only** and bumps `book.updatedAt`. It
   never re-uploads the cover and emits no synced signal that the cover changed.
   The cover is keyed by the **file** hash, so a cover-only edit changes **no
   hash** — there is nothing for peers to detect.
   — `src/app/library/page.tsx:934-962`, `src/services/bookService.ts:158-170`

## Design principle: content hashes + the existing dedupe

Readest already identifies content by **partial MD5**:

- `book.hash` = `partialMD5` of the **file bytes** (sampled ranges) — the unique
  identifier. `src/utils/md5.ts:11-30`
- `book.metaHash` = MD5 of `title|authors|identifiers` — the "logical book"
  across versions. `src/utils/book.ts:355-372`

We extend the same content-addressed philosophy to the cover, and we reuse the
existing dedupe for the file, rather than inventing a parallel versioning system.

### File updates ride the existing re-import / dedupe (no new field)

A changed file already changes its `partialMD5` (`book.hash`). The importer's
Tier-3 **metaHash match** (`bookService.ts:402-458`, `mergeBooks`
`bookService.ts:183-245`) already handles re-import of an edited file:

- overwrites `book.hash` with the new file's hash, overwrites metadata,
- migrates `config.json` / booknotes to the new `Books/<newhash>/` dir,
- **soft-deletes** the old entry (`deletedAt`), and sets `uploadedAt=null` to
  force re-upload of the new file + cover.

Cross-device, this converges through existing sync: peers pull the **old-hash
row with `deleted_at`** (remove old) and the **new-hash row with `uploaded_at`**
(download new), and progress/notes follow the `book_hash OR meta_hash` pull
query (`sync.ts:142`, `useNotesSync.ts:183`).

> Implication: there is **no** `fileUpdatedAt`, no stable-hash-vs-content split,
> and no in-place file replacement. "Use the partial MD5 to detect a file
> update" is already true — the hash *is* the file's partial MD5, and changing
> the file changes the hash. The book's identity for progress/notes is preserved
> by `metaHash`, exactly the dedupe mechanism.

This part of the work is **verify + fix gaps**, not new architecture (see §E).

### Cover updates use a cover content hash (new)

The cover is keyed by the *file* hash, so a cover-only edit changes no hash and
emits no signal. Fix: give the cover its own content hash.

- **`coverHash`** = `partialMD5` of the local `cover.png`, synced.
- **Invariant:** on every device, `book.coverHash === partialMD5(cover.png)`.
- A peer re-downloads the cover **iff** `synced.coverHash !== local.coverHash`.
  Content-addressed ⇒ re-extracting/re-importing a byte-identical cover yields
  the same hash ⇒ **no churn** (the dedupe-compatible property).
- **`coverUpdatedAt`** (timestamp) accompanies it purely for **merge ordering**:
  the cover edit shares the `books` row with page-turn progress, so without a
  per-field timestamp a concurrent page-turn would clobber a just-edited
  `coverHash` under whole-row last-writer-wins — the #4634 bug class fixed by
  `reading_status_updated_at`. `coverHash` answers *"did it change?"*;
  `coverUpdatedAt` answers *"whose change wins?"*.

## Scope

In scope:

- **Cover update sync** (build): `coverHash` + `coverUpdatedAt`, re-upload on
  edit, peer re-download on hash diff. Fixes #4544 and covers both triggers — a
  metadata-editor cover edit, and a re-extracted cover from a re-imported file.
- **File update sync** (leverage + verify): rely on the existing re-import /
  metaHash dedupe; verify cross-device convergence end-to-end and fix any gaps.

Out of scope:

- Dedicated "Replace file…" UI. Users update a file by re-importing it normally
  (drag-drop / open-with / file picker); the dedupe path handles it.
- Remapping reading position (CFI) across a structurally-changed file (inherent
  to changing the bytes; best-effort via the metaHash config carry-over).
- Preserving a **custom** cover across a file re-import. Tier-3 re-import
  re-extracts the cover from the new file, overwriting a custom one. Pre-existing
  behavior; noted as a future consideration, not solved here (see §E).

## A. Data model & schema

**Migration** `docker/volumes/db/migrations/016_add_book_cover_version.sql`
(mirrors `015_add_reading_status_updated_at.sql`):

```sql
-- Migration 016: Add cover_hash / cover_updated_at to books
--
-- Cover-change sync. cover_hash = partial MD5 of cover.png (content-addressed
-- change detection: identical cover ⇒ identical hash ⇒ no re-sync churn).
-- cover_updated_at = field-level LWW timestamp so a page-turn that wins
-- whole-row LWW on updated_at cannot clobber a cover edit (same hazard the 015
-- reading_status_updated_at fix addressed for #4634). Both additive + nullable;
-- NULL cover_updated_at = epoch 0 (oldest) in the merge.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS cover_hash       text NULL,
  ADD COLUMN IF NOT EXISTS cover_updated_at timestamp with time zone NULL;
```

Mirror both columns into `docker/volumes/db/init/schema.sql` (the `books` table).

Types & transform:

- `DBBook` (`src/types/records.ts`): add `cover_hash?: string | null`,
  `cover_updated_at?: string | null`.
- `Book` (`src/types/book.ts`): add `coverHash?: string | null`,
  `coverUpdatedAt?: number | null`.
- `src/utils/transform.ts`: map both directions (`cover_hash` ↔ `coverHash`
  verbatim; `cover_updated_at` ms ↔ ISO), like `reading_status_updated_at`
  (`transformBookToDB` ~99-107, `transformBookFromDB` ~143-151).

New helper (e.g. `src/services/bookService.ts` or `src/utils/book.ts`):

```ts
// Open Books/<hash>/cover.png as a File and partial-MD5 it. Returns null if
// the cover is absent. Keeps book.coverHash === partialMD5(cover.png).
computeCoverHash(fs, book): Promise<string | null>
```

## B. Local change → recompute hash + re-upload + signal

### Cover edit (extend the existing path)

In `handleUpdateMetadata` (`src/app/library/page.tsx:934-962`), after
`appService.updateCoverImage()` writes `cover.png`:

1. `const newHash = await appService.computeCoverHash(book);`
2. **Idempotency gate:** if `newHash === book.coverHash`, do nothing further (no
   timestamp bump, no re-upload, no churn).
3. Else: `book.coverHash = newHash; book.coverUpdatedAt = Date.now();` and bump
   `book.updatedAt` (already happens via `getBookWithUpdatedMetadata`; keep the
   value consistent).
4. If `book.uploadedAt || settings.autoUpload`, re-upload **only** the cover via
   a new `appService.uploadBookCover(book)` (it must **not** touch `uploadedAt`,
   which means "the file is in cloud as of T").
5. `updateBook(envConfig, book)` persists; the existing push (`getNewBooks` keys
   off `updatedAt` — `useBooksSync.ts:26-32`) carries the row incl. the new
   `coverHash` / `coverUpdatedAt`.

New `cloudService.uploadBookCover(fs, resolveFilePath, book, onProgress?)`: a
small sibling of `uploadBook` that uploads only `cover.png` to
`books/<hash>/cover.png`.

### Cover on import / re-import (maintain the invariant)

In the cover-extract path (`bookService.ts:500-512`), after writing `cover.png`,
set `book.coverHash = partialMD5(cover.png)` (and leave `coverUpdatedAt` unset on
first import — the cover version is established when first synced/uploaded; the
diff machinery handles first download via the existing `!coverDownloadedAt`
gate). On a Tier-3 re-import the new file's extracted cover yields a fresh
`coverHash` for the new `book.hash`; peers receive it via the new-book download.

## C. Server merge (`src/pages/api/sync.ts`)

Add `resolveCoverMerge(client, server)` next to `resolveReadingStatusMerge`
(`sync.ts:60-74`): pick `{cover_hash, cover_updated_at}` from whichever side has
the greater `cover_updated_at` (NULL = epoch 0). In the `books` branch of
`upsertRecords` (`sync.ts:417-455`), alongside the existing reading-status graft:

- **Client wins the row** (`clientIsNewer`): graft the resolved cover fields onto
  the client row before `toUpdate.push`.
- **Server wins the row but the client's cover is newer**
  (`cover_updated_at` greater **and** `cover_hash` differs): write the server row
  with the client's cover fields and bump `updated_at = now()` so peers re-pull
  (mirrors the existing `statusChanged` re-propagation branch).
- Else: server row authoritative.

This guarantees a cover edit survives even when a concurrent page-turn dominates
whole-row LWW on `updated_at`.

## D. Peer pull → re-download on hash diff (`src/app/library/hooks/useBooksSync.ts`)

Extend `updateLibrary` / `processOldBook` (`useBooksSync.ts:119-147`). Keep the
existing first-download path (`!oldBook.coverDownloadedAt`) for new/never-fetched
books — and have it **adopt** the synced hash (`oldBook.coverHash =
matchingBook.coverHash ?? (await computeCoverHash(oldBook))`) so the invariant
holds and the change path below sees equality afterwards. Then add a **change**
path:

For a synced book with `!deletedAt && uploadedAt && matchingBook.coverHash`:

1. If `oldBook.coverHash == null`, lazily compute it from the **local**
   `cover.png` (`oldBook.coverHash = await computeCoverHash(oldBook)`). This runs
   **only** for books that carry a synced `coverHash` (i.e. someone edited the
   cover) and lack a local hash — a bounded set, not every book.
2. If `oldBook.coverHash !== matchingBook.coverHash`: re-download the cover
   **forcing overwrite**, set `oldBook.coverHash = matchingBook.coverHash` and
   `oldBook.coverImageUrl = await appService.generateCoverImageUrl(oldBook)`.
   Optionally recompute the downloaded cover's hash and warn if it doesn't match
   `matchingBook.coverHash` (cloud lagging a concurrent overwrite — best-effort).

`cloudService.downloadBookCovers` / `downloadBook` get a force/`redownload` flag
so a changed cover overwrites the existing local file (today they skip when the
file already exists — `cloudService.ts:233-272,287-289`).

The merged book carries the resolved `coverHash` / `coverUpdatedAt` forward.

## E. File updates via re-import (verify + fix gaps)

No new architecture. Implementation tasks:

1. **Verify cross-device convergence** of an edited-file re-import end-to-end:
   device A re-imports an edited file (same title/author) → A re-keys hash,
   soft-deletes old, re-uploads new → device B removes the old version,
   downloads the new, and carries progress/notes via `metaHash`.
2. **Fix gaps** found, e.g.: peer cleanup of the **old** local `Books/<oldhash>/`
   dir and its cloud objects (orphan avoidance); ensuring the soft-deleted
   old-hash row and the new-hash row are both pushed in the same sync; ensuring a
   re-uploaded new file actually triggers the peer download path.
3. **Custom cover note:** a Tier-3 re-import re-extracts the cover, overwriting a
   custom one. If we later want to preserve a custom cover across re-import, we
   can compare the pre-import `coverHash` against the freshly-extracted hash and
   keep the custom cover when it differs — explicitly deferred.

## Edge cases

- **Idempotent re-extract / re-import:** identical cover bytes ⇒ identical
  `coverHash` ⇒ no re-upload, no peer re-download (the dedupe-compatible win).
- **Legacy books (no `coverHash`):** no diff is computed until some device edits
  the cover and syncs a `coverHash`; peers then lazily compute their local hash
  to compare (§D). No mass re-download.
- **Not-yet-uploaded book:** `coverHash`/`coverUpdatedAt` bump locally and ride
  the first `uploadBook`; peers gate on `uploadedAt`.
- **Concurrent cover edits across devices:** resolved by `coverUpdatedAt`
  field-level max-merge (§C); the losing device re-downloads the winner's cover.
- **Web / OPFS:** `cover.png` lives in OPFS via `fs`; `computeCoverHash` opens it
  as a File the same way `uploadFileToCloud` does.
- **Old clients:** ignore `cover_hash` / `cover_updated_at` → they neither read
  nor write them, so they don't propagate cover edits (today's behavior) and
  never break.
- **Delete:** unchanged. `deleted_at` tombstone + the `!deletedAt` gate take
  precedence; cloud delete still clears `uploadedAt` and removes `cover.png`.

## Testing (test-first)

Unit (vitest):

1. `transform.ts` — round-trips `coverHash` (verbatim) and `coverUpdatedAt`
   (ms ↔ ISO), incl. null.
2. `resolveCoverMerge` — picks the side with greater `cover_updated_at`; graft
   onto client-wins row; graft + `updated_at` re-propagation when server wins the
   row but client cover is newer **and** hash differs; NULL = epoch 0; equal
   hash ⇒ no re-propagation churn.
3. `computeCoverHash` — stable per content; differs after a cover edit; null when
   no cover.
4. Cover-edit path (`handleUpdateMetadata`): identical new cover ⇒ no bump / no
   `uploadBookCover`; changed cover ⇒ bumps `coverHash`+`coverUpdatedAt` and
   calls `uploadBookCover` when uploaded/autoUpload (skips upload otherwise).
5. `useBooksSync` re-download decisions: synced `coverHash` differs ⇒ force
   re-download + regenerate URL + adopt synced hash; equal ⇒ no-op; legacy
   (no synced hash) ⇒ no-op; lazy local-hash compute only for books with a
   synced hash; deleted ⇒ no-op.
6. **File re-import** (covers §E verification): an edited-file re-import re-keys
   `hash`, soft-deletes the old entry, migrates config/notes, and the resulting
   push set contains both the deleted old-hash row and the uploaded new-hash row.

Verification gates (per `.agents/rules/verification.md`): `pnpm test`,
`pnpm lint`. No `src-tauri/` or koplugin changes expected.

## Affected files (summary)

- `docker/volumes/db/migrations/016_add_book_cover_version.sql` (new)
- `docker/volumes/db/init/schema.sql`
- `src/types/records.ts`, `src/types/book.ts`
- `src/utils/transform.ts`
- `src/utils/book.ts` / `src/services/bookService.ts` (`computeCoverHash`;
  set `coverHash` in the import cover-extract path)
- `src/pages/api/sync.ts` (`resolveCoverMerge` + books-branch graft)
- `src/services/cloudService.ts` (`uploadBookCover`; force re-download in
  `downloadBookCovers`/`downloadBook`)
- `src/services/appService.ts` + `src/types/system.ts` (new app-service methods)
- `src/app/library/page.tsx` (cover-edit: idempotent hash, marker bump, cover
  re-upload)
- `src/app/library/hooks/useBooksSync.ts` (hash-diff cover re-download)
- (§E) re-import convergence verification + any gap fixes in
  `src/services/bookService.ts` / `src/services/ingestService.ts` /
  `src/services/cloudService.ts`
