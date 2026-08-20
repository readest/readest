---
name: eink-per-device-css-data-eink-5795
description: "#5795 Boox WenKai too light / font-weight 0-500 no-op: per-device CSS via data-eink on book doc; local-only branch, NO PR, NO tests, not in memory until 2026-08-21"
metadata: 
  node_type: memory
  type: project
  originSessionId: da7de966-2949-4d24-ae0f-0bed3bd1faf7
  modified: 2026-08-20T16:08:00.240Z
---

Issue #5795 (filed 2026-08-20, OPEN, no comments/labels/linked PRs): on Boox Leaf 3 the
default `LXGW WenKai GB Screen` is too light; Font Weight slider 0-500 does nothing, 600
is synthetic-bold; user's `-webkit-text-stroke` custom CSS syncs to LCD devices because
`userStylesheet` is in SETTINGS_WHITELIST while `isEink` is per-device.

**State as of 2026-08-21:** work STARTED but UNSHIPPED and was NOT in memory.
- Branch `fix/eink-font-weight-and-data-eink`, worktree
  `/Users/chrox/dev/readest-fix-eink-font-weight-and-data-eink`, ONE commit `978838ea0`
  (2026-08-20): `applyEinkModeAttribute()` in `src/utils/style.ts` mirrors `data-eink`
  (`'true'`/`'false'`, both written) onto each book `documentElement`; called in
  `FoliateViewer.tsx` on section load + in the theme/scroll re-apply effect (dep `isEink`).
  Lets users gate synced CSS on `html[data-eink='true']`.
- Local-only: upstream is `origin/main`, no remote branch, no PR, not on `dev`/`main`.
- NO unit test added (violates test-first rule) — add one before shipping.
- Commit claims font-weight is NOT a Readest bug (WenKai GB Screen = single 400 face, so
  100-500 collapse and 600+ synthesises bold). UNVERIFIED against the font file; font is
  not in the repo tree. Built-in e-ink stroke (issue solution 2) deliberately not done.

**How to apply:** when resuming, add a test for `applyEinkModeAttribute`, run
`pnpm test`/`pnpm lint`, push + PR, and reply on the issue with the `html[data-eink]`
recipe and the font-weight explanation. Related: [[eink-class-substring-matchers]],
[[library-reader-separate-texture-4743]] (per-device vs synced setting split).
