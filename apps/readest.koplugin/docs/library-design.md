# Readest Library View for `readest.koplugin` (v1)

## Context

`apps/readest.koplugin` today is a **sync-only** plugin: when a book is open in
KOReader, it pushes/pulls reading progress and annotations to/from the Readest
sync API and that's it. There is no concept of a "library" — the user has to
discover and open books via KOReader's stock FileManager, and any books that
exist in their Readest cloud account (uploaded from the web/desktop app) are
invisible inside KOReader.

We want a **Library view** that mirrors Readest's web/desktop library
(`apps/readest-app/src/app/library`), so a KOReader user can browse, search,
group, sort, and open all of their books — both files already on disk and books
that live only in Readest cloud — from inside the plugin.

The intended outcome:

1. A first-class library entry point inside the existing **Readest** plugin menu.
2. Books from Readest cloud merge cleanly with local KOReader books (deduped via
   the partial-md5 hash that both sides already use — proven by the existing
   progress/notes sync, which already round-trips this hash with the backend).
3. View-menu controls match Readest's web UI.
4. Cloud-only books are downloadable on tap.
5. Storage backed by SQLite for fast queries on large libraries.

This plan was reviewed by codex (see GSTACK REVIEW REPORT at the bottom) and
revised to address 24 findings. The final design below reflects those fixes.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│  UI layer (Zen UI Menu+mixin pattern)                            │
│                                                                  │
│  librarywidget.lua — extends KOReader's `Menu`; mixes in         │
│      CoverMenu.updateItems + CoverMenu.onCloseWidget             │
│      and either MosaicMenu._recalculateDimen +                   │
│      MosaicMenu._updateItemsBuildUI (grid mode) OR               │
│      ListMenu._recalculateDimen + ListMenu._updateItemsBuildUI   │
│      (list mode); drives `item_table` from LibraryStore.         │
│      Adds search bar, view-menu button, group breadcrumb.        │
│                                                                  │
│  libraryitem.lua — subclasses MosaicMenuItem and ListMenuItem    │
│      to handle cloud-only entries (skip BookInfoManager call,    │
│      use cached cover_path or FakeCover) AND to overlay the      │
│      cloud-up/down badge. Substantive (~150 LOC) — codex round 2 │
│      flagged that thin badge-only patching wouldn't work because │
│      MosaicMenuItem assumes entry.file → BIM:getBookInfo.        │
│                                                                  │
│  librarypaint.lua — partial-page-repaint shim adapted from       │
│      zen_ui partial_page_repaint.lua: forces a full-waveform     │
│      e-ink refresh when last page has < perpage items.           │
│                                                                  │
│  libraryviewmenu.lua — ButtonDialog: View/Columns/Cover/         │
│      Group/Sort/Rescan/Download-folder.                          │
└──────────────┬───────────────────────────────────────────────────┘
               │ loads full item_table; Menu's perpage chunks render
