---
name: cfi-range-start-between-children-7482
description: "#7482 highlight drawn from paragraph start: CFI dropped (element, i>0) starts; fixed in foliate fromRange (#168, #169); MERGED #7515 005ef1399; WebKit caret-over-inline-image repro; readest pins off-main foliate commits"
metadata:
  node_type: memory
  type: project
  originSessionId: 4b4a933c-1100-4e61-b33d-68e8d9c4021c
  modified: 2026-11-17T04:43:17.385Z
---

#7482 / PR #7515 (2026-11-17): a highlight was drawn from the start of the paragraph while its saved text was right. Cause: foliate `partToString` writes `:offset` only for odd (text) steps, so a range START at `(element, i>0)` read back as the element's start. Fixed in foliate `fromRange` via `startInsideChild` (readest/foliate-js#168, merged 12cf174), next to `endInsideChild` (#119). Readest PR #7515 merged 2026-11-17 as 005ef1399, pinning foliate `9fc07e0` (branch `fix/cfi-range-start-between-children-on-pin`). Already-saved bad CFIs are not repaired.

- Only `i > 0` is broken. A first version that also moved `(element, 0)` starts failed 23 readest tests (xcfi, footnote-cfi-mapping, epubcfi-skip/inert, media-overlay), which pin those CFIs byte for byte.
- A `cfi-skip` wrapper as the next child needs a descent into its first child, since the wrapper has no CFI step (foliate #169, from CodeRabbit). Inline cfi-skip spans are common: Word Lens, translation, dialogue highlighting.
- Where `(p, i)` comes from: WebKit `caretPositionFromPoint`/`caretRangeFromPoint` over an inline `<img>` (right half → after it). Desktop WebKit mouse selections around `<em>`/`<a>`/`<span>` gave text positions, and a mouse-down on an image starts an image drag rather than a selection. The real path is the highlight range handles (`rangeFromAnchorToPoint`).
- Repro on dev-web: Playwright `Desktop Safari` project, EPUB with `<p>… echo <img/>foxtrot …</p>`. Highlight "foxtrot golf", `clickHighlight()`, drag the start handle 3/4 across the image, then read `svg g path` getBBox().x. The reader rewrites element ids, so find the paragraph with `p:has(img)`.
- Not reproduced on the reporter's iPad (no Readest in any simulator). The reporter's "extends to the end of the line" wording isn't explained.

**Foliate pinning:** readest `main` pins foliate commits that are NOT on foliate `main` (e8fde46 carries open #153's footnotes.js). To bump, cherry-pick the fix onto the current pin, push it as `<branch>-on-pin` to readest/foliate-js, and pin that. Keep that branch; pinning foliate main alone would drop #153. See [[worktree-new-pr-rebases-onto-main]].
