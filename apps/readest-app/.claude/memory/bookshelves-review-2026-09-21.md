---
name: bookshelves-review-2026-09-21
description: "Review of the configurable bookshelves feature (commit 0a73fb651, docs/bookshelves.md), follow-up fixes, and persistence decisions"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4884cf5c-15aa-418e-b247-eb0a08d3b804
  modified: 2026-09-21T03:15:28.897Z
---

Reviewed 0a73fb651 "feat(library): add configurable bookshelves and migrate preferences" on 2026-09-21 (Claude structured pass + 4 Opus specialists + Codex adversarial). Nothing was fixed; report only. 139 bookshelves unit tests pass.

**P1, verified**
- Journal replays ops with ORIGINAL HLC stamps (`services/bookshelves/journal.ts`, `persistence.ts` replay) but the server rejects any row whose `updated_at_ts` is more than 60s from server time (`libs/replicaSyncServer.ts` `clampHlcSkew`, two-sided) with 409 CLOCK_SKEW. `ReplicaSyncManager.flush` only isolates UNKNOWN_KIND, so one stale shelf op fails the WHOLE push batch (all kinds), and the journal re-marks it dirty every launch. Triggers: offline edit, anonymous edit then sign-in, sync category off then on, old server. Probe-confirmed (fresh op ok, 2-min-old op 409); Codex reproduced the mixed-batch block. Same wedge class: definition over 64 KiB (local zod allows ~82 KB), over 100 pending rows (MAX_PUSH_BATCH), or web API deployed before SQL 023 (DB CHECK gives 500 SERVER, not UNKNOWN_KIND).
- Group selection uses a stale closure: `BookshelfItem` memoizes `handleSelectItem` on `[isSelectMode]` only, while `Bookshelf.tsx` `toggleSelection(id, group)` closes over `selectedBookSet`. Selecting a group replaces the selection with the mode-entry snapshot plus that group; a group cannot be deselected by tap. Code-read only, not runtime-reproduced (the library tests mock BookshelfItem).
- `isSelectAll` latch (pre-existing) now re-fires on ANY settings write because `sections` depends on the whole `settings` object: unticked books get re-selected before a bulk Delete.
- Legacy prefs frozen with no UI: `libraryHideCovers` still read by `BookCoverViewer.tsx`, `BookCover` fallback; `librarySkeuomorphicCovers` by reader sidebar `BookCard`, `BookDetailView/Edit`. A user who had Hide covers ON can never open the cover viewer again.
- No locale keys added: 0 of 35 locale files contain the new strings. Run /i18n.

**P2, verified**: `setSettings` now merges bookshelves (zod parse of every row, new object identity every write) and `globalSort` memo keys on `settings`, so every settings write re-filters and re-sorts the whole library; `saveSettings` reads settings.json before every write; each editor autosave persists twice (`saveBookshelfDraft` then `replayBookshelfOperations`); negated operators (`notEquals`/`notContains`) return false for books lacking the field (`evaluate.ts` `if (!isSet) return false`), probe-confirmed, undocumented; zero-hit search inside a group strips `group`/`shelf` from the URL (regression); tag/subject click deletes `shelf` so the Default shelf's exclusions hide the clicked audiobook; one invalid shelf freezes autosave for all shelves and close silently drops the rest; `loadSettings` merges EVERY account's pending journal rows (no user filter, unlike replay); backup restore LWW-merges shelves so it never rolls back (untested, undocumented); `journal.ts` JSON.parse without try/catch; `.strict()` schemas at the sync boundary make every future additive field drop the whole row on old clients (boot pull is `since: null` so it re-heals after upgrade).

**Why:** the feature is on main and unreleased; these decide whether it can ship.
**How to apply:** if asked to fix, follow test-first; fix the push wedge generically (per-row isolation of permanent 4xx in `flush`, one-sided skew clamp or restamp at push) rather than only for bookshelf. Related: [[sync-clock-skew-lastsynced-5661]], [[group-metadata-row-lww-clobber-5911-5912]].

**Fix status (2026-09-21):** fixes implemented test-first on branch `fix/bookshelves-review-followups`, with the deliberate exceptions below. The initial follow-up verification passed 11787 unit tests, lint and formatting; /i18n added 111 keys across 34 locales. Automated Chromium tests cover editor, preview and stream behavior; no manual native-device verification. Key decisions:
- Wedge fix is CLIENT-side: `prepareRow` (replaces `canPushRow`) restamps only the row-level `updated_at_ts`/tombstone at push time, field `t` stays original. Do NOT loosen the server's two-sided 60s clamp: pull cursors key on `updated_at_ts`, so an old-stamped row would be invisible to incremental pulls. `flush` now isolates per kind then per row (VALIDATION / CLOCK_SKEW / HTTP 5xx) and skips individually rejected rows by object identity until `markDirty` replaces them.
- REVERTED an agent's `getUserID()` account filter in `loadSettings`: on native it calls `supabase.auth.getSession()`, which refreshes an expired token over the network and can stall every window's boot offline. Shelf rows are device-level in settings.json anyway.
- Surfaces outside a shelf (book details, cover viewer, reader sidebar) follow the DEFAULT shelf's covers via `readDefaultBookshelfCovers` / `useDefaultBookshelfCovers`.
- A group opened with no `shelf` URL param is unscoped (whole library); from a shelf it keeps that shelf's filters.
- Left alone on purpose: double sort (TimSort on sorted input is O(n)), multi-window HLC/journal races, replay after a failed boot pull, phone 50/50 editor split, tablist a11y pattern, `key={index}` in the filter editor (identity keys would remount inputs per keystroke; focus moves to Add condition instead).
- Shipping review fixed the remaining stale group-selection callback; it now observes books entering or leaving a mounted group. Local autosave uses AuthContext's cached identity before journaling, so an expired-session refresh cannot delay offline saving; uploads still verify the authenticated account.
- The filter-help browser flake was a real focus race: Dialog's 100 ms opening timer stole focus from an already-focused child and dismissed the tooltip. Preserve focus inside the dialog; a deterministic timer regression reproduces the failure and Chromium checks exercise the tooltip.
- Mobile tab rows stay centered, Manage Bookshelves remembers the last selected shelf locally, and divider spacing is checked with real book cards. Statistics context tests verify that library and preview share the batch load without per-card database reads.
