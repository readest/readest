---
name: plans-page-back-to-reader-6607
description: "#6607 opening Plans/account from reader settings dropped the book; fix = redirect param + transition router + reuse still-open books on reader remount; #6609 + #6610 MERGED (72b837c90), worktree removed"
metadata:
  node_type: memory
  type: project
  originSessionId: dd9dc070-a024-46bf-a4d9-5e642f2e8be6
  modified: 2026-10-03T15:29:56.284Z
---

#6607: `navigateToProfile` pushed bare `/user` and its back button always went to
`/library`, so opening Plans from reader settings (or TTS sheet) lost the book.

Fix (worktree `readest-fix-plans-back-to-reader-6607`, branch
`fix/plans-back-to-reader-6607`, #6609 MERGED 984c1b04f; review fixes PR #6610):
- `navigateToProfile` adds `?redirect=<opener>`; `navigateBackFromProfile` returns
  there (rejects `//` / non-`/`); signed-out `/user` passes it on to `/auth`.
- Profile callers + `/user` use `useAppRouter` (view-transition slide,
  `data-nav-direction` forward/back) — chrox said the plain cut was "too hard".
- Reader remount used to flash TWICE: store still held the old bookKeys (stale
  shell render), then init minted new keys (blank) and reloaded. Fix =
  `readerStore.areBooksOpen(ids)` → ReaderContent skips init and reuses the open
  books. chrox: "much better".

**Traps:** `closeBooks` clears viewStates but leaves `bookKeys` — any "still open"
check must require view states. Leaving the reader by route (not close) never
saves/clears anything. Verified on macOS dev build (signed-out path via a
premium Integrations row → /user → /auth → back); signed-in Plans back button
not exercised live. A hot reload mid-session once lost a page turn (not reproducible
cleanly). See [[computer-use-tauri-dev-binary-no-bundle-id]].

**Trap hit:** chrox merged #6609 while I was fixing CodeRabbit findings; my push
re-created the deleted branch (`[new branch]` on a branch I'd already pushed = it
was merged + deleted). Check `gh api pulls/N --jq .merged` before pushing review
fixes; if merged, cherry-pick onto origin/main as a follow-up PR.
