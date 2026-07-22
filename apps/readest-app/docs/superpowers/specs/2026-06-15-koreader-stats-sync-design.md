# KOReader-compatible reading statistics with cross-device sync

- **Date:** 2026-06-15
- **Status:** Approved design — ready for implementation plan
- **Supersedes:** PR #3156 (`feat(statistics): add core session tracking (Phase 1)`) and tracking issue #3155
- **Related:** KOReader `statistics.koplugin`, Readest `apps/readest.koplugin`, legacy `/api/sync`

## 1. Summary

Add a reading-statistics system to Readest whose **canonical data model is KOReader's own**, so stats round-trip losslessly between Readest and KOReader. Stats are stored locally in a cross-platform Turso `statistics.db` (KOReader schema), tracked as per-page reading events, and synced across all of a user's devices — Readest apps **and** KOReader devices (via `apps/readest.koplugin`) — over the existing `/api/sync` transport.

This replaces PR #3156's approach (session aggregates in a `statistics.json` written with the Node-only `better-sqlite3`) which cannot run on web/mobile and is structurally incompatible with KOReader's per-page model.

## 2. Goals / Non-goals

### Goals

- Local stats persisted in a **Turso `statistics.db`** via the existing cross-platform `DatabaseService` (works on web Workers, desktop, iOS, Android).
- Local schema is **byte-for-byte KOReader-compatible** (`book`, `page_stat_data`, `page_stat` view, `numbers`).
- **Per-page event tracking** in the Readest reader (KOReader-style time-on-page with idle capping).
- **Cross-device sync** of stats through the legacy `/api/sync` endpoint, as a new `stats` type backed by a new Supabase table.
- **KOReader devices participate** via a new `readest_syncstats.lua` in `apps/readest.koplugin`, reusing the plugin's existing sync client/auth.
- Stats sync is **union/append-only** and merges contributions from every Readest and KOReader device.
- A **KOReader-compatible enrichment seam** (extension tables + a nullable `ext` field) so Readest can add richer-than-KOReader data later without breaking compatibility — **seam-only in v1, no data captured**.

### Non-goals (explicitly deferred)

- The statistics **UI page** (charts, calendar, streaks) — a later phase. This design only produces the data + sync substrate; the UI reads it via SQL.
- Reading **goals**.
- Routing stats through the HLC **replica CRDT** (`/api/sync/replicas`). Stats use the simpler legacy transport the koplugin already speaks; union-by-key needs no CRDT.
- **Capturing** enrichment data (chapter attribution, words/wpm, device). The extension seam is built (§5.6) but stays empty until the stats-UI phase.
- Migrating any PR #3156 `statistics.json` data (PR is unmerged; no field data exists).

## 3. Background

### 3.1 KOReader's model (the compatibility target)

`statistics.sqlite3` (verified against the sample DB at
`koreader-emulator-.../settings/statistics.sqlite3`):

```sql
CREATE TABLE book (
  id integer PRIMARY KEY autoincrement,
  title text, authors text, notes integer, last_open integer,
  highlights integer, pages integer, series text, language text,
  md5 text, total_read_time integer, total_read_pages integer );
CREATE UNIQUE INDEX book_title_authors_md5 ON book(title, authors, md5);

CREATE TABLE page_stat_data (
  id_book integer, page integer NOT NULL DEFAULT 0,
  start_time integer NOT NULL DEFAULT 0, duration integer NOT NULL DEFAULT 0,
  total_pages integer NOT NULL DEFAULT 0,
  UNIQUE (id_book, page, start_time),
  FOREIGN KEY(id_book) REFERENCES book(id) );
CREATE INDEX page_stat_data_start_time ON page_stat_data(start_time);

CREATE TABLE numbers (number INTEGER PRIMARY KEY);   -- rescale helper for the view
CREATE VIEW page_stat AS ...;                         -- rescales rows when total_pages changes
```

Key facts:

- The unit of truth is the **per-page read event** in `page_stat_data`: "on `page` of a book that had `total_pages`, starting at Unix-second `start_time`, you read for `duration` seconds." Events are **immutable and append-only**; `(id_book, page, start_time)` is unique.
- `book.total_read_time` / `total_read_pages` are **derived caches** of the page events.
- Book identity is `md5 = util.partialMD5(file)` — a non-uniform sampled MD5 (steps `1024 << (2*i)`, 1 KiB samples, `i = -1..10`).
- KOReader's own cross-device sync is a 3-way SQL merge of the whole `statistics.sqlite3` file over cloud storage, unioning `page_stat_data` keyed on `(title, authors, md5)` → `(page, start_time)`. **We reproduce the union semantics, not the file transport.**