┌──────────────▼───────────────────────────────────────────────────┐
│  Library service     librarystore.lua                            │
│                      - SQLite-backed book index                  │
│                      - listBooks(filters) → all matching rows.   │
│                        4000 rows × ~120 bytes ≈ 500KB. Fine in   │
│                        memory; data-side windowing dropped       │
│                        (codex round 2: Menu computes page count  │
│                        from #item_table, not external total)     │
│                      - getGroups(groupBy) — cached               │
│                      - upsertBook (merges cloud + local on hash) │
│                      - parseSyncRow(dbRow) — snake_case → schema │
└──────────────┬───────────────────────────────────────────────────┘
               │ feeds
┌──────────────▼─────────────┐  ┌─────────────────────────────────┐
│  syncbooks.lua             │  │  localscanner.lua               │
│  - GET /sync?type=books    │  │  - ReadHistory entries          │
│    (incremental, max-ts)   │  │  - **/.sdr/ sidecar walk via   │
│  - GET /storage/download   │  │    dismissableRunInSubprocess   │
│    (fileKey =              │  │    (cancellable; matches        │
│    {user_id}/Readest/      │  │    KOReader's own pattern in    │
│    Books/{hash}/{hash}.ext)│  │    filemanagerfilesearcher.lua) │
│  - server fallback         │  │  - reads partial_md5_checksum   │
│    resolves R2 deployments │  │    from each sidecar; never     │
│    by extension            │  │    hashes on demand             │
└────────────────────────────┘  └─────────────────────────────────┘
```

**Init-time signature checks** (eng-review fix): on plugin init, verify the
expected mixin surfaces exist on `MosaicMenu`/`CoverMenu`/`ListMenu`:

```lua
local function check_renderer_compat()
    local ok_cm, CoverMenu = pcall(require, "covermenu")
    local ok_mm, MosaicMenu = pcall(require, "mosaicmenu")
    local ok_lm, ListMenu  = pcall(require, "listmenu")
    if not (ok_cm and ok_mm and ok_lm) then return false, "missing-modules" end
    local needed = {
        {CoverMenu, "updateItems"},   {CoverMenu, "onCloseWidget"},
        {MosaicMenu, "_recalculateDimen"}, {MosaicMenu, "_updateItemsBuildUI"},
        {ListMenu,  "_recalculateDimen"}, {ListMenu,  "_updateItemsBuildUI"},
    }
    for _, n in ipairs(needed) do
        if type(n[1][n[2]]) ~= "function" then
            return false, "missing-method:" .. n[2]
        end
    end
    return true
end
```

If the check fails, log loudly via `logger.warn` and fall back to a plain
`Menu` render with FakeCover-only items (still usable, no covers). Loud
failure mode — never a silent break when KOReader bumps internal API.

**Renderer smoke test** (codex round 2 fix for shallow signature checks):
after the method-existence check passes, run a 1-item dry render in an
off-screen `Menu` instance with one synthetic `entry = {file = "/tmp/x.epub",
text = "X", is_file = true}` and one `cloud_only` entry. Catch any error in a
`pcall`; if either render fails, the renderer is incompatible — fall back to
plain Menu + FakeCover. Catches contract drift in `item_table` shape, entry
fields, or item-class internals beyond what method-existence can detect.

**Renderer reuse pattern (validated via zen_ui.koplugin source at
`/Users/chrox/dev/koreader-plugins/zen_ui.koplugin/modules/filebrowser/patches/group_view.lua:62-82`):**

```lua
local CoverMenu  = require("covermenu")
local MosaicMenu = require("mosaicmenu")  -- or ListMenu

menu.updateItems   = CoverMenu.updateItems
menu.onCloseWidget = CoverMenu.onCloseWidget
menu.nb_cols_portrait  = settings.library_columns or 3
menu.nb_rows_portrait  = settings.library_rows    or 3
menu.nb_cols_landscape = settings.library_columns_landscape or 4
menu.nb_rows_landscape = settings.library_rows_landscape    or 2
menu.files_per_page    = nil  -- Menu computes from rows*cols
menu.display_mode_type = "mosaic"
menu._recalculateDimen   = MosaicMenu._recalculateDimen
menu._updateItemsBuildUI = MosaicMenu._updateItemsBuildUI
```

This collapses the original plan's `librarygrid.lua` (windowed renderer) into
zero new code — KOReader's `Menu` widget already does perpage windowing, page
navigation, item construction, and click dispatch. We add only the things
KOReader doesn't already provide: badge overlay, partial-page repaint,
SQLite-backed `item_table` population, and the search/view-menu chrome.

**Cover handling**: hard-dependency on KOReader's bundled `coverbrowser.koplugin`
(established Zen UI pattern — verified at plugin init via `pcall(require,
"covermenu")` per `zen_ui/.../coverbrowser_check.lua`; one-time ConfirmBox if
absent — offer to enable from `plugins_disabled` settings, else FakeCover for
everything). For local books call `BookInfoManager:getBookInfo(filepath, true)`;
for missing covers fire `extractInBackground{}` (throttled to N=4 concurrent).
For cloud-only books, download `cover.png` from storage to
`<DataStorage:getSettingsDir()>/readest_covers/{hash}.png`, render via
`ImageWidget{file=path}`. After a cloud book gets downloaded, BIM extracts the
cover from the local file on next view (replacing the downloaded cover).

---

## Files to add

| File                                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest.koplugin/library/librarystore.lua`    | SQLite open/migrate, `listBooks(filters)` (returns full match set; render windowing happens in Menu), `getGroups(by)`, `upsertBook(row)`, `parseSyncRow(dbRow)` (snake_case → schema, JSON-parses metadata, filters dummy hash)                                                                                                                                                                                                                                                                                                                                                  |
| `apps/readest.koplugin/library/syncbooks.lua`       | `pullBooks(since, cb)` → `GET /sync?type=books`; `getDownloadUrl(fileKey, cb)` → `GET /storage/download`; `downloadBook(book, cb)` and `downloadCover(book, cb)` build R2-style fileKeys (see "Cloud download")                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/readest.koplugin/library/localscanner.lua`    | Enumerate ReadHistory entries that still exist + walk `home_dir/**/.sdr/` directories for sidecars containing `partial_md5_checksum`. Never compute hashes on demand.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/readest.koplugin/library/coverprovider.lua`   | Wrapper around `BookInfoManager:getBookInfo` (local) + cloud cover download cache; coverbrowser presence check at init (offers to enable if `plugins_disabled` contains it, else FakeCover for everything)                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/readest.koplugin/library/librarywidget.lua`   | Top-level full-screen view. Constructs a vanilla `Menu` and method-mixes in `CoverMenu` + `MosaicMenu`/`ListMenu` per zen_ui's `group_view.lua` pattern. Owns the search bar widget, view-menu button, group breadcrumb. Drives `item_table` from `LibraryStore:listBooks(filters)`.                                                                                                                                                                                                                                                                                             |
| `apps/readest.koplugin/library/libraryitem.lua`     | **Substantive (~150 LOC)** — subclasses `MosaicMenuItem` and `ListMenuItem`. Detects `entry.cloud_only=true` and: (a) skips `BookInfoManager:getBookInfo` call (which would fail on a non-existent filepath), (b) renders cover from `entry.cover_path` via `ImageWidget{file=path}` if cached, else `FakeCover` placeholder, (c) overlays cloud-up/down badge using paintRect technique from `zen_ui/.../browser_cover_badges.lua:42-110`. For local entries (`entry.cloud_only=false`), defers to the parent class's BIM-driven path with the same badge overlay added on top. |
| `apps/readest.koplugin/library/librarypaint.lua`    | Partial-page repaint shim adapted from `zen_ui/.../partial_page_repaint.lua`. Hooks our menu's `updateItems` to schedule a `UIManager:setDirty(nil, "full")` + `forceRePaint` on the next tick when `items_on_page < perpage`, eliminating e-ink ghost rows.                                                                                                                                                                                                                                                                                                                     |
| `apps/readest.koplugin/library/libraryviewmenu.lua` | `ButtonDialog` with sections: View Mode, Columns (per orientation), Cover Fit, Group By, Sort By, Rescan, Download Folder.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/readest.koplugin/library/exts.lua`            | `EXTS` table — `EPUB→epub`, `PDF→pdf`, `MOBI→mobi`, `AZW→azw`, `AZW3→azw3`, `CBZ→cbz`, `FB2→fb2`, `FBZ→fbz`, `TXT→txt`, `MD→md`. Verbatim copy from `apps/readest-app/src/libs/document.ts`.                                                                                                                                                                                                                                                                                                                                                                                     |

**Removed from earlier draft** (per codex round 2):

- ~~`safefilename.lua`~~ — not needed. The cloud `fileKey` we send is `{user_id}/Readest/Books/{hash}/{hash}.{ext}` (S3-style; the filename middle is irrelevant because the server's `processFileKeys` fallback at `apps/readest-app/src/pages/api/storage/download.ts:99-107` matches by `(book_hash, file_key endsWith .ext)`). For the **local** download filename we still want something readable, but it's a trivial 5-line helper inlined in `syncbooks.lua` (`name:gsub('[<>:|"?*\x00-\x1F/\\]', '_')`) — no JS-parity port required.

### Test harness (new in v1)

The plugin has no test infrastructure today (only `extract-i18n.js` /
`apply-translations.js` scripts). v1 brings up a **busted** harness — but
**scoped narrowly** (codex round 2 fix): only pure functions and the SQLite
store layer get tested. Network/UI/Device modules pull KOReader globals at
require-time and would explode the stub surface, so they stay as
manual-tested only.

| File                                                       | Purpose                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest.koplugin/spec/spec_helper.lua`               | KOReader stub loader for the modules we DO test: stubs `logger`, `G_reader_settings` (in-memory table), `DataStorage:getSettingsDir()` (per-test `mktemp -d`), `lua-ljsqlite3` (real binding loaded against `:memory:`). Sets `package.path` so `require("library.foo")` works. |
| `apps/readest.koplugin/spec/library/parsesync_spec.lua`    | `parseSyncRow` — dummy hash filter, metadata-as-string vs metadata-as-table, ISO→unix, null group_name, `deleted_at` → `cloud_present=0` mapping.                                                                                                                               |
| `apps/readest.koplugin/spec/library/exts_spec.lua`         | `EXTS` mapping completeness vs the 10 documented formats.                                                                                                                                                                                                                       |
| `apps/readest.koplugin/spec/library/librarystore_spec.lua` | Schema migration from `user_version=0`, `upsertBook` cloud+local merge, `listBooks` filters/sort, `getGroups` cache invalidation, multi-account scoping (insert as user A, query as user B → empty). Uses real `:memory:` SQLite.                                               |
| `apps/readest.koplugin/spec/library/filekey_spec.lua`      | Pure-function tests for the cloud `fileKey` builder in `syncbooks.lua` (extracted as a pure helper specifically for testability). Asserts shape `{user_id}/Readest/Books/{hash}/{hash}.{ext}` for each format.                                                                  |
| `apps/readest.koplugin/.busted`                            | Busted runner config (`return { default = { ROOT = {"spec"} } }`).                                                                                                                                                                                                              |

**Removed from earlier draft** (codex round 2 — stub surface explodes):

- ~~`spec/library/safefilename_spec.lua`~~ — no JS-parity port to test.
- ~~`spec/library/syncbooks_spec.lua`~~ — full syncbooks would need stubs for Spore, httpclient, NetworkMgr, withFreshToken… too much. Replaced by the narrower `filekey_spec.lua` for the pure-function piece.

**Run via:** `pnpm test:lua` — added to BOTH root `package.json` AND
`apps/readest-app/package.json` (codex round 2: paths were inconsistent). Each
script invokes `cd <appropriate dir> && busted`. Add to
`.claude/rules/verification.md` as a done-condition.

**Install path**: `luarocks install busted --local` documented in
the koplugin README.

## Files to modify

| File                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/readest.koplugin/main.lua`                                                       | Register `Library` action in `addToMainMenu` and `onDispatcherRegisterActions`; add `openLibrary()` handler. Replace `ensureClient()`'s fire-and-forget refresh with a `withFreshToken(cb)` wrapper that **awaits** refresh completion before invoking the callback.                                                                                      |
| `apps/readest.koplugin/syncauth.lua`                                                   | Add `withFreshToken(callback)` that triggers `tryRefreshToken` then invokes callback on completion (success or no-refresh-needed). Existing call sites migrate to it.                                                                                                                                                                                     |
| `apps/readest.koplugin/readestsync.lua`                                                | Add `pullBooks(since, callback)` hitting `GET /sync?type=books`; add `getDownloadUrl(fileKey, callback)` hitting `GET /storage/download?fileKey=…`. Both go through `withFreshToken`.                                                                                                                                                                     |
| `apps/readest.koplugin/readest-sync-api.json`                                          | Add new method `pullBooks` requiring only `since` (and optional `type=books`); add `getDownloadUrl` method. **Do not change existing `pullChanges`** — it still requires `book` + `meta_hash` for per-book pull, which the existing config/notes sync uses.                                                                                               |
| `apps/readest.koplugin/syncconfig.lua`                                                 | Update 401/403 handling: treat HTTP 403 (not just response body string `"Not authenticated"`) as auth failure → trigger logout. Same change in `syncannotations.lua`.                                                                                                                                                                                     |
| `apps/readest.koplugin/syncannotations.lua`                                            | Same 403 unification.                                                                                                                                                                                                                                                                                                                                     |
| `apps/readest.koplugin/locales/en/translation.po` (run `node scripts/extract-i18n.js`) | New strings: "Library", "Search…", "Grid", "List", "Auto", "Columns", "Crop", "Fit", "Group by", "None", "Books", "Authors", "Series", "Groups", "Sort by", "Title", "Author", "Date Read", "Date Added", "Format", "Ascending", "Descending", "Download book", "Local only", "Cover Browser plugin required", "Rescan library", "Download folder…", etc. |
| `apps/readest-app/scripts/lint-koplugin.js`                                            | Update path glob to **recurse** into `apps/readest.koplugin/library/**/*.lua` and `apps/readest.koplugin/spec/**/*.lua` — codex round 2 caught that the existing script (line 27) only scans top-level `*.lua`, so new code under `library/` would silently bypass luacheck.                                                                              |
| `apps/readest-app/package.json`                                                        | Add `"test:lua": "cd ../readest.koplugin && busted"` script alongside existing `lint:lua`.                                                                                                                                                                                                                                                                |
| `package.json` (root)                                                                  | Add `"test:lua": "pnpm --filter @readest/readest-app run test:lua"` so the documented root command works.                                                                                                                                                                                                                                                 |
| `.claude/rules/verification.md`                                                        | Add `pnpm test:lua` to the done-conditions list.                                                                                                                                                                                                                                                                                                          |

**No backend (`apps/readest-app`) changes are required for v1.** The existing
`/storage/download` endpoint already resolves paths transparently via the
`files` table fallback (see "Cloud download" below).

---

## SQLite schema

Single DB file at `<DataStorage:getSettingsDir()>/readest_library.sqlite3`,
opened via `lua-ljsqlite3` (the established KOReader pattern, see
`coverbrowser.koplugin/bookinfomanager.lua`). PRAGMA `journal_mode` follows
`Device:canUseWAL()`.

```sql
CREATE TABLE IF NOT EXISTS books (
    user_id          TEXT NOT NULL,              -- Readest auth user.id; scopes all queries
    hash             TEXT NOT NULL,              -- partial md5 (KOReader == Readest)
    meta_hash        TEXT,
    title            TEXT NOT NULL,
    source_title     TEXT,
    author           TEXT,
    format           TEXT,                       -- 'EPUB' | 'PDF' | ...
    metadata_json    TEXT,                       -- raw JSON from /sync; series/seriesIndex parsed lazily
    series           TEXT,                       -- denormalized from metadata_json on upsert
    series_index     REAL,                       -- denormalized from metadata_json on upsert
    group_id         TEXT,                       -- nullable; from cloud only
    group_name       TEXT,                       -- nullable; from cloud only
    cover_path       TEXT,                       -- absolute path on disk if cached
    file_path        TEXT,                       -- absolute path on disk if local
    cloud_present    INTEGER NOT NULL DEFAULT 0, -- 1 if seen in /sync (and not deleted)
    local_present    INTEGER NOT NULL DEFAULT 0, -- 1 if file_path resolves
    uploaded_at      INTEGER,                    -- cloud's uploaded_at (object exists in storage)
    progress_lib     TEXT,                       -- books.progress from /sync (JSON tuple [cur, total])
    reading_status   TEXT,                       -- 'unread'|'reading'|'finished'
    last_read_at     INTEGER,                    -- unix ms; from ReadHistory or cloud updated_at
    created_at       INTEGER,                    -- unix ms
    updated_at       INTEGER,                    -- unix ms; max(cloud.updated_at, local mtime)
    deleted_at       INTEGER,                    -- unix ms; tombstone (cloud-side delete)
    PRIMARY KEY (user_id, hash)
);

CREATE INDEX IF NOT EXISTS books_user_updated  ON books(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS books_user_lastread ON books(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS books_user_meta     ON books(user_id, meta_hash);
CREATE INDEX IF NOT EXISTS books_user_group    ON books(user_id, group_name);
CREATE INDEX IF NOT EXISTS books_user_author   ON books(user_id, author);

CREATE TABLE IF NOT EXISTS sync_state (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
);
-- keys (per-user):
--   'last_books_pulled_at' (unix ms) — MAX of returned updated_at|deleted_at, NOT local now
--   'last_full_scan_at'   (unix ms) — gates the 24h-throttled sidecar walk

PRAGMA user_version = 1;
```

**Multi-account**: The `user_id` column scopes every query, so signing out of
account A and into account B doesn't show A's books. Local file rows
(populated by sidecar walks) are stored per active account too — when account B
is logged in and the scanner finds book X locally, it's recorded as B's book
even if the same file is also A's book. `local_present` is therefore
per-account; the underlying file is shared, but the index entries are not. On
account switch, we **do not** delete rows for the previous user — they remain
queryable if the user signs back in. Library queries always include
`WHERE user_id = ?` (the currently-authenticated user); when no user is
logged in, the Library shows a "Sign in" placeholder.

**Composite-FK note for future child tables** (codex round 2 fix): if v1.1
adds local `annotations` or `configs` tables that need to reference a book,
they must FK on the **composite** `(user_id, hash)`, not on `hash` alone —
hash is no longer globally unique in this schema. Document this in the
schema comment block so future contributors don't accidentally create a row
that orphans on account switch:

```sql
-- FUTURE-PROOFING:
-- Any child table referencing books MUST use a composite FK:
--   FOREIGN KEY (user_id, book_hash) REFERENCES books(user_id, hash)
-- NOT just FOREIGN KEY (book_hash) REFERENCES books(hash) — `hash` alone
-- is not unique across users in this schema.
```

**Notes on schema** (responding to codex review):

- `hash TEXT PRIMARY KEY` is safe because we **never** insert placeholder rows.
  Local discovery only enumerates books that already have a real
  `partial_md5_checksum` (in DocSettings sidecars or via ReadHistory). No
  `'pending:'` keys.
- `metadata_json` stores the raw `metadata` JSON string from `/sync`; `series`
  and `series_index` are denormalized into columns at upsert time so they're
  indexable. Other metadata fields stay in `metadata_json` (read on demand).
- `progress_lib` is `books.progress` from `/sync` (a tuple-shaped JSON like
  `[42, 250]`). It's distinct from KOReader's per-document reading position
  and from Readest's `book_configs.progress` (xpointer). Library view shows
  `progress_lib` as the progress bar; tapping a book hands off to KOReader
  which uses its own DocSettings progress.
- `uploaded_at` mirrors the cloud field — its presence is a hint that storage
  has the object, but the authoritative check is the `files` table on the
  server (see "Cloud download").

`librarystore.lua` exposes:

- `LibraryStore:listBooks(filters) -> rows[]` — returns all matching rows
  for the current filter/group/sort. The Menu widget chunks them into pages
  via `perpage`. (Earlier draft had `getPage(offset, limit)` for SQL
  windowing — dropped per codex round 2 because Menu computes page count
  from `#item_table` and can't accept an external total.)
- `LibraryStore:getGroups(groupBy) -> {{name, count, latest_updated_at}, …}`
  for Authors/Series/Groups headers. Cached, invalidated on
  upsert/sort/group-by change.
- `LibraryStore:upsertBook(row)` — merges by `hash` PK; **OR-merges**
  `cloud_present`/`local_present` (an existing local row that gets a cloud
  pull keeps `local_present=1` while gaining `cloud_present=1`).
- `LibraryStore:setLastPulledAt(ts)` / `getLastPulledAt()`.

---

## Merge strategy

The hash is the join key. KOReader's `util.partialMD5` and Readest's
`partialMD5(File)` produce the same digest — proven by the existing
progress/notes sync in `apps/readest.koplugin/syncconfig.lua` and
`syncannotations.lua`, which already round-trip
`ui.doc_settings:readSetting("partial_md5_checksum")` to `/sync` as `book_hash`
and the server matches it correctly. **No further verification required.**

Per book row, two flags + a `deleted_at` tombstone from cloud:

| `cloud_present` | `local_present` | `deleted_at` | Meaning                             | UI                                                                                                                                                                                                                                                               |
| --------------- | --------------- | ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1               | 1               | NULL         | Synced on device                    | Open immediately                                                                                                                                                                                                                                                 |
| 1               | 0               | NULL         | Cloud-only                          | Tap → download → open                                                                                                                                                                                                                                            |
| 0               | 1               | NULL         | True local-only (never uploaded)    | Open immediately. Cloud-up icon = informational ("Not in cloud"). v1 does not push.                                                                                                                                                                              |
| 0               | 1               | non-NULL     | Cloud-deleted, file still on device | **Hidden from Library view; file preserved on disk** (KOReader users own their filesystem — we never delete local book files). User can still find the file via FileManager and re-open it; doing so does NOT re-add it to the Library since cloud says deleted. |
| 0               | 0               | non-NULL     | Cloud delete + no local             | Hidden                                                                                                                                                                                                                                                           |

**Library list filter**: `WHERE user_id = ? AND deleted_at IS NULL AND
(cloud_present = 1 OR local_present = 1)`. The `deleted_at IS NULL` clause is
the new bit — it hides cloud-deletions even when the local file remains.

**Why preserve the local file when cloud says deleted?** A KOReader user might
have the file in `~/Books/` from a manual import that predates Readest; cloud
deletion shouldn't touch their filesystem. The Library view stops showing the
book (since they explicitly deleted it on Readest), but the file stays where
it is and the FileManager still surfaces it.

**Sources of `local_present=1`:**

1. Every `ReadHistory.hist` entry whose file still exists. Read
   `partial_md5_checksum` from its DocSettings.
2. **Sidecar walk**: recursively scan `home_dir/**/.sdr/` directories. Each
   sidecar that contains `partial_md5_checksum` represents a book KOReader has
   opened at least once. We index that file. (This catches books that have
   been pruned from ReadHistory but still exist locally.)
3. We **never** enumerate raw book files that lack a sidecar. This means
   freshly-copied books that have never been opened in KOReader don't appear
   in the library until the user opens them once via FileManager. Acceptable
   for v1 — it preserves the user's "no on-demand hashing" constraint.

**Sources of `cloud_present=1`:** rows returned by `GET /sync?type=books`.

When a sidecar walk finds a row whose `hash` already exists in the DB with
`cloud_present=1` and `local_present=0`, we set `local_present=1` and write
the `file_path`. That's the dedupe.

---

## Sync row parsing (`parseSyncRow`)

`/sync` returns DB-shaped (snake_case) rows, **not** the camelCase `Book` type.
This is the wire format we have to handle:

```
{
  user_id, id, book_hash, hash, meta_hash,
  title, source_title, author, format,
  metadata,            -- JSON string OR object; JSON-parse if string
  group_id, group_name,
  uploaded_at,         -- ISO timestamp string OR null
  updated_at,          -- ISO timestamp string
  deleted_at,          -- ISO timestamp string OR null
  created_at,
  progress             -- [cur, total] tuple OR null
}
```

`parseSyncRow(dbRow) -> ourRow` performs:

1. Skip if `dbRow.book_hash == "00000000000000000000000000000000"` (initial-
   `since=0` dummy book emitted by `apps/readest-app/src/pages/api/sync.ts:121`
   for race-condition workaround).
2. ISO-string-to-unix-ms for every timestamp.
3. JSON-parse `metadata` if it's a string. Extract `metadata.series` and
   `metadata.seriesIndex` into denormalized columns; store the rest in
   `metadata_json`.
4. Map `book_hash → hash`, `source_title → source_title`, `group_name →
group_name` (nullable), `uploaded_at → uploaded_at`, `updated_at →
updated_at`, `deleted_at → deleted_at`.
5. JSON-stringify `progress` tuple → `progress_lib`.
6. If `deleted_at` is non-null and ≤ now: set `cloud_present=0` (book deleted
   on cloud); else `cloud_present=1`.

---

## Cloud download

The koplugin **does not** need to know R2 vs S3 storage layout. The existing
`/storage/download` endpoint at
`apps/readest-app/src/pages/api/storage/download.ts` resolves paths
transparently via a fallback in its `processFileKeys` function (lines 92-131):
when the literal `fileKey` doesn't match a row in the `files` table, the
server splits the path, extracts `(book_hash, extension)`, and queries the
`files` table by `(user_id, book_hash, file_key endsWith .ext)` to find the
real key.

This works for **any** `fileKey` shaped like:

```
{user_id}/Readest/Books/{hash}/{filename}.{ext}
```

(5-part path containing the substring `Readest/Book` — JS `String.includes`
matches `Readest/Books` too.)

So the koplugin constructs:

| Asset       | fileKey                                       |
| ----------- | --------------------------------------------- |
| Book file   | `{user_id}/Readest/Books/{hash}/{hash}.{ext}` |
| Cover image | `{user_id}/Readest/Books/{hash}/cover.png`    |

**Why not the R2-style `{makeSafeFilename(title)}.{ext}` filename middle?**
(codex round 2): the server's `processFileKeys` fallback at
`apps/readest-app/src/pages/api/storage/download.ts:99-107` extracts the
`(book_hash, extension)` from the 5-part path and matches against the `files`
table by **extension only** — the filename middle is never used for matching.
So sending `{hash}.{ext}` works on both R2 and S3 deployments, and we avoid
porting JS's `makeSafeFilename` to Lua (which would have UTF-16-vs-UTF-8
truncation parity hazards per the JS suite at
`apps/readest-app/src/__tests__/utils/misc.test.ts:39,98,147`).

Inputs the koplugin already has:

- `user_id` — stored in `G_reader_settings.readest_sync.user_id` after auth.
- `hash` — from `book_hash` in `/sync` rows.
- `ext` — from `format` field via `EXTS` mapping (`exts.lua`).

The **local** download filename (where we write the bytes on disk) is
separate. It uses a trivial 5-line filesystem-safe helper inlined in
`syncbooks.lua:downloadBook`:

```lua
local function safe_local(name)
    return (name or "book"):gsub('[<>:|"?*\\/\x00-\x1F]', '_'):sub(1, 200)
end
local local_filename = safe_local(book.source_title or book.title) .. "." .. ext
```

This protects the local filesystem and gives the user a readable name when
they browse `library_download_dir` in FileManager. No JS parity required —
the only consumer is KOReader's own filesystem.

**Download flow** (cloud-only book tap):

1. `withFreshToken(function() ReadestSync:getDownloadUrl(fileKey, cb) end)`
2. `httpclient` streams response to
   `<library_download_dir>/{safeTitle}.{ext}` — **flat directory** (KOReader
   users prefer flat layouts to nested hash dirs in their book folders).
   On filename collision (different book, same title-derived filename): try
   `{safeTitle} (1).{ext}`, `(2)`, `(3)` etc. up to (10).
3. Update SQLite: `file_path` = new path, `local_present` = 1.
4. `ReaderUI:showReader(file_path)`.

**Why flat instead of `{hash}/{title}.{ext}`?** Codex round 2 noted that the
nested layout would help "reconciliation by hash on full scan" since the
hash would appear as a directory name. But (a) KOReader users browse this
folder in FileManager and see ugly hash-named directories, (b) we don't
need filesystem-derived reconciliation — we already have `file_path` in
SQLite for the happy path, and the sidecar walk's reconciliation goes via
`partial_md5_checksum` from `.sdr/` files (independent of where in the
filesystem the file lives), and (c) on tap-time recovery if the file
vanished, we just mark `local_present=0` and offer rescan. Flat
download dir wins on UX.

Status codes the new Spore method must accept: 200, 400, 401, 403, 404
(404 = book row exists but no downloadable object — show "Cloud copy
unavailable" message; codex caught that `uploaded_at` does NOT guarantee a
file in storage, since `/storage/download` authorizes via the `files` table).

**Cover download** (lazy, when grid item paints and cover_path is null):

1. `getDownloadUrl({user_id}/Readest/Books/{hash}/cover.png, cb)`.
2. Stream to `<DataStorage:getSettingsDir()>/readest_covers/{hash}.png`.
3. On 404 (no cover uploaded), set `cover_path = "_missing"` sentinel so we
   don't keep retrying; render `FakeCover`.

Cover downloads run through a global throttle (max 4 concurrent) so we don't
DDoS storage when a 4000-book grid first paints.

---

## Auth refresh chain (codex finding)

Today `ensureClient()` in `main.lua:190` calls `SyncAuth:tryRefreshToken()`
and then **immediately** builds the Spore client with whatever token is in
settings — the refresh is callback-based and may not have completed when the
client is built. New library calls would race the same way.

Fix: introduce `SyncAuth:withFreshToken(cb)`:

- If token is fresh (>50% TTL remaining), invoke `cb()` immediately.
- Otherwise, kick off `tryRefreshToken` and only invoke `cb()` from its
  completion handler (success or no-op).
- All new library API calls (`pullBooks`, `getDownloadUrl`) and existing
  config/notes pushes/pulls migrate to this wrapper. (Migrating existing call
  sites is in scope; they were racy already.)

---

## UI — full-screen Library widget

Layout top-to-bottom:

1. **Title bar** — back button + "Library" + count, view-menu button.
2. **Search bar** — `InputContainer` opens `InputDialog` on tap; query is
   debounced 500ms before re-querying SQLite (matches Readest web behavior at
   `LibraryHeader.tsx:66-77`).
3. **Optional group breadcrumb** — when `group_by != 'none'` and user drilled
   into a group ("Authors → Asimov").
4. **Windowed grid/list area** (`librarygrid.lua`) — only renders widgets for
   the visible viewport + 1 page of buffer above and below; on scroll, recycles
   widget instances. This is the e-ink perf fix — building 4000 widgets up
   front would stutter for seconds.
5. **View menu** opens `LibraryViewMenu` (ButtonDialog).

`LibraryItem` (the cell) has two render modes:

```
Grid mode:                List mode:
┌─────────┐ ☁︎↓           ┌──┐ Title              ☁︎↓
│  cover  │               │  │ Author
│         │               │  │ ████░░░░ 47%
└─────────┘               └──┘
  Title
```

### Cloud sync indicator

Mirror Readest's `BookItem` icon (`apps/readest-app/src/app/library/components/BookItem.tsx:161-186`):

| `cloud_present` | `local_present` | Icon           | Tap behavior                                                                                                                                                                 |
| --------------- | --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0               | 1               | **cloud-up**   | **Informational only in v1** — long-press shows "Local only — upload coming in v2". Plan acknowledges this differs from web's `!uploadedAt` semantic, since v1 doesn't push. |
| 1               | 0               | **cloud-down** | Tap on icon = same as tap on cover (download + open)                                                                                                                         |
| 1               | 1               | none           | —                                                                                                                                                                            |
| 0               | 0               | none           | tombstone, hidden                                                                                                                                                            |

Render via `IconWidget` if `frontend/resources/icons/` ships a cloud icon
(verify at implementation), else `TextWidget` with `"☁︎↑"`/`"☁︎↓"` glyphs in an
`OverlapGroup` over the cover.

Cover sourced via `coverprovider.lua`:

- Local book → `BookInfoManager:getBookInfo(file_path, true).cover_bb`
- Cloud-only with `cover_path` cached → `ImageWidget{file=cover_path}`
- Cloud-only without cache → `FakeCover` placeholder, kicks off async cover
  download
- Local book missing cover → `BookInfoManager:extractInBackground{file_path}`,
  `FakeCover` meanwhile

On tap:

- `local_present=1` → `ReaderUI:showReader(file_path)`
- `local_present=0, cloud_present=1` → `Trapper:wrap` confirm dialog →
  `syncbooks.lua:downloadBook(book, cb)` → set `file_path` + `local_present=1`
  → open
- `local_present=1` but file vanished → "File moved or deleted. Rescan?"
  ConfirmBox; don't crash.

---

## View menu

`LibraryViewMenu` is a `ButtonDialog` with sections, persisted to
`G_reader_settings:readSetting("readest_sync")` under new keys:

| Section              | Options                                                              | Default                                            | Setting key                                  |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| **View Mode**        | Grid / List                                                          | Grid                                               | `library_view_mode`                          |
| **Columns**          | Auto, 2, 3, 4, 5, 6                                                  | Auto (3 phones, 4 tablets via `Screen:getWidth()`) | `library_columns` + `library_auto_columns`   |
| **Cover**            | Crop / Fit                                                           | Crop                                               | `library_cover_fit`                          |
| **Group by**         | None / Books / Authors / Series / Groups                             | None                                               | `library_group_by`                           |
| **Sort by**          | Title / Author / Date Read / Date Added / Series / Format + Asc/Desc | Date Read, Desc                                    | `library_sort_by` + `library_sort_ascending` |
| **Rescan library**   | (action)                                                             | —                                                  | triggers full sidecar walk                   |
| **Download folder…** | (action)                                                             | —                                                  | opens PathChooser                            |

On any change: invalidate `getGroups` cache, re-query `listBooks(filters)`,
re-assign the menu's `item_table`, call `Menu:updateItems()`. Menu rebuilds
only the visible-page widgets.

---

## Sync flow

1. **Pull** (Library open + pull-to-refresh):
   - `lastPulledAt = LibraryStore:getLastPulledAt() or 0`
   - `withFreshToken(function() ReadestSync:pullBooks(lastPulledAt, function(rows) … end) end)`
   - For each row: `parsed = parseSyncRow(row)` (skips dummy 00000…). If
     `deleted_at` set: mark `cloud_present=0` on existing row (book may still
     be local). Else: `upsertBook(parsed)`.
   - **Watermark**: compute
     `maxTs = max over rows of max(updated_at, deleted_at)`. If `maxTs > 0`,
     `setLastPulledAt(maxTs)`. **Do not** use `now` (codex finding —
     misses concurrent writes; clock skew). For empty response, leave
     watermark unchanged.

2. **Local discovery** (Library open + after Rescan):
   - `localscanner.lua:lightScan()`: for every existing local row, stat
     `file_path`; if missing, set `local_present=0`. Pull recent
     `ReadHistory.hist` deltas; for each, read DocSettings sidecar's
     `partial_md5_checksum` and `upsertBook{hash, file_path,
local_present=1, last_read_at=ReadHistory time}`.
   - `localscanner.lua:fullSidecarWalk()`: only on first run / explicit
     Rescan / 24h gate. **If `home_dir` is unset (nil or empty), skip this
     entirely** — the Library shows a one-time hint suggesting "Set a Home
     folder in File Manager → top-left ⚙ → Set as Home directory" so the
     scanner can discover more books. Library remains functional via
     ReadHistory entries. When `home_dir` is set, walk `home_dir/**/.sdr/`,
     read each sidecar, upsert books with their hash. **No on-demand
     hashing.**

3. **Download** (tap of cloud-only): see "Cloud download" section above.

v1 does **not** push books up. Local-only books stay local; the existing
config + notes sync keeps working unchanged.

### Download directory

New plugin setting `library_download_dir` (stored in
`G_reader_settings.readest_sync`). First download, if unset: `PathChooser`
pre-selected at `home_dir or DataStorage:getDataDir()`. Files land at
`{library_download_dir}/{safeTitle}.{ext}` (**flat directory layout** —
KOReader users prefer flat over nested hash subdirectories when browsing
in FileManager). On filename collision (different book, same safe-derived
filename), append `(1)`, `(2)`, etc. User can change the folder later from
the view-menu's "Download folder…" action. Existing downloads stay in
their original location.

### Scan frequency

| Trigger                        | Action                                | Cost                     |
| ------------------------------ | ------------------------------------- | ------------------------ |
| Library open                   | Light scan + cloud pull (incremental) | O(rows)                  |
| Pull-to-refresh                | Same                                  | O(rows)                  |
| "Rescan library" (view-menu)   | Sidecar walk                          | O(.sdr dirs in home_dir) |
| Auto-full-scan                 | Same, gated 24h                       | O(.sdr dirs in home_dir) |
| `onReaderReady` for a new file | Single-file upsert                    | O(1)                     |

---

## Performance — e-ink

Codex flagged real perf risks for 4000-book libraries on 1GHz Kindles:

- **Render-side windowing** comes free from KOReader's `Menu` widget
  (`perpage` computed from `nb_cols * nb_rows`) — only widgets for the
  visible page get built/laid out. **Data-side windowing is NOT possible**
  (codex round 2: Menu computes page count from `#item_table`, not external
  total). We `LibraryStore:listBooks(filters)` once per
  filter/sort/group change and load all matching rows into `item_table`.
  4000 rows × ~120 bytes ≈ 500KB — fine in memory; SQLite query is fast
  (indexed). `Menu` then chunks render across `ceil(#item_table / perpage)`
  pages.
- **Partial-page repaint** via `librarypaint.lua` (zen_ui's
  `partial_page_repaint` adapted): hooks `updateItems` to schedule a
  full-waveform e-ink refresh when last page has fewer items than `perpage`.
  Eliminates ghost rows.
- **Debounced search** (500ms, matching Readest at `LibraryHeader.tsx:66-77`).
- **Cached group lists**: `getGroups(by)` returns memoized result; invalidated
  on settings change or `upsertBook`.
- **Throttled cover extraction**: max 4 concurrent `extractInBackground` calls
  via a simple Lua queue (BIM already has `_subprocesses_pids` tracking — we
  just gate the enqueue side).
- **No full-table re-render on settings change**: KOReader's `Menu:updateItems`
  rebuilds only the visible page, not the entire table.
- **Background sidecar walk** via `dismissableRunInSubprocess` (codex round
  2: `Trapper:wrap` is a coroutine, not a worker — it can't make `lfs.dir`
  / `stat` calls cancellable between yield points and will still freeze).
  `localscanner.fullSidecarWalk` follows the established KOReader pattern
  at `frontend/apps/filemanager/filemanagerfilesearcher.lua:130-210`:
  fork a subprocess, walk `home_dir/**/.sdr/`, write discovered
  `(file_path, partial_md5_checksum)` pairs to a pipe, parent process
  reads them in chunks via `Trapper:info("Scanning… N books found")`,
  user can cancel via Back which kills the subprocess. Avoids freezing
  the UI; gives true cancellation; no risk of stalls between Lua yield
  points. Library opens immediately with whatever is already in SQLite;
  newly-discovered books appear as the parent reads pipe chunks and
  upserts them.

---

## Reuse — what we're NOT building from scratch

| Thing                              | Reused from                                                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, JWT refresh, Bearer header   | `apps/readest.koplugin/syncauth.lua` (with new `withFreshToken` wrapper)                                                                                                                                                   |
| HTTP/JSON middleware               | `apps/readest.koplugin/readestsync.lua` Spore client                                                                                                                                                                       |
| Partial md5 (proven equivalent)    | `frontend/util.lua:1111` `util.partialMD5`                                                                                                                                                                                 |
| Cover extraction pipeline          | `coverbrowser.koplugin/bookinfomanager.lua`                                                                                                                                                                                |
| Read-history & open timestamps     | `frontend/readhistory.lua` `ReadHistory.hist`                                                                                                                                                                              |
| Open a book                        | `frontend/apps/reader/readerui.lua:611` `ReaderUI:showReader(file)`                                                                                                                                                        |
| SQLite open/migrate/PRAGMA pattern | Same as `coverbrowser.koplugin/bookinfomanager.lua` openDB                                                                                                                                                                 |
| i18n                               | Existing `apps/readest.koplugin/i18n.lua` and PO catalogs                                                                                                                                                                  |
| KOReader widgets                   | `ScrollableContainer`, `FrameContainer`, `VerticalGroup`, `HorizontalGroup`, `OverlapGroup`, `ImageWidget`, `TextWidget`, `IconWidget`, `IconButton`, `InputDialog`, `ButtonDialog`, `PathChooser`, `Trapper`, `UIManager` |
| Storage path resolution            | Existing `/storage/download` fallback at `apps/readest-app/src/pages/api/storage/download.ts:92-131` (no backend change)                                                                                                   |

---

## What already exists (reuse table)

| Sub-problem                         | Existing in repo                                                                                     | Plan's reuse status                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| JWT auth + refresh                  | `apps/readest.koplugin/syncauth.lua`                                                                 | Reused; adds `withFreshToken` wrapper to fix existing race                                                       |
| Spore HTTP middleware               | `apps/readest.koplugin/readestsync.lua`                                                              | Reused; adds 2 new methods (`pullBooks`, `getDownloadUrl`)                                                       |
| Partial-md5 hashing                 | KOReader `frontend/util.lua:1111 util.partialMD5`                                                    | Reused; never recomputed in plugin (read from sidecar)                                                           |
| Cover extraction                    | `coverbrowser.koplugin/bookinfomanager.lua`                                                          | Reused as hard dependency                                                                                        |
| Mosaic/list grid renderer           | `coverbrowser.koplugin/{covermenu,mosaicmenu,listmenu}.lua`                                          | Reused via Zen UI Menu+mixin pattern                                                                             |
| Badge overlay technique             | `zen_ui.koplugin/modules/filebrowser/patches/browser_cover_badges.lua`                               | Adapted (~20 lines for cloud icon)                                                                               |
| Partial-page repaint                | `zen_ui.koplugin/modules/filebrowser/patches/partial_page_repaint.lua`                               | Adapted (~30 lines)                                                                                              |
| Read history + open timestamps      | `frontend/readhistory.lua ReadHistory.hist`                                                          | Reused; lightScan iterates entries                                                                               |
| Open a book                         | `frontend/apps/reader/readerui.lua:611 ReaderUI:showReader`                                          | Reused; called on tap                                                                                            |
| SQLite open/migrate pattern         | `coverbrowser.koplugin/bookinfomanager.lua`                                                          | Reused (`SQ3.open`, journal_mode WAL/TRUNCATE)                                                                   |
| Path picker                         | `frontend/ui/widget/pathchooser.lua`                                                                 | Reused for `library_download_dir` setting                                                                        |
| Cancellable background subprocess   | `frontend/apps/filemanager/filemanagerfilesearcher.lua:130-210` `dismissableRunInSubprocess` pattern | Reused for `fullSidecarWalk` (replaces earlier draft's `Trapper:wrap` which can't actually cancel filesystem IO) |
| i18n catalog                        | `apps/readest.koplugin/i18n.lua` + `locales/<lang>/translation.po`                                   | Reused; new strings added via existing extract script                                                            |
| Server-side storage path resolution | `apps/readest-app/src/pages/api/storage/download.ts:92-131` `processFileKeys` fallback               | Reused; no backend change needed                                                                                 |
| `EXTS` mapping                      | `apps/readest-app/src/libs/document.ts`                                                              | **Copied verbatim** to `exts.lua`                                                                                |

(Earlier-draft `makeSafeFilename` Lua port deleted — codex round 2: not needed
because the cloud fileKey we send uses `{hash}.{ext}` and the server's
`processFileKeys` fallback at `apps/readest-app/src/pages/api/storage/download.ts:99-107`
matches by `(book_hash, extension)` only. Avoids JS-vs-Lua truncation parity hazards.)

Plan does NOT rebuild any of these; the plan adds glue + new UI shell + SQLite index only.

---

## Failure modes (one-line per new codepath)

| Codepath                       | Realistic failure                                          | Test?                                      | Error handled?                                         | User sees?                                |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------- |
| `syncbooks.pullBooks`          | HTTP timeout on slow link                                  | manual #18                                 | yes (Spore timeout 5/10s)                              | toast                                     |
| `syncbooks.pullBooks`          | Server returns malformed JSON metadata                     | busted                                     | yes (pcall around `json.decode`)                       | row skipped, log warn                     |
| `syncbooks.getDownloadUrl`     | 404 cloud copy unavailable                                 | manual #8                                  | yes                                                    | toast "Cloud copy unavailable"            |
| `syncbooks.downloadBook`       | Disk full mid-write                                        | manual #13                                 | yes (catch httpclient sink error)                      | toast, partial file removed               |
| `syncbooks.downloadBook`       | User cancels (Trapper)                                     | manual #14                                 | yes                                                    | partial file removed                      |
| `syncbooks.downloadCover`      | Cover 404                                                  | (busted)                                   | yes (sentinel `_missing`)                              | FakeCover, no retry storm                 |
| `localscanner.lightScan`       | Stat on removable storage path → nil                       | manual #15                                 | yes (lfs.attributes returns nil → set local_present=0) | row updates silently                      |
| `localscanner.fullSidecarWalk` | `home_dir` is nil                                          | busted                                     | yes (skip + show hint)                                 | hint banner                               |
| `localscanner.fullSidecarWalk` | Permission denied subdir                                   | manual #16                                 | yes (pcall around lfs.dir)                             | log warn, continue                        |
| `localscanner.fullSidecarWalk` | Symlink loop                                               | manual #19                                 | yes (depth cap = 8)                                    | walk stops at depth                       |
| `librarystore.upsertBook`      | SQLite disk full / corrupted                               | manual (out of v1 — KOReader-wide concern) | partial (SQ3 errors logged)                            | unhandled error toast (acceptable for v1) |
| `librarystore.parseSyncRow`    | metadata as already-parsed table (not string)              | busted                                     | yes (type-check)                                       | row imported successfully                 |
| `librarywidget.init`           | MosaicMenu method missing                                  | manual #21                                 | yes (init signature check)                             | log warn + plain Menu fallback            |
| `librarywidget.init`           | MosaicMenuItem contract drift (entry shape)                | manual #22                                 | yes (smoke-test dry render in pcall)                   | log warn + plain Menu fallback            |
| `libraryitem.lua`              | cloud_only entry with no cover_path AND cover download 404 | (busted-adjacent)                          | yes (FakeCover with cloud-down badge)                  | placeholder cover, no broken image        |
| `librarywidget.init`           | coverbrowser plugin disabled                               | manual #9                                  | yes (one-time ConfirmBox)                              | enable prompt or FakeCover-only           |
| `coverprovider.downloadCover`  | Throttle exceeded                                          | (busted)                                   | yes (queued via concurrency limiter)                   | covers fill in over time                  |
| Auth                           | JWT expires mid-Library-session                            | manual #17                                 | yes (`withFreshToken` blocks)                          | seamless retry                            |
| Auth                           | Logout while Library open                                  | manual #17                                 | yes (auth-state listener)                              | returns to Sign-in placeholder            |

**No critical gaps** (no failure mode that's silent + has no test + has no error handling).

---

## Out of scope for v1 (explicit)

- Push local-only books to Readest cloud (upload).
- Edit book metadata in koplugin.
- Manual group create/move/delete.
- Bulk-select operations.
- Tags.
- Per-book backup/restore beyond a single download.
- Background scheduled sync of the books index.
- Indexing of unopened local books (require user to open once via FileManager
  to generate the DocSettings sidecar containing `partial_md5_checksum`).
- R2-style title-based remote filenames (we send `{hash}.{ext}` and rely on
  the server fallback to resolve to the actual R2 file).
- Coverbrowser-disabled fallback grid (we hard-require coverbrowser; if
  absent, FakeCover for everything until enabled).
- Wholesale upload of local-only books to cloud (the cloud-up icon is
  informational in v1; tap does nothing actionable).
- Editing book metadata or moving between groups (read-only on cloud data).
- Background syncing on a timer (sync only fires on Library open + manual refresh).
- Multi-account simultaneous use (one user at a time; previous account's
  rows persist in SQLite scoped by `user_id` for return visits).

---

## Worktree parallelization

The plan splits into three reasonably independent lanes that can be implemented in parallel worktrees once the schema + i18n strings land:

| Step                                               | Modules touched                                                                                                                                                                                                                                                                                                                                         | Depends on                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1. Schema + Store + i18n strings + lint/test infra | `library/librarystore.lua`, `library/exts.lua`, `locales/en/translation.po`, `spec/spec_helper.lua`, `spec/library/{parsesync,exts,librarystore,filekey}_spec.lua`, `.busted`, `apps/readest-app/scripts/lint-koplugin.js` (recurse), `apps/readest-app/package.json` (test:lua), root `package.json` (test:lua proxy), `.claude/rules/verification.md` | —                            |
| 2. Sync layer                                      | `library/syncbooks.lua` (with `build_file_key()` pure helper), `syncauth.lua` (`withFreshToken`), `readestsync.lua`, `readest-sync-api.json`, `syncconfig.lua` (403 fix), `syncannotations.lua` (403 fix)                                                                                                                                               | step 1 (parseSyncRow + EXTS) |
| 3. Local scanner                                   | `library/localscanner.lua` (uses `dismissableRunInSubprocess`), `library/coverprovider.lua`                                                                                                                                                                                                                                                             | step 1 (LibraryStore API)    |
| 4. UI shell                                        | `library/librarywidget.lua`, `library/libraryitem.lua` (~150 LOC subclassing MosaicMenuItem/ListMenuItem for cloud-only entries + badge overlay), `library/librarypaint.lua`, `library/libraryviewmenu.lua`, `main.lua` (menu registration + signature/smoke check)                                                                                     | steps 1, 2, 3                |

Lane plan:

- **Lane A** (sequential): step 1 → step 4. Foundation + UI.
- **Lane B** (parallel after step 1 lands): step 2. Cloud sync. Independent of scanner.
- **Lane C** (parallel after step 1 lands): step 3. Local discovery. Independent of cloud sync.

Execution: implement step 1 first. Then launch B + C in parallel worktrees. Merge both. Then complete step 4 (UI consumes both data sources). Conflict surface = `main.lua` (menu/dispatcher hooks), updated near the end.

For solo dev: serial implementation in the order above is also fine; parallelization only helps if multiple agents work simultaneously.

---

## Verification plan

Functional tests (manual, KOReader plugins have no headless harness):

1. **Empty state**: fresh install + signed in + no books → empty grid + "No books".
2. **Local-only**: 5 EPUBs in home_dir, 2 opened (have sidecars) → 2 rows
   appear (the 3 unopened are intentionally hidden; user can open via FM
   to add them). Both have covers and last-read timestamps.
3. **Cloud sync**: account with 10 cloud books, 3 also local → 12 rows total
   (10 cloud + 2 local-only of the 5 above whose sidecars are present and
   whose hashes are NOT in the cloud account; the 3 dual-present rows have
   file paths and `cloud_present=local_present=1`); 7 cloud-only show
   download icon. **Validate `parseSyncRow` against real `/sync` JSON** —
   eyeball one row to confirm `book_hash`, `meta_hash`, `metadata` (JSON
   string), `group_name` (nullable), `uploaded_at`, `deleted_at` parse
   correctly. Watermark advances to `max(updated_at, deleted_at)`, not `now`.
4. **Search**: type "asimov" → debounce 500ms → grid filters.
5. **Group by Authors**: tap into "Asimov" → drills into group view; books
   with `groupName=null` still show under "Books" (None-grouping fallback).
6. **Sort by Date Read descending**: top row = most-recently-opened per
   ReadHistory.
7. **Cover fit toggle**: Crop ↔ Fit re-renders without restart.
8. **Download flow**: tap cloud-only book → ConfirmBox → download to
   `{library_download_dir}/{hash}/{title}.{ext}` → opens in reader → reload
   Library → row now shows `local_present=1`. **Negative case**: simulate
   `uploaded_at` set but no `files` row (404 from `/storage/download`) →
   "Cloud copy unavailable" toast, row stays cloud-only.
9. **No coverbrowser**: disable coverbrowser.koplugin → first open shows
   one-shot ConfirmBox → if dismissed, all books render as `FakeCover`
   (acceptable degraded mode; no extraction attempted).
10. **Auth flows**: pull → JWT expiring → confirm `withFreshToken` blocks
    until refresh completes before the request fires; HTTP 403 from `/sync`
    triggers logout (not just the body string).
11. **Initial since=0**: first ever pull on a brand-new account → server
    returns dummy `00000…` deleted book → koplugin filters it; library is
    empty; watermark stays at 0 (or advances past dummy).
12. **Perf benchmark**: load a 2000-row test DB on a Kobo Clara HD or Kindle
    PW3 (≤1GHz CPU). Open Library → first paint < 800ms. Scroll 100 rows →
    no jank > 200ms per frame. Switch sort → re-paint < 400ms.
13. **Disk full mid-download**: pre-fill download dir to leave <1MB free,
    tap a 5MB cloud-only book → `httpclient` write fails → toast "Not
    enough storage", row stays `local_present=0`, no partial file left
    behind. Verify temp file cleanup.
14. **User cancels mid-download**: tap cloud-only book, hit Back during the
    progress dialog → `Trapper:wrap` cancellation cleans up the partial
    file, row stays `local_present=0`, no zombie progress dialog.
15. **Removable storage ejected mid-scan**: home_dir on SD card; eject SD
    while sidecar walk is running → `lfs.dir` errors caught, scan aborts
    cleanly, no crash. Existing rows from prior scans preserved.
16. **Permission-denied subdir**: `chmod 000` a subdir of home_dir before
    Rescan → walk logs warning and continues with siblings; no crash.
17. **Logout while Library is open**: open Library → swipe down to
    `Readest → Sign out` → Library widget detects auth loss → returns to
    "Sign in" placeholder, doesn't keep showing the previous user's data.
18. **Slow connection**: throttle network to 64 kbps; tap a 5MB cloud-only
    book → progress dialog updates regularly, user can cancel via Back
    button (verifies step 14 + responsiveness on slow links).
19. **Symlink loop in home_dir**: create `home_dir/loop -> .` → Rescan
    walks at most N levels deep (proposed: 8) and stops; no infinite
    recursion or stack overflow.

### Renderer compatibility check

20. **MosaicMenu signature + smoke test stable**: on KOReader release upgrade,
    the init signature check passes AND the off-screen 1-item dry render of
    both a synthetic local entry AND a synthetic cloud_only entry returns
    without `pcall` error. Library opens in mosaic mode normally.
21. **MosaicMenu signature broken**: simulate by deleting `_recalculateDimen`
    method on the loaded module → init check returns false → Library falls
    back to plain `Menu` with FakeCovers, logs `logger.warn` with the
    missing-method name, doesn't crash.
22. **MosaicMenuItem contract drift**: simulate by hiding `entry.is_file` →
    smoke test catches that the dry render fails → Library falls back to
    plain Menu, logs warning. (Catches contract drift the method-existence
    check alone would miss.)

### Pure-function unit tests (busted, must pass before manual matrix)

```bash
pnpm test:lua            # runs busted spec/library/*_spec.lua
```

23. All `parseSyncRow` cases pass (dummy filter, metadata-as-string vs metadata-as-table, ISO timestamps, null group_name, deleted_at mapping).
24. All `librarystore` cases pass (schema, upsert merge, multi-account scoping, listBooks filters/sort, getGroups cache invalidation).
25. All `exts` cases pass (10 formats map to expected extension).
26. All `filekey` cases pass (cloud fileKey builder produces `{user_id}/Readest/Books/{hash}/{hash}.{ext}` for each format; user_id urlencoded; collision-free across 100 random hashes).

Required project checks (per `.claude/rules/verification.md` — extended in v1):

```bash
pnpm lint:lua                         # luacheck — added in commit 754639eb
pnpm test:lua                         # busted — NEW in v1; runs spec/library/*_spec.lua
node scripts/extract-i18n.js          # confirm new strings reach PO templates
```

(No JS/TS/Rust code changes in v1, so `pnpm test`, `pnpm lint`,
`pnpm fmt:check`, `pnpm clippy:check` are not in scope.)

`.claude/rules/verification.md` should be updated in this PR to add the
`pnpm test:lua` line.

End-to-end smoke: open KOReader on macOS dev box (or sideload to an Android
device), enable both `coverbrowser.koplugin` and `readest.koplugin`, log in to
a known test Readest account, walk steps 1–12 above.

---

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                     | Runs | Status                                            | Findings                                                                                                                                                                                                           |
| ------------- | --------------------- | ----------------------- | ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy        | 0    | —                                                 | —                                                                                                                                                                                                                  |
| Codex Review  | `/codex review`       | Independent 2nd opinion | 2    | **ADDRESSED**                                     | Round 1: 24 findings, all addressed in round-1 revision. Round 2: 9 findings (3 architecture-breaking on the Menu+mixin pattern + 6 medium/low), all addressed in round-2 revision.                                |
| Eng Review    | `/plan-eng-review`    | Architecture & tests    | 1    | **CLEAR (revisions superseded by codex round 2)** | 5 issues raised + resolved at the time. Several decisions later contradicted by codex round 2 evidence (Menu data-windowing, makeSafeFilename Lua port, Trapper:wrap cancellability) — superseded by current plan. |
| Design Review | `/plan-design-review` | UI/UX gaps              | 0    | —                                                 | —                                                                                                                                                                                                                  |
| DX Review     | `/plan-devex-review`  | Developer experience    | 0    | —                                                 | —                                                                                                                                                                                                                  |

**REVISION HISTORY:**

- **v1** (initial): 9 new files, custom librarygrid renderer, deferred hashing.
- **v2** (codex round 1): drop deferred hashing, fix /sync row shape, fix watermark, add multi-account, server-fallback storage paths.
- **v3** (eng review): adopt Zen UI Menu+mixin renderer (drop librarygrid), R2 filename + makeSafeFilename Lua port, Trapper:wrap sidecar walk, busted harness with 6 spec files, 25-step manual matrix.
- **v4 — CURRENT** (codex round 2): drop makeSafeFilename Lua port (server fallback resolves by extension), drop SQL data-windowing claim (Menu uses #item_table; load full 4000 rows ≈ 500KB), MosaicMenuItem/ListMenuItem subclass becomes substantive (~150 LOC for cloud-only handling), replace Trapper:wrap with `dismissableRunInSubprocess`, narrow busted scope (drop syncbooks_spec; add filekey_spec), strengthen renderer compat with smoke-test dry render, fix lint-koplugin.js to recurse, align pnpm test:lua placement (root + apps/readest-app), add composite-FK note for future child tables.

**CODEX ROUND 2 FINDINGS (all 9 addressed in v4):**

| #   | Severity | Finding                                                                             | v4 resolution                                                                                             |
| --- | -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | High     | Menu computes pages from `#item_table`, SQL LIMIT/OFFSET windowing impossible       | Load full item_table (500KB OK in memory); Menu's perpage chunks render only                              |
| 2   | High     | MosaicMenuItem/ListMenuItem assume `entry.file` + call BIM, can't render cloud-only | `libraryitem.lua` substantive subclass (~150 LOC) detects `cloud_only`, skips BIM, uses cached cover_path |
| 3   | High     | Signature checks miss contract drift in entry shape / item_table assumptions        | Added 1-item smoke-test dry render in pcall; falls back to plain Menu if it errors                        |
| 4   | High     | makeSafeFilename Lua port has UTF-16-vs-UTF-8 truncation parity hazards             | Dropped — fileKey uses `{hash}.{ext}`; server fallback resolves R2 by extension                           |
| 5   | Medium   | Composite PK constrains future annotation tables                                    | Documented in schema comment block: child tables must FK on `(user_id, hash)`                             |
| 6   | Medium   | Trapper:wrap not background work, can't cancel filesystem IO                        | Replaced with `dismissableRunInSubprocess` per `filemanagerfilesearcher.lua:130-210`                      |
| 7   | Medium   | Busted scope too broad — syncauth/readestsync need huge stubs                       | Dropped `syncbooks_spec.lua`; replaced with narrow `filekey_spec.lua` for the pure helper                 |
| 8   | Medium   | `lint-koplugin.js` only scans top-level `*.lua`, ignores `library/` and `spec/`     | Updated to recurse                                                                                        |
| 9   | Low      | `pnpm test:lua` placement inconsistent (root vs app)                                | Added in BOTH locations; root proxies to apps/readest-app                                                 |
| 10  | Low      | Filename text self-contradicts (`{safeTitle}.{ext}` vs `{hash}.{ext}`)              | Cleaned up; only `{hash}.{ext}` referenced now                                                            |

**WHAT'S STILL IN SCOPE & WORKING:**

- Codex round 1: 24 findings — all still addressed (cloud paths via server fallback, sync row shape, schema PK, watermark, /sync row parsing, coverImageUrl unused, series in metadata, group_name nullable, cloud icon semantics, auth refresh, 403 unification, Spore method, deleted-book handling, dummy-hash filter, progress shape distinction, e-ink perf, coverbrowser dependency).
- Eng review code-quality fixes still hold: home_dir-unset handling, multi-account schema scoping by user_id.
- Failure modes table updated with new entries for cloud_only rendering + smoke-test dry render.
- 26-step manual matrix (was 25; added smoke-test contract drift step #22).
- Parallelization plan adjusted for the file-list changes.

**VERDICT:** READY TO IMPLEMENT pending user approval.

Optional next reviews:

- `/codex review` round 3 — validate the round-2 fixes don't introduce new issues (cheap; codex quota now refreshed).
- `/plan-design-review` — would need actual mockups; defer until implementation produces something to review.
- `/plan-ceo-review` — scope is locked through 4 review rounds; not needed.

**Codex review v1 (issues_found, gate=fail) → revised plan addresses:**

| #   | Codex finding                                                                                      | Resolution in revised plan                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1-4 | Cloud storage path was wrong (`Books/...` vs `Readest/Books/...`, missing user_id, R2 vs S3 split) | Plugin sends `{user_id}/Readest/Books/{hash}/{hash}.{ext}` for books and `{user_id}/Readest/Books/{hash}/cover.png` for covers; existing server-side `processFileKeys` fallback at `apps/readest-app/src/pages/api/storage/download.ts:92-131` resolves both transparently via `(book_hash, extension)` lookup in the `files` table. Codex misread the fallback's substring match — `'Readest/Books'.includes('Readest/Book')` is `true`. **No backend change.** |
| 5   | Partial-md5 parity unproven                                                                        | User-confirmed: proven by existing `syncconfig.lua`/`syncannotations.lua` round-tripping `partial_md5_checksum` to `/sync` as `book_hash`. Skip test-vector matrix.                                                                                                                                                                                                                                                                                              |
| 6   | Schema PK + `'pending:'` placeholder collides                                                      | Deferred-hashing path dropped entirely (per user). Local discovery only enumerates books with existing `partial_md5_checksum` (sidecar walk + ReadHistory). `hash TEXT PRIMARY KEY` stays clean — no placeholder rows.                                                                                                                                                                                                                                           |
| 7   | Defer-hashing breaks dedupe                                                                        | Same as 6. Trade-off: unopened local files don't appear until user opens via FileManager once. Acknowledged in "Out of scope".                                                                                                                                                                                                                                                                                                                                   |
| 8   | `setLastPulledAt(now)` wrong                                                                       | Use `max(returned updated_at                                                                                                                                                                                                                                                                                                                                                                                                                                     | deleted_at)`per`apps/readest-app/src/hooks/useSync.ts:22,113`. Documented in Sync flow. |
| 9   | `/sync` returns DB-shape (snake_case), not Book objects                                            | `parseSyncRow(dbRow)` function added in `librarystore.lua` — explicit field mapping, JSON-parses `metadata`, ISO→unix-ms timestamps.                                                                                                                                                                                                                                                                                                                             |
| 10  | `coverImageUrl` not in sync rows                                                                   | User-confirmed: not needed. Local covers via BIM bb; cloud-only covers downloaded as `{hash}/cover.png` from storage.                                                                                                                                                                                                                                                                                                                                            |
| 11  | `series` is inside `metadata` JSON                                                                 | Denormalized into `series`/`series_index` columns at upsert; raw JSON kept in `metadata_json`.                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | `groupName` nullable                                                                               | Schema column is nullable; group-by-Groups falls back to "Books" bucket for null.                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Cloud icon semantics misaligned (`uploadedAt`/`downloadedAt` vs our flags)                         | Cloud-up icon repurposed in v1 as **informational** ("Local only") not actionable, with long-press tooltip noting upload arrives in v2. Documented divergence.                                                                                                                                                                                                                                                                                                   |
| 14  | Auth refresh callback race                                                                         | Added `withFreshToken(cb)` wrapper in `syncauth.lua`; all new + existing API calls migrate.                                                                                                                                                                                                                                                                                                                                                                      |
| 15  | 401/403 inconsistency                                                                              | Updated `syncconfig.lua`/`syncannotations.lua` to treat HTTP 403 (not just body string) as auth failure.                                                                                                                                                                                                                                                                                                                                                         |
| 16  | Spore `pullChanges` requires `book`/`meta_hash`                                                    | Adding **new** Spore method `pullBooks(since)` instead of relaxing existing `pullChanges` (existing per-book pull still needs the params).                                                                                                                                                                                                                                                                                                                       |
| 17  | Deleted book leaves local-only stale row                                                           | Documented: `cloud_present=0, local_present=1` is a valid state ("you deleted from cloud but the file is still on this device"). User can delete locally via FileManager. v1 does not auto-mirror cloud deletes to local files.                                                                                                                                                                                                                                  |
| 18  | Initial `since=0` dummy `00000…` book                                                              | `parseSyncRow` filters this hash; verification step #11 confirms.                                                                                                                                                                                                                                                                                                                                                                                                |
| 19  | Progress shape ambiguity                                                                           | Schema renames to `progress_lib` to make clear it's `books.progress` from `/sync` (a `[cur, total]` tuple), distinct from KOReader's per-document position and Readest's `book_configs.progress` xpointer.                                                                                                                                                                                                                                                       |
| 20  | e-ink perf                                                                                         | Added `librarygrid.lua` windowing module + debounced search + cached `getGroups` + throttled cover extraction. Verification step #12 sets concrete benchmarks.                                                                                                                                                                                                                                                                                                   |
| 21  | Coverbrowser dependency contradiction                                                              | Resolved as hard dependency; if absent, all books render `FakeCover` (no degraded grid mode).                                                                                                                                                                                                                                                                                                                                                                    |
| 22  | Download path losing `{hash}/{title}` convention                                                   | Intentional in v4: flat `{library_download_dir}/{safeTitle}.{ext}` layout (user-confirmed — KOReader users prefer flat dirs in their book folder). Hash-based reconciliation still works via DocSettings `partial_md5_checksum` from `.sdr/` sidecars, independent of file location.                                                                                                                                                                             |
| 23  | `uploaded_at` ≠ downloadable object                                                                | Added 404 handling: "Cloud copy unavailable"; verification step #8 covers this.                                                                                                                                                                                                                                                                                                                                                                                  |
| 24  | Verification too thin                                                                              | Steps 10-12 added: auth flows, dummy filter, perf benchmark with concrete targets. Test-vector matrix dropped per user (see #5).                                                                                                                                                                                                                                                                                                                                 |

**VERDICT:** REVISION COMPLETE — ready for implementation pending user approval.
Recommend optional re-run of `/codex review` against the revised plan to
confirm the storage-path-fallback claim and the parseSyncRow design.
