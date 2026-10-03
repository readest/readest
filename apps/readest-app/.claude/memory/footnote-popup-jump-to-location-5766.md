---
name: footnote-popup-jump-to-location-5766
description: "#5766 footnote popup jump-to-location button; foliate scrolled() ignores margin-* so popup chrome is OVERLAID on the text, never given a reserved strip"
metadata:
  type: project
---

**#5766** (FR: link inside footnote popup should lead to the actual position).
**MERGED** as PR #5889, squash aab58241d (2026-08-26). Worktree removed,
branch deleted local + remote. Chrome-VERIFIED end to end (test EPUB + GEB);
reporter verify pending.

Load-bearing facts:

- **A scrolled foliate renderer ignores `margin-top` / `margin-right`.**
  `paginator.js scrolled()` sets documentElement padding to
  `0px <side> 0px <side>` and only publishes `--page-margin-*` as CSS vars. The
  footnote popup is always `flow: scrolled`, so its `backButtonMargin` was dead
  code and the Back button had **always** overlapped the popup's first line.
  ABANDONED first attempt (kept only for the CSS facts it established, see the
  "chrome OVERLAYS the text" bullet below for what shipped): reserve chrome in
  the popup document via the stylesheet passed to `renderer.setStyles`,
  `body { padding-block-start: calc(1em + 32px) !important }` (needs
  `!important` to beat `getFootnoteStyles()`'s `padding: 1em !important`).
  Still-true fact from it: `padding-block-start` resolves to the top in
  `horizontal-tb` and the **right edge** in `vertical-rl` (browser-verified),
  which is where the chrome strip sits in each mode. It was dropped because it
  put a band of dead space above every short footnote.
- **`margin-top: 32px` on the popup renderer BREAKS the popup outright** (found
  the hard way: chrox reported footnotes not opening in GEB
  `4d3ce53db692da09e5a901f461bab370`). The popup box starts at 88px, the
  paginator turns the margin into a grid row, and the leftover ~56px drives an
  endless expand/resize cycle -- 4400+ "ResizeObserver loop completed with
  undelivered notifications" -- so `relocate` never delivers and
  `setShowPopup(true)` never runs. Symptom: link event fires, `before-render`
  and `render` both run (the jump button is in the DOM), but `#popup-container`
  stays `aria-hidden=true` at x/y -999. Never set a non-zero `margin-*` on the
  popup renderer.
- **The jump button is gated on target visibility** (`isLinkTargetVisible` in
  `footnoteHeuristics.ts`): resolve the href, find the rendered section doc in
  `renderer.getContents()`, walk the target's ancestors with `getComputedStyle`
  looking for `display:none`/`visibility:hidden`. Walk ancestors rather than
  measuring `getClientRects()` -- footnote targets are usually EMPTY inline
  anchors with no box even when visible. Target section not rendered => allow
  (an inline note always sits beside its reference, so it is always rendered).
- **The chrome OVERLAYS the text; do not reserve a strip for it.** First
  attempt reserved space via `body { padding-block-start }`, which put a band
  of dead space above every short footnote (chrox caught it in one screenshot).
  Final shape: buttons absolutely positioned at `top-2` + `end-2`/`start-2`
  (symmetric 9px inset incl. border), row is `pointer-events-none` with
  `pointer-events-auto` buttons so it cannot swallow taps on the text beneath.
  This also deleted the `jumpHrefRef` plumbing that only existed to size the
  strip from `before-render`.
- **Do not stop forcing `follow: true` on links clicked inside the popup.** It
  is deliberate (#559 / 6a74a0c5b) so a note-to-note reference renders in the
  popup with the Back button. The fix is an extra affordance, not a change to
  link routing.
- **Why the popup shows only a title**: for a link whose target is a plain
  heading, foliate's `#showFragment` finds no `li`/`aside`/`dt`/`.note`/nested-`a`
  container and falls through to `range.selectNode(el)`. Nothing to widen there.
- Reused the existing i18n key `'Jump to Location'` (already translated in every
  locale, also used by `DesktopFooterBar`), so no `i18n:extract` pass. See
  [[i18n-extract-prunes-keys]].
- Backlinks (`epub:type="backlink"`) already navigate in place with a transient
  flash rather than opening a popup; that path was untouched.

**Web QA recipe (no real book needed)**: build a tiny EPUB, copy it into
`apps/readest-app/public/`, then in the library page run
`fetch('/x.epub') -> new File([blob]) -> DataTransfer -> dispatchEvent(new DragEvent('drop', {dataTransfer, bubbles:true}))`
on `.library-page`. `useDragDropImport` picks it up. There is no
`input[type=file]` in the DOM to target, and the `+` button opens a native
picker the browser tools cannot drive. Remember to delete the epub from
`public/` afterwards. Test EPUB + re-apply script kept under the session
scratchpad `5766/`.

**Session hazards, both real**:
1. An interactive `git rebase dev onto origin/main` started in the main checkout
   mid-session and wiped the working-tree edit *and* the untracked test file.
   Working in a `pnpm worktree:new` worktree avoids this entirely.
   See [[feedback_use_worktree]].
2. A stale intermediate copy of the change survived in the main checkout and
   chrox tested THAT, reporting a regression against code I had already fixed.
   When a bug report lands, first confirm which checkout/port serves it
   (`lsof -nP -iTCP:3000 -sTCP:LISTEN` then the pid's cwd) and diff that tree
   against the committed branch before debugging.
3. `pkill -f "next dev"` kills the user's dev servers too, not just mine.
