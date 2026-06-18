# Sync Reading Status — Design

Issue: [#4634](https://github.com/readest/readest/issues/4634) — "FR: Sync reading status"

## Problem

A book's reading status (unread / reading / finished) does not reliably sync
across devices, and does not sync with KOReader. The reporter changes a book's
status near the end of reading (~95%) and the change is lost on other devices.

### Root cause (cross-device cloud sync)

Reading status already has full sync plumbing:

- `ReadingStatus` type and `Book.readingStatus` (`src/types/book.ts:19,114`)
- `books.reading_status` column (`docker/volumes/db/init/schema.sql:19`)
- Two-way mapping in `src/utils/transform.ts:97,137`
- The `book` sync category is **on by default** (`src/services/constants.ts`)

The data travels, but the **merge clobbers it**. The `books` row carries two
independently-edited fields under one `updated_at`:

- `reading_status` — rare, intentional edits (library context menu / auto-finish)
- a denormalized `progress` — bumped on **every page turn**
  (`updateBookProgress` → `book.updatedAt = Date.now()`, `readerStore.ts:399`,
  `libraryStore.ts:114`)

Both the server upsert (`src/pages/api/sync.ts:362-387`) and the client
pull-merge (`src/app/library/hooks/useBooksSync.ts:128-132`) use **whole-row
last-writer-wins** keyed on that single `updated_at`. So a device that is
actively reading (fresh `updated_at`, stale status) overwrites a deliberate
"finished" set on another device. This is exactly the "change status at ~95%"
scenario: the book is being read on more than one device, so progress updates
dominate the timestamp and win the whole row.

(The progress→books "piggyback", `sync.ts:436-488`, deliberately writes only
`progress` + `updated_at` and leaves `reading_status` intact — partial
protection, but nothing protects against the library's whole-row push.)

### Root cause (KOReader)

The `readest.koplugin` already round-trips the `books` table — including
`reading_status` — through its `LibraryStore` SQLite
(`apps/readest.koplugin/library/librarystore.lua:38`, wire mapping at
`syncbooks.lua:150` / `librarystore.lua:747`). The missing bridge is between
the `LibraryStore.reading_status` and KOReader's **native per-book status**
(`summary.status` in the `.sdr` DocSettings sidecar). Pulled status is never
applied to `summary.status`, and KOReader status changes are never captured
back into the store.

## Goals

1. A reading-status change on one Readest device reliably propagates to others
   and is never clobbered by an orthogonal reading-progress update.
2. Reading status round-trips between Readest and KOReader: marking a book
   finished/reading/on-hold in either reflects in the other.
3. Backward compatible: older clients keep working; the change is additive.

## Non-goals

- Changing how reading **progress** (position/CFI) syncs.
- A separate sync-category toggle for status (it stays under `book`).
- Real-time push; existing throttle/debounce cadence is fine.

## Decisions (locked with maintainer)

- **Field-level LWW** via a dedicated `reading_status_updated_at` timestamp
  (additive nullable column). Chosen over "stop bumping updatedAt on page turns"
  because only a per-field timestamp preserves **both** status and progress;
  the alternative merely relocates the clobber to the denormalized progress bar.
- **Add an `abandoned` status to Readest** so KOReader's `abandoned` ("On hold")
  round-trips losslessly, rather than collapsing it.
- **Whole-library apply** in KOReader: pulled status is written to every
  matching local book's sidecar (resolved via `LibraryStore.file_path` /
  `local_present`), not just the currently-open book.

## Data model & merge rules

### Status value set

`ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned'`
(`undefined`/absent = no explicit status, rendered as a plain progress bar).

### Readest ⇄ KOReader status mapping

KOReader stores `summary.status ∈ { "reading", "abandoned", "complete" }`
(unopened books have no sidecar and render as "New"; there is no "unread").

| Readest         | KOReader `summary.status` |
| --------------- | ------------------------- |
| `finished`      | `complete`                |
| `reading`       | `reading`                 |
| `abandoned`     | `abandoned` ("On hold")   |
| `unread`        | clear `summary.status` (→ "New") |
| `undefined`     | leave sidecar untouched   |

Reverse mapping is the inverse; KOReader "New"/absent → Readest `unread`.

`unread` in Readest means **"not started / reset"**: it intentionally hides the
progress bar *and* any badge (`SHOW_UNREAD_STATUS_BADGE = false`,
`ReadingProgress` renders nothing — decision from `#3103`/`c58e172a5`), and the
reader clears it back to `undefined` the moment the book is opened
(`readerStore.ts:393-394`). Entry points: the batch `SetStatusAlert` and the
"un-finish" toggle in the single-book context menu. KOReader's faithful
equivalent of "not started" is **no sidecar status** ("New"), so
`unread → clear summary.status` is correct. The only nuance (not a real loss):
KOReader can't tell "deliberately marked not-started" from "never opened" —
both render as "New", which is harmless.

### Field-level last-writer-wins

`reading_status` is merged by `reading_status_updated_at` (ms), **independent**
of the row's `updated_at`. All other `books` columns keep whole-row LWW on
`updated_at`/`deleted_at` (unchanged). Concretely, when merging two versions of
a books row:

- pick the base row by the existing whole-row LWW (`updated_at`/`deleted_at`);
- then override `reading_status` + `reading_status_updated_at` with whichever
  side has the greater `reading_status_updated_at`.

This must run on **both** ends (server upsert and client pull-merge) so neither
direction can clobber the field. A missing `reading_status_updated_at` is
treated as `0` (oldest), so legacy rows never beat a real status edit.

### Timestamp stamping rule

`reading_status_updated_at` is set to "now" **only when `reading_status`
actually changes** — never on a pure progress update. Sources:

- Readest explicit edits (`Bookshelf.tsx` status handlers, `SetStatusAlert`).
- Readest auto-status in the reader (`readerStore.ts`: `unread`→cleared on open,
  →`finished` at 100%) — stamped inside `updateBookProgress` only when the
  status arg differs from the existing value.
- KOReader: the status change time is `summary.modified` parsed to day-ms
  (KOReader's own change date), falling back to detection-time ms if
  `summary.modified` is absent. Used as the field's ms stamp for LWW.
  (Day-granularity; see Known limitations.)

## Part A — Cloud field-level LWW (Readest web/app)

**Schema** (`docker/volumes/db/init/schema.sql` + new numbered migration in
`docker/volumes/db/migrations/`, applied to prod Supabase):

```sql
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS reading_status_updated_at timestamptz NULL;
```

Additive, nullable, backward compatible.

**Types** — `src/types/book.ts`:
- extend `ReadingStatus` with `'abandoned'`;
- add `Book.readingStatusUpdatedAt?: number`;
- add `DBBook.reading_status_updated_at?: string` (`src/types/records.ts`).

**Transform** — `src/utils/transform.ts`:
- to DB: `reading_status_updated_at: readingStatusUpdatedAt ? new Date(...).toISOString() : null`;
- from DB: `readingStatusUpdatedAt: reading_status_updated_at ? Date.parse(...) : undefined`.

**libraryStore.updateBookProgress** (`src/store/libraryStore.ts`):
- stamp `readingStatusUpdatedAt = Date.now()` iff `readingStatus !== book.readingStatus`;
  otherwise carry the existing value through.

**Explicit status edits** (`src/app/library/components/Bookshelf.tsx`
`updateBooksStatus` + `handleUpdateReadingStatus`): set
`readingStatusUpdatedAt: Date.now()` alongside `readingStatus`/`updatedAt`.

**Client pull-merge** (`src/app/library/hooks/useBooksSync.ts` `processOldBook`):
after the existing `mergedBook` whole-object LWW, override
`readingStatus`/`readingStatusUpdatedAt` by the greater `readingStatusUpdatedAt`.

**Server upsert** (`src/pages/api/sync.ts`, `books` branch only): keep whole-row
LWW for the row, but resolve `reading_status` / `reading_status_updated_at` by
the field-level rule. This means a corrected row may need to be written even
when the whole row "loses" (server newer overall, client status newer, or vice
versa). Implement as a books-specific post-step so `book_configs`/`book_notes`
are untouched.

## Part B — `abandoned` status in the Readest UI

- `StatusBadge` (`src/app/library/components/StatusBadge.tsx`): `abandoned` is a
  **visible badge** (label "On hold"; distinct color, eink-safe per DESIGN.md) —
  treated like `finished`, **not** like the intentionally badge-less `unread`.
  "On hold" is a state worth surfacing; the user always sees it.
- `ReadingProgress` (`.../ReadingProgress.tsx`): show the badge for `abandoned`
  (keep the progress bar — unlike `unread`, an on-hold book has real progress).
- Context menu (`BookshelfItem.tsx`) + menu ids (`libraryUtils.ts`): add a
  "Mark as On hold" action; keep "Mark as Finished" / "Mark as Unread" /
  "Clear Status".
- `SetStatusAlert.tsx`: add the batch "On hold" button.
- i18n: new keys via the key-as-content flow (`docs/i18n.md`); run extraction.

Copy note: internal value is `abandoned` (matches KOReader's stored value);
display label "On hold" mirrors KOReader. Final wording is a review item.

## Part C — KOReader status sync (readest.koplugin)

**LibraryStore** (`library/librarystore.lua`): add `reading_status_updated_at
INTEGER` to the `books` schema + `BOOK_COLS`, and migrate existing DBs with an
idempotent `ALTER TABLE ... ADD COLUMN` guarded against the
already-exists error (reusing the store's schema-version path if one exists —
to be confirmed in the plan). Carry the field in `row_to_wire` (`syncbooks.lua`)
and `parseSyncRow` (`librarystore.lua`).

**Status mapping module** (new `library/readingstatus.lua`): pure bidirectional
map per the table above (`readest_to_ko`, `ko_to_readest`), unit-tested.

**Apply (cloud → KOReader), whole-library** — in the library sync pull path
(`librarywidget.lua` `syncbooks.syncBooks` → after `pullBooks`): for each row
with `local_present == 1` and a resolvable `file_path`, reconcile:
- compare the row's `reading_status_updated_at` against the sidecar's effective
  status time; if cloud wins and the mapped `summary.status` differs, open
  `DocSettings:open(file_path)`, set `summary.status` (+ `summary.modified`),
  `flush()`, and `BookList.setBookInfoCacheProperty(file, "status", ...)`.

**Capture (KOReader → cloud), whole-library** — extend `localscanner` (which
already opens each sidecar and reads `partial_md5_checksum`): also read
`summary.status`, map to a Readest `reading_status`, and when it differs from
the stored row and the sidecar is the newer side, `touchBook(hash, {
reading_status, reading_status_updated_at = now })` so `pushChangedBooks` sends
the complete row. (Pushing through `LibraryStore` avoids a partial books row
that would null out other columns server-side.)

**Reconciliation = one pure function** so apply/capture converge and never
ping-pong. It compares `reading_status_updated_at` (store) vs the sidecar status
time and, on **any** mismatch, **equalizes both sides** to the winner (writes
the sidecar *and* the store row to the winning status + winning ms). Because
both sides end equal, the next scan finds no mismatch and stops — convergence is
guaranteed regardless of which side won.

**i18n + tests**: any new user-facing string via `_( )` + `.po` catalogs
(`docs`/i18n-koplugin flow); busted specs for the mapping module and the
reconcile decision (`spec/`), following existing `*_spec.lua` idioms.

## Testing strategy

Per `.claude/rules/test-first.md`, write failing tests first.

- **Part A unit (vitest)**: a merge helper test proving status survives when the
  other side is whole-row-newer due to progress; transform round-trip incl. the
  new field and `abandoned`; `updateBookProgress` stamps the status timestamp
  only on change. Server merge covered by a focused unit on the books field-level
  resolver.
- **Part B**: `StatusBadge` / context-menu tests extended for `abandoned`
  (mirror existing `book-context-menu.test.ts`).
- **Part C (busted)**: mapping module both directions; reconcile picks the newer
  side and converges (no oscillation across two passes).

## Verification (per `.claude/rules/verification.md`)

`pnpm test`, `pnpm lint`; `pnpm lint:lua` + `pnpm test:lua` (koplugin changed);
no `src-tauri/` changes expected (skip Rust gates). DB migration applied to the
docker schema and a new numbered migration file.

## Migration & rollout

- Additive nullable column; old clients ignore it (treated as `0`).
- New `abandoned` value: older clients that read it fall through their
  `finished`/`unread` checks to the default progress-bar branch — no crash,
  just no badge. Acceptable.
- koplugin `LibraryStore` schema version bump with an idempotent `ADD COLUMN`.

## Known limitations / risks

- **`unread` ⇄ KOReader "New" is faithful, with one harmless ambiguity** —
  `unread` ("not started / reset") maps to clearing `summary.status`, which is
  exactly KOReader's "New". KOReader simply can't distinguish "deliberately
  marked not-started" from "never opened"; both show as "New". No data loss.
- **KOReader status timestamp is coarse** — `summary.modified` is day-grained,
  so a same-day Readest edit (real ms) always beats a KOReader change made the
  same day. Edge case: KOReader auto-sets `reading` on a book's *first* open; if
  such a book was marked `finished` in Readest but never synced to this device
  via the Readest Library (which writes the sidecar proactively on Library sync),
  a direct first-open in KOReader could capture `reading` and beat an older
  Readest `finished`. Rare; user can re-set. Documented, not engineered around
  in v1.
- **Whole-library apply touches many sidecars** — bounded to `local_present`
  rows with changed status; writes are conditional and flushed per book.

## Implementation phasing

All three parts land in **one PR** on `feat/sync-reading-status`. Implement and
verify internally in order — A (cloud LWW) → B (Readest `abandoned` UI) →
C (koplugin bridge) — since A is the core fix, B adds the value C needs to be
lossless, and C depends on both. Each step is independently testable even though
they ship together.
