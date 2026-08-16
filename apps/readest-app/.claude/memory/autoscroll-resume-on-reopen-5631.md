---
name: autoscroll-resume-on-reopen-5631
description: "#5631 Auto Scroll resumes on reopen — per-book viewSettings flag, only explicit stops clear it; StrictMode latched the unmount ref"
metadata:
  node_type: memory
  type: project
---

Issue #5631 asked for an opt-in "Start Auto Scroll on open" setting. User's call: **no new
option** — instead, a session that was *not stopped* when the book was closed resumes on
reopen. MERGED 2026-08-15 as PR #5710 (squash `be6845371`).

Shape (`src/app/reader/hooks/useAutoScroll.ts`):

- New `ViewSettings.autoScrollRunning` (in `BookLayout`, default false in `DEFAULT_BOOK_LAYOUT`).
  Written with `saveViewSettings(..., skipGlobal=true, applyStyles=false)` so it lands in the
  **book config only**, never `globalViewSettings`. `serializeConfig` prunes values equal to
  global, so `false` never reaches disk — a stopped book's config has no key at all.
- `startSession()` persists true; `onStop` persists false **unless** `closingRef.current`.
- Resume effect keyed on `viewStates[bookKey].inited` (renderer/`flow=scrolled` are set before
  `view.init()`, but there is nothing laid out to scroll until inited).
- Resume is skipped when `previewMode` is set — otherwise opening a `?cfi=` deep link (library
  full-text-search hit, shared annotation) would scroll unprompted and promote the preview into
  the user's real reading position. Needed moving `setPreviewMode(bookKey, true)` **above**
  `setViewInited(bookKey, true)` in `FoliateViewer.openBook` so the flag is visible when the
  resume effect fires, instead of relying on React batching the two store writes.

**The bug the unit tests could not see:** the unmount cleanup sets `closingRef.current = true`
so closing the book doesn't clear the flag. `next.config.mjs` has `reactStrictMode: true`, so in
dev React runs setup -> cleanup -> setup on mount; the cleanup **latched the ref true forever**
and every later explicit stop silently skipped its write. Symptom in Chrome: Escape stopped the
scrolling but `autoScrollRunning: true` stayed in IndexedDB, so the book auto-scrolled again on
the next open. Fix = re-arm `closingRef.current = false` at the top of the same effect. Any
mount-only ref that a cleanup mutates needs the same re-arm. Reproduced in the unit test with
`renderHook(..., { wrapper: StrictMode })` — plain `renderHook` passes either way.

Verified end to end in Chrome against `pnpm dev-web` (see [[browser-verify-readest-web-recipe]]):
start -> config gets `{scrolled, autoScrollRunning:true}` -> leave to /library -> reopen ->
`containerPosition` advances with no input -> Escape -> flag pruned from config -> reopen ->
no movement. Related: [[verify-reader-chrome-needs-e2e]].
