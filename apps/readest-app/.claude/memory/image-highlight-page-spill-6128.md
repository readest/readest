---
name: image-highlight-page-spill-6128
description: "#6128 image highlight leaks a 2px stripe onto the next page (Android, paginated); root = Overlayer.highlight radiusPadding crossing a ZERO column gap (mobile margin slider at minimum); fix clamps each drawn box to its page tile in foliate overlayer.js; MERGED readest #6182 (d61366835) + foliate-js #94 (9e05bf2); UNRELEASED, not device-verified"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6533f2f3-b93c-4222-a156-a3861d248209
  modified: 2026-09-11T14:19:42.151Z
---

**Issue:** https://github.com/readest/readest/issues/6128 (Android 14, Readest 0.12.7). Reporter's
video (Google Drive, downloadable with plain curl) shows a highlight running from text through a
column-wide image; on the NEXT page a 1-2px green stripe runs down the left edge, exactly the image's
vertical extent. It is a cross-fade page turn, so the gap is never visible in the video.

**Root cause (Chrome-VERIFIED 2026-09-09):** `Overlayer.highlight` pads the first/last rect by
`radiusPadding = 2` so the 4px corner radius clears the glyphs. The paginator's column gap is
`(marginLeft + marginRight)/2 + gap`; the mobile footer margin slider (`FontLayoutPanel.handleMarginChange`)
drives BOTH `marginPx` and `gapPercent` from one value, so its minimum gives column-gap 0 and adjacent
pages touch. The image is the LAST rect of the reporter's selection, so its 2px cap paints on the next
page: with margins 0 + gap 0% the probe drew the image path at x=800..1602 on an 800px page (and the
first text rect at x=-2 onto the previous page). Same bug for justified text lines, just 18px tall.
Nothing to do with `#splitRange` (in the 0.12.7 pin), image sizing, or fragmentation.

**Fix (foliate-js `overlayer.js`, submodule -> needs its own PR + re-pin):** `#getRects` tags each
rect with `page = pageOf(rootRect, rect)`; `highlight()` clamps x/y/w/h to it and skips empty boxes.
`pageOf` works because `expand()` sets `documentElement.style[width|height] = columnSize`, so the root
box TILES the pages along either axis in either direction (RTL = negative k via floor); scrolled mode
root = whole document, so the clamp is a no-op there. Caps still extend into real margins (tile, not
content box), so nothing else changes visually. ~30 lines.

**Regression test:** `src/__tests__/document/overlayer-highlight-page-bounds.browser.test.ts` (Chromium):
margins 0 + gap 0%, 800x600, 1 column; (1) `repro-6128-image-highlight.epub` section 1, range
START..after img -> every drawn bbox stays inside the page holding its centre, image box still covers the
image; (2) `sample-vertical-rl.epub` h1 first 3 chars -> vertical cap at y=-2 clamped. Both FAILED before
the fix (`expected -2 to be >= -0.01`), pass after. Dumping from a browser test: `onConsoleLog` drops
stdout AND stderr; put the dump in an assertion message (`expect(out).toBe('')`).

**State (2026-09-11):** readest #6182 MERGED as d61366835 on main (unreleased); worktree + branches removed; the duplicate untracked fixture in the main checkout deleted (identical to the merged one). foliate-js #94 MERGED as squash 9e05bf2 (content identical to branch 58af29d,
nothing else on main). readest #6182 OPEN on `fix/image-highlight-page-spill-6128`: 70100af75 (fix +
test + fixture, pinned the branch commit) + e069f9b77 (re-pin to 9e05bf2, regression test re-run green).
Merged with main 1b681939d. Verified
before push: `pnpm lint`, `pnpm format:check`, foliate eslint, `pnpm test` 919 files, `pnpm test:browser`
58 files all green. The worktree submodule `origin` is the LOCAL gitdir; pushed with an explicit
`git@github.com:readest/foliate-js.git` URL + `GIT_SSH_COMMAND` keepalives ([[git-push-socks-proxy]]).
Not device-verified. The prior session left the same fixture UNTRACKED in the main checkout; not removed.
The gstack review subagent stalled (600s watchdog); review was done by hand instead.

**Why:** 2px caps are cosmetic; a layout with no gap makes any cross-column paint visible.
**How to apply:** any overlay drawer that grows past `getClientRects()` must clamp to `rect.page`.
Related: [[annotator-overlay-z-layers]], [[overlayer-blend-mode-follows-page-not-theme-5790]].
