---
name: note-edit-clock-skew-sync-wipe-6544
description: "#6544 note text vanished on reopen (bubble stayed): server-stamped insert + lagging device clock made the note edit look older than its base; fix = nextBooknoteStamp at every booknote change site, plus instant-highlight note wipe fixed; live repro recipe inside"
metadata:
  node_type: memory
  type: project
  originSessionId: e3bccdd4-09eb-47f1-a08c-be5ee756d8f9
  modified: 2026-10-02T07:55:21.296Z
---

Issue #6544 (Windows, Nightly): note text gone after closing/reopening the book, highlight and note **bubble** still drawn. Branch `fix/note-edit-clock-skew-6544` (worktree `readest-fix-note-edit-clock-skew-6544`): d12895687 note edit, d11407d34 `nextBooknoteStamp` helper (`src/utils/booknoteStamp.ts`, max(now, updatedAt+1, deletedAt+1)) at every existing-booknote change site, 31e556714 instant-highlight note wipe. PR #6551 OPENED 2026-10-02; review follow-ups fc4a523dc (mergeRestyledAnnotation now spreads `existing` first: restyle kept dropping xpointers/hashes) + 05164db84 (handleCopy excerpt + upsertNotebookRecord restamp); MERGED 2026-10-02 as e3ab5d0e6, UNRELEASED; worktree + local/remote branch removed; never verified on a real Windows device.

**Root cause (needs sign-in + device clock behind the server by a few seconds):**
1. Annotate creates an empty placeholder; `useNotesSync` pushes it; `pages/api/sync.ts` upsertRecords **insert** stamps `updated_at = new Date()` (SERVER clock) and returns it; the local record adopts it (incomingWins).
2. Saving the note stamps device `Date.now()` < that server stamp, so `getNewNotes` (`lastSyncedAtNotes < note.updatedAt`) skips it: the note is never pushed.
3. Reopen: `useSync` starts `lastSyncedAtNotes` at stored − 1 day, so the pull returns the empty server copy, which wins `processNewNote`. The bubble was drawn from local data first, so it stays.

**Fix:** every change to an existing booknote is stamped with `nextBooknoteStamp`, which never sorts before the record's last change. Cannot recover notes already lost (never reached the server).

**Live repro recipe (web, logged in, localhost):** in the reader page run `Date.now = () => realNow() - 60000`, then **wait > 60 s before annotating**: `throttle` uses Date.now, so a fresh skew silently swallows every push for 60 s (an experiment artifact that looks like "nothing synced"). Wrap `window.fetch` to log `/api/sync` notes request/response `updated_at`s, and print without URLs (the chrome tool blocks query strings). Verified: unfixed = edit never pushed, wiped on reopen; fixed = pushed at server stamp + 1 ms, survives.

**Traps hit:** Chrome MCP tab not the active tab = rAF stalls (no toolbar/menus); a chrome-MCP `screenshot` activates the tab. The desktop `tauri dev` build was NOT signed in ("Not authenticated" in the Next issue overlay), so desktop runs were logged-out tests only. Headless Playwright logged out gets demo books (Gatsby etc.), no import needed.

Related: [[sync-clock-skew-lastsynced-5661]] (same server-vs-client clock mixing family; the general server-side clamp is still not done). The notebook record (`notebookDocument.ts`) keeps its own stamping and was left alone.

Instant-highlight note wipe (FIXED 31e556714): `persistAnnotation` spread `createAnnotation()` (`note: ''`) over an existing same-cfi record; now `mergeRestyledAnnotation`. Headless repro needs the Instant Highlight drag NOT to be preceded by a stray page click (that disarms it); verified web headless (control wiped, fix kept) + Tauri (config.json updatedAt bumped, note kept). Desktop test left Instant Highlight OFF again (global was null before).
