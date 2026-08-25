---
name: pdf-page-labels-reference-pages-5822
description: "Issue #5822 PDF page labels in the progress bar - MERGED 2026-08-22 via foliate-js#81 (makePDF book.pageList, squash e994c18) + readest PR #5824 (3e9aacb); labels only under the Reference Pages style; submodule pinned at a branch commit; dev-web verify recipe"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb37a1b9-b16d-4542-84ff-00269a3187d8
  modified: 2026-08-22T17:16:25.582Z
---

Issue #5822: show PDF page labels (`viii`, `139`) instead of physical page indices in the footer. MERGED 2026-08-22:
- readest/foliate-js#81 squash-merged as e994c18 (branch commit was 403c31a): `makePDF` builds `book.pageList` from `pdf.getPageLabels()`, one `{label, href: JSON.stringify(i), index: i}` per page; `resolveHref`/`splitTOCHref` accept a JSON number href as a page index. PDF.js ignore rule: every label empty-or-`String(i+1)` -> `pageList = null`. `getPageLabels()` rejection is caught.
- readest/readest#5824 merged as 3e9aacb: submodule bump + `src/__tests__/foliate-pdf-page-labels.test.ts` (8 cases) + `getPageLabels: vi.fn(async () => null)` in the 3 other pdf.js doubles (range-concurrency, pdf-canvas-memory-cap, pdf-spread-seam). NO readest source change was needed: `getReferencePageInfo`, `PageJumpInput` (`findReferencePageHref`), and LayoutPanel's "Reference Page Count" hide-when-pageList already consume `pageList`/`pageItem`.
- readest main pins `packages/foliate-js` at 403c31a, which is NOT on foliate main (squash). It stays fetchable only while the fork branch `feat/pdf-page-labels` (or the PR head ref) exists; the next foliate bump should move to e994c18 or later. Worktree and local branch removed 2026-08-23. Test book "PageLabelsTest" (hash 4a4ab57fdeb82c305f7f5451f482a925) was left in the Chrome dev-web library at localhost:3000.

**Why:** The footer's Reference Pages style (#5716) is the existing "printed page" channel for EPUB page-list navs, so PDF labels ride it unchanged; the default Page Number style stays physical (`10 / 254`) and the sidebar TOC still shows `item.index + 1` for PDF outlines. Showing labels by default (PDF.js style `viii (10 of 254)`) was flagged in the PR as an open product choice. `getReferencePageInfo` total = highest numeric label, so the issue's torture PDF (`i..iv, 1..4, Arabic-Indic, " Long Label - n"`) reads `/ 4`; a real `i..xiv, 1..240` book reads `/ 240`.

**How to apply:** Any pdf.js test double that feeds `makePDF` now needs `getPageLabels`. Verify recipe that worked in dev-web: import via synthetic `new DragEvent('drop', {dataTransfer})` dispatched on `.library-page` (no file input exists); direct `/reader?ids=<hash>` navigation bounced back to the library, click the cover instead; flip a React-controlled `<select>` with the native `HTMLSelectElement.prototype.value` setter + bubbling `change`; the desktop footer's page-jump box is the SECOND `input[enterkeyhint=go]` (the first is the hidden mobile one). Vendored pdf.js runs in plain Node for label dumps: `import('packages/foliate-js/vendor/pdfjs/pdf.mjs')` then `getDocument({data}).promise.getPageLabels()`. Related: [[reference-page-count-sync-5716]], [[feedback-always-verify-on-xiaomi]] (device check on a real labelled PDF still pending).


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5822 PDF page labels as reference pages](pdf-page-labels-reference-pages-5822.md) MERGED foliate#81 + PR #5824; keep foliate branch `feat/pdf-page-labels` until next bump; device verify pending
