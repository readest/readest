---
name: bookorbit-unmatched-source-5742
description: "#5742 Readest books never appear under BookOrbit's Unmatched KOReader Books; server filters on match-check `source`, PR #5704 (KOSync metadata) is unrelated"
metadata: 
  node_type: memory
  type: project
  originSessionId: 01dd44aa-827f-4924-b583-b62d01ef3f5d
  modified: 2026-08-24T20:24:08.605Z
---

Issue #5742 (chizzy-n): books imported outside BookOrbit get the "Book not found in the BookOrbit library" toast but never show up in BookOrbit's **Unmatched KOReader Books** list for manual linking, unlike books opened via the BookOrbit koplugin.

**Root cause (server side, verified in bookorbit/bookorbit source 2026-08-25):** `koreader.repository.ts` `listUnmatchedBooks` filters `source IN ('current_file','file') AND metadata_ambiguous = false`. `/plugin/match-check` upserts every unmatched hash, but Readest's `notesPass.ts` sent `{hash, title, authors}` with no `source`, so rows landed as `statistics` and were hidden. The koplugin (`bookorbit_book_sync.lua` stepMatch) sends `source = "current_file"`, `last_open`, `metadata_ambiguous = false`.

**PR #5704 does NOT solve it:** it adds KOReader 2026.05's `metadata` field to `KOSyncClient` progress uploads, gated by `settings.kosync.sendMetadata`. `bookOrbitProgressProvider.selectConfig` never sets `sendMetadata`, and BookOrbit's `KoreaderSaveProgressDto` accepts `metadata` but `koreader.service.ts` ignores it and never touches the unmatched table. Unmatched entries come only from `match-check`.

**Fix:** **MERGED #5860** (`c07e75916`, 2026-08-25, shipped via `/ship`), worktree REMOVED; branch had 3 commits: `9003c2fb3` `MatchCheckBook` gains `lastOpen` (unix seconds) + `source`, `runBookOrbitNotesPass` sends `source: 'current_file'`, `lastOpen: floor(now/1000)`; `556b416b5` coverage tests; `d9f56408b` `BookOrbitClient.matchCheck` clamps title 500 / authors 1000 (server DTO `@MaxLength`, a 400 there silently kills the whole notes pass; adversarial-review find). 10056 tests + lint green; ship review logged. Reporter verify on a live instance pending.

**Ship follow-ups (NOT done, both Claude + Codex flagged):** match-check only runs from the notes pass, so `syncNotes` off OR fixed-layout (PDF/CBZ, `FIXED_LAYOUT_FORMATS` skip in useBookOrbitNotesSync) never registers a book; a deterministic 400 is retried every notes tick and only `console.warn`ed; toast copy could point at the dashboard (i18n key rename). No VERSION/CHANGELOG in this repo, so `/ship` title has no `v` prefix (conventional-commit title kept); TODOS.md has no Priority fields / Completed section (skill would ask to reorganize).

**VERIFIED against BookOrbit's real server 2026-08-25** (main @ cb2ea1e): captured Readest's actual wire bodies (temp vitest with `window.fetch` mock, from `dev` = old and the fix worktree = new) and replayed them through BookOrbit's own vitest e2e harness (`createReaderStateIsolationE2EContext`, `app.inject`). 6/6: old body -> row `source='statistics'`, hidden from `GET /koreader/unmatched-books`; new body -> `current_file`, listed with title/authors/lastOpen; old-then-new upgrades the row; `PUT /koreader/syncs/progress` with #5704 `metadata` -> **404 "Book not found for the given document hash"**, no unmatched row; dashboard link -> next match-check returns the bookId. Recipe: ephemeral `initdb`+`pg_ctl` on port 54329 in job tmp (brew postgresql@15, NOT the system service); no pgvector -> sed `vector(256)`->`real[]` + drop the hnsw index in `0000_baseline.sql`; create `public.bookorbit_unaccent()` from `src/scripts/postgres-extensions.ts` by hand; migrate with a 4-line tsx script calling drizzle `migrate()` (drizzle-kit's spinner eats errors); env from `.github/workflows/e2e-runner.yml` (`JWT_SECRET`, `NODE_ENV=test`, `BOOKS_PATH`, `APP_URL`) + `E2E_DATABASE_URL`; run `vitest run -c vitest.config.e2e.ts <spec>`.

**Compat:** BookOrbit's ValidationPipe is `forbidNonWhitelisted: true`, but `books`/`lastOpen`/`source` all entered `MatchCheckBookDto` in the same commit (a0dad230, 2026-07-02), so no server that accepts today's payload rejects the new fields.

**Known gaps (unfixed, by scope):** match-check only runs from the notes pass, so BookOrbit `syncNotes` off = no unmatched registration at all; the koplugin also sweeps library files with `source = "file"`, Readest only reports the open book; the toast text does not point users at the dashboard.

Related: [[custom-headers-kosync-bookorbit-5570]], [[sync-fixes]].
