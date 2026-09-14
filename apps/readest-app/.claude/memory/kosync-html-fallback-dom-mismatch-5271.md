---
name: kosync-html-fallback-dom-mismatch-5271
description: "#5271 (KOReader highlights land on page 1 / Readest shows KO highlights in the wrong place) was NOT fixed by #5630 and is now FIXED in foliate epub.js (closeVoidElements + parseContentDocument, 2026-09-07, PR pending): the text/html fallback for malformed XHTML builds a DOM where self-closed <a id=page_N/> anchors swallow the following <p>s, so it no longer matches crengine's; fix = close void tags and re-parse as XML before falling back to HTML (verified 19/20 byte-identical XPointers against the emulator's crengine, 2026-09-07)"
metadata:
  type: project
  originSessionId: 85280a2e-03e0-46da-8144-1e680cc6af56
  modified: 2026-09-07T13:58:56.955Z
---

Issue #5271 (ivanbeldad, Readest 0.11.20 macOS + KOReader with readest.koplugin). Reporter's two
EPUBs are at `~/Documents/books/issues/5271/` ("It's OK That You're Not OK", "Understanding and
Responding to Self-Harm"; the Gmail draft holds the same two files). chrox CLOSED it 2026-09-04
with no linked PR, presumably on the strength of #5630 (same unclosed `<meta charset>` as the
#5625 book) and #6014. **Verified 2026-09-07 on `dev` at 0041b7b3e (both fixes in): NOT fixed.**
Every one of 20 probed highlights fails in BOTH directions. Recommend REOPENING.

## Mechanism (not the #5625 null-body crash — that part is fixed)

Every spine file in both books is malformed XML the InDesign way (`<meta charset="utf-8">`
unclosed; `xmllint` says `Opening and ending tag mismatch: meta line 3 and head`). foliate's
`loadReplaced` (render) and, since #5630, `loadDocument` (`createDocument`) both retry such a file
as `text/html`. The HTML parser does NOT honour `/>` on non-void elements, and `<a>` is a
*formatting element*: the books' page anchors `<a id="page_25"/>` inside `<p>` stay open, the
newline after `</p>` reconstructs the `<a>` at BODY level, and every following `<p>` becomes a
child of that `<a>` until the next anchor (a mid-paragraph anchor runs the adoption agency
algorithm and hoists THAT `<p>` back to body level). Confirmed in real Chrome 152 via DOMParser and
in jsdom. crengine (`LVHTMLParser`, honours `/>`) keeps `<a/>` empty and all `<p>` under `<body>`.

Consequences, measured with the emulator's crengine (246 / 196 pages):
- Readest -> KO: Readest emits `/body/DocFragment[12]/body/a[1]/p[3]/text().0`; crengine has no
  `body/a[1]` -> `createXPointer` null -> `getPageFromXPointer` returns its default **1**
  (cre.cpp `int page = 1`). That is the reporter's "always page 1". 20/20 unresolvable.
- KO -> Readest: crengine emits `/body/DocFragment[12]/body/p[4]/text().0`; in Readest's DOM the
  only DIRECT `p` children of body are the chapter-number line plus paragraphs carrying a
  mid-paragraph anchor, so `p[4]` lands on an unrelated paragraph ("random places", 16/20) or
  `text()[1]` finds 0 direct text nodes and throws -> note dropped ("don't appear", 4/20).
- DocFragment indices themselves are right (`DocFragment[N]` == section N-1), so #6014 is not
  involved.

## Fix — IMPLEMENTED 2026-09-07 in packages/foliate-js/epub.js (chrox: "Can we solve #5271?")

`parseContentDocument(parser, str, mediaType)` is shared by `loadReplaced` (render) and
`loadDocument` (createDocument): XML parse -> on parsererror `closeVoidElements` (lowercase void
tags only, quoted-attribute-aware regex, skips already self-closed) -> XML re-parse -> HTML only if
still broken. Oracle result on the reporter's books after the fix: It's OK 2946/2946 and Self-Harm
1845/1845 sampled words exact in BOTH directions (was ~99% failing). Tests in
`src/__tests__/foliate-epub-malformed-xhtml.test.ts` (#5271 block: body children, empty anchors,
XPointer both ways, render path via captured blob, beyond-repair `&` still falls back to HTML).
Not browser-verified. Stored CFIs for such books DO go stale (accepted).

### Original fix direction note

In `packages/foliate-js/epub.js` `loadDocument` AND `loadReplaced`: on `parsererror` for XHTML,
first close unclosed void elements (`meta link br img hr input col area base embed param source
track wbr`) and re-parse as `application/xhtml+xml`; fall back to `text/html` only if that still
fails. Experiment on the real books: repaired-XML DOM gives XPointers byte-identical to crengine's
for 19/20 passages; the 20th differs only at a `<span class="hide">` boundary
(`p[2]/span/text().12` vs crengine `p[2]/text().0`, same visual point). Caveats: existing CFIs
stored for such books encode the `<a>`-wrapper structure and would go stale; the malformation is
ubiquitous in InDesign/ADE exports, so the blast radius is wide (mostly for the better: today
those books render every paragraph inside an anchor element).

## Headless crengine probe recipe (no GUI, no sync server)

`cd ~/dev/koreader/koreader-emulator-arm64-apple-darwin24.6.0-debug/koreader &&
KO_HOME=<scratch> ./luajit probe.lua in.json out.json` with a script that does
`require("setupkoenv")`, `package.path = "spec/front/unit/?.lua;" .. package.path`,
`require("commonrequire")` (dummy framebuffer), then `DocumentRegistry:openDocument(epub)`,
`doc:requestDomVersion(doc:getLatestDomVersion())`, `doc:render()`, and per case
`doc:isXPointerInDocument(xp)`, `doc:getPageFromXPointer(xp)`, `doc:getTextFromXPointers(a, b)`,
and `doc:findAllText(text, false, 0, 5, false)` -> `[{start, end}]` for crengine's OWN XPointers of
a passage. `require("json")` works. KO_HOME keeps `settings.tests.lua`/cache out of the emulator
dir. Readest side: vitest + `DocumentLoader(File)` on the real EPUB, `section.createDocument()`,
`CFI.joinIndir(section.cfi, CFI.fromRange(range))`, `getXPointerFromCFI(cfi, undefined,
undefined, book)`; reverse via `new XCFI(doc, index).xPointerToCFI(start, end)` +
`book.resolveCFI(cfi).anchor(doc).toString()`. Note `CFI.toRange` wants the spine step SHIFTED off
first. Runs in ~1 s each; keep probe files out of the repo.

Related: [[loaddocument-xhtml-parsererror-5625]] (the crash half, fixed),
[[kosync-percentage-reanchor-impossible-path-5980]] (DocFragment mapping, not involved),
[[koreader-highlight-deletion-dedupe-5818]], [[koreader-emulator-headless-verify]].

**Follow-up 2026-09-07:** a crengine oracle now exists ([[crengine-xpointer-oracle]]); on these two books it reports ~99% KOReader->Readest mismatches, all from the DOM shape, so the void-tag repair above remains the fix.
