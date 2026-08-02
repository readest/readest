---
name: annotation-json-export-import-5400
description: "#5400 JSON annotation export/import MERGED #5440 - bookmark `text` is a display snippet not an anchor; resolveCFI is EPUB-only; real-export fixture replays in CI"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7bfbdab1-feb1-40f9-857a-301429dd6133
  modified: 2026-08-02T14:03:35.516Z
---

#5400 "export/import annotations as JSON" -> **MERGED #5440** (squash `55691602b`) 2026-08-02. Worktree and branch cleaned up.

New `src/services/annotation/providers/readest.ts`: `buildAnnotationExport` / `parseAnnotationExport` / `convertAnnotationExportToBookNotes`. Export rides `ExportMarkdownDialog` via a Format select (`NoteExportConfig.exportFormat: 'markdown'|'text'|'json'`, legacy `exportAsPlainText` kept and mirrored on save). Import = new `Readest` row in `ImportAnnotationsDialog`.

## The bug only a real book found

**A bookmark's `text` is a display snippet, NOT an anchor assertion.** Gating bookmarks on text equality corrupts them three different ways, all seen in one 159-annotation library book:
- collapsed **point** CFI (`.../1:156`) -> `range.toString()` is `''`, never matches -> dropped
- `text` is a **truncated prefix** of what the range covers -> wrongly re-anchored
- `text` is literally `'in Chapter 9 - The Mock Turtle's Story'` — a chapter label, not book text

Fix is one line: `entry.type !== 'bookmark' && entry.text`. Bookmarks are judged purely on whether the CFI resolves. Result went `154 kept / 3 relocated / 5 dropped` -> `158 / 1 / 1`. **Unit tests with synthetic data never would have caught this** — the fixtures I wrote assumed bookmarks carry no text, which is exactly the wrong assumption.

**So the real data now ships as a fixture.** `src/__tests__/fixtures/data/alice-annotations.json` = 24-entry trimmed slice of a genuine export, replayed against the existing `sample-alice.epub` (same edition — verified, CFIs resolve) in `readest-annotation-import-real-book.test.ts`. Runs in ~2s in the normal vitest lane, no browser. Reverting the bookmark rule fails 3 of its 7 tests. When an anchor-matching heuristic is involved, get a real export from the app and replay it; synthetic DOMs just re-encode your own assumptions.

## Other gotchas

- **`bookDoc.resolveCFI` exists only on EPUB.** foliate's `epub.js` defines it; TXT/MD/CBZ/PDF sections carry synthetic `CFI.fake.fromIndex(i)` CFIs. Fallback must mirror `view.js`: `CFI.parse` -> `CFI.fake.toIndex((parts.parent ?? parts).shift())` -> `doc => CFI.toRange(doc, parts)`. `.shift()` mutates `parts` and the anchor closure depends on that mutation. Added as optional to the `BookDoc` interface.
- Re-anchor reuses `searchMatcher(textWalker, ...)` from `foliate-js/search.js` — handles highlights spanning multiple elements, unlike mrexpt's single-text-node `findWordRange`. With `matchCase + matchDiacritics` the sensitivity resolves to `'variant'` -> routes to `simpleSearch` = **exact substring**, so whitespace drift between editions misses. Known limitation, reported in the toast.
- Annotations on **translator-injected content** (Parallel Read) can never survive export: the text isn't in the book file. Correctly dropped and counted.
- Unmatched notes are dropped entirely (user's call), deliberately unlike the mrexpt path which anchors misses at chapter start.
- Progress/location adopted only when the target book has no `location`. `setConfig` returns void — build the merged config by hand before `saveConfig`.

## Verifying this in a browser (reusable recipe)

Web `selectFileWeb` builds a **detached** `<input type=file>` and calls `.click()`, so `file_upload` can't see it. Patch `HTMLInputElement.prototype.click` to intercept `type === 'file'`, append the input to the DOM, and suppress the native picker — then `find` + `file_upload` works. Remove stale inputs between runs or you upload to a dead one.

Read the export straight off the dialog's `font-mono` preview div (it IS the file content) and POST it to a tiny local CORS sink; the real download hits a native save panel you can't drive.

**Never instrument with a `MutationObserver` that reads `document.body.innerText`** — it forces a full-document reflow per mutation and made a 320 ms import look like 30-60 s. I nearly filed a perf bug against my own code. Use `requestAnimationFrame` + a cheap attribute/selector check instead.

## Rebase hazard

`dev` was 7 commits behind `origin/main`; wholesale-copying my touched files into a fresh worktree clobbered upstream #5424 (cover-image export) in `ExportMarkdownDialog.tsx` and `READEST_PUBLIC_ASSETS_BASE_URL` in `constants.ts`. Correct move: reset the worktree to `origin/main`, re-apply source edits by hand, and regenerate locales with `pnpm i18n:extract` + the translate script rather than merging 33 JSON tails. Also watch for *other people's* uncommitted work in the tree (`bookService.ts`, `document.ts` `destroy?()` from #5387) — exclude it from the commit.

Related: [[feedback_en_plurals_manual]] (the two `{{count}}` keys need hand-written en `_one`/`_other`; `i18n:extract` won't add them), [[i18n-extract-prunes-keys]], [[feedback_use_worktree]].