### 3.2 Readest infrastructure we build on

- **Cross-platform Turso layer:** `appService.openDatabase(schema, path, base, opts)` → `DatabaseService` (`execute` / `select` / `batch` / `close`), with an auto-migration system (`migrate.ts`, `getMigrations(schema)`). Already used by `reedy.db`, `opds.db`, `library.db`. Native = `tauri-plugin-turso`; web = `@readest/turso-database-wasm` (OPFS); node = `@tursodatabase/database`.
- **`partialMD5` already equals KOReader's** (`src/utils/md5.ts::partialMD5`, byte-identical algorithm) and is already `Book.hash`. **Book identity matches KOReader with no extra work.**
- **Progress model:** `BookProgress.pageinfo = { current /*0-based*/, total }` + `location` (CFI) — enough to emit page events.
- **Legacy sync `/api/sync`:** `SyncType = 'books' | 'configs' | 'notes'`, Supabase-backed, pull by `since` timestamp (+ optional `book`/`meta_hash`), push `{ books, notes, configs }`. Records keyed by `(user_id, book_hash, meta_hash)` with `updated_at` / `deleted_at`. **This is the endpoint `apps/readest.koplugin` already uses** (`readest-sync-api.json`, `readest_syncconfig.lua`).
- **Reader lifecycle hook point:** PR #3156's `BookSessionTracker` mounts per `bookKey` (in `BooksGrid` / `ReaderContent`) and already wires idle timers + `visibilitychange`. We keep this shell and change what it records.

## 4. Architecture

```
┌─ Readest app (web/desktop/mobile) ─┐         ┌─ KOReader device ──────────┐
│  Turso  statistics.db              │         │  statistics.sqlite3        │
│  (KOReader schema)                 │         │  (native)                  │
│        ▲ page-event tracker        │         │     ▲ KOReader writes       │
└────────┼───────────────────────────┘         └─────┼──────────────────────┘
         │ push/pull type=stats                      │ readest_syncstats.lua
         └──────────────┬────────────────────────────┘ (push/pull type=stats)
                        ▼
        /api/sync (Supabase: book_page_stats)
        upsert/union by (user_id, book_hash, page, start_time)
```

