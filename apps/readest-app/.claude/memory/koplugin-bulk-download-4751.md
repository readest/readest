---
name: koplugin-bulk-download-4751
description: "koplugin Library \"Download all books\" bulk download — entry point, candidate query, and the sync/async coroutine bridge"
metadata: 
  node_type: memory
  type: project
  originSessionId: b474b24d-cfa5-4f32-b6f2-d6a35f27cadd
---

Issue #4751: bulk "download all" for the readest.koplugin Library view (parity with Readest web/desktop "download all"). Branch `feat/koplugin-bulk-download-4751`, PR #4765 (base main).

- Entry point: view-menu Actions section in `library/libraryviewmenu.lua` → calls `require("library.librarywidget").downloadAll()` (no args; reads `M._opts`/`M._store` like `M.refresh()`).
- Candidate set: new `LibraryStore:listCloudOnlyBooks()` = `cloud_present=1 AND local_present=0 AND deleted_at IS NULL AND uploaded_at IS NOT NULL` (phantom records with no uploaded file are excluded, same as `listBooks`). Whole library, ignores active search/group. Test-first in `librarystore_spec.lua`.
- Orchestration `M.downloadAll()`: sequential reuse of `syncbooks.downloadBook`, inside `Trapper:wrap`. Progress + cancel via `Trapper:info("Downloading %1 of %2…")` — it yields to UIManager, so a tap queued during the previous (blocking) download is processed at the book boundary and raises Trapper's Abort/Continue confirm (returns false → cancel). Skip per-book failures, count them, show a summary toast. Only `Trapper:clear()` when NOT cancelled (abort path already closed the widget).
- **Sync/async cb bridge** (the non-obvious bit): `downloadBook`'s callback fires exactly once but may be synchronous (token fresh) OR async (after token refresh). In the cb, resume the coroutine only `if coroutine.status(co) == "suspended"`; capture result + a `finished` flag, and only `coroutine.yield()` `if not finished`. This avoids "resume non-suspended coroutine" errors in the sync case and correctly awaits in the async case. Reusable for any callback-style KOReader API awaited inside a Trapper coroutine.
- i18n: 6 new `_()` strings, `T(_("… %1 …"), ...)` interpolation (`local T = require("ffi/util").template`). Ran `node scripts/extract-i18n.js`; translated all 33 locales via [[i18n-koplugin]] flow. Verify: placeholders `%1/%2/%3` preserved (no `%s/%d`), `…` U+2026 kept.
- Note: the per-book long-press sheet already had a "Download All" (cover+file for ONE book) — left as-is; distinct from the new bulk "Download all books".

Gates: `pnpm lint:lua` + `pnpm test:lua` (see [[verify-format-check-gate]] / verification.md). No JS/TS/Rust changes.
