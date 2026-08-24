---
name: eink-per-device-css-data-eink-5795
description: "#5795 Boox WenKai too light / font-weight 0-500 no-op: per-device CSS via html[data-eink] on the book doc; MERGED #5803 2026-08-21 (46073d324); font-weight = single 400 face (VERIFIED), not a bug"
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

**State as of 2026-08-21:** MERGED #5803 (merge commit `46073d324`, branch and worktree
removed).
- `applyEinkModeAttribute()` in `src/utils/style.ts` mirrors `data-eink` (`'true'`/`'false'`,
  both written) onto each book `documentElement`; called in `FoliateViewer.tsx` on section
  load + in the theme/scroll re-apply effect (dep `isEink`). Users gate synced CSS on
  `html[data-eink='true']`.
- Tests: 3 cases in `src/__tests__/utils/style-dom.test.ts` (RED vs origin/main confirmed).
- Font-weight claim VERIFIED: the cdnjs `lxgw-wenkai-screen-web/1.520.0` stylesheet has 248
  `@font-face` subsets, ALL `font-weight: 400`; 100-500 collapse to it, 600+ = faux bold.
  Not a Readest bug; built-in e-ink stroke toggle (issue option 2) deliberately NOT done.
- Issue comment POSTED 2026-08-21 (issuecomment-5358737902): font-weight explanation + `html[data-eink]` recipe; PR closed
  #5795 via `Closes`. Device verify on a Boox still PENDING.
- Gotcha: `git push` runs a pre-push hook (lint + FULL vitest, ~2.5 min); a 2-min Bash
  timeout kills it silently with nothing pushed. Run pushes in the background.

**How to apply:** verify on a Boox that the stroke rule fires only with E-ink on (not yet
done). If the reporter still wants a built-in
toggle, it is a follow-up feature, not part of #5803. Related: [[eink-class-substring-matchers]],
[[library-reader-separate-texture-4743]] (per-device vs synced setting split).
