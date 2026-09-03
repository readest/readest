---
name: verify-annotations-hub-needs-long-list
description: Reproducing annotations-hub scroll bugs needs 60+ notes and a separate dev-server port; short lists give false passes
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6cadaf05-b000-4043-9a4e-aaafa0fab6f6
  modified: 2026-09-01T10:47:39.185Z
---

Verifying the annotations hub in Chrome has three traps, all hit while working
[[annotations-hub-scroll-to-new-note-5987-5957]]:

1. **`pnpm dev-web` silently exits when port 3000 is already taken** by another
   checkout's `next dev` — the worktree's change then "doesn't hot-reload"
   because the page is being served by the *other* tree. Check the listener's
   cwd (`lsof -p <pid> -a -d cwd`) before debugging the code. Run the worktree
   on its own port: `npx dotenv -e .env.web -- npx next dev -p 3010`.
2. **A different port is a different origin** — empty IndexedDB, signed out.
   That is the right place to test: port 3000 pulls the real cloud library
   (700+ books) and any annotation made there syncs to the live account.
3. **A ~10-note list does not reproduce** hub scroll bugs. The list is short
   enough that max scrollTop already reveals the new row, so buggy and fixed
   builds both pass. Seed ~60 notes first.

**Why:** two full A/B rounds passed identically on a 10-note list before the
70-note run separated them cleanly (before: no editor rendered at all; after:
editor centered, caret inside).

**How to apply — seed notes without the app clobbering them:** the reader
writes its in-memory config back on unload, so seeding while the book is open
is lost on the very next navigation. Navigate to `/library` FIRST, then patch
`Readest/Books/<hash>/config.json` in the `AppFileSystem` IndexedDB store
(records are `{path, content}`, in-line keys — `put(record)` with no key arg),
then navigate to the reader. Synthetic CFIs of the form
`epubcfi(/6/8!/4/2/2[chapter_458]/4/2,/1:<n>,/1:<n+12>)` (varying offsets in one
paragraph) sort correctly and resolve to the right TOC group.

Import an EPUB on the web build by dispatching a real `DragEvent` with a
`DataTransfer` at `.library-page` — `selectFiles` throws in the browser, and the
drop listener is attached to that element, not `window` or `body`.

**`pnpm format` is workspace-rooted, so run it from the worktree.** Running it
from `~/dev/readest` formats the MAIN checkout; `pnpm format:check` in the
worktree then still fails, and the mismatch survives a commit. Same trap for
`pnpm -w` scripts generally.

**Never `git stash` inside a worktree to park work.** The stash list is shared
with every other worktree of the repo, so `git stash pop` can restore a
completely unrelated old entry over your tree (it did: a `dev@0.12.6` WIP with a
MEMORY.md conflict and a foliate-js gitlink change). Use a scratch commit or
`git worktree` isolation instead.