- **One canonical format** (KOReader's). **One transport** (legacy `/api/sync`). **One merge rule** (union/upsert).
- **The stats payload is self-contained** — it carries both `book` metadata records and `page_stat_data` event records, exactly like KOReader's `statistics.sqlite3` bundles `book` + `page_stat_data`. No join against the `books` sync table; a stats consumer (Readest app or koplugin) can rebuild a complete `statistics.sqlite3` from the stats payload alone.
- **Everything is keyed by the stable `book_hash`, never the local autoincrement `id_book`** (which is per-device). Each device maps `book_hash` → its own local `id_book` on import.
- **Synced book metadata is trimmed to KOReader's identity triple: `md5` + `title` + `authors`.** Everything else in KOReader's `book` table is **derived locally** and never synced: `pages` = latest event's `total_pages`, `last_open` = `max(start_time + duration)`, `total_read_time` / `total_read_pages` summed from events; `series` / `language` / `notes` / `highlights` are left NULL/0 (valid KOReader schema, filled by KOReader itself when it opens the book). This keeps the local `statistics.db` a valid KOReader export while syncing only the irreducible identity.
- Derived analytics (sessions, daily summaries, streaks, hour/day heatmaps) are **SQL queries over `page_stat_data`**, computed on demand by the future UI — nothing extra stored or synced.

## 5. Component design

### 5.1 Local store — `src/services/statistics/`

- New `'statistics'` migration schema registering the KOReader DDL verbatim (book, page_stat_data, page_stat view, numbers, indexes). Registered in `getMigrations('statistics')`.
- `statisticsDb.ts`: opens `statistics.db` via `appService.openDatabase('statistics', 'statistics.db', 'Data')`; thin typed helpers:
  - `upsertBook(meta) → id_book` (upsert by `(title, authors, md5)`).
  - `insertPageEvent(id_book, page, start_time, duration, total_pages)` — upsert on the unique key `(id_book, page, start_time)` via `ON CONFLICT … DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages` (a re-flush of the same page-read with a longer duration wins; a return visit at a different `start_time` is a distinct row, as in KOReader).
  - `recomputeBookTotals(id_book)`.
  - `getEventsSince(ts)` / `applyRemoteEvents(events)` for sync.
- `numbers` is seeded to a fixed range (KOReader seeds 1..1000) so the `page_stat` view's rescale join works.

### 5.2 Tracker — replace PR's session logic in `BookSessionTracker.tsx`

Keep the mount-per-`bookKey` shell + idle/visibility wiring. Record **page events**, not sessions:

- State per book: `currentPage`, `pageEnterTime` (Unix s), `totalPages`.
- **Flush a page event** `(page=currentPage, start_time=pageEnterTime, duration=cappedElapsed, total_pages)` on: page change, idle timeout, tab hidden (`visibilitychange`), and book close (unmount). **No periodic tick** — every flushed event is final/immutable (its `start_time` and `duration` never change afterward), which lets cross-device sync use a simple `start_time` high-water push cursor. An idle timeout flushes-and-pauses; resuming the same page starts a fresh event with a new `start_time`.
- **Duration cap:** `duration = min(now - pageEnterTime, maxEventSeconds)`, mirroring KOReader's per-page cap (default 120 s; configurable). Events shorter than a small floor are dropped (KOReader ignores sub-second flips).
- `page = pageinfo.current + 1`, `total_pages = pageinfo.total`. Units = Unix **seconds** throughout (matches KOReader; the PR already converts).
- On first event for a book, `upsertBook` from library metadata (title/authors/pages/series/language/md5=Book.hash).

### 5.3 Sync — server (`/api/sync`, Supabase)

The stats type carries **two self-contained record sets** (mirroring KOReader's `book` + `page_stat_data`), both keyed by `book_hash`:

- `stat_books` — identity only:
  `user_id, book_hash, title, authors, updated_at, deleted_at`,
  primary key `(user_id, book_hash)`, index on `updated_at`. (No `pages` / `last_open` / `series` / `language` / totals — derived locally.)
- `stat_pages` — page events:
  `user_id, book_hash, page, start_time, duration, total_pages, updated_at, deleted_at`,
  primary key `(user_id, book_hash, page, start_time)`, index on `updated_at`.
- Extend `SyncType` with `'stats'`. GET returns `{ statBooks: [...], statPages: [...] }` changed since `since` (optional `book` filter). POST upserts both:
  - `stat_pages`: `ON CONFLICT … DO UPDATE SET duration = greatest(duration, excluded.duration), total_pages = excluded.total_pages, updated_at = now()`.
  - `stat_books`: `ON CONFLICT (user_id, book_hash) DO UPDATE SET title = excluded.title, authors = excluded.authors, updated_at = now()` (latest title/authors win — handles a renamed book).
  - Deletes (a book's stats cleared) set `deleted_at` on both.
- No dependency on the `books` table — stats are fully self-describing.

### 5.4 Sync — Readest app client (`src/services/sync/` + statistics service)

- After a flush batch, **push** new page events **and the book-metadata record** (`type=stats`). On reader open and on a periodic timer, **pull** `since` the stored cursor → apply both `statBooks` (upsert local `book`) and `statPages` (upsert `page_stat_data`), then `recomputeBookTotals`. Reuse the existing cursor/`since` machinery used by `configs`.
- Gate behind a new `stats` entry in `syncCategories` (default **on**).

### 5.5 Sync — koplugin (`apps/readest.koplugin/readest_syncstats.lua`)

- Modeled on `readest_syncconfig.lua`; uses the existing `readest_syncclient` + auth.
- **Push:** read new `page_stat_data` rows plus each book's `md5` / `title` / `authors` from KOReader's `statistics.sqlite3` (`md5` via `partial_md5_checksum`), send both record sets as `type=stats`.
- **Pull:** fetch `since` cursor; upsert incoming `statBooks` (`md5` + `title` + `authors`) into the local `book` table — creating the row when absent, KOReader fills the rest when the book is opened — and `statPages` into `page_stat_data` (mapping `book_hash` → local `id_book`), then let KOReader recompute totals.
- Add to the plugin's sync menu + i18n (follow `/i18n-koplugin`); cover with `busted` specs.

### 5.6 Readest enrichment seam (KOReader-compatible, seam-only in v1)

Readest may later want per-event data KOReader's page-based schema can't represent (chapter/section attribution, words-read → wpm, originating device). The bridge being the **sync API, not a shared file**, makes this additive: KOReader reads only its own `statistics.sqlite3` (written by the koplugin in KOReader's exact schema), so it never sees Readest extras. v1 **builds the seam and captures nothing** — the extension columns/tables exist but stay NULL/empty until a later phase wires up the stats UI.

- **Local:** enrichment lives in **separate `readest_*` extension tables** (e.g. `readest_page_ext(book_hash, page, start_time, …)`, `readest_book_ext(book_hash, …)`) keyed by the same identity. KOReader's `book` / `page_stat_data` tables stay **byte-identical** (a literal file export stays valid too).
- **Wire:** a nullable **`ext jsonb`** column on `stat_pages` / `stat_books`. Readest reads/writes it; the koplugin **leaves it NULL and ignores incoming `ext`**.
- **Compatibility invariants:** (1) the koplugin maps only KOReader-schema fields; (2) those round-trip losslessly. Enrichment is therefore **lossless Readest↔Readest** and **dropped only at the KOReader boundary** (inherent — KOReader's schema can't hold it).

## 6. KOReader interop details

- **Book identity:** Readest `Book.hash` = `partialMD5(file)` = KOReader `md5`. The Supabase key is `book_hash`. No re-hashing.
- **Units:** Unix **seconds** for `start_time` and `duration`; same as KOReader.
- **`total_pages`/repagination:** stored per event; KOReader's `page_stat` view already rescales when `total_pages` differs, so differing pagination between sessions/engines is tolerated by the view, not by us.
- **Book-row reconstruction is self-contained:** incoming `statBooks` records carry `md5` + `title` + `authors`, so a pulling device creates its local `book` row directly from the payload — no lookup against the library or `books` sync. `pages` and `last_open` are filled from the book's page events; `series` / `language` stay NULL. The Readest app still enriches its *own* book rows from library metadata when it originates them.

## 7. Known limitations

Readest (foliate) and KOReader paginate the same EPUB differently, so per-page **coordinates differ across engines**. Consequences:

- **Total reading *time* is exact** (sum of `duration`) — the primary metric.
- Per-page heatmaps and **distinct-page counts mix coordinate systems** cross-engine and are approximate — the same approximation KOReader already lives with when `total_pages` changes (handled by the rescaling `page_stat` view). Within a single engine, fully exact.

This is documented, accepted, and not a blocker.

## 8. Testing strategy (test-first)

- **Tracker flush logic** (vitest): page-change/idle/hidden/close each emit the right `(page, start_time, duration, total_pages)`; duration cap; sub-floor drop; idle-then-resume starts a fresh event; multi-book isolation.
- **statisticsDb** (vitest, node DB service): KOReader-schema round-trip; upsert-by-key keeps longer duration; `recomputeBookTotals`; `page_stat` view returns expected rescaled rows for a known fixture.
- **Sync endpoint** (vitest): `since` filtering, upsert/union, conflict-keeps-longer-duration, delete propagation.
- **KOReader fixture parity:** import the sample `statistics.sqlite3`, assert `book` + `page_stat_data` survive a Readest export/import round-trip unchanged.
- **koplugin** (`busted`): `readest_syncstats` push/pull/merge against an in-memory `statistics.sqlite3`; `pnpm lint:lua` + `pnpm test:lua`.
- Full `pnpm test` + `pnpm lint` green before completion.

## 9. Rollout / compatibility

- PR #3156 is unmerged → no `statistics.json` migration. This design lands as the first stats implementation.
- New Supabase table + migration; additive `SyncType` — no change to existing `books`/`notes`/`configs` flows.
- `better-sqlite3`, `@types/better-sqlite3`, and the `onlyBuiltDependencies`/`statistics.json` bits from PR #3156 are dropped.

## 10. Open questions

- **Duration-cap / idle-timeout defaults:** adopt KOReader's 120 s per-page cap and a 120 s idle timeout, both configurable later. (Assumed; confirm at implementation.)
- **Stats-sync encryption:** match whatever the legacy `configs` flow does today (no new E2E layer for stats in v1). Confirm against current `/api/sync` behavior when wiring the endpoint.
