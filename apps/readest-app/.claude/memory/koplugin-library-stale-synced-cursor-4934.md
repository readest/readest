---
name: koplugin-library-stale-synced-cursor-4934
description: "#4934 koplugin Library goes stale forever: pull cursor keyed on client updated_at not server synced_at; split pull/push cursors + v2->v3 heal migration"
metadata:
  node_type: memory
  type: project
---

**Issue #4934, PR #4944 MERGED** (merge commit `0b180da6a`, koplugin Lua only, base `readest/readest:main`). Reporter: iOS + KOReader; the koplugin "Readest library" stopped receiving iOS updates and never recovered. Workaround was delete `koreader/settings/readest_library.sqlite3` + "Pull books now" (works for a while, re-breaks). **iOS/web library unaffected** — the smoking gun.

**Root cause (the direct follow-up [[sync-synced-at-cursor-4678]] predicted).** Since #4678 the server keys the books GET on the server-stamped `synced_at` (`src/pages/api/sync.ts` `cursorColumn = table==='books' ? 'synced_at' : 'updated_at'`, `.gt('synced_at', since)`). Web/iOS advance their cursor from `synced_at` (`useSync.ts computeMaxTimestamp`, prefers synced_at) → always ≤ server-now → never stale. The **koplugin was left on `updated_at`**: `syncbooks.lua pullBooks` set `last_books_pulled_at = max(updated_at, deleted_at)` of returned rows; `parseSyncRow` never read `synced_at`. `updated_at` is CLIENT event time, and the koplugin stamps it from the **device clock** (`librarystore.lua touchBook` = `os.time()*1000`). An e-reader clock ahead of the server (common; dead RTC / wrong date) — or ANY single row account-wide carrying a future `updated_at` — drove the koplugin's global cursor past server-now, so `synced_at > since` returned nothing **forever**. Delete-sqlite reset the cursor to 0 (workaround); it re-broke once a book-open re-bumped it into the future.

**Extra hazard #4678 flagged:** `last_books_pulled_at` was SHARED between the pull cursor (vs server synced_at) and push-delta detection (`getChangedBooks` vs LOCAL updated_at) — can't just retarget it to synced_at. So the fix requires a cursor SPLIT.

**Fix (all in `apps/readest.koplugin/library/`):**
1. `librarystore.lua parseSyncRow`: add transient `synced_at = iso_to_ms(dbRow.synced_at)` (NOT a books column; server sends it via `select('*')`). New `getLastPushedAt`/`setLastPushedAt` on key `last_books_pushed_at`.
2. `syncbooks.lua`: new pure `row_pull_cursor(parsed)` = `parsed.synced_at` if present else `max(updated_at, deleted_at)` (mirrors computeMaxTimestamp; exported `M._row_pull_cursor` for tests). `pullBooks` seeds `pull_ts`/`push_ts` from their stored values (no regression on empty pages), advances `last_books_pulled_at` from `row_pull_cursor` (synced_at) and `last_books_pushed_at` from `max(updated_at, deleted_at)` of pulled rows. `pushChangedBooks` reads/writes `getLastPushedAt`/`setLastPushedAt` instead of the pull cursor.
3. **Cursor split:** pull cursor = server `synced_at` (pull only); push watermark = local `updated_at`, advanced on BOTH pull and push (preserves the old dedup so pulled books aren't re-pushed — the old shared cursor did exactly this).
4. **Heal migration `SCHEMA_VERSION 2->3`** (`M.new`, guard `prev>=1 and prev<3`): `INSERT last_books_pushed_at SELECT value FROM ... WHERE key='last_books_pulled_at'` then `UPDATE ... SET value='0' WHERE key='last_books_pulled_at'`. Seeds push watermark from the old shared value (no re-push storm) and zeroes the pull cursor → next sync does ONE full re-pull that re-establishes it on synced_at. **Auto-heals already-stale installs; user need not delete the sqlite.**

**Scope note (intentional):** the push watermark, seeded from a poisoned future value, still suppresses the koplugin's OWN local pushes until wall-clock passes it — but that's UNCHANGED from before (old shared cursor did the same) and #4934 is a pull/viewing bug ("iOS unaffected"). Not fixing device-clock `updated_at` here. Only functional cursor callers are in syncbooks; `librarywidget.lua:557` only logs it.

**Tests (TDD, gates `pnpm test:lua` 224✓ / `pnpm lint:lua` exit 0):** `librarystore_spec.lua` — parseSyncRow synced_at, getLast/setLastPushedAt independent round-trip, `v2->v3 migration` (reset pull=0 + seed push, per-user), bumped user_version 2→3 (and the v1->v2 test now lands at 3, migrations cumulative). `syncbooks_spec.lua` — `_row_pull_cursor` (synced_at wins over a future updated_at; fallback; 0), and `pullBooks` integration via injected fake `sync_auth`/client + real in-memory store asserting pull cursor=synced_at (not future updated_at) and push watermark=updated_at distinctly.
