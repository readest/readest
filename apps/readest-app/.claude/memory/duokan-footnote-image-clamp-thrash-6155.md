---
name: duokan-footnote-image-clamp-thrash-6155
description: "#6155 paged mode froze on Duokan-footnote EPUBs — setImageSize read used-value margins between style writes, one relayout per image"
metadata:
  type: project
---

# #6155 — paged mode freezes on a Duokan-footnote EPUB (0.12.8 regression)

Repro book: 唐诗选 (马茂元), two 1.1 MB single-file sections, 2125 `<img>` in one
of them (Duokan marks every footnote with an inline image). Scrolled mode fine,
paged mode frozen for minutes. Windows + Android; not in 0.12.6.

**Root cause.** foliate-js `f71a084` (#90, shipped in readest `26a4bcaf0`, after
0.12.6) made `setImageSize` read the element's own margins so it could cap the
*margin* box. The loop interleaved per element: `removeProperty` →
`getComputedStyle` → `setStylesImportant`.

The load-bearing detail measured in Chrome: **`marginTop` / `marginBottom` are
resolved to used values and force layout; `marginLeft` / `marginRight` do not.**
`maxWidth` / `maxHeight` (what the pre-#90 code read) are computed values and are
free. So the new read flushed a full re-fragmentation of a 277,560 px-wide
multicol document that the previous iteration's write had just dirtied — once
per image. And `marginTop`/`marginBottom` are read unconditionally even though
only the `vertical` branch uses them.

**Fix** (foliate-js#96, merged b9dcd03, `packages/foliate-js/paginator.js`, `setImageSize`): three phases —
clear inline constraints, then read every element's computed style into an
array, then write. One layout for the whole pass.

**Numbers** (M-series Mac, Chrome, real book's biggest section through the real
paginator): 24,953 ms → 803 ms. Synthetic 2000-image fixture: 23,996 ms → 882 ms.
Interleaved cost was ~12 ms per image and grows with section size.

**Verified in Chrome, real app** (`pnpm dev-web`, `/library?url=…` imports and
auto-opens a book, but the web app is auth-gated so the user must be signed in):
without the fix the renderer goes unresponsive and CDP `Page.captureScreenshot`
times out; with it the book opens to page 875/1565 and footnote popups work.

**Test**: `src/__tests__/document/paginator-image-size-perf.browser.test.ts` with
`src/__tests__/fixtures/data/repro-6155-footnote-images.epub` (2000 footnote
images in one 1.2 MB section; the zip is 25 KB because the filler text repeats).
Budget 5000 ms sits between 882 ms (fixed) and 23,996 ms (broken).

**Rule**: in a loop over many elements in a columnized document, never read a
resolved style between writes. Batch reads, then writes. See
[[paginator-scroll-fixes]] and [[adhoc-visual-check-daisyui-theme-tokens]] for
other browser-harness recipes.

## #6212 is the same bug

Same reporter, same Drive file (sha256 `b41bae74…`, 1,056,596 bytes), and the body
points at #6155. Its title blames "large quantities of text in a single HTML" —
that is the wrong mechanism. Control run: strip every `<img>` out of that same
book (text volume unchanged) and it opens in **253 ms without the fix** and
326 ms with it. Section size is only a multiplier on each forced relayout; the
replaced elements are the cause.

A comment there (JackyHe398) reports slow **margin changes** too. Same cause, and
worse than opening: on a re-render `removeProperty('max-width')` actually removes
a previously-set value, so every iteration dirties layout, where on first open
some of those removals are no-ops.

Real book, biggest section (1989 images), before → after:

| | broken | fixed |
|---|---|---|
| open | 27,542 ms | 525 ms |
| margin change (`margin-*` attrs, as FoliateViewer sets them) | 105,441 ms | 544 ms |
| same book, images stripped | 253 ms | 326 ms |
