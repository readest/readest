---
name: pdf-copy-join-lines-5814
description: "#5814 copied PDF text one line per printed line; geometry-based paragraph rebuild in getTextFromRange via src/utils/pdfText.ts; MERGED #5828 (a2f123ff9); Chrome-web verified on 3 PDFs; known heuristic gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: bc9d2bd7-f2f5-4c74-9d6a-5dea9b8de3c2
  modified: 2026-08-22T18:29:30.981Z
---

Issue #5814 (2026-08-21): copying/annotating/translating a PDF selection gave one line of text per printed line (pdf.js emits `<span>` per run + `<br role="presentation">` per EOL; `getTextFromRange` turned every `<br>` into `\n` since #5202). Fix MERGED via PR #5828 (`a2f123ff9`) on 2026-08-23; worktree removed.

**Design** (`src/utils/pdfText.ts`, pure `classifyPdfLineBreaks` + DOM `getPdfTextFromRange`; `getTextFromRange` delegates when `range` sits in `.textLayer`): each `<br>` is `paragraph | space | join | dehyphenate`, decided from live `getBoundingClientRect` geometry of the whole page: vertical step > 1.3x lower-median pitch, font-size change > 20%, centred pair, indented first line (indent > 1em past the column's modal left edge AND previous line not indented), or the fit test (column right edge, 85th percentile of same-font/same-left lines, minus line right > next line's first-word width + 0.3em). Joins drop a line-end hyphen before a lowercase continuation, keep it otherwise ("Times-" + "Roman"), no space when either side is CJK/Hangul/fullwidth punctuation. No geometry (jsdom, unrendered page) => old `\n` behaviour. The PDF right-click translate path now uses `getAnnotationText` instead of `sel.toString()`.

**Verified in Chrome web (dev-web :3005)**: IEEE two-column sample (`src/__tests__/fixtures/data/sample-paper.pdf`): paragraphs one line each, headings separate, paragraph continues across the column break; `~/Downloads/What we listen to...EDM.pdf` slide deck: CJK caption wrapped mid-word joined without spaces, centred title lines kept separate; `sample-alice.pdf` novel spread: 4 paragraphs => 4 lines incl. one-line dialogue. The indent rule was added after a real miss: a last line only ~1em short of full with next word "The" (13px) was merged.

**Known gaps (accepted)**: nearly-full last line with NO indent/gap => merged with next paragraph; right-aligned blocks join; Korean treated as no-space script; a bulleted list that outnumbers body lines on a page shifts the modal left edge (ties go right). No settings toggle (scope rule).

**Why:** The heuristic thresholds are tuned on real PDFs; future reports ("paragraphs merged", "lines not joined") should be checked against these rules before changing constants.

**How to apply:** Dump row geometry in the page with the snippet pattern used here (walk `.textLayer` children, group at `<br>`, `getBoundingClientRect` per span) and compare with `classifyBreak` order. Chrome-MCP recipe for PDF selection tests: find iframes through shadow roots (`foliate-view`), build a Range in `iframe.contentDocument`, `addRange`, dispatch `pointerup`/`mouseup` on the end span, then `document.querySelector('button[aria-label="复制"]').click()` (zh UI) with `navigator.clipboard.writeText` wrapped to capture text; synthetic mouse drags and `cmd+c` key events did NOT work. Web import without a picker: `fetch('/_tmp/x.pdf')` from `public/_tmp` (delete before commit) => `DataTransfer` => `DragEvent('drop')` on `.library-page`. See [[feedback-always-verify-on-xiaomi]] for the device recipe (not done for this change).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5814 PDF copy joins line wraps into paragraphs](pdf-copy-join-lines-5814.md) MERGED #5828; geometry heuristics in `src/utils/pdfText.ts`; Chrome-web verified on 3 PDFs; nearly-full unindented last line still merges
