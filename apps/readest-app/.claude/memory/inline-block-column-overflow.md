---
name: inline-block-column-overflow
description: Foliate paginator fix — atomic-inline (inline-block) boxes too tall to fragment clip content in paginated mode
metadata: 
  node_type: memory
  type: project
  originSessionId: f0c35f7b-d4ff-4275-9f13-7019b0e167d9
---

Bug: a chapter's content jumps straight to its "Reference materials", silently skipping a large middle (deep-dive/wrap-up). Repro book: "System Design Interview Vol.2" (System Design EPUB), Chapter 8 `OEBPS/c554.xhtml`, reported "at page 346".

Root cause: the EPUB's own CSS wraps the whole chapter body in a `<div>` with `display: inline-block` (`.class_s5mz1`). Atomic inline-level boxes (inline-block / inline-flex / inline-grid / inline-table) **cannot fragment across CSS columns**, so in paginated (columnized) mode the 7700px-tall box overflows the page vertically and every column past the first is clipped → "1 page left in chapter" while most of the chapter is unreachable. Direct `goTo({index})` and forward `next()` both still RENDER the section (engine traverses by content), so the symptom only manifests as clipped/unreachable pages + bogus page counts; scrolled mode is unaffected (vertical overflow is normal there).

Diagnosis tell: in column mode `documentElement.scrollHeight >> clientHeight` (e.g. 7768 vs 632); late headings stack vertically at one far-right column-left offset instead of spreading across columns.

Fix: `packages/foliate-js/paginator.js` → `#demoteUnfragmentableBoxes(availableHeight)`, called from `columnize()` after `setImageSize` (column-mode only). Guarded fast-path: returns immediately unless `scrollHeight > clientHeight + 1`. When overflowing, scans `body.querySelectorAll('*')`, and for any element whose computed display is atomic-inline AND `getBoundingClientRect().height > availableHeight`, demotes to the fragmentable equivalent (inline-block→block, inline-flex→flex, inline-grid→grid, inline-table→table) via `setStylesImportant`. Idempotent (demoted elements no longer match), regression-free (short legit inline-blocks like side-by-side figures untouched — they're never page-tall). Mirrors the existing `setImageSize` over-tall-image clamp and the `p { display: block }` rule in `style.ts` ("epubs set insane inline-block for p").

Test: `src/__tests__/document/paginator-inline-block-overflow.browser.test.ts` + fixture `repro-inline-block-overflow.epub` (one chapter wrapped in `.wrap{display:inline-block}`, 50 paras + TAIL_MARKER). Asserts `scrollHeight <= clientHeight+2`, wrap display `block`, tail heading in a later column within page height. Needs real layout → browser test (jsdom has no layout). Dev server (Next/Turbopack) picks up the workspace foliate-js edit on reload. Related: [[paginator-gutter-bleed-asymmetry-4394]].
