---
name: footnote-popup-content-size-5887
description: "PR #5887 review - footnote popup ResizeObserver fit; verified A/B findings incl. an uncapped resize pump and the pre-existing \"image footnote never opens\" bug"
metadata: 
  node_type: memory
  type: project
  originSessionId: 33f6f263-fb2a-4c57-bff2-09321845839f
  modified: 2026-08-26T18:39:02.583Z
---

PR #5887 (`alexander-pecheny`, fork branch `fix/footnote-popup-content-size`) adds a
`ResizeObserver` on the popup document's `documentElement` plus imperative size
seeding in `src/app/reader/components/FootnotePopup.tsx`. Reviewed 2026-08-27;
**MERGED** by chrox as squash 7c0419961 on origin/main, worktree + branches removed.

Verified A/B in Chrome 151 in worktree `readest-pr-5887`, swapping ONLY
`FootnotePopup.tsx` between the PR and `09ce80872` (origin/main), against a
purpose-built probe EPUB with 4 footnotes (short text / long text / image / CSS-animated):

| footnote | main | PR #5887 |
|---|---|---|
| short text | shown 360x57.6 | same |
| long text | shown 720x427, 2 size updates | same |
| image | never shown, 88px | never shown, 385px |
| CSS-animated | shown 360x107, **3** updates | shown 360x186, **205** updates in 4s |

**The regression:** `maxSizeAdjustCount` used to cap *every* size adjustment; the PR
moved it so it only guards the cross-axis widening. The observer -> rAF ->
`fitPopupToContent` chain is uncapped, so content that keeps changing size (CSS
animation/transition, `<video>`, late reflow) pumps a React re-render + a full
paginator relayout every frame, indefinitely. Codex independently ranked this P1.

**Why image footnotes staircase:** `paginator.scrolled()` calls
`setImageSize(availableWidth, availableHeight)` with the CONTAINER height, which
clamps every `img` `max-height` to the popup box height. Sizing the box from
`renderer.viewSize` therefore feeds back: bigger box -> bigger image -> taller
content -> bigger box. Measured 8 steps of exactly 39.59px in 210ms; the step size
is the non-image content height, so **image-only footnotes are a fixed point stuck
at the 88px seed** (true on main too). See [[eink-class-substring-matchers]] style
note: this coupling is a foliate invariant to remember.

**Separate PRE-EXISTING bug found during the review (NOT caused by #5887; FIXED by
me on top of it and PUSHED to the PR as e13f58c05 and merged with it, a fast-forward
890c7d8b0..e13f58c05 onto the contributor's fork branch, no history rewrite -
cherry-picked onto the REAL PR head, never pushing the worktree's rebased branch):** an image footnote popup never becomes visible. Instrumented the popup
view: it emits `load` and `create-overlay` but **never `relocate`**, and
`setShowPopup(true)` lives only in the `relocate` handler, so `#popup-container`
stays `aria-hidden="true"` at `left:-999px` forever. Identical on main. chrox saw
this live ("Image note does not show"). Fix shipped = show the popup from the content observer's rAF once
`fitPopupToContent(view) > 0`, since a measured size is what `relocate` was
standing in for. Regression test added to `FootnotePopupSizing.test.tsx`
(fake foliate view + controllable ResizeObserver/rAF stubs). Chrome-VERIFIED all
4 probe footnotes now open; full suite 10155 green, lint + format clean.

Other findings: `fitPopupToContent` can commit a 0 size (`renderer.viewSize` is 0
when the paginator has no primary view) - only the cross-axis branch guards
`> 0`; a detached iframe stops delivering RO callbacks in Chrome (verified), so it
is latent there but untested on WebKit, which is where the reporter verified.
`stopTrackingPopupContentSize()` is missing from the in-popup `link` handler and
`handleBack`, contradicting commit f18444e93's message.

AS REVIEWED (the contributor's #5887 branch), `FootnotePopupSizing.test.tsx`
stubbed `ResizeObserver` to a no-op and covered only the alt-attribute path (a
real regression test there: fails on main with `88px`, passes with `152px`), so
the observer path had no coverage. THAT NO LONGER HOLDS: my e13f58c05 on top
replaced the stub with the controllable one described above (callbacks captured
in `h.resizeObservers`, frames in `h.frames`) and added the second describe,
"footnote popup whose section never emits relocate", which fires
`h.resizeObservers.forEach(cb => cb([]))` + `flushFrames()` and asserts
`aria-hidden` flips to `false`. The observer path IS covered on main.

Gates before merge: `pnpm test` 10154 passed / 16 skipped, `pnpm lint` (tsc + biome)
green. Rebased on #5892, one commit behind main.

The reported symptom (a *text* footnote cut to 2-3 lines, iPhone screenshot) does
NOT reproduce on desktop Chrome - long text sized identically on both branches.
The verified improvement is only for content arriving after the first relocate.

Related: [[footnote-popup-jump-to-location-5766]],
[[footnote-popup-revokes-section-blobs]], [[footnote-popup-selection-5646]].


## 2026-09-01: root cause measured in Chrome

Both a horizontal AND a vertical scrollbar render on every footnote popup, even a
one-line one. They are **mutually induced by a 2px sizing error**, not by content
length, so the popup looks identical for short and long notes.

`Popup.tsx` (~L183) sets `.popup-container` to `width: ${width}px` with
`box-sizing: border-box` and a 1px `border`, and the content is sized to that same
number. Measured live: `offset 360x58`, `scroll 360x58` (the content iframe),
`client 343x41`, border 1px all round, padding 0, scrollbar thickness **15px on
both axes** (space-consuming, not overlay).

The deadlock: content 360 wide vs 358 usable -> horizontal bar appears and eats
15px of height -> 41 usable vs 58 tall -> vertical bar appears and eats 15px of
width -> 343 usable, which keeps the horizontal bar justified. Each bar holds the
other up. Remove the borders from the equation and 360 <= 360 / 58 <= 58, so
NEITHER bar should show.

Fix direction: size the content to the container's CONTENT box, not its
border-box (or give the popup body `width/height: 100%` inside a container that
owns its borders, instead of passing a pixel width to both). Regression assertion:
`popup.scrollWidth <= popup.clientWidth` and `scrollHeight <= clientHeight`.

**`Popup.tsx` is shared** by FootnotePopup, AnnotationPopup, TranslatorPopup and
DictionaryPopup, so check whether all four pass the width the same way before
treating this as a one-line fix.

Diagnostic traps hit on the way: `elementFromPoint` at the popup's right/bottom
edge is what identifies the drawer as `.popup-container` rather than the content;
probing `overflow:auto` with content that fits reports a 0 gutter and tells you
NOTHING about scrollbar thickness (use `overflow:scroll`); and the reader's book
iframe is one wide horizontal strip (w ~24000, negative left), so noteref pixel
coordinates from `getBoundingClientRect` do not map to the screen. Click the
`a[epub:type=noteref]` element directly instead.
